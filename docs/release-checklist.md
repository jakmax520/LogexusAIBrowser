# Logexus AI Browser — 上架清单

## 一、Chrome Web Store 资料准备

### 1.1 扩展信息

| 字段 | 内容 |
|:--|:--|
| **名称** | Logexus AI Browser |
| **简短说明** (132字) | AI-powered browser operator. Let any AI Agent (Claude Code, Cursor, custom Python/Node.js) control your Chrome browser through a local WebSocket / MCP SSE API. |
| **详细说明** | 见下方英文/中文文案 |
| **类别** | Developer Tools |
| **语言** | English + 中文（简体） |
| **主页** | https://github.com/jakmax520/LogexusAIBrowser |
| **隐私政策** | 见 `docs/privacy.md` |

### 1.2 商店文案（英文）

```
Logexus AI Browser turns your Chrome into an AI-controllable automation engine.

== What it does ==
- Exposes browser actions through a local WebSocket and MCP SSE API (single-process Native Host)
- Supports 3 protocols: JSON-RPC 2.0 (WebSocket), MCP SSE, and HTTP POST
- AI Agents (Claude Code, Cursor, custom scripts) send instructions and receive structured page state
- No LLM inside the extension — pure executor with security gateway

== Key Features ==
- Cloud-Edge Separation: Zero LLM dependency, lightweight executor only
- Three Protocols, One Process: JSON-RPC 2.0 + MCP SSE + HTTP coexist in Native Host (:9527)
- DOM Reduction: Converts complex pages to ≤150 structured interactive elements
- Multi-Tab Coordination: Manage tabs across windows with auto-grouping
- CAPTCHA Detection: Auto-pause and wait for manual verification
- Authorization Gateway: Per-session click-to-authorize security model
- Audit Logs: Full operation history with IndexedDB persistence and JSON export
- Dark Mode: Toggle between light and dark themes
- Operation Recording & Playback: Save and replay macro sequences
- Auto-Start: Native Host launches silently on Windows login (v0.2.1+)
- Semantic CDP Tools: Extract network APIs, export cookies, full-page screenshots, PDF export, storage read (5 advanced tools)
- File Offloading: Large payloads (>10KB) auto-saved to temp directory

== How it works ==
1. Start the Native Host: node native-host/host.js (or auto-start via install-autostart.bat)
2. Load the extension in Chrome
3. Connect your AI Agent:
   - Claude Code → MCP SSE: http://127.0.0.1:9527/sse
   - Python / Tauri → WebSocket JSON-RPC 2.0: ws://127.0.0.1:9527
   - curl testing → HTTP POST: http://127.0.0.1:9527/api/agent

== Privacy ==
- All data processed locally — nothing uploaded to any server
- No passwords stored — reuses existing browser login sessions
- API token authentication for external access
```

### 1.3 商店文案（中文）

```
Logexus AI Browser 将你的 Chrome 浏览器变成一个 AI 可操控的自动化引擎。

内部不包含任何大模型——纯粹的浏览器执行器 + 安全网关。
外部 AI Agent（Claude Code、Cursor、自定义脚本）通过本地 WebSocket / MCP SSE 发送指令，
扩展在浏览器中执行并返回结构化结果。

核心能力：
- 云边分离：零 LLM 依赖，轻量执行器
- 三协议统一：JSON-RPC 2.0 + MCP SSE + HTTP API 共存于单进程 Native Host
- DOM 降噪：复杂页面压缩为 ≤150 个结构化交互元素
- 多标签页协同 + 验证码检测 + 授权网关 + 审计日志
- 暗色模式 + 操作录制回放 + JSON 日志导出
- 自动启动：Windows 登录时静默启动 Native Host（v0.2.1+）
- 5 个高级语义 CDP 工具：网络 API 抓取、Cookie 导出、全页截图、PDF 导出、存储读取
```

### 1.4 截图准备

| # | 截图内容 | 规格 |
|:--|:--|:--|
| 1 | Side Panel 主界面（暗色模式 + 审计日志列表） | 1280x800 |
| 2 | 授权弹窗（黄色卡片 + 允许/拒绝按钮） | 1280x800 |
| 3 | 测试控制台（test-agent.html 发送指令 + 响应日志） | 1280x800 |
| 4 | Native Host 启动 + Agent 连接成功日志 | 1280x800 |
| 5 | DOM 降噪效果（observe 返回的结构化元素） | 1280x800 |

截图方法：在 Chrome 中加载扩展后，用 `chrome.tabs.captureVisibleTab` 或系统截图工具截取。

---

## 二、生产构建与打包

### 2.1 构建命令

```bash
npm run build
```

### 2.2 打包为 ZIP

```powershell
# Windows
Compress-Archive -Path "dist\*" -DestinationPath "logexus-ai-browser-v0.2.1.zip"
```

```bash
# macOS / Linux
cd dist && zip -r ../logexus-ai-browser-v0.2.1.zip * && cd ..
```

### 2.3 版本号管理

发布前更新三处版本号：
1. `manifest.json` → `"version": "0.2.1"`
2. `package.json` → `"version": "0.2.1"`
3. `native-host/package.json` → `"version": "0.2.1"`

遵循语义化版本：`主版本.次版本.修订号`

---

## 三、Native Host 生产部署

### 3.1 Native Host 安装

```powershell
# Windows：注册 Native Messaging Host
cd native-host
install.bat <你的扩展ID>
```

```bash
# macOS / Linux
cd native-host
chmod +x install.sh && ./install.sh <你的扩展ID>
```

### 3.2 安装 Native Host 依赖

```bash
cd native-host
npm install --production
```

### 3.3 Windows 开机自启（v0.2.1+）

```powershell
# 注册自启（仅需一次）
native-host\install-autostart.bat
```

```bash
# macOS (LaunchAgent)
# 详见 docs/auto-start-design.md
```

### 3.4 自定义 Token

```bash
# 生成强随机 token
node -e "console.log('lx_' + require('crypto').randomBytes(16).toString('hex'))"

# 设置环境变量启动
export LOGEXUS_TOKEN=你的强token   # macOS/Linux
set LOGEXUS_TOKEN=你的强token      # Windows
node native-host/host.js
```

### 3.5 健康检查

```bash
curl http://127.0.0.1:9527/health
# {"status":"RUNNING","extensionConnected":true,"pendingRequests":0,"sseConnected":false}
```

---

## 四、提交审核 Checklist

- [ ] `manifest.json` 版本号已更新
- [ ] `manifest.json` 图标路径正确（icon16/48/128.png）
- [ ] 隐私政策 URL 已填写
- [ ] 商店描述已准备（中英文）
- [ ] 5 张截图已准备好（1280x800）
- [ ] `.zip` 包已生成且 < 100MB
- [ ] `npm run typecheck` 零错误
- [ ] Chrome 中实际加载测试通过
- [ ] `externally_connectable` 配置正确
- [ ] 无 `console.log` 残留（生产模式）
- [ ] CSP 策略已设置
- [ ] 权限说明与隐私政策一致
- [ ] 不含任何远程代码执行
- [ ] 不含混淆/压缩代码（Web Store 合规要求）
- [ ] `nativeMessaging` 权限有充分理由说明
- [ ] Native Host 已测试启动并连接成功
