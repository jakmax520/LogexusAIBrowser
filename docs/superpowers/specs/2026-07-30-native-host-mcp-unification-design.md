# Native Host + MCP 统一化架构设计

**日期**: 2026-07-30
**版本**: 1.0
**状态**: 设计中

---

## 一、背景与动机

### 1.1 当前架构问题

Logexus AI Browser v0.1.5 的外部通信架构为三进程 + HTTP 桥接：

```
Claude Code / LangGraph
     │ MCP stdio
     ▼
MCP Wrapper (Node.js)         ← 独立进程，Agent 拉起
     │ HTTP POST :9527
     ▼
Native Host (Node.js)         ← 独立进程，Chrome 拉起
     │ Native Messaging (stdin/stdout)
     ▼
Daemon (WebSocket Server)     ← 独立进程，手动启动
     │ WebSocket
     ▼
Chrome Extension (SW)
```

问题：
1. **三进程维护负担重**：Daemon、MCP Wrapper、Native Host 各自有 `package.json`，版本管理分散
2. **HTTP 跳增加延迟**：MCP Wrapper → Native Host 走 HTTP，有 TCP 握手 + HTTP 封包/解包开销
3. **Daemon 手动启动**：非随用随起，用户体验差
4. **MCP Tool 为裸原子操作**：Agent 需要理解 CDP 底层才能完成复杂任务（如"导出登录态"）
5. **大体积数据阻塞管道**：截图 base64 直接塞 MCP Response，容易 OOM

### 1.2 设计目标

| 目标 | 说明 |
|:--|:--|
| **单进程** | 废弃 Daemon 和独立 MCP Wrapper，所有网关逻辑收敛到 Native Host |
| **标准 MCP** | Native Host 直接暴露 MCP SSE Server，Agent 通过标准 MCP 协议接入 |
| **文件卸载** | 大体积数据(>10KB)写入临时目录，MCP Response 只返回 `saved_path` 指针 |
| **语义 Tool** | 新增 5 个封装了 CDP 底层逻辑的高级语义工具 |
| **零扩展改动** | `src/` 目录下所有 Chrome Extension 代码不改动 |

---

## 二、目标架构

### 2.1 整体架构图

```
LangGraph (Python)                    Claude Code
     │                                    │
     │ sse_client(url)                    │ MCP config: {url: "..."}
     │                                    │
     └──────────┬─────────────────────────┘
                │ HTTP POST/SSE on http://127.0.0.1:9527
                ▼
┌──────────────────────────────────────────────┐
│         Native Host (单进程 Node.js)          │
│         由 Chrome 通过注册表自动拉起           │
│                                              │
│  ┌──────────────────────────────────────────┐│
│  │  @modelcontextprotocol/sdk               ││
│  │  SSEServerTransport                      ││
│  │  endpoint: GET /sse + POST /messages     ││
│  │  Tools: 7基础 + evaluate + 5语义 = 13    ││
│  │  FileOffloader: >10KB → %TEMP%/logexus/  ││
│  └──────────────┬───────────────────────────┘│
│                 │ 进程内零拷贝                 │
│  ┌──────────────▼───────────────────────────┐│
│  │  Native Messaging Protocol               ││
│  │  stdin:  读取 4字节LE长度 + JSON          ││
│  │  stdout: 写入 4字节LE长度 + JSON          ││
│  └──────────────┬───────────────────────────┘│
└──────────────────┼───────────────────────────┘
                   │ stdin/stdout
                   ▼
┌──────────────────────────────────────────────┐
│       Chrome Extension (Service Worker)      │
│       Content Script (DOM / CDP 执行层)       │
└──────────────────────────────────────────────┘
```

### 2.2 关键变化 vs 当前架构

