# Logexus AI Browser — UI Design System

> Chrome Extension Side Panel 设计规范。Side Panel 代码 (`src/sidepanel/`) 引用本文件定义的颜色、字体、间距、组件规格。

## 1. 设计哲学

Logexus AI Browser 是一个 AI 浏览器操作员工具，Side Panel 是用户与 AI Agent 交互的核心界面。设计上追求 **透明可追踪 (Transparent & Traceable)**，让用户清晰感知 AI 的每一步思考与行动。

- **Panel 约束**: Chrome Side Panel 标准宽度 400px，最小 320px，最大 800px
- **信息密度优先**: 每屏尽可能展示核心执行日志，减少视觉装饰
- **状态即时传达**: 通过颜色 + 图标 + 文字三重编码 Agent 状态
- **深夜可用**: 默认暗色主题，减少长时间监控的眼疲劳

## 2. 颜色系统

### 主色调

| 令牌 | 值 | 用途 |
|------|-----|------|
| `primary` | `#6366F1` (indigo-500) | 主按钮、选中态、链接 |
| `primary-hover` | `#4F46E5` (indigo-600) | 悬停态 |
| `primary-muted` | `#EEF2FF` (indigo-50) | 弱强调背景 (light) |

### 中性色

| 令牌 | Light | Dark |
|------|-------|------|
| 页面背景 | `#FFFFFF` | `#1E1E1E` |
| 面板背景 | `#F9FAFB` | `#252525` |
| 卡片背景 | `#FFFFFF` | `#2D2D2D` |
| 主文字 | `#111827` | `#F3F4F6` |
| 次文字 | `#6B7280` | `#9CA3AF` |
| 边框 | `#E5E7EB` | `#374151` |

### 语义色 (状态灯 + 反馈)

| 状态 | 颜色 | 色值 |
|------|------|------|
| 空闲 (IDLE) | 灰 | `#9CA3AF` |
| 思考中 (THINKING) | 蓝 | `#3B82F6` |
| 执行中 (RUNNING) | 绿 | `#22C55E` |
| 等待人工 (WAITING) | 黄 | `#F59E0B` |
| 已完成 (COMPLETED) | 绿深 | `#16A34A` |
| 错误 (ERROR) | 红 | `#EF4444` |

### Tailwind 配置扩展

```js
// tailwind.config.js
colors: {
  primary: {
    50: '#EEF2FF', 500: '#6366F1', 600: '#4F46E5'
  },
  surface: {
    light: '#F9FAFB', dark: '#252525'
  }
}
```

## 3. 排版

### 字体

单一字体族，等宽用于日志输出：

| 用途 | 字体 |
|------|------|
| UI 文字 | `Inter, system-ui, -apple-system, sans-serif` |
| 日志/代码 | `JetBrains Mono, Menlo, monospace` |

### 字号阶梯

| 级别 | 尺寸 | 用途 |
|------|------|------|
| `text-xs` | 12px | 时间戳、元数据、状态标签 |
| `text-sm` | 14px | 日志条目、辅助文本 |
| `text-base` | 16px | 正文、输入框 |
| `text-lg` | 18px | 面板标题 |
| `text-xl` | 20px | 步骤标题 |

## 4. 间距

基于 Tailwind 4px 基准：

| 层级 | 值 | 用途 |
|------|-----|------|
| `p-2` | 8px | 紧凑元素内间距 (图标按钮) |
| `p-3` | 12px | 日志条目、折叠面板内间距 |
| `p-4` | 16px | 卡片、输入框内间距 |
| `gap-3` | 12px | 日志条目间距、表单元素间距 |
| `gap-4` | 16px | 区块间距 |

## 5. 核心组件规格

### 5.1 控制按钮 (ControlButtons)

```
┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
│ ▶   │ │ ⏸   │ │ ⏹   │ │ 🤚  │
│开始 │ │暂停 │ │停止 │ │接管 │
└─────┘ └─────┘ └─────┘ └─────┘
```

