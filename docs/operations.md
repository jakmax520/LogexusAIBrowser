# Logexus AI Browser — 操作手册

## 一、开发环境搭建

### 1.1 前置要求

- Node.js ≥ 18
- Chrome 浏览器 ≥ 114（支持 Side Panel API 和 Manifest V3）
- Git

### 1.2 克隆与安装

```bash
git clone <repo-url>
cd LogexusAIBrowser
npm install
```

### 1.3 常用命令

```bash
npm run dev              # 开发模式 (HMR 热更新)
npm run build            # 生产构建
npm run typecheck        # TypeScript 类型检查
```

---

## 二、编译生成插件包

### 2.1 开发构建

```bash
npm run dev
```

Vite 启动后会在 `dist/` 目录生成扩展文件，支持 HMR 热更新。修改源码后浏览器自动刷新扩展。

### 2.2 生产构建

```bash
npm run build
```

构建产物在 `dist/` 目录：

| 产物 | 说明 |
|:--|:--|
| `dist/manifest.json` | 正式 Manifest V3 清单 |
| `dist/service-worker-loader.js` | Service Worker 入口 |
| `dist/assets/index.html-*.js` | React Side Panel (压缩) |
| `dist/assets/index-*.css` | Tailwind CSS (压缩) |
| `dist/src/sidepanel/index.html` | Side Panel HTML |
| `dist/assets/index.ts-*.js` | Content Script |

### 2.3 打包为 ZIP（用于分发和上架）

**Windows PowerShell**:

```powershell
Compress-Archive -Path "dist\*" -DestinationPath "logexus-ai-browser-v0.1.0.zip"
```

**macOS / Linux**:

```bash
cd dist && zip -r ../logexus-ai-browser-v0.1.0.zip * && cd ..
```

---

## 三、安装到浏览器

### 3.1 开发模式加载

1. Chrome 地址栏输入 `chrome://extensions/` 回车
2. 右上角开启 **「开发者模式」** 开关
3. 点击 **「加载已解压的扩展程序」**
4. 选择项目的 `dist/` 目录
5. 加载完成后，工具栏会出现扩展图标

### 3.2 更新已安装的扩展

- **开发模式（`npm run dev`）**：修改源码自动 HMR，无需手动刷新
- **手动构建（`npm run build`）**：构建完成后，在 `chrome://extensions/` 找到扩展卡片，点击右下角刷新图标

### 3.3 使用扩展

1. 点击工具栏的扩展图标 → 打开 Side Panel
2. Side Panel 显示连接状态（绿色 = 已连接当前 Tab）
3. 外部 AI Agent 通过 `chrome.runtime.sendMessage` 发送 `AGENT_REQUEST` 指令
4. Side Panel 弹出授权确认 → 点击「允许」→ Agent 操作执行
5. 审计日志实时滚动显示每步操作

### 3.4 调试方法

- **Service Worker 调试**：`chrome://extensions/` → 找到扩展 → 点击 "Service Worker" 链接 → 打开 DevTools
- **Content Script 调试**：在目标网页按 F12 → Console → 筛选当前扩展的日志
- **Side Panel 调试**：在 Side Panel 内右键 → 检查

---

## 四、部署到 Chrome Web Store

### 4.1 注册开发者账号

1. 访问 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. 支付一次性注册费 **$5 USD**
3. 完成账号验证

### 4.2 准备上架素材

| 素材 | 规格 | 要求 |
|:--|:--|:--|
| 商店图标 | 128×128 PNG | 简洁清晰，建议应用 logo |
| 截图 | 1280×800 或 640×400 | 1-5 张，展示核心功能界面 |
| 宣传图（小）| 440×280 PNG | 可选，用于精选推荐 |
| 宣传图（大）| 920×680 PNG | 可选 |
| 封面图 | 1400×560 PNG | 可选 |

### 4.3 补充 manifest.json

上架前需补全 `manifest.json` 中的图标字段：

```json
"icons": {
  "16": "icons/icon16.png",
  "48": "icons/icon48.png",
  "128": "icons/icon128.png"
}
```

并在 `public/icons/` 目录放置对应尺寸的图标文件。

### 4.4 提交审核

