# Chrome Web Store 权限使用说明 — Logexus AI Browser v0.2.1

> 本文档用于 CWS 提交时填写「权限使用说明」字段，供应对可能触发的深入审核。
> 提交时请确保与已托管的《隐私权政策》（`docs/privacy-policy.html`）表述一致。

## 产品概述

Logexus AI Browser 是一款浏览器自动化引擎。用户自行配置的 AI Agent（如 Claude Code、Cursor 或自研 Agent）通过**本机 WebSocket daemon（仅回环地址 127.0.0.1:9527）**接入扩展，由扩展在浏览器内执行受控的原子操作（导航、点击、输入、滚动、提取、等待）。产品目标：让 AI 像真人一样操作浏览器，复用已有登录态完成跨网站自动化任务。

**本扩展没有任何自有后端服务器，扩展自身代码不发起任何远端网络上传；所有数据仅在本机流转（浏览器 ↔ 本地 daemon ↔ 用户自配的 Agent 进程），或由用户自己的 Agent 按其配置转发至其选择的 LLM 服务。**

---

## 一、`host_permissions: <all_urls>`（访问所有网站）

**用途与必要性**
- 产品核心能力是「AI 在任意网站上执行自动化」。AI 任务目标（搜索、填表、跨站比价、登录后操作等）面向的网站集合是**开放且不可枚举**的，无法预先列入白名单。
- Content Script 需要在用户浏览器打开的任意域名页面注入运行（DOM 降噪、可交互元素索引、原子操作执行），以响应 AI 的实时指令。
- CWS 建议的两条替代路径在本产品场景下均不成立：
  - **`activeTab`**：仅在用户显式唤起扩展（点击图标/打开侧栏）时授予当前活动标签页的临时访问权，**一旦页面导航到新 origin 即失效**；本产品的 AI 需要自主跨站导航并持续操作，无法使用。
  - **指定站点白名单**：产品面向任意网站，无法穷举。

**使用边界**
- Content Script 常驻用户浏览的页面，但**仅在自动化会话收到指令（observe/execute）时才采集与执行**，不在后台主动收集或上传任何数据。
- 只采集「降噪后的结构化 DOM」（可交互元素、文本、超链接，单页上限约 80 个元素），**不采集完整 HTML、不注入远程脚本**。
- 采集结果仅用于生成下一步操作指令，经本地 daemon 提供给用户自配的 Agent。

---

## 二、`permissions: cookies`

**用途与必要性**
- 「复用已有登录态」是本产品核心卖点：跨站自动化任务常需保持登录（如登录后才能操作的站点）。
- 仅当用户本机的 AI Agent **显式调用 `browser.get_cookies`（指定域名）**时，扩展才按该域名读取当前登录态 Cookie，并以 Netscape 格式导出。

**使用边界**
- **按需、按指定域名**读取；不做批量、后台或轮询读取。
- 导出的 Cookie 仅经本地回环 WebSocket 传给用户自配的 Agent 进程，**扩展自身无任何远端上传**；是否将 Cookie 用于其 LLM 服务，由用户自己的 Agent 按其配置决定，完全受用户控制。
- 扩展不存储 Cookie、不写入、不修改网站会话；卸载后无残留。

---

## 三、`permissions: debugger`

**用途与必要性**
- 用于自动化「输入文本」操作中，通过 CDP（Chrome DevTools Protocol）`Input.dispatchKeyEvent` 向目标输入框发送**真实键盘事件**。
- 现代前端框架（React/Vue 等）的受控组件会过滤合成事件，仅用脚本赋值或合成事件常导致输入不被页面接受；CDP 真实键盘事件可保证 AI 输入的文本被页面完整、正确接收——这是自动化输入保真度的必要手段。

**使用边界**
- **仅按需（lazy attach）**：仅在执行输入操作时，对**当前正在自动化的那一个标签页** attach；同一时间仅 attach 单个标签页。
- **仅用于输入模拟**：debugger 不用于读取页面数据、不做持续监控、不采集内容。
- 标签页关闭时 Chrome 自动解除 attach，无残留。
- 该权限仅在自动化会话中生效，会话需用户授权确认后方可执行。

