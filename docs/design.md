# Logexus AI Browser — 最终设计方案

## 一、产品定义

### 1.1 一句话定位

Logexus AI Browser 是一个 Chrome 扩展，让 AI 像真人一样操作你的本地浏览器，直接复用你已登录的会话执行跨网站自动化任务。

### 1.2 核心差异化能力

| 能力 | 说明 |
|:--|:--|
| **会话复用** | 不存密码，直接用浏览器本地登录态，天然绕过 CAPTCHA |
| **语义理解** | AI 动态理解页面内容，页面改版后自动适应，无需维护 CSS 选择器 |
| **自然语言驱动** | 用户说"做什么"，AI 自己规划"怎么做" |
| **全程可控** | Side Panel 实时直播执行过程，随时接管或关闭标签页立即终止 |
| **操作可审计** | 每一步 Thought / Action / Result 完整记录，支持回放 |
| **远程触发** | 手机/其他设备发起任务，主电脑在线即可执行（后续版本） |

### 1.3 目标场景

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
| Agent 框架 | 纯 TypeScript 自研 | 避免 Python WebSocket 桥接开销，原生调用 Chrome API，维护成本低 |
| 截图策略 | 混合模式 | 日常用纯 DOM 树省 Token；元素消失或校验失败时触发截图给视觉模型 |
| LLM Provider | 多 Provider 架构 | 首发 OpenAI 兼容接口（支持中转服务），预留 Ollama 本地通道 |
| UI 风格 | 富交互面板 | 折叠卡片 + 状态灯 + 进度预警，消除"黑盒效应" |
| 远程触发 | 延后 | MVP 阶段聚焦核心闭环，基础盘打磨透再扩展 |

---

## 三、系统架构（云边分离）

整体采用 **云边分离** 架构：重型推理引擎（LLM、ReAct 循环）剥离到外部 AI Agent，端侧 Chrome 扩展回归极轻量级执行器角色。

```
┌─────────────────────────────────────────────────────────────┐
│                    外部 AI Agent (云端/本地)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                    │
│  │ Planner  │ │ Executor │ │Reflector │                    │
│  │ 任务拆解  │ │ 工具调用  │ │ 自我纠错  │                    │
│  └──────────┘ └──────────┘ └──────────┘                    │
│            ↓ LLM (OpenAI/Anthropic/Ollama)                  │
│            ↓ AGENT_REQUEST / AGENT_RESPONSE                  │
├─────────────────────────────────────────────────────────────┤
│                   Chrome Extension (端侧执行器)               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Service Worker (API 网关 + 授权)           ││
│  │  chrome.runtime.onMessage → 路由分发 → 安全校验 → 审计   ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │              Side Panel (监控 + 授权面板)                ││
│  │  连接状态 │ 授权弹窗 │ 审计日志滚动列表                    ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ Content Script│ │ Content Script│ │ Content Script│        │
│  │ DOM 降噪     │ │ DOM 降噪     │ │ DOM 降噪     │        │
│  │ 元素索引注入  │ │ 元素索引注入  │ │ 元素索引注入  │        │
│  │ 6 种原子操作  │ │ 6 种原子操作  │ │ 6 种原子操作  │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 数据流向

| 方向 | 路径 | 数据内容 |
|:--|:--|:--|
| **下行（指令）** | 外部 Agent → `chrome.runtime.sendMessage` → Service Worker → Content Script | `AGENT_REQUEST: {type, task_id, action, payload}` |
| **上行（结果）** | Content Script → Service Worker → `sendResponse` → 外部 Agent | `AGENT_RESPONSE: {type, task_id, status, data}` |

### 3.3 API 契约

**外部 Agent → 扩展**（每次操作一条指令）：

```json
{
  "type": "AGENT_REQUEST",
  "task_id": "req_001",
  "action": "observe|click|type|navigate|extract|scroll",
  "payload": {
    "target_id": "el_15",
    "value": "OpenAI",
    "reasoning": "在搜索框中输入搜索词"
  }
}
```

**扩展 → 外部 Agent**（同步返回执行结果 + 最新页面状态）：

```json
{
  "type": "AGENT_RESPONSE",
  "task_id": "req_001",
  "status": "success|error|blocked",
  "data": {
    "action_result": "Text entered successfully",
    "current_url": "https://example.com/search",
    "new_observation": [{ "id": "el_16", "tag": "button", "text": "Search", "inViewport": true }],
    "error": null
  }
}
```

### 3.4 核心模块

| 模块 | 位置 | 职责 |
|:--|:--|:--|
| API 网关 | `src/background/index.ts` | 接收 AGENT_REQUEST，路由分发，安全授权，审计记录 |
| DOM 降噪 | `src/content/DOMReducer.ts` | 过滤隐藏/不可交互元素，输出 ≤80 个结构化元素 |
| 元素索引 | `src/content/ElementIndexer.ts` | 为交互元素注入 `data-agent-id`，支持精确定位 |
| 动作执行 | `src/content/ActionExecutor.ts` | 6 种原子操作：observe/click/type/navigate/extract/scroll |
| 变化监听 | `src/content/MutationWatcher.ts` | MutationObserver + 500ms 静默期判定 |
| 授权面板 | `src/sidepanel/` | Side Panel UI：连接状态 + 授权弹窗 + 审计日志 |

---

## 四、核心模块详细设计

### 4.1 DOM 降噪与元素索引（Content Script）

**处理流程**：

```
原始 DOM → 过滤隐藏/不可见 → 筛选交互元素 → 注入 data-agent-id → 结构化 JSON
```

1. **可见性过滤**：剔除 `display:none`、`visibility:hidden`、`opacity:0`、宽高为 0 的元素
2. **视口检测**：`getBoundingClientRect()` 标记 `in_viewport` / `requires_scroll`
3. **交互元素筛选**：
   - 点击类：`<a>`, `<button>`, `[role="button"]`, `[role="link"]`, `[onclick]`
   - 输入类：`<input>`, `<textarea>`, `<select>`, `[role="textbox"]`, `[contenteditable="true"]`
4. **索引注入**：`el.setAttribute('data-agent-id', 'el_N')`，可选叠加绝对定位高亮标签
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
    },
    {
      "id": "el_7",
      "tag": "button",
      "text": "Search",
      "inViewport": true
    }
  ]
}
```

