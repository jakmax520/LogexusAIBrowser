# Logexus AI Browser

> AI 驱动的浏览器操作员 — 接入 Claude Code / Cursor / 任意 AI Agent 的标准浏览器驱动。

## 架构（WebSocket 直连 · 极简）

```
外部 AI Agent ←── ws://localhost:9527 ──→ Chrome Extension (WS Client)
(Python/Node.js)     daemon 消息中枢        (Service Worker)
                   认证 · 路由 · 审计               ↓
                                            Content Script (DOM 执行)
```

**无需 Native Messaging 注册、无需 MCP 中间层、无需 HTTP 转发**——Agent 和 Extension 通过同一个 WebSocket 服务器直连通信。

## 核心能力

- **7 种原子操作**：observe / click / type / navigate / extract / scroll / screenshot
- **WebSocket 直连**：Agent ↔ `ws://localhost:9527` ↔ Extension，单一 hop，最低延迟
- **云边分离**：扩展零 LLM 依赖，纯执行器 + 安全网关
- **安全网关**：daemon Token 认证 + 授权弹窗 + 审计日志 + 禁止任意代码执行
- **多 Tab 协同** + **验证码检测** + **操作录制回放** + **暗色模式** + **日志导出**

## 三步启动

```bash
# 1. 启动 daemon（消息中枢）
cd daemon && npm install && npm start

# 2. 构建并加载扩展
npm install && npm run build
chrome://extensions → 开发者模式 → 加载 dist/

# 3. 外部 Agent 连接
# Python:  ws = websocket.connect("ws://localhost:9527?token=lx_3696ac533d9ddfb81d5e50340f205317&role=agent")
# Node:    new WebSocket("ws://localhost:9527?token=lx_3696ac533d9ddfb81d5e50340f205317&role=agent")
```

## 项目结构

```
├── src/                    # Chrome Extension
│   ├── background/         # API 网关 + WS 客户端 + 多 Tab 调度
│   ├── content/            # DOM 降噪 + 元素索引 + 7 种原子操作
│   ├── sidepanel/          # 授权面板 + 审计日志 (React)
│   └── shared/             # 类型 + 消息协议
├── daemon/                 # WebSocket 消息中枢 (Node.js)
├── native-host/            # Native Messaging Host (备选通道)
└── mcp-wrapper/            # MCP Server Wrapper (备选通道)
```

详见 [docs/operations.md](docs/operations.md)。

## 文档

| 文档 | 说明 |
|:--|:--|
| [docs/design.md](docs/design.md) | 完整产品设计方案 |
| [docs/operations.md](docs/operations.md) | 操作手册 — 构建/安装/部署/对接 |
| [docs/test-cases.md](docs/test-cases.md) | 测试用例 (24 条) |
| [DESIGN.md](DESIGN.md) | UI 设计系统 |
| [SECURITY.md](SECURITY.md) | 安全策略 |

## 许可

MIT
