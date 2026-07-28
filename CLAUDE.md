# CLAUDE.md — Logexus AI Browser

## 1. 偏好设置

- **语言**: 请使用简体中文进行所有交流、回复和解释
- **回复风格**: 先讲结论，再讲关键原因和步骤。不确定时说明假设和风险
- **动手前先读**: 修改前先阅读相关文件和已有约定，修改范围尽量小
- **需求确认**: 当我提出设计方案或需求后，你必须先复述我的需求要点，确认理解无误后，再启动执行任务

## 2. 项目概述

Logexus AI Browser 是一个 Chrome 扩展，让 AI 像真人一样操作本地浏览器，复用已有登录态执行跨网站自动化任务。

| 维度 | 选型 |
|------|------|
| 平台 | Chrome Extension (Manifest V3) |
| 开发语言 | TypeScript (strict) |
| UI 框架 | React 18 + Tailwind CSS |
| 构建工具 | Vite + @crxjs/vite-plugin |
| Agent 框架 | 纯 TS 自研 (参考 browser-use ReAct 循环) |
| LLM 接入 | OpenAI / Anthropic / Gemini + Ollama 本地备选 |
| 状态持久化 | chrome.storage.local (配置) + IndexedDB (日志) |

## 3. 项目结构

```
LogexusAIBrowser/
├── src/
│   ├── manifest.json                  # Manifest V3 配置
│   ├── background/                    # Service Worker
│   │   ├── index.ts                   # SW 入口，消息路由
│   │   ├── AgentScheduler.ts          # 核心调度器 (ReAct 循环)
│   │   ├── LLMProvider.ts             # LLM 调用抽象层
│   │   └── state-machine.ts           # 任务状态机
│   ├── content/                       # Content Script
│   │   ├── index.ts                   # CS 入口，消息监听
│   │   ├── DOMReducer.ts              # DOM 降噪过滤
│   │   ├── ElementIndexer.ts          # 交互元素索引注入
│   │   ├── ActionExecutor.ts          # 6 种原子操作执行器
│   │   └── MutationWatcher.ts         # DOM 变化监听 + 静默期判定
│   ├── sidepanel/                     # Side Panel UI (React)
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   └── styles/
│   ├── shared/                        # 共享类型与常量
│   │   ├── types.ts
│   │   ├── messages.ts
│   │   └── prompt.ts
│   └── providers/                     # LLM Provider 实现
│       ├── base.ts
│       ├── openai-compatible.ts
│       ├── anthropic.ts
│       └── ollama.ts
├── docs/
│   └── design.md                      # 完整产品设计方案
├── vite.config.ts
├── tsconfig.json
├── package.json
├── tailwind.config.js
├── DESIGN.md                          # UI 设计系统
├── SECURITY.md
├── CONTRIBUTING.md
└── CODE_OF_CONDUCT.md
```

## 4. 核心架构

### 数据流

```
Side Panel (UI) ←→ Service Worker (调度) ←→ Content Script (执行)
                         ↓
                    LLM API (AI 引擎)
```

### Agent 循环 (ReAct)

```
Observe → Plan → Act → Evaluate → (循环)
```

1. **Observe**: Content Script 采集页面 DOM 结构 (降噪后 ≤80 个交互元素)
2. **Plan**: Service Worker 组装 Prompt → SSE 流式调用 LLM → 解析 Tool Call
3. **Act**: 校验 action 合法性 → 注入 Content Script 执行 → 等待 MutationObserver 静默
4. **Evaluate**: Reflector 对比执行前后状态 → 决定继续/重试/人工介入/完成

### 状态机

```
IDLE → RUNNING → PAUSED → WAITING_USER → COMPLETED
                  ↓                        ↓
                ERROR ←────────────────────┘
```

### 安全约束

- **禁止任意代码执行**: 仅支持 6 种预定义原子操作 (click/type/scroll/navigate/extract/wait)
- **API Key 本地存储**: chrome.storage.local 加密存储
- **每次会话强制授权**: 对标 Manus，需用户点击确认
- **关闭标签页即停止**: 对标 Manus 的即时终止设计

## 5. 常用命令

```bash
# 安装依赖
npm install

# 开发模式 (HMR 热更新)
npm run dev

# 生产构建
npm run build

# TypeScript 类型检查
npm run typecheck
```

### 加载扩展

1. Chrome 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 开发模式选择项目根目录，生产模式选择 `dist/`

## 6. 编码规范

### TypeScript

- 启用 `strict: true`，禁止 `any`
- 变量/函数: `camelCase`，类型/接口: `PascalCase`
- 文件命名: `camelCase.ts` (模块) / `PascalCase.tsx` (React 组件)
- 优先使用 `interface` 定义对象类型，`type` 用于联合/交叉类型

### React

- 函数式组件 + Hooks
- Props 使用 `interface` 定义
- 自定义 Hook: `use` 前缀
- 一个文件一个组件 (除小型私有组件外)

### Chrome Extension

- Service Worker 中不能使用 DOM API，只能使用 `chrome.*` API
- Content Script 中可操作 DOM 但不能使用 `chrome.tabs.*` 等高级 API
- Side Panel 通过 `chrome.runtime.connect` 与 SW 长连接通信
- 消息类型统一定义在 `src/shared/messages.ts`

### 样式

- 使用 Tailwind CSS 原子类
- 自定义设计令牌参考 `DESIGN.md`
- 禁止内联 style 对象 (Tailwind 能解决的用 Tailwind)

### 日志

- 开发阶段: `console.log/error`，带模块前缀 `[SW]`/`[CS]`/`[UI]`
- 生产构建时移除 `console.log`

## 7. 编码约定

- 修改前先读 `docs/design.md` 了解设计方案全貌
- 安全相关修改需对照 `SECURITY.md` 检查
- 新增动作类型需在 `shared/types.ts` 枚举 + `ActionExecutor.ts` 实现 + `prompt.ts` 更新
- 修改后立即 `npm run typecheck` 验证，不攒到最后
- 不确定的架构决策先询问，而非自行判断
- 同一问题修复失败 3 次，停止并输出诊断摘要

## 8. Git 规范

- **提交消息**: Conventional Commits — `feat(scope):`, `fix(scope):`, `refactor(scope):`, `chore(scope):`, `docs(scope):`
- **Scope**: `sw` (Service Worker), `cs` (Content Script), `ui` (Side Panel), `provider` (LLM), `shared`
- **分支**: `main` 为活跃开发分支

## 9. 关键决策记录

| 决策 | 结论 | 原因 |
|:--|:--|:--|
| Agent 框架 | 纯 TS 自研 | 避免 Python WebSocket 桥接，原生 Chrome API |
| 截图策略 | 混合模式 | 日常 DOM 树省 Token，失败时截图给视觉模型 |
| LLM Provider | 多 Provider | 首发 OpenAI 兼容接口，预留 Ollama 本地通道 |
| UI 风格 | 富交互面板 | 消除黑盒效应，状态透明可追踪 |
| 远程触发 | 第四阶段后 | MVP 聚焦核心闭环 |