- 尺寸: 40×40px，图标 18px
- 圆角: `rounded-lg` (8px)
- 布局: `flex gap-2`
- 禁用态: `opacity-40 cursor-not-allowed`
- 停止按钮使用红色 `text-red-500`

### 5.2 状态指示器 (StatusIndicator)

```
● 执行中 — 第 12/50 步
```

- 圆点: 8×8px，`rounded-full`，对应当前状态色
- 文字: `text-sm font-medium`
- 步骤计数: `text-xs text-muted`，接近上限 (≥40/50) 时切换为 `text-amber-500`

### 5.3 执行日志条目 (ExecutionLog)

每条日志三级折叠卡片：

```
┌──────────────────────────────────────┐
│ 12:34:56  ● Step 3            [展开] │  ← 时间戳 + 步骤序号
├──────────────────────────────────────┤
│ 💭 需要先找到搜索框，当前页面有一个  │  ← Thought (展开内容)
│    搜索输入框和多个按钮              │
├──────────────────────────────────────┤
│ ⚡ type(el_5, "OpenAI")      [✓]    │  ← Action + 执行结果
├──────────────────────────────────────┤
│ 📋 输入框已填入 "OpenAI"，等待搜索   │  ← Result
└──────────────────────────────────────┘
```

- 背景: `bg-surface-light dark:bg-surface-dark`
- 边框: `border border-hairline rounded-lg`
- 间距: `p-3`
- 展开/折叠: 默认折叠 Thought 和 Result，仅显示 Action 行
- 字体: Thought/Result 用 `text-sm`，Action 用 `font-mono text-sm`

### 5.4 指令输入区 (CommandInput)

```
┌──────────────────────────────────────┐
│                                      │
│  请描述你想要执行的浏览器自动化任务    │
│                                      │
│                                      │
├──────────────────────────────────────┤
│ [模板: 竞品融资采集 ▼]      [▶ 发送] │
└──────────────────────────────────────┘
```

- Textarea: 3 行最小高度，`resize-y`，带 placeholder
- 模板选择: `select` 下拉，选项含"自定义"和预置指令模板
- 发送按钮: 仅在有输入内容时激活 (`disabled` 管理)
- 宽度撑满面板

### 5.5 会话列表

```
┌──────────────────────────────────────┐
│ 📋 历史会话                          │
├──────────────────────────────────────┤
│ ● 2024-07-28  Crunchbase竞品采集     │
│ ● 2024-07-27  Semrush SEO 批量审计   │
│ ● 2024-07-26  内部 ERP 数据迁移      │
└──────────────────────────────────────┘
```

- 每条: `py-2 px-3 text-sm`
- 悬停: `bg-primary-50`
- 选中: `bg-primary-50 border-l-2 border-primary`

## 6. 暗色模式

通过 Tailwind `class` 策略 (`dark:` 前缀) 实现：

- 页面背景: `bg-white dark:bg-[#1E1E1E]`
- 面板背景: `bg-gray-50 dark:bg-[#252525]`
- 卡片: `bg-white dark:bg-[#2D2D2D] border-gray-200 dark:border-gray-700`
- 文字: `text-gray-900 dark:text-gray-100`
- 代码块: `bg-gray-100 dark:bg-[#1A1A1A]`

暗色模式默认跟随系统 `prefers-color-scheme`，Side Panel Settings 中可手动切换。

## 7. 动画

| 用途 | 规格 |
|------|------|
| 日志展开/折叠 | `transition-all duration-200 ease-out` |
| 状态灯脉冲 (执行中) | `animate-pulse` 1.5s |
| 按钮悬停 | `transition-colors duration-150` |
| 新日志追加 | 滑入 `slide-in-from-top duration-300` |

禁止使用大幅度位移动画 (Chrome Side Panel 性能有限)。