**Token 控制**：
- 硬上限：单次最多 **80 个**元素，超出按可见性优先级截断
- 每个元素描述压缩至 **60 字符**以内
- 累积历史超上下文窗口 80% 时，旧记录压缩为执行摘要

### 4.2 动作执行引擎（ActionExecutor）

**安全约束**：仅支持 6 种预定义原子操作，**禁止执行 LLM 生成的任意 JS 代码**。

| 操作 | 函数 | 实现细节 |
|:--|:--|:--|
| **导航** | `navigate(url)` | `window.location.href = url`；跨域时通过 Service Worker 创建新 Tab |
| **点击** | `click(id)` | `scrollIntoView({block:'center'})` → `el.click()` → `dispatchEvent(new MouseEvent('click', {bubbles:true}))` |
| **输入** | `type(id, text)` | `el.focus()` → `el.value = text` → `dispatchEvent(new InputEvent('input', {bubbles:true}))` → `dispatchEvent(new Event('change', {bubbles:true}))` |
| **滚动** | `scroll(direction)` | `window.scrollBy(0, ±300)` 或 `el.scrollIntoView()` |
| **提取** | `extract(selector)` | `document.querySelectorAll(selector)` → 返回 `textContent` 数组 |
| **等待** | `wait(ms)` | `setTimeout` 延迟，上限 10 秒 |

### 4.3 Agent 调度器 + ReAct 循环（Service Worker）

采用 **ReAct（Reasoning + Acting）范式**，上限 **50 步**（用户可配置）。

**状态机**：

```
IDLE → RUNNING → PAUSED → WAITING_USER → COMPLETED
                  ↓                        ↓
                ERROR ←────────────────────┘
```

**单步执行流程**（Observe → Plan → Act → Evaluate）：

```
STEP 1: OBSERVE（感知）
  → Content Script 采集页面状态（DOM结构 + URL + title）
  → 过滤不可见/不可交互元素
  → 注入 data-agent-id 索引
  → 返回: {url, title, elements: [{id, tag, text, type, placeholder, ariaLabel, inViewport}]}

STEP 2: PLAN（决策）
  → Service Worker 组装 System Prompt
  → 拼接: 任务目标 + 当前页面状态 + 最近 5 步历史 + 当前步数/总步数
  → SSE 流式调用 LLM API
  → 实时推送 Thought 到 Side Panel
  → 解析 Tool Call 返回: {thought, action, target_id?, value?}

STEP 3: ACT（执行）
  → 校验 action 合法性（必须属于 6 种预定义操作）
  → 通过 chrome.scripting.executeScript 注入执行
  → 等待 MutationObserver 静默期（500ms 无变化）
  → 返回: {success, newUrl, domChanged, error?}

STEP 4: EVALUATE（校验）
  → Reflector 对比执行前后页面状态（URL 变化？DOM 变化？）
  → 判断: 继续下一步 / 重试 / 请求人工介入 / 任务完成
```