| 维度 | 当前 v0.1.5 | 目标 v0.2.0 |
|:--|:--|:--|
| 进程数 | 3 | **1** |
| MCP 协议 | stdio (独立 Wrapper) | **SSE over HTTP** (内嵌 Native Host) |
| 进程间通信 | HTTP `:9527` | **无**（同进程） |
| Daemon | 手动启动 `node daemon/server.js` | **废弃** |
| MCP Wrapper | 独立目录 `mcp-wrapper/` | **废弃**，合并入 `native-host/` |
| MCP Tool 数量 | 14 | 19 (含 5 个语义 Tool) |
| 大数据处理 | base64 直接塞 Response | **文件卸载** `%TEMP%/logexus/` |
| Extension `src/` | — | **零改动** |

### 2.3 双协议共存原理

Node.js 事件循环天然支持多路复用：

| 通道 | 协议 | 对端 | 方式 |
|:--|:--|:--|:--|
| `stdin` | Native Messaging (4字节LE长度头 + JSON) | Chrome Extension | `process.stdin.on('data')` |
| `stdout` | Native Messaging (4字节LE长度头 + JSON) | Chrome Extension | `process.stdout.write()` |
| HTTP Server | MCP SSE (`GET /sse` + `POST /messages`) | 外部 Agent | `http.createServer()` on `:9527` |

三者在 Node.js 事件循环中并发处理，互不阻塞。`stdin`/`stdout` 是 Stream，HTTP Server 是 `net.Server`，各自独立事件源。

---

## 三、生命周期管理

### 3.1 状态机

```
┌─────────┐  Chrome 拉起    ┌──────────┐  SSE Server 就绪  ┌───────────┐
│  INIT   │ ──────────────→ │ STARTING │ ────────────────→ │  RUNNING  │
└─────────┘                 └──────────┘                   └─────┬─────┘
      ▲                                                          │
      │                                     ┌────────────────────┼─────────────┐
      │                                     │                    │             │
      │                               stdin 关闭          Agent 断连     进程异常
      │                                     │                    │             │
      │                                     ▼                    ▼             ▼
      │                              ┌───────────┐       ┌───────────┐  ┌────────┐
      │                              │ DRAINING  │       │ DEGRADED  │  │ ERROR  │
      │                              │ 等待未完成 │       │ 无 Agent  │  │ 退出=1 │
      │                              │ 请求后退出 │       │ 等重连    │  └────────┘
      │                              └─────┬─────┘       └─────┬─────┘
      │                                    │                   │
      │                              超时/请求完成        Agent 重连
      │                               (max 45s)          (30min 窗口)
      │                                    │                   │
      │                                    ▼                   ▼
      │                              ┌──────────┐       ┌───────────┐
      └──────────────────────────────│  EXITED  │       │  RUNNING  │
                                     └──────────┘       └───────────┘
```

### 3.2 状态转换规则

| 转换 | 触发条件 | 行为 |
|:--|:--|:--|
| INIT → STARTING | `main()` 入口执行 | 创建 `%TEMP%/logexus/` 目录，清理过期文件 |
| STARTING → RUNNING | HTTP Server listening + stdin ready | 启动 MCP SSE Server，开始处理请求 |
| RUNNING → DEGRADED | 所有 SSE 客户端断开 | 记录日志，启动 30 分钟超时计时器 |
| DEGRADED → RUNNING | SSE 客户端重连 | 清除超时计时器，恢复正常服务 |
| DEGRADED → EXITED | 30 分钟无重连 | 清理临时文件，`process.exit(0)` |
| RUNNING → DRAINING | `stdin` 关闭 (Chrome 关闭/插件卸载) | 停止接收新请求，等待已有请求完成(最大 45s) |
| DRAINING → EXITED | 所有请求完成或超时 | 清理所有临时文件，关闭 HTTP Server，`process.exit(0)` |
| 任意 → ERROR | 未捕获异常 | 记录错误，清理资源，`process.exit(1)` |

### 3.3 端口冲突处理

Native Host 启动时若 `:9527` 被占用（上次非正常退出残留），处理策略：

