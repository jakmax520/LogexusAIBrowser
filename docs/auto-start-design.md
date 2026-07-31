# Native Host 自动启动与协议桥接 — 设计需求与技术规范

**版本**: v0.2.1  
**更新**: 2026-07-31  
**关联**: Logexus Tauri (browser.rs) + LogexusAIBrowser (native-host/)

---

## 一、设计需求

### 1.1 背景与痛点

v0.2.0 架构统一为单进程 Native Host（`native-host/host.js`），暴露 WebSocket / MCP SSE / HTTP 三种协议给外部调用方。但存在以下问题：

| 痛点 | 表现 | 根因 |
|:--|:--|:--|
| 手动启动 | 每次开机/重启 Chrome 后需手动 `node host.js` | 无自动启动机制 |
| 路径断裂 | Logexus Tauri 无法找到 Native Host | `browser.rs` 硬编码路径失效 |
| 授权丢弃 | MyBrowser 连接器 navigate 被拦截 | JSON-RPC 桥接未透传 `__auth_approved` |
| 进程异常退出 | 独立运行时 stdin 关闭导致 shutdown | 运行模式未区分 |

### 1.2 设计目标

1. **零手动操作**：Native Host 在 Windows 登录时自动启动，无命令行窗口
2. **双重保障**：Windows 开机自启（主方案）+ Chrome Native Messaging（备选）
3. **协议完整性**：JSON-RPC → AGENT_REQUEST 桥接不丢失任何字段
4. **路径可发现**：Logexus Tauri 在任意安装位置都能找到 LogexusAIBrowser
5. **模式隔离**：Native Messaging 模式与独立模式生命周期分离

---

## 二、技术方案

### 2.1 整体架构

```
Windows 登录
    │
    ├── 主方案：注册表 Run Key
    │   HKCU\...\Run\LogexusNativeHost → start-silent.vbs
    │   └── wscript.exe (后台) → node host.js (独立模式)
    │
    └── 备选方案：Chrome Native Messaging
        chrome.runtime.connectNative("com.logexus.browser.host")
        └── Chrome 自动拉起 host.bat → node host.js --nm
```

### 2.2 运行模式规范

| 模式 | 启动方式 | 参数 | stdin 行为 | 退出行为 |
|:--|:--|:--|:--|:--|
| **独立模式** | VBS / 手动 `node host.js` | 无 | 忽略 stdin 关闭 | Ctrl+C / kill |
| **NM 模式** | Chrome 通过 `host.bat` 拉起 | `--nm` | stdin 关闭 = Chrome 断开 → shutdown | 自动退出 |

### 2.3 文件清单与职责

```
native-host/
├── host.js                     # 单进程服务端（HTTP + WS + MCP SSE）
├── host.bat                    # Chrome NM 启动入口（node host.js --nm）
├── start-silent.vbs            # VBS 静默启动（无命令行窗口）
├── install.bat                 # 注册 NM Host + 生成 host.bat
├── install-autostart.bat       # 注册 Windows 开机自启
├── com.logexus.browser.host.json  # NM manifest（install.bat 生成）
└── file-offloader.js           # 大文件落盘子模块
```

### 2.4 配置项

| 配置 | 位置 | 默认值 | 说明 |
|:--|:--|:--|:--|
| `HTTP_PORT` | host.js | `9527` | HTTP + WebSocket 监听端口 |
| `HTTP_HOST` | host.js | `127.0.0.1` | 仅本地回环，不暴露到网络 |
| `AUTH_TOKEN` | host.js / 环境变量 `LOGEXUS_TOKEN` | `lx_3696...` | WebSocket 鉴权 Token |
| `BROWSER_SKIP_AUTH` | browser.rs | `true` | Tauri 侧是否跳过授权 |
| `LOGEXUS_SKIP_AUTH` | chrome.storage.local | `false` (关闭) | 扩展侧是否跳过授权 |

---

## 三、核心规范

### 3.1 Native Host 启动流程