**超时与重试**：
- 单动作超时：30 秒
- 失败重试：指数退避 1s → 2s → 4s → 8s → 16s，最多 5 次
- 元素未找到：强制 DOM 重扫 → 新状态 + 错误信息发回 LLM 重新决策
- 心跳检测：每 5 秒 ping Content Script，断连自动重注入

### 4.4 Agent 引擎三组件

**Planner（规划器）**：
- 组装 System Prompt（含角色设定、可用工具列表、输出格式约束）
- 输入：任务目标 + 当前页面 JSON + 最近 5 步历史 + 步骤计数器
- 输出：`{thought, action, target_id?, value?}` 或 `FINISH`

**Executor（执行器）**：
- 解析 Planner 输出，路由到当前 Tab 的 Content Script
- 管理超时、重试、异常冒泡

**Reflector（反思器）**：
- 快照对比：执行前 vs 执行后 `{url, elements.length, key elements text}`
- 判断动作有效性
- 失败时生成备选策略（如"ID 定位失败 → 用按钮文本模糊匹配再试"）
- 连续 3 次失败 → 请求人工介入

### 4.5 UI 交互层（Side Panel）

| 区域 | 功能描述 |
|:--|:--|
| **指令输入区** | 多行文本输入框 + 指令模板库（"竞品融资采集"、"SEO 批量审计"等一键填充） |
| **执行日志区** | 滚动日志列表，每条记录三级折叠：❶ Thought → ❷ Action → ❸ Result |
| **状态指示器** | 6 色状态灯：⚪空闲 / 🔵思考中 / 🟢执行中 / 🟡等待人工 / ✅已完成 / 🔴错误 |
| **控制按钮** | ▶ 开始 / ⏸ 暂停 / ⏹ 停止 / 🤚 人工接管 |
| **会话列表** | 历史会话记录，支持回溯查看和重新执行 |
| **步骤进度** | "第 12/50 步"，接近上限时黄色预警 |

### 4.6 操作录制与回放（第二阶段）

- **录制模式**：用户手动执行操作 → 记录每步（URL + 动作 + 元素特征）
- **回放模式**：AI 按录制步骤复现，页面变化时 LLM 自适应调整
- **价值**：固定流程（日报提取）直接用录制回放，不走 LLM，省时省钱

---

## 五、异常处理矩阵

| 异常类型 | 检测方式 | 处理策略 |
|:--|:--|:--|
| **目标元素消失** | Content Script 返回 `{error:"element_not_found"}` | SW 触发 DOM 重扫 → 新元素树 + 错误上下文发回 LLM 重新规划 |
| **页面加载超时** | 30s 超时计时器 | 重试 1 次 → 仍失败则标记 ERROR 通知用户 |
| **验证码 (CAPTCHA)** | 检测 `iframe[src*="recaptcha"]` 等特征 | 暂停 Agent → Side Panel 红色警报 + 页面高亮 → 人工完成 → 点击"继续"恢复 |
| **弹窗/对话框** | `window.alert/confirm/prompt` 拦截 | 自动 dismiss（内容记录到日志） |
| **LLM API 错误** | HTTP 4xx/5xx | 指数退避 3 次 → 超限标记 ERROR |
| **Content Script 断连** | 心跳 5s 无响应 | 自动重新注入 → 重试当前步骤 |
| **用户关闭标签页** | `tabs.onRemoved` 事件 | 等同于 Stop → 立即终止 → 状态机置为 ERROR |

---

## 六、安全设计