1. 尝试监听 `:9527`
2. 若 `EADDRINUSE`：等待 500ms 后重试（旧进程可能正在退出）
3. 重试 5 次仍失败：尝试 `:9528`（降级端口）
4. 日志输出实际监听端口
5. EXITED 状态确保 `server.close()` 被调用释放端口

---

## 四、文件卸载机制

### 4.1 触发阈值

```
Chrome Extension → AGENT_RESPONSE → Native Host (stdin)
     │
     ├── data < 10KB → 直接序列化到 MCP Response
     │
     └── data ≥ 10KB → offload:
          1. 写入 %TEMP%/logexus/
          2. MCP Response 返回 saved_path 指针
          3. 注册到清理调度器
```

### 4.2 文件命名规范

```
Windows:  %TEMP%\logexus\{timestamp}_{task_id}_{type}.{ext}
macOS:    /tmp/logexus/{timestamp}_{task_id}_{type}.{ext}

示例:
  /tmp/logexus/1712345678_mcp_001_screenshot.jpg
  /tmp/logexus/1712345678_mcp_002_network.json
```

| type | ext | 内容 |
|:--|:--|:--|
| `screenshot` | `.jpg` | `chrome.tabs.captureVisibleTab` JPEG 数据 |
| `network` | `.json` | 网络抓包数组，最多 200 条 |
| `console` | `.json` | 控制台消息数组，最多 200 条 |
| `perf` | `.json` | `Performance.getMetrics()` 返回值 |
| `fullpage` | `.png` | CDP `Page.captureScreenshot(full=true)` |
| `pdf` | `.pdf` | CDP `Page.printToPDF()` 输出 |
| `cookies` | `.txt` / `.json` | Cookie 导出 |

### 4.3 MCP Response 格式

**offload 前**（当前）:
```json
{"content": [{"type": "text", "text": "Status: success\n\n[截图: 3847KB]"}]}
```

**offload 后**（目标）:
```json
{
  "content": [{
    "type": "text",
    "text": "Status: success\nsaved_path: /tmp/logexus/1712345678_mcp_001_screenshot.jpg\nsize_bytes: 3938816\nformat: jpeg\nexpires_at: 1712349278"
  }]
}
```

Agent 通过 `saved_path` 直接读取文件，避免 MCP 管道阻塞。

### 4.4 清理策略

| 触发时机 | 动作 |
|:--|:--|
| Native Host 启动时 | 清空所有 ≥ 1 小时的文件 |
| 文件写入时 | 注册 TTL (默认 1 小时) |
| 定时器 (每 10 分钟) | 扫描并删除过期文件 |
| 存储目录总大小 > 1024MB | 强制清空最旧 50% 文件 |
| Native Host EXITED | 清空所有遗留文件 |

---

## 五、高级语义 Tool 定义

### 5.1 总体清单

| 类别 | 数量 | Tool 列表 |
|:--|:--|:--|
| 基础操作（现有，不变） | 7 | `observe`, `click`, `type`, `navigate`, `extract`, `scroll`, `screenshot` |
| CDP 裸能力（现有，不变） | 7 | `evaluate`, `network_start/stop`, `console_start/stop`, `perf_start/stop` |
| **语义 CDP（新增）** | **5** | `extract_network_apis`, `get_auth_cookies`, `screenshot_fullpage`, `export_pdf`, `get_storage` |

### 5.2 `extract_network_apis`

**解决的问题**：Agent 一键获取页面 API 调用列表，无需手动 `network_start` → 等待 → `network_stop` → 自行筛选。

**入参 Schema**:
```json
{
  "type": "object",
  "properties": {
    "domain_filter": {
      "type": "string",
      "description": "可选：只返回匹配此域名的请求，如 'api.example.com'。不传则返回所有域名。"
    },
    "capture_duration_ms": {
      "type": "number",
      "description": "捕获时长(毫秒)，默认 3000ms。SPA 应用可能需要更长。上限 30000ms。",
      "default": 3000,
      "maximum": 30000
    },
    "include_request_body": {
      "type": "boolean",
      "description": "是否包含 POST/PUT 请求体，默认 false。",
      "default": false
    }
  }
}
```

