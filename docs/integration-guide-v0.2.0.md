# Logexus AI Browser v0.2.0 — 对接文档

**版本**: v0.2.0
**更新**: 2026-07-30

---

## 一、架构概览

v0.2.0 将外部通信统一为**单进程 Native Host**，同时暴露两种协议：

```
Logexus Tauri (Rust)         Claude Code / LangGraph          Python 脚本 / curl
     │                              │                              │
     │ WebSocket                    │ MCP SSE                      │ HTTP POST
     │ JSON-RPC 2.0                 │ GET /sse + POST /messages   │ /api/agent
     │                              │                              │
     └──────────────┬───────────────┴──────────────┬───────────────┘
                    │                              │
                    ▼                              ▼
          ws://127.0.0.1:9527          http://127.0.0.1:9527
                    │                              │
                    └──────────┬───────────────────┘
                               ▼
                    ┌─────────────────────┐
                    │    Native Host      │
                    │    (Node.js 单进程)  │
                    └─────────┬───────────┘
                              │ WebSocket
                              ▼
                    ┌─────────────────────┐
                    │  Chrome Extension   │
                    │  (DOM/CDP 执行层)    │
                    └─────────────────────┘
```

| 协议 | 端口 | 用途 | 调用方 |
|:--|:--|:--|:--|
| WebSocket + JSON-RPC 2.0 | `:9527` | 浏览器指令 | Logexus Tauri, Python 脚本 |
| WebSocket + AGENT_REQUEST | `:9527` | 浏览器指令（旧协议） | 旧版调用方 |
| MCP SSE | `:9527/sse` | AI Agent Tool | Claude Code, LangGraph |
| HTTP POST | `:9527/api/agent` | 浏览器指令（HTTP） | curl 测试, 简单脚本 |
| HTTP GET | `:9527/health` | 健康检查 | 运维监控 |

**所有协议共享同一进程和端口，无需手动启动多个服务。**

---

## 二、启动方式

### 2.1 手动启动

```powershell
node D:\CCWorkSpace\LogexusAIBrowser\native-host\host.js
```

输出：
```
[NativeHost] INIT → STARTING
[FileOffloader] Init done, dir: C:\Users\...\AppData\Local\Temp\logexus
[NativeHost] HTTP+WS on http://127.0.0.1:9527
[NativeHost] Extension connected via WebSocket    ← 扩展连上后出现
```

按 `Ctrl+C` 退出。

### 2.2 Windows 开机自启（v0.2.1+）

**主方案**：注册 Windows 开机自启。

```powershell
# 注册自启（仅需一次）
native-host\install-autostart.bat

# 或手动注册
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" ^
    /v "LogexusNativeHost" /d "\"D:\CCWorkSpace\LogexusAIBrowser\native-host\start-silent.vbs\"" /f
```

Native Host 会在 Windows 登录时通过 VBS 脚本在后台静默启动，无需命令行窗口。

**备选方案**：Chrome Native Messaging 自动拉起。通过 `install.bat` 注册后，Chrome 在扩展调用 `chrome.runtime.connectNative()` 时自动启动 Native Host。需 Chrome 完全重启后生效。

> 详细设计见 [auto-start-design.md](auto-start-design.md)。

### 2.3 健康检查

```powershell
curl -s http://127.0.0.1:9527/health
```

正常响应：
```json
{"status":"RUNNING","extensionConnected":true,"pendingRequests":0,"sseConnected":false}
```

状态字段说明：

| status | 含义 |
|:--|:--|
| `STARTING` | 刚启动，无 Agent 连接 |
| `RUNNING` | SSE Agent 已连接 |
| `DEGRADED` | Agent 断开，等待重连（30 分钟超时） |
| `DRAINING` | 正在退出，等待未完成请求 |
| `EXITED` | 已退出 |

`extensionConnected: true` 表示 Chrome Extension 已通过 WebSocket 连上。

---

## 三、Logexus Tauri 桌面端对接

### 3.1 现状

Logexus Tauri 的 `browser.rs` **无需任何修改**即可对接 v0.2.0 Native Host。

**原因**：`browser.rs` 已经通过 WebSocket 连接到 `ws://127.0.0.1:9527`，发送 JSON-RPC 2.0 消息（`role=agent`）。v0.2.0 Native Host 兼容此协议。

### 3.2 连接参数

```rust
// browser.rs 中已有的连接配置（无需改动）
const BROWSER_WS: &str =
    "ws://127.0.0.1:9527?token=lx_3696ac533d9ddfb81d5e50340f205317&role=agent";
```

### 3.3 支持的方法映射