---

## 四、其他权限（简述，均为本地用途）

| 权限 | 用途 |
|---|---|
| `tabs` | 读取当前标签页 URL/标题，及执行导航（`chrome.tabs.update/create`）——导航原子操作的必要依赖 |
| `tabGroups` | 将自动化任务打开的标签页归入「My Logexus Browser」分组，便于用户识别与追踪 |
| `storage` | 配置与 API Key 的本地保存（`chrome.storage.local`，加密存储） |
| `alarms` | Service Worker 保活定时器，维持与本地 daemon 的连接 |
| `nativeMessaging` | 连接本机原生进程（com.logexus.browser.host），由 Chrome 管理 daemon 进程生命周期；仅本地通信 |

---

## 五、数据安全与隐私声明（对应 CWS 隐私信息部分）

1. **无自有后端、无远端上传**：扩展自身代码不发起任何远端网络请求；数据仅在本机（浏览器 ↔ 本地 daemon ↔ 用户自配 Agent）之间流转。
2. **数据去向仅两类**：(a) 用户本机的 daemon/原生进程（回环地址）；(b) 若用户显式配置，其自行选择的 LLM API——由用户自己的 Agent 按其配置转发，扩展不主动上传。
3. **会话强制授权**：非观察类操作需用户确认后方可执行；关闭标签页立即停止所有操作。
4. **无任意代码执行**：仅支持 6 种预定义原子操作（navigate / click / type / scroll / extract / wait），禁止执行 AI 生成的任意 JavaScript。
5. **本地存储与可清理**：API Key 仅存本地且加密；审计日志存于 IndexedDB，可一键清空；卸载即全部删除。
6. 本说明与《隐私权政策》及《安全策略》（SECURITY.md）所述一致。

---

## English version（可直接粘贴的精简版）

> Logexus AI Browser is a browser automation engine. Users' own AI agents (e.g., Claude Code, Cursor) connect to the extension through a local WebSocket daemon on the loopback address (127.0.0.1) and drive six whitelisted atomic operations (navigate, click, type, scroll, extract, wait). The extension has no backend server and performs no remote data upload — all data flows locally between the browser, the local daemon, and the user's own agent process.
>
> **`<all_urls>` host permission** — Required because the product operates on arbitrary websites chosen by the AI at runtime; the site set is open-ended and cannot be enumerated, so a host whitelist is not feasible, and activeTab's temporary grant is invalidated on cross-origin navigation. The content script is injected into pages but only collects filtered structured DOM (interactive elements/text/links, ≤ ~80 elements per page) on demand during an authorized session; it does not collect full HTML, load remote scripts, or upload anything in the background.
>
> **`cookies`** — Core feature: reusing existing login state for cross-site tasks. Cookies are read only on demand for a caller-specified domain when the agent explicitly invokes `browser.get_cookies` and are exported in Netscape format to the local daemon/agent only. No bulk, background, or polling reads; no remote upload by the extension.
>
> **`debugger`** — Used only to simulate real keyboard events (CDP `Input.dispatchKeyEvent`) for reliable text input into React/Vue controlled form fields. It is attached lazily, only to the single tab currently being automated, and only during an authorized session; it is not used to read page data or for continuous monitoring, and Chrome auto-detaches it when the tab closes.
>
> Other permissions (`tabs` for URL/title and navigation, `tabGroups` for task tab grouping, `storage` for local config, `alarms` for keep-alive, `nativeMessaging` for the local daemon process) are all local-only. Sessions require user confirmation, closing the tab stops all operations, no arbitrary JS execution is allowed, and all data is stored locally and deletable.

---

## 字段版文案（中文，每项 ≤1000 字符，对应后台「权限说明」字段）

> 以下按 CWS 后台「权限说明」区字段顺序排列，可直接逐段粘贴。