**出参**:
```json
{
  "total_requests": 47,
  "filtered_requests": 12,
  "domains": ["api.crunchbase.com", "www.crunchbase.com"],
  "apis": [
    {
      "url": "https://api.crunchbase.com/api/v4/searches/organizations",
      "method": "POST",
      "status": 200,
      "type": "fetch",
      "mime_type": "application/json",
      "response_size_bytes": 4521,
      "timing_ms": 234
    }
  ],
  "saved_path": "/tmp/logexus/1712345678_mcp_003_network.json"
}
```

**实现**: `CDPEngine.network_start` → 等待 `capture_duration_ms` → `network_stop` → 按 `domain_filter` 过滤 → >10KB 触发 offload。

### 5.3 `get_auth_cookies`

**解决的问题**：一秒导出登录态为 curl/wget 兼容格式，打通"浏览器认证 → 本地脚本"链路。

**入参 Schema**:
```json
{
  "type": "object",
  "properties": {
    "domain": {
      "type": "string",
      "description": "可选：只导出特定域名的 Cookie，如 '.example.com'。"
    },
    "format": {
      "type": "string",
      "enum": ["netscape", "json"],
      "description": "导出格式。netscape 兼容 curl/wget；json 为原始结构。默认 netscape。",
      "default": "netscape"
    }
  }
}
```

**出参 (netscape)**:
```
# Netscape HTTP Cookie File
.example.com  TRUE  /  TRUE  1712345678  sessionid  abc123def456
saved_path: /tmp/logexus/1712345678_mcp_004_cookies.txt
```

**出参 (json)**:
```json
{
  "domain": ".example.com",
  "cookie_count": 12,
  "saved_path": "/tmp/logexus/1712345678_mcp_004_cookies.json"
}
```

**实现**: CDP `Network.getCookies()` + `document.cookie` → 合并去重 → Netscape/JSON 格式化 → >1KB 触发 offload。

### 5.4 `screenshot_fullpage`

**解决的问题**：`screenshot` 只截 viewport，CDP 可以截全页但需要手动 `evaluate`。统一为一个 Tool。

**入参 Schema**:
```json
{
  "type": "object",
  "properties": {
    "max_height_px": {
      "type": "number",
      "description": "最大截图高度(像素)，默认 16384。超出截断。",
      "default": 16384,
      "maximum": 32768
    },
    "format": {
      "type": "string",
      "enum": ["png", "jpeg"],
      "default": "png"
    },
    "quality": {
      "type": "number",
      "description": "JPEG 质量(0-100)，仅 format=jpeg 时生效。",
      "default": 80,
      "minimum": 1,
      "maximum": 100
    }
  }
}
```

**出参**（始终 offload）:
```json
{
  "status": "success",
  "width_px": 1920,
  "height_px": 8456,
  "saved_path": "/tmp/logexus/1712345678_mcp_005_fullpage.png",
  "size_bytes": 2845696,
  "format": "png"
}
```

**实现**: CDP `Page.captureScreenshot({captureBeyondViewport: true})` → 直接 offload bytes。

### 5.5 `export_pdf`

**解决的问题**：自动化场景常见需求（报告、发票、合同导出）。

**入参 Schema**:
```json
{
  "type": "object",
  "properties": {
    "landscape": {
      "type": "boolean",
      "description": "横向打印，默认 false(纵向)。",
      "default": false
    },
    "paper_size": {
      "type": "string",
      "enum": ["A4", "Letter", "Legal"],
      "default": "A4"
    },
    "print_background": {
      "type": "boolean",
      "description": "是否打印背景色/图片，默认 true。",
      "default": true
    },
    "scale": {
      "type": "number",
      "description": "缩放比例，0.1-2.0。默认 1.0。",
      "default": 1.0,
      "minimum": 0.1,
      "maximum": 2.0
    }
  }
}
```