| Rust 调用的 JSON-RPC Method | Native Host 转换为 | Extension 执行的操作 |
|:--|:--|:--|
| `browser.get_context` | `observe` | DOM 采集，返回交互元素列表 |
| `browser.navigate` | `navigate` | 页面跳转 |
| `browser.reload` | `reload` | 页面刷新 |
| `action.click` | `click` | 点击元素 |
| `action.input` | `type` | 输入文本 |
| `action.scroll` | `scroll` | 页面滚动 |
| `screenshot` (旧协议) | `screenshot` | 视口截图 |

### 3.4 调用示例

Rust 端（已有代码，无需改动）：
```rust
// observe
let result = browser_observe().await?;
// navigate
let result = browser_navigate("https://example.com".into()).await?;
// click
let result = browser_click("el_5".into()).await?;
```

### 3.5 LangGraph Sidecar 对接

Logexus 的 LangGraph sidecar 通过 `tools/browser.py` → HTTP `:47800` → Rust MCP Bridge → `send_browser_action()` → WebSocket `:9527`。

这条链路在 v0.2.0 下**完全兼容**，因为 Rust 层的 `send_browser_action()` 已经直接对接了 WebSocket/JSON-RPC 2.0 路径。

### 3.6 授权流程（LOGEXUS_SKIP_AUTH）

**默认行为**：首次安装 `LOGEXUS_SKIP_AUTH = OFF`，非 observe 操作需授权确认。

**非阻塞授权**：Extension 不弹窗、不阻塞，直接返回 `auth_required` 给调用方。

```
Logexus 发送: navigate(https://www.baidu.com)
        ↓
Extension 返回: {"status":"auth_required","data":{"auth_action":"navigate",...}}
        ↓
Logexus 对话窗: "确认执行 navigate(https://www.baidu.com)? [允许] [拒绝]"
        ↓ 用户点 [允许]
Logexus 重发: navigate(https://www.baidu.com) + __auth_approved: true
        ↓
Extension 返回: {"status":"success","data":{...}}
```

**Rust 端实现示例**：

```rust
// browser.rs 中已有的 send_browser_action 函数，增强授权处理
pub(crate) async fn send_browser_action_with_auth(
    action: &str, payload: serde_json::Value
) -> Result<String, String> {
    // 第一次尝试
    let result = send_browser_action(action, payload.clone()).await?;
    
    // 检查是否需要授权
    let v: serde_json::Value = serde_json::from_str(&result).unwrap_or_default();
    if v["status"] == "auth_required" {
        // 发送 auth_required 事件到前端，让用户确认
        emit_tauri_event("browser-auth-required", &v["data"]);
        
        // 等待用户确认后，携带 __auth_approved 重试
        let mut approved_payload = payload.clone();
        if let Some(obj) = approved_payload.as_object_mut() {
            obj.insert("__auth_approved".into(), serde_json::Value::Bool(true));
        }
        return send_browser_action(action, approved_payload).await;
    }
    
    Ok(result)
}
```

**查询/切换授权状态**（通过 `chrome.runtime.sendMessage`）：

```javascript
// 查询
chrome.runtime.sendMessage(EXTENSION_ID, {type: 'GET_SKIP_AUTH'}, resp => {
    // resp.skipAuth: true → 已跳过, false → 需授权
});

// 永久关闭授权（开发调试用）
chrome.runtime.sendMessage(EXTENSION_ID, {type: 'SET_SKIP_AUTH', payload: {skip: true}});
```

### 3.7 使用 v0.2.0 新增的 5 个语义 Tool

v0.2.0 新增的语义工具可以通过 MCP SSE 或直接通过 Native Host 的 AGENT_REQUEST 通道调用：

| Tool | 等价 AGENT_REQUEST | 说明 |
|:--|:--|:--|
| `extract_network_apis` | `network_start` → 等待 → `network_stop` | 抓取页面 API 调用 |
| `get_auth_cookies` | `evaluate` (document.cookie) | 导出登录态 |
| `screenshot_fullpage` | `screenshot` (+ full_page 参数) | 全页长截图 |
| `export_pdf` | `evaluate` (pdf_export) | 导出 PDF |
| `get_storage` | `evaluate` (localStorage/sessionStorage) | 读取本地存储 |

**注意**：这些语义 Tool 需要 Chrome Extension 端实现对应的 CDP 命令（`Page.printToPDF`、`Page.captureScreenshot(full)` 等）。当前 Extension 端尚未完全实现，后续版本补齐。

---

## 四、Claude Code 对接

### 4.1 配置