### 1. 需请求 tabs 的理由

> 用于读取当前标签页的 URL 与标题（作为操作上下文返回给 Agent），以及执行导航原子操作（chrome.tabs.update/create）。不读取标签页内容或表单数据。

### 2. 需请求 tabGroups 的理由

> 用于将自动化任务打开的标签页归入「My Logexus Browser」分组，便于用户识别、追踪与关闭。纯本地 UI 行为，不涉及任何用户数据。

### 3. 需请求 storage 的理由

> 用于在浏览器本地（chrome.storage.local，加密）保存用户配置与 LLM API Key。数据不出本机，用户可随时清除。

### 4. 需请求 alarms 的理由

> Service Worker 保活定时器（每 0.25 分钟），用于维持与本地 daemon 的连接。纯本地，不涉及任何用户数据。

### 5. 需请求 debugger 的理由

> 用于自动化「输入文本」操作时，通过 CDP（Chrome DevTools Protocol）Input.dispatchKeyEvent 向目标输入框发送真实键盘事件。现代前端框架（React/Vue 等）的受控组件会过滤合成事件，仅用脚本赋值或合成事件常导致输入不被页面接受；真实键盘事件可保证 AI 输入的文本被页面完整、正确接收，是自动化输入保真度的必要手段。仅按需（lazy attach）：只在执行输入操作时对当前正在自动化的那一个标签页 attach，同一时间仅 attach 单个标签页。仅用于输入模拟，不用于读取页面数据、不做持续监控、不采集内容。标签页关闭时 Chrome 自动解除 attach，无残留。该权限仅在用户授权的自动化会话中生效，会话需用户确认后执行。

### 6. 需请求 nativeMessaging 的理由

> 用于连接本机原生进程（com.logexus.browser.host），由 Chrome 管理本地 daemon 进程的生命周期（自动拉起/退出），通信仅在本机回环，不涉及远端通信。

### 7. 需请求 cookies 的理由

> 「复用已有登录态」是本产品核心卖点：跨站自动化任务常需保持登录。扩展仅在用户本机的 AI Agent 显式调用 browser.get_cookies（指定域名）时，按该域名读取当前登录态 Cookie 并以 Netscape 格式导出，供 AI 在需要登录的站点执行任务。按需、按指定域名读取，不做批量、后台或轮询读取。导出的 Cookie 仅经本地回环 WebSocket（127.0.0.1:9527）传给用户本机运行的 Agent 进程，扩展自身不向任何远端上传；是否将 Cookie 转发给 LLM 服务由用户自己的 Agent 按其配置决定，完全受用户控制。扩展不存储、不写入、不修改网站会话，卸载后无残留。

### 8. 需请求主机权限的理由

> 产品核心是让用户自行配置的 AI 在任意网站上执行跨站自动化（导航、点击、输入、滚动、提取）。任务面向的网站集合开放且不可枚举，无法预先列入白名单；activeTab 仅在用户手势时授予当前活动标签页临时访问权，一旦导航到新 origin 即失效，无法支撑 AI 自主跨站导航后的持续操作，故必须请求所有网站访问权。Content Script 常驻页面，但仅在自动化会话收到指令（observe/execute）时才采集与执行，不在后台主动收集或上传任何数据。只采集降噪后的结构化 DOM（可交互元素、文本、链接，单页上限约 80 个元素），不采集完整 HTML，不注入远程脚本。采集结果仅用于生成下一步操作指令，经本地回环 daemon 提供给用户本机运行的 Agent，扩展自身无任何远端上传。

### 9. 单一用途说明

> 本扩展的单一用途是：让用户自行配置的 AI Agent 通过本机 WebSocket 连接操作浏览器，执行用户授权的跨网站自动化任务（导航、点击、输入、滚动、提取、等待），并复用用户已有的登录态。扩展不提供广告，不将数据用于任何其他目的；所有数据仅在本机流转，扩展自身无远端上传。
