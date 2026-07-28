#!/usr/bin/env node
/**
 * Logexus AI Browser — MCP Server Wrapper
 *
 * 将 7 种浏览器操作暴露为 MCP Tools，供 Claude Code / Cursor 调用。
 * 通过 HTTP API (localhost:9527) 与 Native Host 通信。
 *
 * Claude Code 配置 (~/.claude/claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "logexus": {
 *       "command": "node",
 *       "args": ["D:/CCWorkSpace/LogexusAIBrowser/mcp-wrapper/server.js"]
 *     }
 *   }
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const NATIVE_HOST_URL = 'http://127.0.0.1:9527/api/agent';

// ── 调用 Native Host HTTP API ──
async function callAgent(action: string, targetId?: string, value?: string, reasoning?: string): Promise<unknown> {
  const body: Record<string, unknown> = {
    type: 'AGENT_REQUEST',
    task_id: `mcp_${Date.now()}`,
    action,
    payload: { target_id: targetId, value, reasoning },
  };

  const res = await fetch(NATIVE_HOST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Native Host error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

// ── MCP 工具定义 ──
const TOOLS = [
  {
    name: 'observe',
    description: '观察当前浏览器页面，返回互元素列表(最多80个)。每个元素有 id/tag/text/placeholder/inViewport 等字段。',
    inputSchema: {
      type: 'object',
      properties: {
        reasoning: { type: 'string', description: '为何要观察页面' },
      },
    },
  },
  {
    name: 'click',
    description: '点击页面中的交互元素。target_id 从 observe 返回的元素列表中获取(如 el_5)。',
    inputSchema: {
      type: 'object',
      properties: {
        target_id: { type: 'string', description: '元素 ID, 格式 el_N' },
        reasoning: { type: 'string', description: '点击这个元素的原因' },
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
        reasoning: { type: 'string', description: '输入这个内容的原因' },
      },
      required: ['target_id', 'value'],
    },
  },
  {
    name: 'navigate',
    description: '页面跳转到指定 URL 或打开新标签页。value 以 "newtab:" 开头则在新标签页打开。',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'URL 或 "newtab: URL"' },
        reasoning: { type: 'string', description: '跳转到此页面的原因' },
      },
      required: ['value'],
    },
  },
  {
    name: 'extract',
    description: '从当前页面提取数据。value 为 CSS 选择器(如 h3, .price, [data-id])。',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'CSS 选择器' },
        reasoning: { type: 'string', description: '提取这些数据的原因' },
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
        reasoning: { type: 'string', description: '滚动页面的原因' },
      },
      required: ['value'],
    },
  },
  {
    name: 'screenshot',
    description: '截取当前浏览器视口为 JPEG。失败时自动调用。',
    inputSchema: {
      type: 'object',
      properties: {
        reasoning: { type: 'string', description: '截图的原因' },
      },
    },
  },
  {
    name: 'evaluate',
    description: '[CDP] Execute JavaScript in the page context and return the result. Supports async/await expressions.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'JavaScript expression to evaluate. e.g. document.title, Array.from(document.querySelectorAll("a")).length' },
        reasoning: { type: 'string' },
      },
      required: ['value'],
    },
  },
  {
    name: 'network_start',
    description: '[CDP] Start capturing network requests (URL, method, status). Call network_stop to get results.',
    inputSchema: {
      type: 'object',
      properties: { reasoning: { type: 'string' } },
    },
  },
  {
    name: 'network_stop',
    description: '[CDP] Stop network capture and return captured requests (max 200).',
    inputSchema: {
      type: 'object',
      properties: { reasoning: { type: 'string' } },
    },
  },
  {
    name: 'console_start',
    description: '[CDP] Start capturing console messages (log/warn/error). Call console_stop to get results.',
    inputSchema: {
      type: 'object',
      properties: { reasoning: { type: 'string' } },
    },
  },
  {
    name: 'console_stop',
    description: '[CDP] Stop console capture and return captured messages (max 200).',
    inputSchema: {
      type: 'object',
      properties: { reasoning: { type: 'string' } },
    },
  },
  {
    name: 'perf_start',
    description: '[CDP] Start performance tracing. Call perf_stop to get metrics.',
    inputSchema: {
      type: 'object',
      properties: { reasoning: { type: 'string' } },
    },
  },
  {
    name: 'perf_stop',
    description: '[CDP] Stop performance trace and return metrics (JSHeapUsedSize, TaskDuration, LayoutCount, etc.).',
    inputSchema: {
      type: 'object',
      properties: { reasoning: { type: 'string' } },
    },
  },
];

// ═══════════════════════════════════════════
// MCP Server
// ═══════════════════════════════════════════

const server = new Server(
  { name: 'logexus-browser', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// 列出工具
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// 调用工具
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args || {}) as Record<string, string>;
  const reasoning = a.reasoning || `MCP tool call: ${name}`;

  try {
    const result = await callAgent(
      name,
      a.target_id,
      a.value,
      reasoning
    );

    const r = result as Record<string, unknown>;
    const data = (r.data || {}) as Record<string, unknown>;

    // 格式化返回：突出显示关键信息
    let text = `Status: ${r.status}`;
    if (data.action_result) text += `\nResult: ${data.action_result}`;
    if (data.current_url) text += `\nURL: ${data.current_url}`;
    if (data.error) text += `\nError: ${data.error}`;
    if (data.new_observation && Array.isArray(data.new_observation)) {
      const els = data.new_observation as Array<Record<string, unknown>>;
      text += `\n\n交互元素 (${els.length}):`;
      els.slice(0, 15).forEach((el) => {
        text += `\n  [${el.id}] <${el.tag}> "${(el.text as string || '').slice(0, 40)}"`;
      });
      if (els.length > 15) text += `\n  ... 还有 ${els.length - 15} 个元素`;
    }
    if (data.screenshot) {
      text += `\n\n[截图: ${Math.round((data.screenshot as string).length / 1024)}KB]`;
    }

    return { content: [{ type: 'text', text }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});

// 启动
async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Logexus MCP] Server started');
}

run().catch((err) => {
  console.error('[Logexus MCP] Fatal:', err);
  process.exit(1);
});