```
1. 创建 HTTP Server (createServer)
2. 注册路由：
   - GET  /sse      → MCP SSE 连接
   - POST /messages → MCP 消息
   - GET  /health   → 健康检查
   - POST /api/agent → HTTP 浏览器指令（兼容旧协议）
   - GET  /api/macros → 宏列表
   - OPTIONS 全部 → CORS 预检
3. 创建 WebSocket Server (upgrade 同一 HTTP Server)
4. listen(9527, "127.0.0.1")
5. 进入 STARTING 状态，等待连接
```

### 3.2 连接时序

```
Service Worker 启动
    │
    ├── 1. launchNativeHost()               // 尝试 NM 拉起（静默失败）
    ├── 2. transport.connect()              // WebSocket 重连（指数退避 1→2→4→8→16→30s）
    │
    ▼
Native Host 已运行 (Windows AutoStart)
    │
    ├── Extension WebSocket 连接成功
    │   └── role=extension&token=<TOKEN>&clientId=<ID>
    ├── JsonRpcTransport 保活三角启动
    │   ├── chrome.alarms 每 15s
    │   ├── chrome.runtime.getPlatformInfo 每 20s
    │   └── WebSocket system.ping 每 20s
    └── 状态: extensionConnected = true
```

### 3.3 授权流程 — `__auth_approved` 透传规范

```
Logexus Tauri (Rust)                         Chrome Extension (Service Worker)
    │                                                    │
    │ send_jsonrpc_local("browser.navigate",             │
    │   {url, __auth_approved: true})                    │
    │   ↓                                                │
    │ ws://127.0.0.1:9527?role=agent                     │
    ▼                                                    │
Native Host (host.js)                                    │
    │                                                    │
    │ METHOD_MAP: browser.navigate → "navigate"          │
    │ payload = {                                        │
    │   target_id, value, reasoning,                     │
    │   __auth_approved: params.__auth_approved  ← 必须透传
    │ }                                                  │
    │ sendToExtension → AGENT_REQUEST                    │
    ▼                                                    │
ws://127.0.0.1:9527?role=extension                       │
    │                                                    │
    │ AGENT_REQUEST { action: "navigate",                │
    │   payload: { __auth_approved: true } }             │
    ▼                                                    │
handleAgentRequest()                                     │
    │                                                    │
    │ authRequired && !sessionAuthorized                 │
    │   && !payload.__auth_approved?  → auth_required    │
    │                                                    │
    │ payload.__auth_approved   → sessionAuthorized=true │
    │ 执行业务逻辑 ✅                                      │
```

**关键约束**：JSON-RPC `params` 中的 `__auth_approved` 字段**必须**由 Native Host 原样透传到 AGENT_REQUEST 的 `payload` 中。任何丢弃行为都会导致 navigate/click/type 被授权拦截。

### 3.4 Logexus Tauri 侧 — Native Host 路径发现

**文件**: `Logexus/products/tauri-app/src-tauri/src/commands/browser.rs`

```rust
fn find_daemon_script() -> Option<std::path::PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?;
    let mut cursor = exe_dir;

    // 向上遍历目录树，查找 LogexusAIBrowser/native-host/host.js
    for _ in 0..10 {
        let candidate = cursor.join("LogexusAIBrowser")
                              .join("native-host").join("host.js");
        if candidate.exists() { return Some(candidate); }
        cursor = match cursor.parent() {
            Some(p) => p,
            None => break,
        };
    }
    // 生产模式 fallback: resources/native-host/host.js
    // ...
}
```

**目录结构依赖**：

```
CCWorkSpace/
├── Logexus/                     ← Tauri 项目
│   └── products/tauri-app/src-tauri/target/debug/Logexus.exe
└── LogexusAIBrowser/            ← Chrome 扩展 + Native Host
    └── native-host/host.js
```

Tauri 可执行文件向上遍历直至 `CCWorkSpace/` 层，在每层检查 `LogexusAIBrowser/native-host/host.js` 是否存在。

### 3.5 Windows 自启注册

**注册表路径**：
```
HKCU\Software\Microsoft\Windows\CurrentVersion\Run
    LogexusNativeHost = "<path>\start-silent.vbs"
```

