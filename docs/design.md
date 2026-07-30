# Logexus AI Browser — 设计方案

## 一、产品定义

### 1.1 一句话定位

Logexus AI Browser 是一个 Chrome 扩展，将本地 Chrome 浏览器暴露为安全的自动化执行引擎，供外部 AI Agent（Claude Code、Cursor、自定义 Python/Node.js 脚本）通过本地 WebSocket API 驱动，复用已有登录态执行跨网站自动化任务。

### 1.2 核心架构决策：纯执行器 + 安全网关 + 单进程桥接

本扩展**不内置 LLM**。AI 推理能力由外部 Agent 提供，扩展自身定位为：

- **安全网关**：授权控制、操作白名单校验、审计记录
- **执行引擎**：将外部指令翻译为浏览器原生操作
- **状态采集器**：DOM 降噪、页面结构化、CDP 深度检测

**v0.2.0 架构演进**：废弃独立 Daemon 和 MCP Wrapper，统一为**单进程 Native Host**，同时暴露 WebSocket、MCP SSE、HTTP API 三种协议。

```
外部 AI Agent (Claude Code / Cursor / Python 脚本 / Logexus Tauri)
        │
        ├── MCP SSE ──── http://127.0.0.1:9527/sse (Claude Code / LangGraph)
        ├── JSON-RPC 2.0 ─ ws://127.0.0.1:9527 (Logexus Tauri / 脚本)
        └── HTTP POST ── http://127.0.0.1:9527/api/agent (curl 测试)
        │
        ▼
┌───────────────────────────────────────────────────────┐
│            Native Host (Node.js 单进程)                │
│  ┌─────────────────────────────────────────────────┐  │
│  │  MCP SSE Server (13 个 Tools，含 5 语义 Tool)    │  │
│  │  WebSocket Server (JSON-RPC 2.0 + AGENT_REQUEST) │  │
│  │  File Offloader (>10KB 自动落盘)                  │  │
│  └──────────────┬──────────────────────────────────┘  │
│                 │ WebSocket (127.0.0.1:9527)           │
└─────────────────┼─────────────────────────────────────┘
                  │
┌─────────────────▼─────────────────────────────────────┐
│              Chrome Extension (端侧执行器)              │
│  ┌─────────────────────────────────────────────────┐  │
│  │   Service Worker (API 网关 + 授权 + 审计)        │  │
│  │   JsonRpcTransport ←→ index.ts ←→ MacroEngine   │  │
│  │   CDPEngine (debugger API)                       │  │
│  ├─────────────────────────────────────────────────┤  │
│  │   Side Panel (监控 + 授权)                        │  │
│  │   StatusIndicator | AuthDialog | AuditLog        │  │
│  └─────────────────────────────────────────────────┘  │
│  ┌──────────────┐ ┌──────────────┐                     │
│  │ Content Script│ │ Content Script│    ...             │
│  │ DOMReducer   │ │ DOMReducer   │                     │
│  │ ElementIndexer│ │ ElementIndexer│                     │
│  │ ActionExecutor│ │ ActionExecutor│                     │
│  │ MutationWatcher│ │ MutationWatcher│                    │
│  └──────────────┘ └──────────────┘                     │
└───────────────────────────────────────────────────────┘
```

### 1.3 核心差异化能力

| 能力 | 说明 |
|:--|:--|
| **会话复用** | 不存密码，直接用浏览器本地登录态，天然绕过 CAPTCHA |
| **安全沙箱** | 仅支持 15 种预定义原子操作，禁止 LLM 生成的任意代码执行 |
| **三协议统一** | JSON-RPC 2.0 (WebSocket) + MCP SSE + HTTP API 共存于单进程 Native Host |
| **自动拉起** | Chrome 启动时通过 Native Messaging 自动启动 Native Host，无需手动操作 |
| **CDP 深度检测** | 通过 Chrome Debugger API 提供 JS 执行、网络抓包、控制台、性能分析 |
| **语义化 Tool** | 5 个高级封装工具（网络 API 抓取/Cookie 导出/全页截图/PDF 导出/存储读取） |
| **文件卸载** | 大体积数据（>10KB）自动写入临时目录，防止 MCP 管道阻塞 |
| **全程可控** | Side Panel 实时直播执行过程，随时接管或关闭标签页立即终止 |
| **操作可审计** | 每一步完整记录到 IndexedDB，支持筛选/导出/跨会话恢复 |
| **零改动集成** | Logexus Tauri `browser.rs` 无需修改，WebSocket JSON-RPC 2.0 即插即用 |