| 安全措施 | 实现方式 |
|:--|:--|
| **API Key 本地存储** | `chrome.storage.local` 加密存储，永不上传云端 |
| **禁止任意代码执行** | 仅支持 6 种预定义原子操作；LLM 返回的 action 在白名单中校验 |
| **每次会话强制授权** | 对标 Manus：每次新任务需用户点击"授权"按钮 |
| **关闭标签页即停止** | 对标 Manus：关闭执行标签页 = 立即终止所有操作 |
| **操作审计** | 所有 Thought/Action/Result 完整记录到 IndexedDB，支持导出 |
| **敏感操作二次确认** | 提交表单、支付确认、跨域新 Tab 打开前弹窗确认 |
| **不存储密码** | 零密码存储，完全依赖浏览器已有登录态 |

---

## 七、技术选型

| 维度 | 选择 | 理由 |
|:--|:--|:--|
| 开发语言 | TypeScript（strict）| 类型安全，浏览器 API 类型完备 |
| UI 框架 | React 18 + Tailwind CSS | 组件化 + 原子化 CSS，适合 Side Panel 尺寸 |
| 构建工具 | Vite + @crxjs/vite-plugin | HMR 热更新，Chrome 扩展构建专用插件 |
| Agent 框架 | **纯 TS 自研**（参考 browser-use ReAct 循环）| 零 Python 依赖，原生 Chrome API |
| LLM 接入 | OpenAI / Anthropic / Gemini + Ollama 本地备选 | 云端高性能 + 本地隐私双轨 |
| 状态持久化 | `chrome.storage.local`（配置）+ IndexedDB（日志）| 小数据 + 大体积分治 |
| 截图方案 | `chrome.tabs.captureVisibleTab` + 混合策略 | 日常 DOM 树，失败时补充截图 |

### 开源参考项目

| 项目 | 参考价值 |
|:--|:--|
| **browser-use** | Manus 核心依赖，ReAct 循环 + 工具调用设计 |
| **Curio** | 完整 Chrome Side Panel Agent，SSE 流式 + 多工具调用 |
| **Page Agent UI** | 操作录制与回放能力 |
| **Trient AI** | 基于 browser-use 的 Chrome 插件工程参考 |
| **OpenManus** | MetaGPT 团队复刻 Manus 核心功能，规划与分步执行参考 |

---

## 八、分阶段实施路线

### 第一阶段：核心闭环 MVP（约 2 周）

**目标**：跑通 Observe → Plan → Act → Evaluate 完整循环

- Manifest V3 脚手架搭建（Vite + @crxjs + React 18）
- Content Script：DOM 降噪 + 元素索引注入 + 6 种原子操作
- Service Worker：AgentScheduler + OpenAI API SSE 流式调用
- AI Agent 核心：System Prompt + ReAct 单步循环
- Side Panel MVP：指令输入 + 日志滚动 + 开始/停止按钮
- **验证**：对单个网站完成"搜索关键词 → 点击结果"闭环

### 第二阶段：Agent 能力增强（约 3 周）

- 6 种原子操作在各框架下的鲁棒性打磨
- Reflector 反思机制 + 完整异常处理
- Anthropic / Gemini API + Ollama 本地模型
- SPA 异步等待策略（MutationObserver + 静默期判定）
- Side Panel UI 完整版（状态指示器、暂停/恢复、会话列表、步骤进度）
- 操作录制与回放
- **验证**："Crunchbase 搜索 → 提取 → 跨 Tab 填表单"端到端

### 第三阶段：体验与稳定性（约 2 周）

- 验证码检测 + 人工接管流程
- 心跳检测 + Content Script 自动重连
- IndexedDB 日志持久化
- 指令模板系统
- 50 步长任务压力测试
- **验证**：50 步以上复杂任务零中断

### 第四阶段：安全与发布（约 1 周）

- 强制授权流程（任务启动确认、跨域二次确认）
- API Key 加密存储
- 审计日志导出
- Chrome Web Store 上架准备

### 后续版本

- 远程触发（WebSocket 指令通道）

---

## 九、关键风险与应对

| 风险 | 影响 | 应对 |
|:--|:--|:--|
| LLM 推理延迟（3-10s/步）| 用户体验差 | Side Panel 流式展示 Thought 降低感知延迟；本地模型加速 |
| 网站反自动化检测 | 任务失败 | 复用真实浏览器会话，模拟原生事件，避免 `webdriver` 标记 |
| LLM 幻觉导致错误操作 | 数据污染 | Reflector 校验 + 关键操作（提交/支付）需人工确认 |
| Token 成本 | 长任务消耗大 | DOM 降噪最多 80 元素；累积历史压缩；本地模型备选 |