**出参**（始终 offload）:
```json
{
  "status": "success",
  "page_count": 3,
  "saved_path": "/tmp/logexus/1712345678_mcp_006_export.pdf",
  "size_bytes": 156234,
  "format": "pdf"
}
```

**实现**: CDP `Page.printToPDF()` → decode base64 → offload bytes。

### 5.6 `get_storage`

**解决的问题**：Agent 直接读取 localStorage/sessionStorage（JWT token、应用状态、草稿），无需手写 JS。

**入参 Schema**:
```json
{
  "type": "object",
  "properties": {
    "include": {
      "type": "string",
      "enum": ["local", "session", "both"],
      "description": "读取哪种存储。默认 both。",
      "default": "both"
    },
    "key_prefix": {
      "type": "string",
      "description": "可选：只返回 key 以此前缀开头的条目。如 'token_' 或 'persist:'。"
    },
    "max_value_length": {
      "type": "number",
      "description": "单个 value 最大长度(字符)，超出截断。默认 200。",
      "default": 200,
      "maximum": 1000
    }
  }
}
```

**出参**:
```json
{
  "localStorage": {
    "count": 8,
    "filtered_count": 2,
    "entries": {
      "token_jwt": "eyJhbGciOiJIUzI1NiJ9...",
      "persist:user": "{\"id\":123,\"name\":\"Jak\"}"
    }
  },
  "sessionStorage": {
    "count": 3,
    "filtered_count": 0,
    "entries": {}
  }
}
```

**实现**: Content Script `evaluate` → `JSON.stringify({localStorage, sessionStorage})` → `key_prefix` 过滤 + `max_value_length` 截断。

---

## 六、原生工具降噪

### 6.1 问题分析

当前 MCP Wrapper 中 7 个 CDP 裸工具（`network_start/stop`, `console_start/stop`, `perf_start/stop`, `evaluate`）直接暴露给 Agent 会产生两个问题：

1. **冗余决策成本**：语义化 Tool（如 `extract_network_apis`）已经内部调用了 `network_start → network_stop`，Agent 不应该再看到这两个原子工具，否则会产生混淆——Agent 可能选择手动组合而非使用高级工具
2. **上下文污染**：14 个描述成本身已占据 token，新增 5 个语义 Tool 后总共 19 个。每次 Tool 发现时，LLM 需要扫描全部工具描述，增加不必要的推理开销

### 6.2 降噪方案

**核心原则**：Tool 列表应是正交的非重叠集合——Agent 看到的每个 Tool 解决一个独立问题，不存在"手动组合 A+B 能达成工具 C"的冗余。

**降噪操作**：

| 现有 Tool | 处理 | 原因 |
|:--|:--|:--|
| `network_start` | **隐藏**（不在 MCP Tool 列表中注册） | 语义被 `extract_network_apis` 完全覆盖 |
| `network_stop` | **隐藏** | 同上 |
| `console_start` | **隐藏** | 通过 `evaluate` 可直接注入 JS 截获 console，且语义场景极少 |
| `console_stop` | **隐藏** | 同上 |
| `perf_start` | **隐藏** | 性能分析不在 Agent 常规路径中，保留 `evaluate` 裸通道即可 |
| `perf_stop` | **隐藏** | 同上 |
| `evaluate` | **保留** | CDP evaluate 是"逃生舱"——语义 Tool 覆盖不了的边缘场景由它兜底 |
| 7 个基础操作 | **保留** | 基础原子操作，不可替代 |
| 5 个语义 Tool | **新增** | 高级封装 |

**降噪后 Tool 清单**：