### 1.4 目标场景

| 场景 | 典型任务 |
|:--|:--|
| 市场研究 | Crunchbase、PitchBook 自动采集 20 家竞品融资数据并交叉对比 |
| SEO 分析 | Semrush、Ahrefs 批量审计 50 个域名，汇总为结构化报表 |
| CRM 数据富化 | 为 100 个潜在客户自动补充调研背景信息 |
| 金融研究 | 从付费金融数据源自动汇编市场情报 |
| 内部系统流转 | 跨 ERP/财务/运营系统的报表提取与表单填报 |

---

## 二、核心决策

| 决策项 | 选择 | 理由 |
|:--|:--|:--|
| Agent 智能 | 外部化（不在扩展内嵌 LLM） | 扩展保持轻量；AI 模型独立迭代；避免扩展体积膨胀 |
| 通信协议 | JSON-RPC 2.0 + MCP SSE + HTTP 三合一 | JSON-RPC 兼容 Tauri/Python；MCP SSE 兼容 Claude Code/LangGraph；HTTP 用于快速测试 |
| 网关架构 | 单进程 Native Host | v0.2.0 废弃 Daemon + MCP Wrapper，统一为一个 Node.js 进程，消除 HTTP 跳转 |
| 自动拉起 | `chrome.runtime.connectNative` | Extension 启动时 Chrome 自动拉起 Native Host，关闭时自动退出 — 无需手动 `node host.js` |
| 工具策略 | 13 个可见 Tool + 文件卸载 | 工具降噪隐藏 6 个冗余 CDP 裸操作；5 个语义 Tool 封装常见业务场景；大体积数据文件落盘 |
| 截图策略 | 按需触发（截图是独立 action） | 由外部 Agent 决定何时截图，扩展不自动决策 |
| LLM Provider | 不内置 | 由外部 Agent 自行选择 LLM（OpenAI/Anthropic/Ollama 等） |
| UI 风格 | 富交互面板 + 暗色模式 | 折叠卡片 + 状态灯 + 中文标签，消除"黑盒效应" |
| 传输层 | Native Messaging（自动拉起）+ WebSocket（业务通信） | Native Messaging 管理进程生命周期；WebSocket 承载所有业务数据 |

---

## 三、系统架构

### 3.1 架构分层

```
┌──────────────────────────────────────────────────────────┐
│  应用层: Claude Code / Cursor / Python脚本 / 自定义Agent  │
├──────────────────────────────────────────────────────────┤
│  协议层: JSON-RPC 2.0 / AGENT_REQUEST (旧版兼容)          │
├──────────────────────────────────────────────────────────┤
│  传输层: WebSocket (Daemon :9527) / chrome.runtime API   │
├──────────────────────────────────────────────────────────┤
│  网关层: Service Worker — 路由、授权、审计、CDP           │
├──────────────────────────────────────────────────────────┤
│  执行层: Content Script — DOM操作、元素索引、动作执行      │
├──────────────────────────────────────────────────────────┤
│  监控层: Side Panel — 状态、授权弹窗、审计日志             │
└──────────────────────────────────────────────────────────┘
```

### 3.2 数据流向

| 方向 | 路径 | 协议 |
|:--|:--|:--|
| **下行（指令）** | 外部 Agent → Daemon WebSocket → Service Worker → Content Script | JSON-RPC 2.0 或 AGENT_REQUEST |
| **上行（结果）** | Content Script → Service Worker → Daemon WebSocket → 外部 Agent | JSON-RPC 2.0 或 AGENT_RESPONSE |
| **UI 推送** | Service Worker → Side Panel (chrome.runtime.connect) | 内部消息 |

