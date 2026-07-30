# Native Host + MCP 统一化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Logexus AI Browser 的外部通信架构从三进程 + HTTP 桥接统一为单进程 Native Host（MCP SSE Server），同步落地文件卸载机制和 5 个高级语义 Tool。

**Architecture:** 废弃 `daemon/` 和 `mcp-wrapper/`，所有网关逻辑收敛到 `native-host/host.js`。使用 `@modelcontextprotocol/sdk` 的 `SSEServerTransport` 在进程内暴露 MCP 端点（`:9527`），通过 stdin/stdout 与 Chrome Extension 通信。`src/` 目录零改动。

**Tech Stack:** Node.js, `@modelcontextprotocol/sdk`, Chrome Native Messaging Protocol

---

### Task 1: 清理废弃代码

**Files:**
- Remove directory: `daemon/`
- Remove directory: `mcp-wrapper/`

- [ ] **Step 1: 删除 daemon/ 和 mcp-wrapper/ 目录**

```bash
Remove-Item -Recurse -Force "D:\CCWorkSpace\LogexusAIBrowser\daemon"
Remove-Item -Recurse -Force "D:\CCWorkSpace\LogexusAIBrowser\mcp-wrapper"
```

> 注意：`daemon/node_modules/` 仅含 `ws` 包，Native Host 不需要它（Native Host 使用 Chrome 原生通道，不走 WebSocket）。确认无误后删除。

- [ ] **Step 2: 验证删除**

```bash
# 确认 daemon/ 和 mcp-wrapper/ 不存在
Get-ChildItem "D:\CCWorkSpace\LogexusAIBrowser\daemon" -ErrorAction SilentlyContinue  # 应报错/无输出
Get-ChildItem "D:\CCWorkSpace\LogexusAIBrowser\mcp-wrapper" -ErrorAction SilentlyContinue  # 应报错/无输出
# 确认 native-host/ 完整
Get-ChildItem "D:\CCWorkSpace\LogexusAIBrowser\native-host"
```

预期：`native-host/` 仍然包含 `host.js`、`install.bat`、`com.logexus.browser.host.json`。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m @'
chore: remove deprecated daemon/ and mcp-wrapper/ directories

All routing and MCP logic consolidated into native-host/ (per v0.2.0 design).
'@
```

---

### Task 2: Setup Native Host 依赖

**Files:**
- Create: `native-host/package.json`
- Create: `native-host/.gitignore`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "logexus-native-host",
  "version": "0.2.0",
  "description": "Logexus AI Browser — Native Messaging Host + MCP SSE Server",
  "type": "module",
  "scripts": {
    "start": "node host.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.6.0"
  }
}
```

**文件路径**: `D:\CCWorkSpace\LogexusAIBrowser\native-host\package.json`

- [ ] **Step 2: 创建 .gitignore**

```
node_modules/
*.log
```

**文件路径**: `D:\CCWorkSpace\LogexusAIBrowser\native-host\.gitignore`

- [ ] **Step 3: 安装依赖**

```bash
cd D:\CCWorkSpace\LogexusAIBrowser\native-host
npm install
```

预期：`node_modules/@modelcontextprotocol/sdk` 目录出现。

- [ ] **Step 4: Commit**

```bash
git add native-host/package.json native-host/package-lock.json native-host/.gitignore
git commit -m "chore(native-host): add package.json with @modelcontextprotocol/sdk dependency"
```

---

### Task 3: 文件卸载模块 (FileOffloader)

**Files:**
- Create: `native-host/file-offloader.js`

- [ ] **Step 1: 创建 file-offloader.js**

```javascript
// Logexus AI Browser — File Offloader
// 大体积数据(>10KB)写入临时目录，MCP Response 仅返回 saved_path 指针

import { writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OFFLOAD_DIR = join(tmpdir(), 'logexus');
const TTL_MS = 3600_000;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

/** @type {Map<string, {path:string, expiresAt:number}>} */
const pending = new Map();

export async function init() {
  await mkdir(OFFLOAD_DIR, { recursive: true });
  await cleanupExpired();
  setInterval(cleanupExpired, 600_000);
  console.error('[FileOffloader] Init done, dir:', OFFLOAD_DIR);
}

/**
 * @param {string} taskId
 * @param {string} type - screenshot|network|console|perf|fullpage|pdf|cookies
 * @param {string} ext  - jpg|json|png|pdf|txt
 * @param {Buffer|string} data
 * @returns {Promise<{saved_path:string, size_bytes:number, format:string, expires_at:number}>}
 */
export async function offload(taskId, type, ext, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const fname = `${Date.now()}_${taskId}_${type}.${ext}`;
  const path = join(OFFLOAD_DIR, fname);
  await writeFile(path, buf);

  const size = (await stat(path)).size;
  const expiresAt = Date.now() + TTL_MS;
  pending.set(taskId, { path, expiresAt });
  await enforceMaxSize();

  return { saved_path: path, size_bytes: size, format: ext, expires_at: expiresAt };
}

async function cleanupExpired() {
  const now = Date.now();
  for (const [taskId, entry] of pending) {
    if (now >= entry.expiresAt) {
      await rm(entry.path).catch(() => {});
      pending.delete(taskId);
    }
  }
}

export async function cleanupAll() {
  for (const entry of pending.values()) {
    await rm(entry.path).catch(() => {});
  }
  pending.clear();
}

async function enforceMaxSize() {
  let total = 0;
  const entries = [];
  for (const [taskId, entry] of pending) {
    const s = (await stat(entry.path).catch(() => ({ size: 0 }))).size;
    total += s;
    entries.push({ taskId, ...entry });
  }
  if (total > MAX_TOTAL_BYTES) {
    entries.sort((a, b) => a.expiresAt - b.expiresAt);
    const toDelete = entries.slice(0, Math.ceil(entries.length / 2));
    for (const { taskId, path } of toDelete) {
      await rm(path).catch(() => {});
      pending.delete(taskId);
    }
    console.error('[FileOffloader] Enforced max size — removed', toDelete.length, 'files');
  }
}

/** 判断是否需要 offload：单条数据 > 10KB */
export function shouldOffload(data) {
  const len = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
  return len > 10240;
}
```

