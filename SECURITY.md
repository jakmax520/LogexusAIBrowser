# Logexus AI Browser — 安全策略

## 1. 安全原则

Logexus AI Browser 在用户本地浏览器中运行，安全第一优先级为：**保护用户数据不被泄露**，**防止恶意网页通过 AI Agent 执行未授权操作**。

## 2. 数据安全

### 2.1 API Key 管理

- **存储位置**: `chrome.storage.local` (本地加密存储)
- **传输**: 仅通过 HTTPS 发送至用户配置的 LLM API 端点
- **不上传**: API Key 永不上传至任何第三方服务器
- **日志脱敏**: 执行日志中自动替换 API Key 为 `****`

### 2.2 用户数据

- **零密码存储**: 不存储任何网站的登录凭证，完全依赖浏览器已有 Cookie/Session
- **页面数据**: 仅采集当前页面结构化 DOM 树 (过滤后 ≤80 个元素)，不采集完整 HTML
- **截图**: 仅在异常校验失败时触发局部截图，不持续录屏
- **本地化**: 所有数据 (日志、配置、会话) 仅存储于本地 `chrome.storage.local` 和 IndexedDB

### 2.3 数据传输

- 上行数据: 页面 DOM 结构 JSON → Service Worker → HTTPS → LLM API
- 下行数据: LLM Tool Call → Service Worker → Content Script
- **不经过任何中间服务器**，直连用户配置的 LLM API 端点

## 3. 执行安全

### 3.1 原子操作白名单

**严格禁止**执行 LLM 生成的任意 JavaScript 代码。仅支持以下 6 种预定义操作：

| 操作 | 安全级别 | 说明 |
|:--|:--|:--|
| `navigate(url)` | 中 | URL 跳转，跨域时需用户确认 |
| `click(id)` | 低 | 仅点击已索引的 `data-agent-id` 元素 |
| `type(id, text)` | 低 | 仅向已索引的输入框输入文本 |
| `scroll(direction)` | 低 | 仅页面滚动 |
| `extract(selector)` | 低 | 仅读取 DOM 文本内容，不可修改 |
| `wait(ms)` | 低 | 延迟等待，上限 10 秒 |

操作合法性在 Service Worker 层校验，action 值必须在枚举白名单中。

### 3.2 Prompt Injection 防护

- LLM 的 System Prompt 明确约束输出格式为结构化 JSON
- Agent Scheduler 解析 LLM 返回时，仅提取 `action/target_id/value` 字段，忽略其他内容
- `target_id` 必须是 `el_N` 格式的整数 ID，不允许任意 JS 表达式
- `value` 在 `navigate` 操作时校验 URL 格式，防止 `javascript:` 协议注入

### 3.3 用户授权

- **每次任务启动**: 用户必须在 Side Panel 点击「授权」确认
- **跨域新 Tab**: 打开新域名时弹出二次确认
- **敏感操作**: 表单提交、涉及 `password`/`credit card` 字段的操作需人工确认

## 4. 网络安全

### 4.1 Content Security Policy (CSP)

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; connect-src https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com http://localhost:*"
  }
}
```

### 4.2 权限最小化

Manifest V3 权限声明遵循最小化原则：

```json
{
  "permissions": ["activeTab", "tabs", "scripting", "storage"],
  "host_permissions": ["<all_urls>"]
}
```

`<all_urls>` 为必要权限 (需要支持用户指定的任意网站)，其余权限均按需申请。

## 5. 审计与合规

### 5.1 操作审计

- 所有操作 (Thought/Action/Result) 完整记录至 IndexedDB
- 日志包含: 时间戳、页面 URL、执行动作、结果状态、错误详情
- 日志数据可通过 Side Panel 导出为 JSON/CSV
- 日志本地保留 30 天后自动清理 (可配置)

### 5.2 Chrome Web Store 合规

- 隐私政策: 明确声明不收集、不传输用户数据至第三方
- 权限说明: 在扩展描述中逐一解释每个权限的用途
- 禁止混淆代码: 上传至 Web Store 的代码保持可读性

## 6. 安全开发实践

### 6.1 依赖管理

- 定期 `npm audit` 检查依赖漏洞
- 最小化依赖数量 (React + Tailwind 为主，避免重型框架)
- 锁定依赖版本 (`package-lock.json`)

### 6.2 代码审查

- 涉及 LLM Tool Call 解析的代码需额外审查
- 涉及 `chrome.storage` 读写的代码需检查敏感数据处理
- 安全相关的 PR 需要明确的安全影响说明

### 6.3 威胁模型

| 威胁 | 风险等级 | 缓解措施 |
|:--|:--|:--|
| 恶意网页诱导 AI 点击危险按钮 | 中 | AI 操作的按钮限定为 `data-agent-id` 索引元素，ActionExecutor 执行前二次校验 |
| LLM 返回恶意 JS 代码 | 高 | 白名单操作 + 参数格式校验 + 禁止 eval |
| API Key 泄露 | 高 | chrome.storage.local 加密 + 不上传 + 日志脱敏 |
| 中间人攻击 | 中 | 强制 HTTPS + CSP 限制 connect-src |