### 3.3 通信协议

#### JSON-RPC 2.0（主协议）

通过 WebSocket `ws://127.0.0.1:9527` 传输，Token 认证。

**可用方法**：

| 方法 | 类别 | 说明 |
|:--|:--|:--|
| `system.ping` | 系统 | 心跳检测 |
| `system.register` | 系统 | 客户端注册 |
| `browser.get_context` | 浏览器 | 获取当前页面结构化上下文（URL + 交互元素） |
| `browser.navigate` | 浏览器 | 页面导航 |
| `browser.reload` | 浏览器 | 页面刷新 |
| `action.click` | 操作 | 点击元素 |
| `action.input` | 操作 | 输入文本（优先 CDP 绕过 React/Vue 绑定） |
| `action.scroll` | 操作 | 页面滚动 |

**请求格式**：
```json
{
  "jsonrpc": "2.0",
  "method": "browser.get_context",
  "params": { "tabId": 123 },
  "id": "req_001"
}
```

**成功响应**：
```json
{
  "jsonrpc": "2.0",
  "result": {
    "url": "https://example.com",
    "title": "Example Page",
    "elements": [{ "id": "el_1", "tag": "button", "text": "Submit", "inViewport": true }]
  },
  "id": "req_001"
}
```

**错误码定义**（`src/shared/jsonrpc.ts`）：

| 错误码 | 常量 | 说明 |
|:--|:--|:--|
| -32700 | PARSE_ERROR | JSON 解析错误 |
| -32600 | INVALID_REQUEST | 无效请求 |
| -32601 | METHOD_NOT_FOUND | 方法不存在 |
| -32602 | INVALID_PARAMS | 参数无效 |
| -32603 | INTERNAL_ERROR | 内部错误 |
| -32000 | NO_ACTIVE_TAB | 无活跃标签页 |
| -32001 | ELEMENT_NOT_FOUND | 元素未找到 |
| -32002 | ACTION_FAILED | 操作执行失败 |
| -32003 | AUTH_BLOCKED | 授权被拒 |
| -32004 | CONTENT_SCRIPT_UNREACHABLE | Content Script 无法连接 |
| -32005 | TIMEOUT | 操作超时 |

#### AGENT_REQUEST（旧协议，兼容保留）

直接通过 `chrome.runtime.sendMessage` 或 WebSocket 发送。

```json
{
  "type": "AGENT_REQUEST",
  "task_id": "req_001",
  "action": "observe|click|type|navigate|extract|scroll|screenshot|evaluate|network_start|network_stop|console_start|console_stop|perf_start|perf_stop|cdp_detach",
  "payload": {
    "target_id": "el_15",
    "value": "OpenAI",
    "reasoning": "在搜索框中输入搜索词"
  }
}
```

### 3.4 核心模块