- [ ] **Step 2: Commit**

```bash
git add native-host/file-offloader.js
git commit -m "feat(native-host): add FileOffloader module for large payload management"
```

---

### Task 4: 高级语义 Tool 实现

**Files:**
- Create: `native-host/tools/semantic/extract-network-apis.js`
- Create: `native-host/tools/semantic/get-auth-cookies.js`
- Create: `native-host/tools/semantic/screenshot-fullpage.js`
- Create: `native-host/tools/semantic/export-pdf.js`
- Create: `native-host/tools/semantic/get-storage.js`

- [ ] **Step 1: 创建 extract-network-apis.js**

```javascript
// 自动捕获网络请求，按域名过滤，返回结构化 API 列表

/**
 * @param {object} ctx - { sendToExtension(taskId, action, payload): Promise<result> }
 * @param {object} params - { domain_filter?, capture_duration_ms?, include_request_body? }
 * @returns {Promise<object>}
 */
export async function extractNetworkApis(ctx, params = {}) {
  const { domain_filter, capture_duration_ms = 3000, include_request_body = false } = params;
  const taskId = `net_${Date.now()}`;

  // 1. 启动网络捕获
  await ctx.sendToExtension(taskId, 'network_start', {});
  // 2. 等待
  await new Promise(r => setTimeout(r, Math.min(capture_duration_ms, 30000)));
  // 3. 停止捕获
  const result = await ctx.sendToExtension(taskId, 'network_stop', {});

  const data = result.data || {};
  const requests = data.requests || [];

  // 4. 按域名过滤
  let filtered = requests;
  if (domain_filter) {
    filtered = requests.filter(r => {
      try { return new URL(r.url).hostname.includes(domain_filter); } catch { return false; }
    });
  }

  // 5. 去重 + 结构化
  const seen = new Set();
  const apis = filtered.filter(r => {
    const key = `${r.method}:${r.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(r => ({
    url: r.url,
    method: r.method || 'GET',
    status: r.status,
    type: r.type || 'fetch',
    mime_type: r.mimeType || '',
    response_size_bytes: r.responseSize || 0,
    timing_ms: r.timing || 0,
  }));

  // 6. 收集所有域名
  const domains = [...new Set(apis.map(a => {
    try { return new URL(a.url).hostname; } catch { return ''; }
  }).filter(Boolean))];

  return {
    total_requests: requests.length,
    filtered_requests: apis.length,
    domains,
    apis,
  };
}
```

- [ ] **Step 2: 创建 get-auth-cookies.js**

```javascript
// 导出当前页面 Cookie 为 Netscape 格式（兼容 curl/wget）

/**
 * @param {object} ctx - { sendToExtension(taskId, action, payload): Promise<result> }
 * @param {object} params - { domain?, format? }
 * @returns {Promise<object>}
 */
export async function getAuthCookies(ctx, params = {}) {
  const { domain, format = 'netscape' } = params;
  const taskId = `ck_${Date.now()}`;

  const result = await ctx.sendToExtension(taskId, 'evaluate', {
    value: `(() => {
      const d = document.domain;
      const c = { localStorage: {}, sessionStorage: {} };
      try { for (let i=0;i<localStorage.length;i++) c.localStorage[localStorage.key(i)]=localStorage.getItem(localStorage.key(i)); } catch(e){}
      try { for (let i=0;i<sessionStorage.length;i++) c.sessionStorage[localStorage.key(i)]=sessionStorage.getItem(sessionStorage.key(i)); } catch(e){}
      return JSON.stringify({ domain: d, cookies: document.cookie, storage: c });
    })()`,
  });

  // 从 CDP Network.getCookies 获取完整 Cookie 列表
  const cdpResult = await ctx.sendToExtension(taskId, 'evaluate', {
    value: 'document.cookie',
  });

  const rawCookies = (cdpResult.data?.result || '').split(';').map(c => c.trim()).filter(Boolean);
  const targetDomain = domain || (() => {
    try { return new URL(ctx.currentUrl || 'about:blank').hostname; }
    catch { return ''; }
  })();

  if (format === 'netscape') {
    const lines = ['# Netscape HTTP Cookie File'];
    for (const ck of rawCookies) {
      const parts = ck.split('=');
      if (parts.length < 2) continue;
      const name = parts[0];
      const value = parts.slice(1).join('=');
      lines.push(`${targetDomain.startsWith('.') ? targetDomain : '.' + targetDomain}\tTRUE\t/\t${true ? 'TRUE' : 'FALSE'}\t0\t${name}\t${value}`);
    }
    return { format: 'netscape', domain: targetDomain, cookie_count: rawCookies.length, raw: lines.join('\n') };
  }

  return {
    format: 'json',
    domain: targetDomain,
    cookie_count: rawCookies.length,
    cookies: rawCookies.map(c => {
      const [name, ...rest] = c.split('=');
      return { name, value: rest.join('=') };
    }),
  };
}
```

- [ ] **Step 3: 创建 screenshot-fullpage.js**

```javascript
// 全页截图，使用 CDP Page.captureScreenshot({captureBeyondViewport: true})