**VBS 静默启动**：
```vbscript
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
cmd = "node """ & scriptDir & "\host.js"""
WshShell.Run cmd, 0, False   ' 0 = 隐藏窗口
```

**注册命令**：
```powershell
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" ^
    /v "LogexusNativeHost" /d "\"D:\...\native-host\start-silent.vbs\"" /f
```

### 3.6 健康检查

```powershell
curl -s http://127.0.0.1:9527/health
```

```json
{
  "status": "STARTING",
  "extensionConnected": true,
  "pendingRequests": 0,
  "sseConnected": false
}
```

| 字段 | 含义 |
|:--|:--|
| `status` | 进程状态: `STARTING` / `RUNNING` / `DEGRADED` / `DRAINING` / `EXITED` |
| `extensionConnected` | Chrome 扩展 WebSocket 是否已连接 |
| `pendingRequests` | 未完成的浏览器操作请求数 |
| `sseConnected` | MCP SSE Agent 是否已连接 |

---

## 四、兼容性矩阵

### 4.1 协议路由

| 调用方 | 协议 | 角色 | 鉴权方式 |
|:--|:--|:--|:--|
| Logexus Tauri (browser.rs) | WebSocket JSON-RPC 2.0 | `role=agent` | Token + `__auth_approved` |
| Python 脚本 (browser.py) | HTTP POST `/api/agent` | `role=agent` | Token |
| Claude Code / LangGraph | MCP SSE `/sse` + `/messages` | MCP Client | Token |
| Chrome Extension | WebSocket AGENT_REQUEST | `role=extension` | Token |
| curl / 运维脚本 | HTTP GET `/health` | 无 | 无 |

### 4.2 向后兼容

| 旧调用方式 | v0.2.1 兼容性 | 说明 |
|:--|:--|:--|
| `daemon/server.js` | 废弃 | 改为 `native-host/host.js` |
| 旧协议 AGENT_REQUEST（Agent 直接连接） | 兼容 | WebSocket `role=agent` 同时支持新旧协议 |
| HTTP POST `/api/agent` | 兼容 | host.js 保留旧端点 |
| 手动 `node host.js` | 兼容 | 独立模式,不加 `--nm` |

### 4.3 浏览器兼容

| 场景 | 行为 |
|:--|:--|
| 用户登录 Windows | VBS 后台启动 Native Host |
| Chrome 未启动 | Native Host 等待 Chrome 启动后扩展连接 |
| Chrome 重启 | NM 备选尝试拉起（可能静默失败），扩展重连已运行的 Native Host |
| 扩展刷新/重载 | Native Host 保持运行，扩展重连 WebSocket |
| Native Host 崩溃 | 下次 Windows 登录自动恢复；Tauri 首次调用时触发 `ensure_daemon_running()` |

---

## 五、安全约束

1. **仅本地回环**：Native Host 绑定 `127.0.0.1`，不可从外部网络访问
2. **Token 鉴权**：WebSocket 连接需携带 `?token=lx_...`，不匹配则 4001 拒绝
3. **操作授权**：navigate/click/type 需 `__auth_approved: true` 或 `LOGEXUS_SKIP_AUTH=ON`
4. **操作白名单**：仅 6 种原子操作（click/type/scroll/navigate/extract/wait）可执行
5. **无窗口运行**：VBS 后台启动不暴露命令行窗口，防止误关闭

---

## 六、变更记录

| 日期 | 版本 | 变更内容 |
|:--|:--|:--|
| 2026-07-31 | v0.2.1 | 新增 Windows AutoStart 机制（主方案） |
| 2026-07-31 | v0.2.1 | 新增 `--nm` 运行模式区分 |
| 2026-07-31 | v0.2.1 | 修复 `__auth_approved` JSON-RPC 透传 |
| 2026-07-31 | v0.2.1 | 修复 `browser.rs` Native Host 路径发现（向上遍历） |
| 2026-07-30 | v0.2.0 | 初始版本：单进程 Native Host，废弃独立 Daemon |