| 模块 | 文件 | 职责 |
|:--|:--|:--|
| SW 入口 | `src/background/index.ts` | 消息路由、安全授权、审计记录、标签页管理、CDP 调度 |
| JSON-RPC 传输 | `src/background/JsonRpcTransport.ts` | WebSocket 生命周期、指数退避重连、MV3 保活三角 |
| CDP 引擎 | `src/background/CDPEngine.ts` | JS 执行、网络抓包、控制台捕获、性能追踪 |
| 宏引擎 | `src/background/MacroEngine.ts` | 操作录制与回放，chrome.storage.local 持久化 |
| JSON-RPC 协议 | `src/shared/jsonrpc.ts` | 类型定义、错误码、编解码工具函数 |
| 共享类型 | `src/shared/types.ts` | ToolAction、InteractiveElement、PageState、AgentRequest/Response、AuditEntry |
| 消息常量 | `src/shared/messages.ts` | 所有内部消息类型常量 |
| DOM 降噪 | `src/content/DOMReducer.ts` | 过滤隐藏/不可交互元素，输出 ≤150 个结构化元素 |
| 元素索引 | `src/content/ElementIndexer.ts` | 为交互元素注入 `data-agent-id`，支持精确定位 |
| 动作执行 | `src/content/ActionExecutor.ts` | 15 种原子操作的浏览器端执行 |
| 变化监听 | `src/content/MutationWatcher.ts` | MutationObserver + 500ms 静默期 + 网络空闲判定 |
| Side Panel | `src/sidepanel/App.tsx` | UI 根组件：状态栏 + 授权弹窗 + 审计日志 + 模板面板 |
| 状态管理 | `src/sidepanel/hooks/useAgentState.ts` | 连接管理、消息处理、暗色模式、审计持久化 |
| 审计存储 | `src/sidepanel/hooks/logStorage.ts` | IndexedDB 读写，上限 500 条 |
| 状态指示器 | `src/sidepanel/components/StatusIndicator.tsx` | 连接状态灯 + Tab 信息 + 授权徽章 |
| 授权弹窗 | `src/sidepanel/components/AuthDialog.tsx` | 操作确认卡片（操作类型/目标/推理） |
| 审计日志 | `src/sidepanel/components/AuditLog.tsx` | 可折叠日志列表、筛选、清空、导出 |
| 模板面板 | `src/sidepanel/components/TemplatePanel.tsx` | 4 个预定义指令模板 |

### 3.5 基础设施组件

| 组件 | 文件 | 说明 |
|:--|:--|:--|
| **Native Host** | `native-host/host.js` | **单进程网关 v0.2.0**：HTTP+WS on :9527，MCP SSE Server，JSON-RPC 2.0 转发，Native Messaging 生命周期 |
| **文件卸载** | `native-host/file-offloader.js` | 大体积数据 >10KB 写入 %TEMP%/logexus/，TTL 自动清理 |
| **工具注册表** | `native-host/tools/tools-registry.js` | 13 个可见 Tool（7 基础 + evaluate + 5 语义），6 个隐藏 CDP 裸工具 |
| **语义工具** | `native-host/tools/semantic/*.js` | extract_network_apis, get_auth_cookies, screenshot_fullpage, export_pdf, get_storage |
| **测试控制台** | `public/test-agent.html` | 浏览器端手动测试工具，支持所有 action |
| **集成测试** | `scripts/test_jd.py` | Python 脚本，京东搜索端到端 JSON-RPC 流程 |
| **连接验证** | `scripts/verify-ws.py` | WebSocket 连接验证 |
| **压力测试** | `scripts/stress-test.ts` | 50 步压力测试脚本 |

**已废弃（v0.2.0 删除）**：

| 组件 | 原因 |
|:--|:--|
| `daemon/server.js` | 路由逻辑合并入 Native Host |
| `mcp-wrapper/server.js` | MCP 能力合并入 Native Host |

---

## 四、核心模块详细设计

### 4.1 DOM 降噪与元素索引（Content Script）

**处理流程**：

```
原始 DOM → 过滤隐藏/不可见 → 筛选交互元素 → 注入 data-agent-id → 结构化 JSON
```

1. **可见性过滤**：剔除 `display:none`、`visibility:hidden`、`opacity:0`、宽高为 0 的元素
2. **视口检测**：`getBoundingClientRect()` 标记 `inViewport`
3. **交互元素筛选**：
   - 点击类：`<a>`, `<button>`, `[role="button"]`, `[role="link"]`, `[onclick]`, `[contenteditable]`
   - 输入类：`<input>`, `<textarea>`, `<select>`, `[role="textbox"]`, `[role="searchbox"]`, `[role="combobox"]`
   - 其他 ARIA 角色：`menuitem`, `option`, `tab`, `switch`, `checkbox`, `radio`, `slider`
4. **索引注入**：`el.setAttribute('data-agent-id', 'el_N')`
5. **结构化输出**：