/**
 * @param {object} ctx - { sendToExtension(taskId, action, payload): Promise<result> }
 * @param {object} params - { max_height_px?, format?, quality? }
 * @returns {Promise<object>}
 */
export async function screenshotFullpage(ctx, params = {}) {
  const { max_height_px = 16384, format = 'png', quality = 80 } = params;
  const taskId = `ss_${Date.now()}`;

  const result = await ctx.sendToExtension(taskId, 'screenshot', {
    full_page: true,
    max_height: Math.min(max_height_px, 32768),
    format,
    quality: format === 'jpeg' ? Math.min(Math.max(quality, 1), 100) : undefined,
  });

  const data = result.data || {};
  return {
    status: data.error ? 'error' : 'success',
    width_px: data.width || 0,
    height_px: data.height || 0,
    raw_bytes: data.screenshot || null, // base64 string or null
    error: data.error || null,
    format,
  };
}
```

- [ ] **Step 4: 创建 export-pdf.js**

```javascript
// 导出当前页面为 PDF，使用 CDP Page.printToPDF

/**
 * @param {object} ctx - { sendToExtension(taskId, action, payload): Promise<result> }
 * @param {object} params - { landscape?, paper_size?, print_background?, scale? }
 * @returns {Promise<object>}
 */
export async function exportPdf(ctx, params = {}) {
  const { landscape = false, paper_size = 'A4', print_background = true, scale = 1.0 } = params;
  const taskId = `pdf_${Date.now()}`;

  const result = await ctx.sendToExtension(taskId, 'evaluate', {
    value: JSON.stringify({
      action: 'pdf_export',
      params: {
        landscape,
        paperWidth: paper_size === 'A4' ? 8.27 : paper_size === 'Letter' ? 8.5 : 8.5,
        paperHeight: paper_size === 'A4' ? 11.69 : paper_size === 'Letter' ? 11 : 14,
        printBackground: print_background,
        scale: Math.min(Math.max(scale, 0.1), 2.0),
      },
    }),
  });

  const data = result.data || {};
  return {
    status: data.error ? 'error' : 'success',
    page_count: data.pageCount || 0,
    raw_bytes: data.pdfData || null,
    error: data.error || null,
  };
}
```

- [ ] **Step 5: 创建 get-storage.js**

```javascript
// 读取页面 localStorage 和 sessionStorage

/**
 * @param {object} ctx - { sendToExtension(taskId, action, payload): Promise<result> }
 * @param {object} params - { include?, key_prefix?, max_value_length? }
 * @returns {Promise<object>}
 */
