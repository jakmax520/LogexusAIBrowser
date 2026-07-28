# Logexus AI Browser

> AI 驱动的 Chrome 浏览器操作员插件 — 云边分离架构，纯执行器 + 安全网关。

## 核心定位

Logexus AI Browser 是一个 Chrome 扩展，作为**轻量级浏览器执行器**，通过标准化 API 契约对外暴露 6 种原子操作（observe / click / type / navigate / extract / scroll）。重型推理引擎（LLM、ReAct 循环）剥离到外部 AI Agent。

- **云边分离**：扩展不包含任何 LLM，纯 DOM 执行器
- **安全网关**：每次操作可触发授权弹窗，用户完全可控
- **审计透明**：Side Panel 实时展示每步操作日志

## 快速开始

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
4. 选择 `dist/` 目录

## 技术栈

| 维度 | 选型 |
|:--|:--|
| 平台 | Chrome Extension Manifest V3 |
| 语言 | TypeScript (strict) |
| UI | React 18 + Tailwind CSS |
| 构建 | Vite + @crxjs/vite-plugin |
| 架构 | 云边分离 — 扩展仅含 API 网关 + 执行器 |

## API 契约

外部 AI Agent 通过 `chrome.runtime.sendMessage` 发送指令：

```json
// 请求
{ "type": "AGENT_REQUEST", "task_id": "req_001", "action": "click",
  "payload": { "target_id": "el_5", "reasoning": "点击搜索按钮" } }

// 响应
{ "type": "AGENT_RESPONSE", "task_id": "req_001", "status": "success",
  "data": { "action_result": "OK", "current_url": "...", "new_observation": [...] } }
```

## 项目结构

```
src/
├── background/index.ts        # API 网关 + 安全授权
├── content/
│   ├── DOMReducer.ts          # DOM 降噪 (≤80 元素)
│   ├── ElementIndexer.ts      # 交互元素索引注入
│   ├── ActionExecutor.ts      # 6 种原子操作
│   └── MutationWatcher.ts     # DOM 静默期检测
├── sidepanel/                 # 授权面板 + 审计日志 (React)
└── shared/                    # 类型定义 + 消息协议
```

## 文档

| 文档 | 说明 |
|:--|:--|
| [docs/design.md](docs/design.md) | 完整产品设计方案 |
| [docs/operations.md](docs/operations.md) | 操作手册 — 构建/安装/部署/对接 |
| [DESIGN.md](DESIGN.md) | UI 设计系统 |
| [SECURITY.md](SECURITY.md) | 安全策略 |
| [CLAUDE.md](CLAUDE.md) | 项目协作规则 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献指南 |

## 许可

MIT