```json
{
  "url": "https://crunchbase.com/search",
  "title": "Crunchbase Search",
  "elements": [
    {
      "id": "el_3",
      "tag": "input",
      "text": "",
      "type": "search",
      "placeholder": "Search companies",
      "ariaLabel": "Search",
      "inViewport": true
    }
  ]
}
```

**参数控制**：
- 硬上限：单次最多 **150 个**元素（`MAX_ELEMENTS = 150`），超出按视口可见性优先级截断
- 每个元素描述压缩至 **60 字符**以内（`trimText` 截断）

### 4.2 动作执行引擎（ActionExecutor）

**安全约束**：仅支持 15 种预定义原子操作，**禁止执行 LLM 生成的任意 JS 代码**。

#### 基础操作 (Content Script 执行)

| 操作 | 函数 | 实现细节 |
|:--|:--|:--|
| **导航** | `navigateAction(url)` | `window.location.href = url`；跨域时由 SW 创建新 Tab |
| **点击** | `clickAction(elementId)` | `findByAgentId` → `scrollIntoView({behavior:'instant'})` → 原生 `.click()` + `dispatchEvent(new MouseEvent('click', {bubbles:true}))` |
| **输入** | `typeAction(elementId, text)` | 处理 `<select>` 选项匹配、`contenteditable` textContent、input/textarea 原生值设置器（兼容 React/Vue），调度 input/change/keydown/keyup 事件 |
| **滚动** | `scrollAction(direction)` | `window.scrollBy({top: ±300, behavior:'smooth'})` |
| **提取** | `extractAction(selector)` | `document.querySelectorAll(selector)` → 返回 `textContent` 数组 |
| **等待** | `waitAction(ms)` | `setTimeout` 延迟，上限 10 秒 |

#### 扩展操作 (Service Worker 执行)

| 操作 | 说明 |
|:--|:--|
| **observe** | SW 协调 → CS 执行 `reduceDOM()` → 返回 PageState |
| **screenshot** | SW 调用 `chrome.tabs.captureVisibleTab()` → 返回 base64 截图 |

#### CDP 操作 (通过 chrome.debugger API)

| 操作 | 函数 | 说明 |
|:--|:--|:--|
| **evaluate** | `cdpEvaluate(tabId, expression)` | 通过 `Runtime.evaluate` 在页面上下文中执行 JS |
| **network_start** | `cdpNetworkStart(tabId)` | 启用 Network 域，开始捕获请求 |
| **network_stop** | `cdpNetworkStop()` | 停止网络捕获，返回最多 200 个请求 |
| **console_start** | `cdpConsoleStart(tabId)` | 启用 Runtime 域，捕获 console API 调用 |
| **console_stop** | `cdpConsoleStop()` | 停止控制台捕获，返回最多 200 条消息 |
| **perf_start** | `cdpPerformanceStart(tabId)` | 启用 Performance 域进行追踪 |
| **perf_stop** | `cdpPerformanceStop(tabId)` | 停止性能追踪，返回指标（JSHeapUsedSize 等） |
| **cdp_detach** | `cdpDetach(tabId)` | 清理监听器并分离调试器 |

### 4.3 JSON-RPC 传输层（Service Worker）

`JsonRpcTransport` 封装 WebSocket 完整生命周期：

```
连接 → 注册 → 心跳保活 → 请求/响应路由 → 断开重连
```

**保活三角**（防止 MV3 Service Worker 被回收）：
1. `chrome.alarms` 每 15 秒触发
2. `chrome.runtime.getPlatformInfo()` 每 20 秒调用
3. WebSocket `system.ping` 每 20 秒发送

**重连策略**：指数退避 1s → 2s → 4s → 8s → 16s → 30s（上限），连接成功时重置。

**会话恢复**：通过 `chrome.storage.session` 保存 `jsonrpc_sessionId`，断线重连后恢复。

### 4.4 CDP 引擎（Service Worker）

通过 `chrome.debugger` API 提供深度浏览器检测能力：