export async function getStorage(ctx, params = {}) {
  const { include = 'both', key_prefix, max_value_length = 200 } = params;
  const taskId = `st_${Date.now()}`;

  const result = await ctx.sendToExtension(taskId, 'evaluate', {
    value: `(() => {
      const out = {};
      const stores = ${JSON.stringify(include === 'both' ? ['local', 'session'] : [include])};
      const prefix = ${JSON.stringify(key_prefix || '')};
      const maxLen = ${max_value_length};
      for (const s of stores) {
        const storage = s === 'local' ? localStorage : sessionStorage;
        const entries = {};
        try {
          for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            if (prefix && !k.startsWith(prefix)) continue;
            let v = storage.getItem(k) || '';
            if (v.length > maxLen) v = v.slice(0, maxLen) + '...[truncated]';
            entries[k] = v;
          }
        } catch (e) {}
        out[s + 'Storage'] = {
          count: storage.length,
          filtered_count: Object.keys(entries).length,
          entries,
        };
      }
      return JSON.stringify(out);
    })()`,
  });

  try {
    return JSON.parse((result.data?.result || '{}'));
  } catch {
    return { error: 'Failed to parse storage data' };
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add native-host/tools/
git commit -m "feat(native-host): add 5 semantic CDP tools"
```

---

### Task 5: 工具注册表 + 降噪

**Files:**
- Create: `native-host/tools/tools-registry.js`

- [ ] **Step 1: 创建 tools-registry.js**

```javascript
// MCP Tool 注册表
// 控制哪些工具暴露给外部 Agent（降噪：隐藏被语义 Tool 覆盖的原子 CDP 操作）

import {
  extractNetworkApis,
} from './semantic/extract-network-apis.js';
import {
  getAuthCookies,
} from './semantic/get-auth-cookies.js';
import {
  screenshotFullpage,
} from './semantic/screenshot-fullpage.js';
import {
  exportPdf,
} from './semantic/export-pdf.js';
import {
  getStorage,
} from './semantic/get-storage.js';

// ── 显式暴露的工具（Agent 可见）──
export const VISIBLE_TOOLS = [
  // 基础操作 7
  'observe', 'click', 'type', 'navigate', 'extract', 'scroll', 'screenshot',
  // CDP 兜底 1
  'evaluate',
  // 语义工具 5
  'extract_network_apis', 'get_auth_cookies', 'screenshot_fullpage', 'export_pdf', 'get_storage',
];

// ── 内部工具（Agent 不可见，语义工具内部调用）──
export const HIDDEN_TOOLS = [
  'network_start', 'network_stop', 'console_start', 'console_stop',
  'perf_start', 'perf_stop',
];

// ── 语义工具执行器映射 ──
export const SEMANTIC_EXECUTORS = {
  extract_network_apis: extractNetworkApis,
  get_auth_cookies: getAuthCookies,
  screenshot_fullpage: screenshotFullpage,
  export_pdf: exportPdf,
  get_storage: getStorage,
};

// ── 全部工具的 JSON Schema（MCP ListTools 用）──
export const TOOL_SCHEMAS = [
  {
    name: 'observe',
    description: '观察当前浏览器页面，返回交互元素列表(最多150个)。每个元素有 id/tag/text/placeholder/inViewport 等字段。',
    inputSchema: { type: 'object', properties: { reasoning: { type: 'string' } } },
  },
  {
    name: 'click',
    description: '点击页面中的交互元素。target_id 从 observe 返回的元素列表中获取(如 el_5)。',
    inputSchema: {
      type: 'object',
      properties: {
        target_id: { type: 'string', description: '元素 ID, 格式 el_N' },
        reasoning: { type: 'string' },
      },
      required: ['target_id'],
    },
  },
  {
    name: 'type',
    description: '向输入框输入文本。支持 input/textarea/select/contenteditable 元素。',
    inputSchema: {
      type: 'object',
      properties: {
        target_id: { type: 'string', description: '输入框元素 ID' },
        value: { type: 'string', description: '要输入的文本' },
        reasoning: { type: 'string' },
      },
      required: ['target_id', 'value'],
    },
  },
  {
    name: 'navigate',
    description: '页面跳转到指定 URL。value 以 "newtab:" 开头则在新标签页打开。',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'URL' },
        reasoning: { type: 'string' },
      },
      required: ['value'],
    },
  },
  {
    name: 'extract',
    description: '从当前页面提取数据。value 为 CSS 选择器。',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'CSS 选择器' },
        reasoning: { type: 'string' },
      },
      required: ['value'],
    },
  },
  {
    name: 'scroll',
    description: '滚动当前页面。value 为 "up" 或 "down"。',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', enum: ['up', 'down'], description: '滚动方向' },
        reasoning: { type: 'string' },
      },
      required: ['value'],
    },
  },
  {
    name: 'screenshot',
    description: '截取当前浏览器视口为 JPEG。失败时自动调用。',
    inputSchema: { type: 'object', properties: { reasoning: { type: 'string' } } },
  },
  {
    name: 'evaluate',
    description: '[CDP] 在页面上下文中执行 JavaScript 表达式并返回结果。这是最灵活的兜底工具——当语义工具无法覆盖特定场景时使用。支持任意 JS 表达式。',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'JavaScript 表达式' },
        reasoning: { type: 'string' },
      },
      required: ['value'],
    },
  },
  {
    name: 'extract_network_apis',
    description: '自动捕获网络请求并按域名过滤，返回结构化 API 调用列表。内部自动启动/停止 CDP Network 域，无需手动 network_start/stop。',
    inputSchema: {
      type: 'object',
      properties: {
        domain_filter: { type: 'string', description: '可选：只返回匹配此域名的请求' },
        capture_duration_ms: { type: 'number', description: '捕获时长(ms)，默认 3000。上限 30000。', default: 3000, maximum: 30000 },
        include_request_body: { type: 'boolean', description: '是否包含 POST/PUT 请求体，默认 false。', default: false },
      },
    },
  },
  {
    name: 'get_auth_cookies',
    description: '导出当前页面的 Cookie 为 Netscape 格式（兼容 curl/wget/yt-dlp）。用于跨工具迁移登录态。',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: '可选：只导出特定域名的 Cookie' },
        format: { type: 'string', enum: ['netscape', 'json'], description: '导出格式。默认 netscape。', default: 'netscape' },
      },
    },
  },
  {
    name: 'screenshot_fullpage',
    description: '截取页面完整长图(包含滚动区域)，返回本地文件路径。使用 CDP Page.captureScreenshot({captureBeyondViewport:true})。',
    inputSchema: {
      type: 'object',
      properties: {
        max_height_px: { type: 'number', description: '最大截图高度(像素)，默认 16384。上限 32768。', default: 16384, maximum: 32768 },
        format: { type: 'string', enum: ['png', 'jpeg'], default: 'png' },
        quality: { type: 'number', description: 'JPEG 质量(0-100)。默认 80。', default: 80, minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'export_pdf',
    description: '将当前页面导出为 PDF 文件。使用 CDP Page.printToPDF。',
    inputSchema: {
      type: 'object',
      properties: {
        landscape: { type: 'boolean', description: '横向打印，默认 false。', default: false },
        paper_size: { type: 'string', enum: ['A4', 'Letter', 'Legal'], default: 'A4' },
        print_background: { type: 'boolean', description: '是否打印背景色/图片，默认 true。', default: true },
        scale: { type: 'number', description: '缩放比例，0.1-2.0。默认 1.0。', default: 1.0, minimum: 0.1, maximum: 2.0 },
      },
    },
  },
  {
    name: 'get_storage',
    description: '读取当前页面的 localStorage 和 sessionStorage，可选按 key 前缀过滤。用于提取 JWT token、应用状态、草稿等。',
    inputSchema: {
      type: 'object',
      properties: {
        include: { type: 'string', enum: ['local', 'session', 'both'], description: '读取哪种存储。默认 both。', default: 'both' },
        key_prefix: { type: 'string', description: '可选：只返回 key 以此前缀开头的条目。' },
        max_value_length: { type: 'number', description: '单个 value 最大长度(字符)，超出截断。默认 200。', default: 200, maximum: 1000 },
      },
    },
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add native-host/tools/tools-registry.js
git commit -m "feat(native-host): add tool registry with noise reduction (13 visible tools)"
```

---

### Task 6: 重写 Native Host 主入口

**Files:**
- Modify: `native-host/host.js` (完全重写)

- [ ] **Step 1: 加载设计文档确认完整契约**

重写前，确保理解 `host.js` 的职责：
1. 通过 Native Messaging（stdin/stdout）与 Chrome Extension 通信
2. 暴露 MCP SSE Server（`:9527`）供外部 Agent 连接
3. 路由：MCP Tool Call → AGENT_REQUEST (stdout) → 等待 AGENT_RESPONSE (stdin) → MCP Response
4. 集成 FileOffloader 和语义 Tool 执行器

- [ ] **Step 2: 编写新的 host.js**

```javascript
#!/usr/bin/env node
/**
 * Logexus AI Browser — Native Host v0.2.0
 *
 * 单进程架构：
 *   - 上半身：MCP SSE Server (http://127.0.0.1:9527) ← 外部 Agent 连接
 *   - 下半身：Native Messaging (stdin/stdout) ← Chrome Extension 通信
 *   - 进程内零拷贝路由 + 文件卸载
 */

import { createServer } from 'node:http';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { init as initOffloader, offload, shouldOffload, cleanupAll } from './file-offloader.js';
import {
  VISIBLE_TOOLS,
  HIDDEN_TOOLS,
  SEMANTIC_EXECUTORS,
  TOOL_SCHEMAS,
} from './tools/tools-registry.js';

// ═══════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════
const HTTP_PORT = 9527;
const HTTP_HOST = '127.0.0.1';
const EXTENSION_TIMEOUT_MS = 45000;
const DEGRADED_EXIT_MS = 1800000; // 30 分钟无 Agent 重连 → 退出

// ═══════════════════════════════════════════
// 状态机
// ═══════════════════════════════════════════
const State = { INIT: 'INIT', STARTING: 'STARTING', RUNNING: 'RUNNING', DEGRADED: 'DEGRADED', DRAINING: 'DRAINING', EXITED: 'EXITED' };
let state = State.INIT;
let degradedTimer = null;
let httpServer = null;
let sseTransport = null;

function transition(newState) {
  console.error(`[NativeHost] ${state} → ${newState}`);
  state = newState;
}

// ═══════════════════════════════════════════
// Native Messaging — stdin/stdout
// ═══════════════════════════════════════════
const pendingRequests = new Map();
let currentUrl = 'about:blank';

function readNativeMessage() {
  return new Promise((resolve) => {
    const chunks = [];
    let reading = false;
    let expectedLen = 0;
    let receivedLen = 0;

    const onData = (chunk) => {
      chunks.push(chunk);
      receivedLen += chunk.length;
      if (!reading && receivedLen >= 4) {
        const buf = Buffer.concat(chunks);
        expectedLen = buf.readUInt32LE(0);
        reading = true;
        const remaining = buf.slice(4);
        chunks.length = 0;
        if (remaining.length > 0) { chunks.push(remaining); receivedLen = remaining.length; }
        else { receivedLen = 0; }
      }
      if (reading && receivedLen >= expectedLen) {
        process.stdin.removeListener('data', onData);
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8').slice(0, expectedLen)));
        } catch {
          resolve(null);
        }
      }
    };
    process.stdin.on('data', onData);
    process.stdin.on('end', () => { process.stdin.removeListener('data', onData); resolve(null); });
  });
}

function sendNativeMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(Buffer.concat([header, buf]));
}

function sendToExtension(taskId, action, payload = {}) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(taskId);
      resolve({ type: 'AGENT_RESPONSE', task_id: taskId, status: 'error', data: { error: 'Extension timeout after 45s' } });
    }, EXTENSION_TIMEOUT_MS);

    pendingRequests.set(taskId, (response) => {
      clearTimeout(timer);
      resolve(response);
    });

    sendNativeMessage({
      type: 'AGENT_REQUEST',
      task_id: taskId,
      action,
      payload: { ...payload, reasoning: payload.reasoning || `MCP tool call: ${action}` },
    });
  });
}

