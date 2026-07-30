// MCP Tool 注册表 + 降噪
// 控制哪些工具暴露给外部 Agent：隐藏被语义 Tool 覆盖的原子 CDP 操作

import { extractNetworkApis } from './semantic/extract-network-apis.js';
import { getAuthCookies } from './semantic/get-auth-cookies.js';
import { screenshotFullpage } from './semantic/screenshot-fullpage.js';
import { exportPdf } from './semantic/export-pdf.js';
import { getStorage } from './semantic/get-storage.js';

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
    description: '[CDP] 在页面上下文中执行 JavaScript 表达式并返回结果。这是最灵活的兜底工具——当语义工具无法覆盖特定场景时使用。',
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
    description: '自动捕获网络请求并按域名过滤，返回结构化 API 调用列表。内部自动启动/停止 CDP Network 域。',
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
        include: { type: 'string', enum: ['local', 'session', 'both'], description: '选择读取哪种存储。默认 both。', default: 'both' },
        key_prefix: { type: 'string', description: '可选：只返回 key 以此前缀开头的条目。如 token_ 或 persist:' },
        max_value_length: { type: 'number', description: '单个 value 最大长度(字符)，超出截断。默认 200。', default: 200, maximum: 1000 },
      },
    },
  },
];