在 Claude Code 的 MCP 配置文件中添加：

**配置文件位置**：
- Claude Code: `~/.claude/claude_desktop_config.json` 或 `~/.claude/mcp.json`
- VS Code 插件: `.vscode/mcp.json`

```json
{
  "mcpServers": {
    "logexus": {
      "url": "http://127.0.0.1:9527/sse"
    }
  }
}
```

> **注意**：v0.2.0 使用 SSE over HTTP 模式（`url` 字段），而非 stdio 模式（`command` 字段）。原生 HTTP 端口无需额外进程。

### 4.2 可用工具（13 个）

#### 基础操作 (7)

| Tool | 描述 | 必填参数 |
|:--|:--|:--|
| `observe` | 观察浏览器页面，返回交互元素列表(≤150) | 无 |
| `click` | 点击元素(按 `el_N` ID) | `target_id` |
| `type` | 向输入框输入文本 | `target_id`, `value` |
| `navigate` | 跳转到 URL | `value` |
| `extract` | CSS 选择器提取数据 | `value` |
| `scroll` | 滚动页面 | `value` ("up"/"down") |
| `screenshot` | 截取视口为 JPEG | 无 |

#### CDP 能力 (1)

| Tool | 描述 | 必填参数 |
|:--|:--|:--|
| `evaluate` | 在页面中执行 JavaScript | `value` (JS 表达式) |

#### 高级语义工具 (5)

| Tool | 描述 | 关键参数 |
|:--|:--|:--|
| `extract_network_apis` | 自动捕获并按域名过滤 API 调用 | `domain_filter`, `capture_duration_ms` |
| `get_auth_cookies` | 导出 Cookie 为 Netscape/JSON 格式 | `domain`, `format` ("netscape"/"json") |
| `screenshot_fullpage` | 截取完整长图(含滚动区域) | `max_height_px`, `format` ("png"/"jpeg") |
| `export_pdf` | 导出页面为 PDF | `landscape`, `paper_size` ("A4"/"Letter"/"Legal") |
| `get_storage` | 读取 localStorage/sessionStorage | `include`, `key_prefix`, `max_value_length` |

### 4.3 使用示例

在 Claude Code 中直接对话：

```
> 帮我打开京东搜索"机械键盘"，然后告诉我第一页有哪些品牌
```

Claude Code 会自动调用：
1. `navigate` → 打开 jd.com
2. `observe` → 获取页面结构，找到搜索框元素 ID
3. `type` → 输入"机械键盘"
4. `click` → 点击搜索按钮
5. `observe` → 获取搜索结果
6. 返回品牌列表

---

## 五、LangGraph (Python) 对接

### 5.1 安装依赖

```bash
pip install langchain-mcp-adapters
```

### 5.2 代码示例

```python
import asyncio
from mcp import ClientSession
from mcp.client.sse import sse_client
from langchain_mcp_adapters.tools import load_mcp_tools
from langgraph.prebuilt import create_react_agent
from langchain_openai import ChatOpenAI


async def main():
    # 1. 连接到 Logexus Native Host 的 SSE 端点
    async with sse_client("http://127.0.0.1:9527/sse") as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # 2. 将 Logexus 的 13 个工具加载为 LangGraph Tool
            tools = await load_mcp_tools(session)

            # 3. 创建 Agent
            model = ChatOpenAI(model="gpt-4o")
            agent = create_react_agent(model, tools=tools)

            # 4. 执行任务
            result = await agent.ainvoke({
                "messages": [
                    {"role": "user", "content": "打开百度搜索 LangGraph 最新版本"}
                ]
            })
            print(result)


asyncio.run(main())
```

### 5.3 工具列表

加载后，`tools` 将包含 13 个 LangChain Tool 对象，名称格式为 `logexus_browser__observe`、`logexus_browser__click` 等。

### 5.4 在 Logexus 自身的 LangGraph Sidecar 中使用

Logexus Tauri 的 `langgraph-sidecar/` 已有完整的 Agent 系统。如果想让其直接调用 LogexusAIBrowser 的能力（而非走 Rust Bridge），可以添加：

```python
# tools/browser_extension.py (新增文件)
from mcp import ClientSession
from mcp.client.sse import sse_client

EXTENSION_URL = "http://127.0.0.1:9527/sse"

async def call_extension_tool(tool_name: str, args: dict) -> str:
    async with sse_client(EXTENSION_URL) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, args)
            return result.content[0].text
```

---

## 六、Python 脚本 / curl 对接

### 6.1 WebSocket (JSON-RPC 2.0) — 推荐