// ═══════════════════════════════════════════
// MCP SSE Server
// ═══════════════════════════════════════════

const mcpServer = new McpServer(
  { name: 'logexus-browser', version: '0.2.0' },
  { capabilities: { tools: {} } }
);

// ListTools — 只返回 VISIBLE_TOOLS 中的工具 Schema
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  const schemas = TOOL_SCHEMAS.filter(t => VISIBLE_TOOLS.includes(t.name));
  return { tools: schemas };
});

// CallTool — 路由到对应的执行器
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args || {});
  const taskId = `mcp_${Date.now()}`;
  const reasoning = a.reasoning || `MCP tool call: ${name}`;

  try {
    let result;

    // 语义工具：在 Native Host 内部执行
    if (SEMANTIC_EXECUTORS[name]) {
      const executor = SEMANTIC_EXECUTORS[name];
      const ctx = { sendToExtension, currentUrl };
      const semanticResult = await executor(ctx, a);

      // 检查是否包含大体积数据需要 offload
      let savedPath = null;
      if (semanticResult.raw_bytes) {
        const buf = Buffer.from(semanticResult.raw_bytes, 'base64');
        const ext = name === 'screenshot_fullpage' ? 'png' : name === 'export_pdf' ? 'pdf' : 'json';
        const type = name.replace('_', '');
        const offloadResult = await offload(taskId, type, ext, buf);
        savedPath = offloadResult.saved_path;
      } else if (semanticResult.raw && shouldOffload(semanticResult.raw)) {
        const offloadResult = await offload(taskId, name, 'txt', Buffer.from(semanticResult.raw));
        savedPath = offloadResult.saved_path;
      }

      let text = `Status: ${semanticResult.status || 'success'}`;
      if (savedPath) text += `\nsaved_path: ${savedPath}`;
      Object.entries(semanticResult).forEach(([k, v]) => {
        if (!['raw_bytes', 'status', 'raw'].includes(k) && v !== null && v !== undefined) {
          text += `\n${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`;
        }
      });

      return { content: [{ type: 'text', text }] };
    }

    // 基础操作 / CDP 裸工具：透传给 Extension
    const extResult = await sendToExtension(taskId, name, {
      target_id: a.target_id,
      value: a.value,
      reasoning,
    });

    const data = extResult.data || {};

    // 截图/大体积数据 → offload
    if (data.screenshot && shouldOffload(data.screenshot)) {
      const offloadResult = await offload(taskId, 'screenshot', 'jpg', Buffer.from(data.screenshot, 'base64'));
      let text = `Status: ${extResult.status}`;
      if (data.current_url) text += `\nURL: ${data.current_url}`;
      text += `\nsaved_path: ${offloadResult.saved_path}\nsize_bytes: ${offloadResult.size_bytes}\nformat: jpeg`;
      return { content: [{ type: 'text', text }] };
    }

    // 网络抓包大体积 → offload
    if (data.requests && Array.isArray(data.requests) && shouldOffload(JSON.stringify(data.requests))) {
      const offloadResult = await offload(taskId, 'network', 'json', JSON.stringify(data.requests));
      let text = `Status: ${extResult.status}\nCaptured: ${data.requests.length} requests\nsaved_path: ${offloadResult.saved_path}`;
      return { content: [{ type: 'text', text }] };
    }

    // 小块数据：直连
    let text = `Status: ${extResult.status}`;
    if (data.action_result) text += `\nResult: ${data.action_result}`;
    if (data.current_url) text += `\nURL: ${data.current_url}`;
    if (data.error) text += `\nError: ${data.error}`;
    if (data.new_observation && Array.isArray(data.new_observation)) {
      const els = data.new_observation;
      text += `\n\n交互元素 (${els.length}):`;
      els.slice(0, 15).forEach((el) => {
        text += `\n  [${el.id}] <${el.tag}> "${(el.text || '').slice(0, 40)}"`;
      });
      if (els.length > 15) text += `\n  ... 还有 ${els.length - 15} 个元素`;
    }

    // 更新 currentUrl 缓存
    if (data.current_url) currentUrl = data.current_url;

    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});