1. 打开 [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. 点击 **「新增项」**
3. 上传 `.zip` 包
4. 填写应用信息：

| 字段 | 建议内容 |
|:--|:--|
| **详细说明** | 描述插件功能（建议中英文双语）。说明这是一个 AI Agent 的浏览器执行器，通过标准化 API 契约让 AI 操作浏览器 |
| **类别** | 效率工具 (Productivity) 或 开发者工具 (Developer Tools) |
| **语言** | 中文（简体）+ English |

5. **隐私权做法**：

```
本插件仅作为浏览器操作的执行器和安全网关：
- 不收集任何用户个人数据
- 不上传数据至任何第三方服务器
- 所有数据仅在用户本地浏览器处理
- 不存储任何网站登录凭证
- API Key（如有）仅通过 chrome.storage.local 存储在本地

权限说明：
- activeTab / tabs: 用于获取当前活动标签页并执行用户指令
- scripting: 用于注入 DOM 操作脚本
- storage: 用于本地存储授权配置
- host_permissions <all_urls>: 用于支持用户指定任意网站执行操作
```

6. **内容审核**：声明不含成人/暴力/仇恨等敏感内容
7. 点击 **「提交审核」**

### 4.5 审核周期

Google 审核通常 **1-3 个工作日**。审核通过后自动上架。

### 4.6 版本更新

1. 修改 `manifest.json` 中的 `version` 字段（如 `0.1.0` → `0.2.0`）
2. 重新 `npm run build`
3. 重新打包 `.zip`
4. 在 Developer Dashboard 中找到对应扩展 → **「更新包」** → 上传新 `.zip`
5. 提交审核

---

## 五、持续集成部署 (CI/CD)

### 5.1 GitHub Actions 自动构建

创建 `.github/workflows/build.yml`：

```yaml
name: Build Extension

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: extension-dist
          path: dist/
```

### 5.2 GitHub Actions 自动发布到 Chrome Web Store

创建 `.github/workflows/publish.yml`：

```yaml
name: Publish to Chrome Web Store

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version tag (e.g. v0.2.0)'
        required: true

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - name: Zip extension
        run: cd dist && zip -r ../extension.zip * && cd ..
      - name: Upload to Chrome Web Store
        uses: wdzeng/chrome-extension@v1
        with:
          extension-id: ${{ secrets.EXTENSION_ID }}
          client-id: ${{ secrets.CLIENT_ID }}
          client-secret: ${{ secrets.CLIENT_SECRET }}
          refresh-token: ${{ secrets.REFRESH_TOKEN }}
          zip-path: extension.zip
```

需要的 GitHub Secrets：

| Secret | 获取方式 |
|:--|:--|
| `EXTENSION_ID` | Developer Dashboard 中扩展 URL 的 32 位 ID |
| `CLIENT_ID` | Google Cloud Console → APIs & Services → OAuth 2.0 Client ID |
| `CLIENT_SECRET` | 同上 |
| `REFRESH_TOKEN` | 通过 `google-api-refresh-token` 工具生成 |

---

## 六、外部 Agent 对接指南

### 6.1 通信方式

外部 AI Agent 通过 Chrome Extension Messaging API 与扩展通信：

```typescript
// 发送指令到扩展
const EXTENSION_ID = 'your_extension_id_here';

const response = await chrome.runtime.sendMessage(EXTENSION_ID, {
  type: 'AGENT_REQUEST',
  task_id: 'req_001',
  action: 'observe',
  payload: {}
});

// response 类型为 AgentResponse
console.log(response.status);       // 'success' | 'error' | 'blocked'
console.log(response.data.current_url);
console.log(response.data.new_observation);
```

### 6.2 6 种工具操作说明

| action | payload.target_id | payload.value | 说明 |
|:--|:--|:--|:--|
| `observe` | - | - | 采集当前页面 DOM 结构，返回交互元素列表 |
| `click` | 元素 ID (如 "el_5") | - | 滚动到元素并触发点击 |
| `type` | 元素 ID | 输入文本 | 聚焦输入框并模拟原生输入事件 |
| `navigate` | - | URL | 跳转到指定 URL |
| `extract` | - | CSS 选择器 | 提取匹配元素的文本内容 |
| `scroll` | - | "up" 或 "down" | 滚动页面 ±300px |

### 6.3 构建一个简单的外部 Agent

参见 `scripts/test-agent.ts`，它展示了完整的外部 Agent 调用流程：

```
1. 发送 observe → 获取页面元素列表
2. 找到目标元素（如搜索框 el_0）
3. 发送 type(el_0, "OpenAI") → 输入文本
4. 发送 observe → 获取更新后的页面
5. 找到搜索按钮
6. 发送 click(el_N) → 点击搜索
7. 发送 extract("h3") → 提取结果
8. 循环以上步骤
```

### 6.4 安全授权流程

1. 外部 Agent 发送首个 `AGENT_REQUEST`
2. 扩展 Side Panel 弹出授权确认弹窗（显示操作类型、目标元素、原因）
3. 用户点击「允许」或「拒绝」
4. 允许后，当前会话内的后续操作自动通过（无需重复授权）
5. 切换 Tab 或刷新页面后，需重新授权
