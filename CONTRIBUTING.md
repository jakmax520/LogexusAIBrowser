# 贡献指南

感谢你对 Logexus AI Browser 的关注！

## 开发环境

```bash
# 克隆仓库
git clone <repo-url>
cd LogexusAIBrowser

# 安装依赖
npm install

# 启动开发模式
npm run dev
```

### 前置要求

- Node.js ≥ 18
- Chrome 浏览器 ≥ 114 (支持 Side Panel API)
- 了解 Chrome Extension Manifest V3 基础概念

## 开发流程

1. **认领或创建 Issue**: 在开始工作前，确保有对应的 Issue
2. **创建分支**: `git checkout -b feat/your-feature-name`
3. **开发**: 遵循编码规范 (见 `CLAUDE.md`)
4. **类型检查**: `npm run typecheck` 确保零错误
5. **提交**: `git commit -m "feat(scope): description"`
6. **发起 PR**: 推送到远程后创建 Pull Request

## 提交规范

使用 Conventional Commits 格式：

```
feat(sw): 添加 AgentScheduler 指数退避重试
fix(cs): 修复 React 框架下 input 事件未触发状态更新
refactor(shared): 提取消息类型到独立模块
docs(readme): 补充开发环境配置说明
chore(deps): 升级 Vite 到 6.x
```

Scope 列表：

| Scope | 说明 |
|:--|:--|
| `sw` | Service Worker 相关 |
| `cs` | Content Script 相关 |
| `ui` | Side Panel UI 相关 |
| `provider` | LLM Provider 实现 |
| `shared` | 共享类型/工具 |
| `docs` | 文档变更 |
| `deps` | 依赖变更 |
| `security` | 安全相关变更 |

## 代码审查

所有 PR 需满足以下条件：

- [ ] `npm run typecheck` 通过
- [ ] 新增代码符合 `CLAUDE.md` 编码规范
- [ ] 涉及安全模块 (Agent Scheduler / ActionExecutor / LLM 解析) 有额外审查
- [ ] 修改已有功能需更新相关文档

## 项目结构约定

- 新增 LLM Provider: `src/providers/<provider-name>.ts`，继承 `base.ts` 抽象类
- 新增 UI 组件: `src/sidepanel/components/<ComponentName>.tsx`
- 新增共享类型: `src/shared/types.ts`
- 新增消息类型: `src/shared/messages.ts`

## 问题反馈

- Bug 报告: 创建 Issue，附复现步骤和 Chrome 版本
- 功能建议: 创建 Issue，描述使用场景和期望行为
- 安全问题: 请勿公开创建 Issue，直接联系维护者

## 设计参考

- [docs/design.md](docs/design.md) — 完整产品设计方案
- [DESIGN.md](DESIGN.md) — UI 设计系统
- [SECURITY.md](SECURITY.md) — 安全策略 (安全相关贡献必读)