// ═══════════════════════════════════════════
// SSE Transport 管理
// ═══════════════════════════════════════════

function handleSseConnection(req, res) {
  if (req.url === '/sse' && req.method === 'GET') {
    console.error('[NativeHost] SSE client connected');
    transition(State.RUNNING);
    if (degradedTimer) { clearTimeout(degradedTimer); degradedTimer = null; }

    sseTransport = new SSEServerTransport('/messages', res);
    sseTransport.onclose = () => {
      console.error('[NativeHost] SSE client disconnected');
      sseTransport = null;
      if (state === State.RUNNING) {
        transition(State.DEGRADED);
        degradedTimer = setTimeout(() => {
          console.error('[NativeHost] Degraded timeout — exiting');
          shutdown();
        }, DEGRADED_EXIT_MS);
      }
    };

    mcpServer.connect(sseTransport).catch(err => {
      console.error('[NativeHost] SSE connect error:', err.message);
    });
    return true;
  }

  if (req.url === '/messages' && req.method === 'POST' && sseTransport) {
    sseTransport.handlePostMessage(req, res);
    return true;
  }

  // Health check
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: state,
      extensionConnected: true,
      pendingRequests: pendingRequests.size,
      sseConnected: sseTransport !== null,
    }));
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════
// 主循环
// ═══════════════════════════════════════════