- **JS 执行**：`Runtime.evaluate` 在页面上下文执行表达式
- **网络抓包**：`Network.requestWillBeSent` + `Network.responseReceived` 事件监听，自动收集请求/响应元数据
- **控制台捕获**：`Runtime.consoleAPICalled` 事件，捕获 console.log/warn/error
- **性能追踪**：`Performance.start()` / `Performance.stop()` + `Performance.getMetrics()`

每个 CDP session 自动管理 debugger 的 attach/detach 生命周期。

### 4.5 操作录制与回放（MacroEngine）

- **录制模式**：用户手动执行操作 → 拦截 `AGENT_REQUEST` 记录每步
- **存储**：`chrome.storage.local` 中 `logexus_macros` 键
- **回放**：加载宏 → 按录制步骤顺序重新发送 `AGENT_REQUEST`

### 4.6 UI 交互层（Side Panel）

| 区域 | 组件 | 功能描述 |
|:--|:--|:--|
| **状态指示器** | `StatusIndicator` | 连接状态灯（绿/红）+ 当前活跃 Tab ID/计数/域名 + 授权徽章 |
| **授权弹窗** | `AuthDialog` | 琥珀色卡片，显示操作类型、目标元素、AI 推理原因；允许/拒绝按钮 |
| **审计日志** | `AuditLog` | 可折叠滚动列表，每条目：时间戳 + 操作中文标签 + 状态色标 + task_id；展开显示 reasoning 和 result；支持筛选搜索、清空、导出 JSON |
| **模板面板** | `TemplatePanel` | 4 个预设指令模板："Bing 搜索测试"、"竞品融资采集"、"SEO 批量查询"、"CRM 数据回填" |
| **暗色模式** | 全局 | localStorage 持久化，Tailwind `dark` class 策略 |

### 4.7 标签页管理

- **自动分组**：Logexus 管理的标签页自动归入 "My Logexus Browser" 分组（紫色）
- **浮动徽章**：被管理标签页右下角注入 "My Logexus Browser" 浮动标识（绿色圆点 + 模糊背景）
- **连接追踪**：`connectedTabs` Set 维护所有已注入 Content Script 的标签页
- **激活切换**：`tabs.onActivated` 事件触发状态的自动切换和授权重置

---

## 五、安全设计

| 安全措施 | 实现方式 |
|:--|:--|
| **禁止任意代码执行** | 仅支持 15 种预定义原子操作；action 值在 `ToolAction` 联合类型中白名单校验 |
| **每次会话强制授权** | 首个非 observe 操作触发授权弹窗，30 秒超时自动拒绝 |
| **关闭标签页即停止** | `tabs.onRemoved` → 立即清理连接；所有操作绑定到活跃 Tab |
| **操作审计** | 所有操作完整记录，`AuditEntry` 保存到 IndexedDB，支持导出 |
| **不存储密码** | 零密码存储，完全依赖浏览器已有登录态 |
| **Token 认证** | WebSocket Daemon 连接需 Token（默认 `lx_3696ac533d9ddfb81d5e50340f205317`，可通过 `LOGEXUS_TOKEN` 环境变量覆盖） |
| **本地通信** | 所有通信限制在 `127.0.0.1`，不暴露到网络 |

---

## 六、异常处理矩阵

| 异常类型 | 检测方式 | 处理策略 |
|:--|:--|:--|
| **目标元素消失** | Content Script 返回 `{error:"element_not_found"}` | 返回错误 + 自动附带当前页面截图；外部 Agent 自行决定重试策略 |
| **页面加载超时** | `waitForPageLoad()` 15 秒超时 | 超时后仍尝试执行，返回错误状态 |
| **Content Script 断连** | ping/pong 心跳（最多 10 次重试） | 自动重新注入 → 恢复连接 |
| **验证码 (CAPTCHA)** | CS 检测 `iframe[src*="recaptcha"]` / `[class*="captcha"]` 等特征 | 通过 `CAPTCHA_ALERT` 推送 Side Panel 警告横幅 |
| **用户关闭标签页** | `tabs.onRemoved` 事件 | 清理连接 → 状态重置 |
| **WebSocket 断开** | `ws.onclose` 事件 | 指数退避自动重连（1s→30s 上限） |
| **操作超时** | 单个操作 30 秒超时 | 返回 `TIMEOUT` 错误码（-32005） |
| **授权超时** | 30 秒内无用户响应 | 自动拒绝，返回 `AUTH_BLOCKED` |

