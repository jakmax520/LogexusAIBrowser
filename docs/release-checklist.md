# Logexus AI Browser — 上架清单

## 一、Chrome Web Store 资料准备

### 1.1 扩展信息

| 字段 | 内容 |
|:--|:--|
| **名称** | Logexus AI Browser |
| **简短说明** (132字) | AI-powered browser operator. Let any AI Agent (Claude Code, Cursor, custom Python/Node.js) control your Chrome browser through a secure WebSocket API. |
| **详细说明** | 见下方英文/中文文案 |
| **类别** | Developer Tools |
| **语言** | English + 中文（简体） |
| **主页** | https://github.com/jakmax520/LogexusAIBrowser |
| **隐私政策** | 见 `docs/privacy.md` |

### 1.2 商店文案（英文）

```
Logexus AI Browser turns your Chrome into an AI-controllable automation engine.

== What it does ==
- Exposes 7 browser actions (observe, click, type, navigate, extract, scroll, screenshot) through a local WebSocket API
- AI Agents (Claude Code, Cursor, custom scripts) send AGENT_REQUEST and receive structured page state
- No LLM inside the extension — pure executor with security gateway

== Key Features ==
- Cloud-Edge Separation: Zero LLM dependency, lightweight executor only
- WebSocket Direct Connect: Single-hop communication via local daemon (ws://localhost:9527)
- DOM Reduction: Converts complex pages to ≤80 structured interactive elements
- Multi-Tab Coordination: Manage tabs across windows
- CAPTCHA Detection: Auto-pause and wait for manual verification
- Authorization Gateway: Per-session click-to-authorize security model
- Audit Logs: Full operation history with IndexedDB persistence and JSON export
- Dark Mode: Toggle between light and dark themes
- Operation Recording & Playback: Save and replay macro sequences

== How it works ==
1. Start the daemon: cd daemon && npm start
2. Load the extension in Chrome
3. Connect your AI Agent via WebSocket: ws://localhost:9527
4. Send AGENT_REQUEST, receive AGENT_RESPONSE

== Privacy ==
- All data processed locally — nothing uploaded to any server
- No passwords stored — reuses existing browser login sessions
- API token authentication for WebSocket access
```

### 1.3 商店文案（中文）

```
Logexus AI Browser 将你的 Chrome 浏览器变成一个 AI 可操控的自动化引擎。

内部不包含任何大模型——纯粹的浏览器执行器+安全网关。
外部 AI Agent（Claude Code、Cursor、自定义脚本）通过本地 WebSocket 发送指令，
扩展在浏览器中执行并返回结构化结果。

核心能力：
- 云边分离：零 LLM 依赖，轻量执行器
- WebSocket 直连：单跳通信，最低延迟
- DOM 降噪：复杂页面压缩为 ≤80 个结构化交互元素
- 多标签页协同 + 验证码检测 + 授权网关 + 审计日志
- 暗色模式 + 操作录制回放 + JSON 日志导出
```

### 1.4 截图准备

| # | 截图内容 | 规格 |
|:--|:--|:--|
| 1 | Side Panel 主界面（暗色模式 + 审计日志列表） | 1280x800 |
| 2 | 授权弹窗（黄色卡片 + 允许/拒绝按钮） | 1280x800 |
| 3 | 测试控制台（test-agent.html 发送指令 + 响应日志） | 1280x800 |
| 4 | daemon 启动 + Agent 连接成功日志 | 1280x800 |
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
Compress-Archive -Path "dist\*" -DestinationPath "logexus-ai-browser-v0.1.0.zip"
```

```bash
# macOS / Linux
cd dist && zip -r ../logexus-ai-browser-v0.1.0.zip * && cd ..
```

### 2.3 版本号管理

发布前更新两处版本号：
1. `manifest.json` → `"version": "0.1.0"`
2. `package.json` → `"version": "0.1.0"`

遵循语义化版本：`主版本.次版本.修订号`

---

## 三、Daemon 生产部署

### 3.1 自定义 Token

```bash
# 生成强随机 token
node -e "console.log('lx_' + require('crypto').randomBytes(16).toString('hex'))"

# 设置环境变量启动
set LOGEXUS_TOKEN=你的强token
node daemon/server.js
```

### 3.2 Windows 开机自启

```bat
schtasks /create /tn "LogexusDaemon" /tr "node D:\CCWorkSpace\LogexusAIBrowser\daemon\server.js" /sc onlogon /rl highest /f
```

### 3.3 健康检查

```bash
curl http://127.0.0.1:9528
# {"status":"ok","clients":1,"extensionConnected":true,...}
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