async function shutdown() {
  transition(State.DRAINING);

  // 等待 pending 请求完成
  const drainStart = Date.now();
  while (pendingRequests.size > 0 && (Date.now() - drainStart) < 45000) {
    await new Promise(r => setTimeout(r, 500));
  }

  await cleanupAll();
  if (httpServer) {
    await new Promise(resolve => httpServer.close(resolve));
    httpServer = null;
  }
  transition(State.EXITED);
  process.exit(0);
}

async function main() {
  transition(State.STARTING);

  // 初始化 FileOffloader
  await initOffloader();

  // 启动 HTTP Server（MCP SSE endpoint + health check）
  httpServer = createServer((req, res) => {
    if (!handleSseConnection(req, res)) {
      // 处理 CORS（Claude Code 的 SSE client 需要）
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // 兼容旧路径：POST /api/agent（保留向后兼容）
      if (req.method === 'POST' && req.url === '/api/agent') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');
          try {
            const agentReq = JSON.parse(body);
            const extResult = await sendToExtension(
              agentReq.task_id || `legacy_${Date.now()}`,
              agentReq.action,
              agentReq.payload || {},
            );
            res.writeHead(200);
            res.end(JSON.stringify(extResult));
          } catch (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
    console.error(`[NativeHost] HTTP server on http://${HTTP_HOST}:${HTTP_PORT}`);
  });

  // 端口冲突重试逻辑
  httpServer.on('error', async (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[NativeHost] Port ${HTTP_PORT} in use, waiting...`);
      await new Promise(r => setTimeout(r, 500));
      httpServer.close();
      httpServer.listen(HTTP_PORT, HTTP_HOST);
    } else {
      console.error('[NativeHost] HTTP server error:', err);
    }
  });

  // stdin 关闭 → 开始退出
  process.stdin.on('end', () => {
    console.error('[NativeHost] stdin closed by Chrome');
    shutdown();
  });

  // Native Messaging 主循环
  while (true) {
    const msg = await readNativeMessage();
    if (!msg) {
      console.error('[NativeHost] Chrome disconnected, exiting');
      shutdown();
      break;
    }

    const m = msg;
    const taskId = m.task_id;

    // Extension 响应 → 路由到 pending request
    if (m.type === 'AGENT_RESPONSE' && taskId && pendingRequests.has(taskId)) {
      const resolve = pendingRequests.get(taskId);
      pendingRequests.delete(taskId);
      if (resolve) resolve(m);
      continue;
    }

    // 旧协议兼容：直接按 msg.type 匹配
    if (taskId && pendingRequests.has(taskId)) {
      const resolve = pendingRequests.get(taskId);
      pendingRequests.delete(taskId);
      if (resolve) resolve(m);
      continue;
    }

    // Extension 主动推送的宏结果等
    if (m.type === 'LOGEXUS:MACRO_LIST_RESULT' || m.type === 'LOGEXUS:RECORD_STATUS') {
      // 暂不处理，保留扩展点
      continue;
    }

    if (m.type === 'ping') {
      sendNativeMessage({ type: 'pong', status: 'ok' });
    }
  }
}

main().catch((err) => {
  console.error('[NativeHost] crashed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: 确认所有 import 路径正确**

验证 `file-offloader.js` 和 `tools/tools-registry.js` 的 import 路径与 `host.js` 中的引用一致：
- `./file-offloader.js` ✓
- `./tools/tools-registry.js` ✓
- `tools-registry.js` → `./semantic/extract-network-apis.js` ✓
- `tools-registry.js` → `./semantic/get-auth-cookies.js` ✓
- `tools-registry.js` → `./semantic/screenshot-fullpage.js` ✓
- `tools-registry.js` → `./semantic/export-pdf.js` ✓
- `tools-registry.js` → `./semantic/get-storage.js` ✓

- [ ] **Step 4: Commit**

```bash
git add native-host/host.js native-host/file-offloader.js native-host/tools/
git commit -m "feat(native-host): rewrite host.js as single-process MCP SSE Server + Native Messaging bridge"
```

---

### Task 7: 更新设计文档与安装脚本

**Files:**
- Modify: `docs/design.md`
- Modify: `native-host/install.bat`

- [ ] **Step 1: 更新 docs/design.md 版本状态**

将第九节（当前版本状态）修改为：

```markdown
## 九、当前版本状态

**版本**: 0.2.0

### 已实现

- [x] Manifest V3 脚手架（Vite + @crxjs + React 18）
- [x] ... (保留所有 v0.1.5 已实现项)
- [x] 单进程 Native Host（MCP SSE Server + Native Messaging 桥接）
- [x] 文件卸载机制（大体积数据落盘 + 自动清理）
- [x] 13 个 MCP Tool（7 基础 + evaluate 兜底 + 5 语义 CDP）
- [x] 工具降噪（隐藏 6 个冗余 CDP 裸工具）

### 待实现

- [ ] CDP `Page.printToPDF` 和 `Page.captureScreenshot(full)` 的 Extension 端实现
- [ ] SSE 断连后的请求重试机制（Agent 层）
- [ ] Chrome Web Store 上架
```

- [ ] **Step 2: 更新 install.bat 添加依赖安装步骤**

在 `install.bat` 末尾（注册表写入之后）添加：

```batch
REM 安装 Node.js 依赖
echo.
echo 正在安装 Native Host 依赖...
cd /d "%HOST_DIR%"
call npm install --production
if %ERRORLEVEL% EQU 0 (
  echo 依赖安装完成
) else (
  echo 依赖安装失败，请检查 Node.js 是否已安装
)
```

- [ ] **Step 3: Commit**

```bash
git add docs/design.md native-host/install.bat
git commit -m "docs: update design.md to v0.2.0 and add npm install to install.bat"
```

---

### Task 8: 集成验证

**Files:** 无需修改，验证现有代码可正常工作。

- [ ] **Step 1: TypeScript 类型检查**

```bash
cd D:\CCWorkSpace\LogexusAIBrowser
npm run typecheck
```

预期：PASS（`src/` 目录未改动，不应引入新错误）

- [ ] **Step 2: 构建扩展**

```bash
npm run build
```

预期：PASS，`dist/` 生成完整扩展产物

- [ ] **Step 3: 启动 Native Host 验证**

```bash
node D:\CCWorkSpace\LogexusAIBrowser\native-host\host.js
```

预期输出：
```
[FileOffloader] Init done, dir: C:\Users\...\AppData\Local\Temp\logexus
[NativeHost] INIT → STARTING
[NativeHost] HTTP server on http://127.0.0.1:9527
[NativeHost] STARTING → DEGRADED
```

按 Ctrl+C 结束，预期输出：
```
[NativeHost] stdin closed by Chrome
[NativeHost] DEGRADED → DRAINING
[NativeHost] DRAINING → EXITED
```

- [ ] **Step 4: 验证健康检查端点**

先启动 Native Host（另一个终端）：
```bash
node D:\CCWorkSpace\LogexusAIBrowser\native-host\host.js
```

然后在另一个终端：
```bash
curl http://127.0.0.1:9527/health
```

预期响应：
```json
{"status":"DEGRADED","extensionConnected":true,"pendingRequests":0,"sseConnected":false}
```

- [ ] **Step 5: Commit (if any fixes)**

如有改动，提交修复。目标：所有验证通过。
```

---

### Task 9: 最终验证与发布准备

- [ ] **Step 1: 全量 Diff 审核**

```bash
git diff main~1 --stat
```

确认：
- `daemon/` 已完全删除
- `mcp-wrapper/` 已完全删除
- `src/` 目录零改动
- `native-host/` 新增 8 个文件（package.json, .gitignore, file-offloader.js, host.js, install.bat 修改, tools/ 目录 6 个文件）

- [ ] **Step 2: 确认版本号一致性**

检查 `native-host/package.json` 版本为 `0.2.0`。

- [ ] **Step 3: Final commit**

```bash
git status
# 确保没有未提交的改动
git log --oneline -10
```

---

## 文件结构总览 (v0.2.0)

```
native-host/
├── host.js                      # ← 重写：MCP SSE Server + Native Messaging
├── package.json                 # ← 新建：@modelcontextprotocol/sdk
├── package-lock.json            # ← 新建：npm install 生成
├── .gitignore                   # ← 新建
├── file-offloader.js            # ← 新建：文件卸载模块
├── install.bat                  # ← 修改：增加 npm install 步骤
├── com.logexus.browser.host.json# = 不动
└── tools/
    ├── tools-registry.js        # ← 新建：Tool 注册表 + 降噪
    └── semantic/
        ├── extract-network-apis.js  # ← 新建
        ├── get-auth-cookies.js      # ← 新建
        ├── screenshot-fullpage.js   # ← 新建
        ├── export-pdf.js            # ← 新建
        └── get-storage.js           # ← 新建

废弃目录:
✗ daemon/        （已删除）
✗ mcp-wrapper/   （已删除）

不动目录:
✓ src/           （零改动）
```