```python
# pip install websockets
import asyncio
import json
import websockets


async def browser_observe():
    uri = "ws://127.0.0.1:9527?token=lx_3696ac533d9ddfb81d5e50340f205317&role=agent"
    async with websockets.connect(uri) as ws:
        req = {
            "jsonrpc": "2.0",
            "method": "browser.get_context",
            "params": {"includeScreenshot": False},
            "id": "py_1",
        }
        await ws.send(json.dumps(req))
        resp = await ws.recv()
        return json.loads(resp)


result = asyncio.run(browser_observe())
print(json.dumps(result, indent=2, ensure_ascii=False))
```

### 6.2 HTTP POST — 简单测试

**CMD (使用 curl)**:
```bash
# 观察页面
curl -s -X POST http://127.0.0.1:9527/api/agent -H "Content-Type: application/json" -d "{\"action\":\"observe\",\"payload\":{\"reasoning\":\"test\"}}"

# 导航
curl -s -X POST http://127.0.0.1:9527/api/agent -H "Content-Type: application/json" -d "{\"action\":\"navigate\",\"payload\":{\"value\":\"https://example.com\",\"reasoning\":\"test\"}}"

# 点击
curl -s -X POST http://127.0.0.1:9527/api/agent -H "Content-Type: application/json" -d "{\"action\":\"click\",\"payload\":{\"target_id\":\"el_5\",\"reasoning\":\"test\"}}"
```

**PowerShell**:
```powershell
# PowerShell 中 curl 是别名，需用 Invoke-RestMethod 或 cmd /c curl
cmd /c "curl -s -X POST http://127.0.0.1:9527/api/agent -H ""Content-Type: application/json"" -d ""{\""action\"":\""observe\"",\""payload\"":{\""reasoning\"":\""test\""}}"""
```

或者直接装一个真正的 curl：`winget install curl.curl`

### 6.3 旧协议 AGENT_REQUEST

```python
import json
import websockets

async def legacy_screenshot():
    uri = "ws://127.0.0.1:9527?token=lx_3696ac533d9ddfb81d5e50340f205317&role=agent"
    async with websockets.connect(uri) as ws:
        req = {
            "type": "AGENT_REQUEST",
            "task_id": "legacy_test",
            "action": "screenshot",
            "payload": {},
        }
        await ws.send(json.dumps(req))
        resp = await ws.recv()
        return json.loads(resp)
```

---

## 七、故障排查

### 7.1 health 端点不可达

```
curl: (7) Failed to connect to 127.0.0.1 port 9527
```

**原因**: Native Host 未启动
**解决**: 执行 `node D:\CCWorkSpace\LogexusAIBrowser\native-host\host.js`

### 7.2 Extension timeout after 45s

```json
{"error":"Error: Extension timeout after 45s"}
```

**原因**: Extension 连接了但未响应指令。通常是以下原因之一：
1. **授权未通过** — 返回 `auth_required` 状态。调用方需携带 `__auth_approved: true` 重试
2. **无活跃标签页** — 在 Chrome 中打开一个网页后再试
3. **Content Script 未注入** — 刷新目标页面

### 7.3 Extension not connected

**原因**: Chrome Extension 未加载或未连接 Native Host
**解决**: 
1. 确保 Chrome Extension 已加载并启用
2. 打开 Side Panel 查看连接状态
3. 确认 Native Host 的 token 与 Extension 的 `WS_TOKEN` 一致（默认 `lx_3696ac533d9ddfb81d5e50340f205317`）

### 7.4 大体积数据获取慢

截图和网络抓包结果超过 10KB 时自动触发文件卸载（offload）。MCP Response 返回 `saved_path` 指针而非完整数据。数据文件位于：

```
Windows: %TEMP%\logexus\
macOS:   /tmp/logexus/
```

文件在 1 小时后自动清理。

---

## 八、安全注意事项

| 项目 | 说明 |
|:--|:--|
| **网络绑定** | 所有服务仅监听 `127.0.0.1`，不暴露到外部网络 |
| **Token 认证** | WebSocket 连接需 Token（默认 `lx_3696ac533d9ddfb81d5e50340f205317`），可通过 `LOGEXUS_TOKEN` 环境变量覆盖 |
| **操作白名单** | Extension 仅执行 15 种预定义原子操作，禁止任意代码 |
| **会话授权** | 首次非 observe 操作返回 `auth_required`，调用方携带 `__auth_approved: true` 重试即可 |
| **本地文件** | 文件卸载写入 `%TEMP%/logexus/`，仅在本地可读 |
| **关闭即停** | 关闭被管理的标签页立即终止所有操作 |