---

## 七、技术选型

| 维度 | 选择 | 理由 |
|:--|:--|:--|
| 平台 | Chrome Extension Manifest V3 | 强制要求，MV2 已废弃 |
| 开发语言 | TypeScript (strict) | 类型安全，浏览器 API 类型完备 |
| UI 框架 | React 18 + Tailwind CSS 3 | 组件化 + 原子化 CSS，暗色模式内置 |
| 构建工具 | Vite 6 + @crxjs/vite-plugin | HMR 热更新，Chrome 扩展专用构建 |
| 通信协议 | JSON-RPC 2.0 | 标准化、可扩展、无状态、易于多语言客户端实现 |
| 传输层 | WebSocket (ws) + chrome.runtime API | ws 用于本地 Daemon 通信；runtime API 用于浏览器内通信 |
| CDP | chrome.debugger API | 原生 Chrome 调试协议，无需额外依赖 |
| 状态持久化 | chrome.storage.local + IndexedDB | 小数据（配置/宏）用 storage API；大体积（审计日志）用 IndexedDB |
| 样式策略 | Tailwind CSS 原子类 + CSS 自定义组件 | 禁止内联 style 对象 |

---

## 八、项目结构

```
LogexusAIBrowser/
├── src/
│   ├── manifest.json                     # Manifest V3
│   ├── background/                       # Service Worker
│   │   ├── index.ts                      # SW 入口：消息路由、授权、审计、标签页管理
│   │   ├── JsonRpcTransport.ts           # JSON-RPC 2.0 WebSocket 传输层
│   │   ├── CDPEngine.ts                  # Chrome 调试协议引擎
│   │   └── MacroEngine.ts               # 操作录制与回放
│   ├── content/                          # Content Script
│   │   ├── index.ts                      # CS 入口：消息监听、验证码检测、徽章注入
│   │   ├── DOMReducer.ts                 # DOM 降噪过滤（≤150 元素）
│   │   ├── ElementIndexer.ts             # 元素 data-agent-id 索引注入
│   │   ├── ActionExecutor.ts             # 6 种基础原子操作执行器
│   │   └── MutationWatcher.ts            # DOM 变化监听 + 静默期判定
│   ├── sidepanel/                        # Side Panel UI (React)
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── StatusIndicator.tsx
│   │   │   ├── AuthDialog.tsx
│   │   │   ├── AuditLog.tsx
│   │   │   └── TemplatePanel.tsx
│   │   ├── hooks/
│   │   │   ├── useAgentState.ts
│   │   │   └── logStorage.ts
│   │   └── styles/
│   │       └── index.css
│   └── shared/                           # 共享类型与常量
│       ├── types.ts                      # ToolAction, PageState, AgentRequest/Response, AuditEntry
│       ├── messages.ts                   # 消息类型常量
│       └── jsonrpc.ts                    # JSON-RPC 2.0 类型、错误码、编解码
├── native-host/                           # 单进程网关 (v0.2.0)
│   ├── host.js                           # HTTP+WS+MCP SSE Server + 路由
│   ├── package.json                      # @modelcontextprotocol/sdk + ws
│   ├── file-offloader.js                 # 大体积数据文件卸载
│   ├── install.bat                       # Windows Native Messaging 注册
│   ├── host.bat                          # Chrome 拉起入口
│   └── tools/
│       ├── tools-registry.js             # 13 可见 + 6 隐藏 Tool
│       └── semantic/                     # 5 个语义 CDP Tool
│           ├── extract-network-apis.js
│           ├── get-auth-cookies.js
│           ├── screenshot-fullpage.js
│           ├── export-pdf.js
│           └── get-storage.js
├── scripts/
│   ├── test_jd.py                        # 京东集成测试
│   ├── verify-ws.py                      # WebSocket 连接验证
│   ├── stress-test.ts                    # 压力测试 (50 步)
│   ├── test-agent.ts                     # 控制台测试脚本
│   └── package.bat                       # 构建打包
├── public/
│   └── test-agent.html                   # 浏览器测试控制台
├── docs/
│   ├── design.md                         # 本文档
│   ├── test-cases.md                     # 测试用例
│   ├── operations.md                     # 操作手册
│   ├── integration-guide.md              # 集成指南
│   ├── release-checklist.md              # 发布清单
│   ├── privacy.md                        # 隐私政策
│   └── chrome_extension_design_and_roadmap.md
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
└── package.json
```