| 类别 | 数量 | 列表 |
|:--|:--|:--|
| 基础操作 | 7 | `observe`, `click`, `type`, `navigate`, `extract`, `scroll`, `screenshot` |
| CDP 能力 | 1 | `evaluate`（兜底逃生舱） |
| 语义 Tool | 5 | `extract_network_apis`, `get_auth_cookies`, `screenshot_fullpage`, `export_pdf`, `get_storage` |
| **合计** | **13** | |

**效果**：
- 从 19 个降至 13 个，减少 32%
- Agent 不会看到可被语义 Tool 替代的裸工具，消除"手动组合 vs 使用高级工具"的二义性
- `evaluate` 作为唯一的裸通道保留，Agent 在 Tool 描述中可以看到它是最通用的兜底工具

**实现方式**：Native Host 中的 MCP Tool 注册表维护一个 `hidden_tools` 集合，内部仍保留所有处理函数（语义 Tool 内部调用它们），但 `ListToolsRequest` 只返回 13 个工具的描述。

---

## 七、文件变更清单

### 7.1 新增文件

| 路径 | 说明 |
|:--|:--|
| `native-host/file-offloader.js` | 文件卸载模块（写入、清理、TTL 管理） |
| `native-host/tools/semantic/` | 5 个语义 Tool 的实现文件 |
| `native-host/tools/semantic/extract-network-apis.js` | `extract_network_apis` 实现 |
| `native-host/tools/semantic/get-auth-cookies.js` | `get_auth_cookies` 实现 |
| `native-host/tools/semantic/screenshot-fullpage.js` | `screenshot_fullpage` 实现 |
| `native-host/tools/semantic/export-pdf.js` | `export_pdf` 实现 |
| `native-host/tools/semantic/get-storage.js` | `get_storage` 实现 |

### 7.2 修改文件

| 路径 | 变更内容 |
|:--|:--|
| `native-host/host.js` | 重写：集成 MCP SSE Server + FileOffloader + 语义 Tool 路由 |
| `native-host/package.json` | 新增依赖 `@modelcontextprotocol/sdk` |
| `docs/design.md` | 更新架构图、模块说明、版本状态 |

### 7.3 废弃文件（从 repo 删除）

| 路径 | 原因 |
|:--|:--|
| `daemon/server.js` | 路由逻辑合并入 Native Host |
| `daemon/package.json` | 随目录删除 |
| `mcp-wrapper/server.js` | MCP 能力合并入 Native Host |
| `mcp-wrapper/package.json` | 随目录删除 |

### 7.4 不动文件

`src/` 目录下所有 Chrome Extension 源代码零改动。

---

## 八、风险与缓解

| 风险 | 等级 | 缓解 |
|:--|:--|:--|
| SSE 客户端兼容性（Claude Code/LangGraph 对 MCP SSE 的支持度） | 中 | MCP SDK 官方支持 SSE Transport；Claude Code 支持 `url` 配置模式；LangGraph 通过 `langchain-mcp-adapters` SSE client |
| SSE 断连导致请求丢失 | 低 | Native Host 维持内部请求队列，SSE 重连后不重放（Agent 层负责重试） |
| 端口冲突（:9527 被占用） | 低 | 重试 + 降级端口策略 |
| 临时文件残留占用磁盘 | 低 | 多级清理策略（TTL + 硬上限 + 生命周期联动） |
| Native Host 进程崩溃 | 低 | Chrome 会自动重启 Native Host（由注册表配置的 `allowed_origins` 保证） |
| `@modelcontextprotocol/sdk` 版本 API 变化 | 低 | 锁定 SDK 版本；SSEServerTransport 是稳定 API |

---

## 九、版本路线

| 版本 | 内容 | 估时 |
|:--|:--|:--|
| **v0.2.0** (本设计) | 单进程 Native Host + MCP SSE + 文件卸载 + 5 语义 Tool + 工具降噪 | 3-4 天 |
| v0.2.1 | 语义 Tool 增补 + Agent 反馈优化 | 后续 |
| v0.3.0 | TypeScript 重写 Native Host + 类型共享 | 后续 |