---

## 九、当前版本状态

**版本**: 0.2.0

### 已实现 (v0.2.0)

- [x] **单进程 Native Host**（MCP SSE Server + Native Messaging 桥接，废弃 Daemon 和独立 MCP Wrapper）
- [x] **文件卸载机制**（大体积数据 >10KB 写入 %TEMP%/logexus/，TTL + 硬上限自动清理）
- [x] **13 个 MCP Tool**（7 基础 + evaluate 兜底 + 5 语义 CDP）
- [x] **工具降噪**（隐藏 network_start/stop 等 6 个冗余 CDP 裸工具）
- [x] 5 个高级语义 Tool：extract_network_apis, get_auth_cookies, screenshot_fullpage, export_pdf, get_storage

### 已实现 (v0.1.5)

- [x] Manifest V3 脚手架（Vite + @crxjs + React 18）
- [x] Content Script：DOM 降噪 + 元素索引注入 + 6 种基础原子操作 + 验证码检测
- [x] Service Worker：消息路由 + 安全授权 + 审计记录 + 标签页管理
- [x] JSON-RPC 2.0 协议 + WebSocket 传输层（指数退避重连 + MV3 保活）
- [x] CDP 引擎：JS 执行、网络抓包、控制台捕获、性能追踪
- [x] 宏录制与回放
- [x] Side Panel：状态指示器 + 授权弹窗 + 审计日志（筛选/导出/持久化）+ 模板面板 + 暗色模式
- [x] 标签页自动分组（"My Logexus Browser"）+ 浮动徽章
- [x] 测试工具：test-agent.html + Python 集成测试 + 压力测试脚本

### 待实现

- [ ] CDP `Page.printToPDF` 和 `Page.captureScreenshot(full)` 的 Extension 端深度实现
- [ ] 操作录制回放的 UI 面板
- [ ] Chrome Web Store 上架

---

## 十、关键风险与应对

| 风险 | 影响 | 应对 |
|:--|:--|:--|
| 网站反自动化检测 | 任务失败 | 复用真实浏览器会话，模拟原生事件（InputEvent + change），避免 `webdriver` 标记 |
| CDP 附加影响性能 | 页面变慢 | 按需 attach/detach，操作完成后立即清理 |
| WebSocket 连接不稳定 | 指令丢失 | 指数退避重连 + 会话恢复 + 保活三角防止 SW 回收 |
| MV3 Service Worker 回收 | 连接断开 | 15s alarm + 20s ping + 20s platformInfo 三重保活 |
| 同一元素重复索引 | Agent 混淆 | 每次 observe 前清除旧 `data-agent-id`，重新分配 |
| Native Host 崩溃 | 所有外部 Agent 通信中断 | Chrome 重启时自动恢复；Logexus Tauri 备选方案监控重启 |
| 临时文件残留 | 磁盘占满 | FileOffloader 多级清理（TTL + 硬上限 + 生命周期联动） |
| 端口冲突 (:9527) | Native Host 无法启动 | 重试机制 + 降级端口方案 |
