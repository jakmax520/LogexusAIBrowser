#!/usr/bin/env node
/**
 * Logexus AI Browser — Native Host v0.2.0
 *
 * 单进程架构：
 *   - 上半身：MCP SSE Server (http://127.0.0.1:9527) ← 外部 Agent 连接
 *   - 左通道：WebSocket ← Chrome Extension (兼容现有 JsonRpcTransport)
 *   - 右通道：Native Messaging (stdin/stdout) ← Chrome 生命周期管理
 *   - 进程内零拷贝路由 + 文件卸载
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { init as initOffloader, offload, shouldOffload, cleanupAll } from './file-offloader.js';
import {
  VISIBLE_TOOLS,
  SEMANTIC_EXECUTORS,
  TOOL_SCHEMAS,
} from './tools/tools-registry.js';

// ═══════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════
const HTTP_PORT = 9527;
const HTTP_HOST = '127.0.0.1';
const AUTH_TOKEN = process.env.LOGEXUS_TOKEN || 'lx_3696ac533d9ddfb81d5e50340f205317';
const EXTENSION_TIMEOUT_MS = 45000;
const DEGRADED_EXIT_MS = 1800000;

// ═══════════════════════════════════════════
// 状态机
// ═══════════════════════════════════════════
const State = {
  INIT: 'INIT',
  STARTING: 'STARTING',
  RUNNING: 'RUNNING',
  DEGRADED: 'DEGRADED',
  DRAINING: 'DRAINING',
  EXITED: 'EXITED',
};
let state = State.INIT;
let degradedTimer = null;
let httpServer = null;
let wss = null;
let sseTransport = null;
let extensionWs = null;

function transition(newState) {
  console.error(`[NativeHost] ${state} → ${newState}`);
  state = newState;
}

// ═══════════════════════════════════════════
// Extension 通信 — WebSocket (兼容 JsonRpcTransport)
// ═══════════════════════════════════════════
const pendingRequests = new Map();
let currentUrl = 'about:blank';

/**
 * 向 Extension 发送 JSON-RPC 请求并等待响应。
 * 优先通过 WebSocket；若 Extension 未连接则报错。
 */
function sendToExtension(taskId, action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!extensionWs || extensionWs.readyState !== 1) {
      reject(new Error('Extension not connected'));
      return;
    }

    const timer = setTimeout(() => {
      pendingRequests.delete(taskId);
      reject(new Error('Extension timeout after 45s'));
    }, EXTENSION_TIMEOUT_MS);

    pendingRequests.set(taskId, (response) => {
      clearTimeout(timer);
      resolve(response);
    });

    extensionWs.send(JSON.stringify({
      type: 'AGENT_REQUEST',
      task_id: taskId,
      action,
      payload: { ...payload, reasoning: payload.reasoning || `MCP: ${action}` },
    }));
  });
}

// ═══════════════════════════════════════════
// MCP SSE Server
// ═══════════════════════════════════════════

const mcpServer = new McpServer(
  { name: 'logexus-browser', version: '0.2.0' },
  { capabilities: { tools: {} } }
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  const schemas = TOOL_SCHEMAS.filter((t) => VISIBLE_TOOLS.includes(t.name));
  return { tools: schemas };
});

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = args || {};
  const taskId = `mcp_${Date.now()}`;

  try {
    // 语义工具：在 Native Host 内部执行
    if (SEMANTIC_EXECUTORS[name]) {
      const executor = SEMANTIC_EXECUTORS[name];
      const ctx = { sendToExtension, currentUrl };
      const semanticResult = await executor(ctx, a);

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
      for (const [k, v] of Object.entries(semanticResult)) {
        if (!['raw_bytes', 'status', 'raw'].includes(k) && v !== null && v !== undefined) {
          text += `\n${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`;
        }
      }
      return { content: [{ type: 'text', text }] };
    }

    // 基础操作 / CDP 裸工具：透传给 Extension
    const extResult = await sendToExtension(taskId, name, {
      target_id: a.target_id,
      value: a.value,
      reasoning: a.reasoning,
    });

    const data = extResult.data || {};

    if (data.screenshot && shouldOffload(data.screenshot)) {
      const offloadResult = await offload(taskId, 'screenshot', 'jpg', Buffer.from(data.screenshot, 'base64'));
      let text = `Status: ${extResult.status}`;
      if (data.current_url) text += `\nURL: ${data.current_url}`;
      text += `\nsaved_path: ${offloadResult.saved_path}\nsize_bytes: ${offloadResult.size_bytes}\nformat: jpeg`;
      return { content: [{ type: 'text', text }] };
    }

    if (data.requests && Array.isArray(data.requests) && shouldOffload(JSON.stringify(data.requests))) {
      const offloadResult = await offload(taskId, 'network', 'json', JSON.stringify(data.requests));
      let text = `Status: ${extResult.status}\nCaptured: ${data.requests.length} requests\nsaved_path: ${offloadResult.saved_path}`;
      return { content: [{ type: 'text', text }] };
    }

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
    sseTransport.onerror = (err) => {
      console.error('[NativeHost] SSE error:', err.message);
    };
    mcpServer.connect(sseTransport).catch((err) => {
      console.error('[NativeHost] SSE connect error:', err.message);
    });
    return true;
  }

  if (req.url === '/messages' && req.method === 'POST' && sseTransport) {
    sseTransport.handlePostMessage(req, res);
    return true;
  }

  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: state,
      extensionConnected: extensionWs !== null,
      pendingRequests: pendingRequests.size,
      sseConnected: sseTransport !== null,
    }));
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════
// WebSocket — Extension 通道
// ═══════════════════════════════════════════

function setupWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://${HTTP_HOST}`);
    const token = url.searchParams.get('token') || '';
    const role = url.searchParams.get('role') || 'agent';

    if (token !== AUTH_TOKEN) {
      ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid token' }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    if (role === 'extension') {
      extensionWs = ws;
      console.error('[NativeHost] Extension connected via WebSocket');

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        // Extension → Host：AGENT_RESPONSE
        if (msg.type === 'AGENT_RESPONSE' && msg.task_id) {
          const resolve = pendingRequests.get(msg.task_id);
          if (resolve) { pendingRequests.delete(msg.task_id); resolve(msg); }
          return;
        }

        // Extension → Host：JSON-RPC Response
        if (msg.jsonrpc === '2.0' && msg.id) {
          const resolve = pendingRequests.get(msg.id);
          if (resolve) { pendingRequests.delete(msg.id); resolve(msg); }
          return;
        }

        // 旧协议兼容
        if (msg.task_id && pendingRequests.has(msg.task_id)) {
          const resolve = pendingRequests.get(msg.task_id);
          pendingRequests.delete(msg.task_id);
          resolve(msg);
        }
      });

      ws.on('close', () => {
        extensionWs = null;
        console.error('[NativeHost] Extension WebSocket disconnected');
      });
    } else {
      // Agent 通道：JSON-RPC 2.0 + 旧协议 AGENT_REQUEST 兼容
      console.error('[NativeHost] Agent connected via WebSocket');

      // JSON-RPC method → AGENT_REQUEST action 映射
      const METHOD_MAP = {
        'browser.get_context': 'observe',
        'browser.navigate': 'navigate',
        'browser.reload': 'reload',
        'action.click': 'click',
        'action.input': 'type',
        'action.scroll': 'scroll',
      };

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        // JSON-RPC 2.0 请求（Logexus Tauri / Python 脚本等）
        if (msg.jsonrpc === '2.0' && msg.method && msg.id) {
          const action = METHOD_MAP[msg.method] || msg.method;
          const params = msg.params || {};
          const taskId = `rpc_${msg.id}`;

          // 提取 payload 参数（兼容 Rust browser.rs 的参数格式）
          const payload = {
            target_id: params.elementId || params.target_id || params.index || '',
            value: params.text || params.value || (params.url || ''),
            reasoning: `WebSocket RPC: ${msg.method}`,
          };

          sendToExtension(taskId, action, payload)
            .then((extResult) => {
              const data = extResult.data || {};
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                result: {
                  status: extResult.status || 'success',
                  ...data,
                },
                id: msg.id,
              }));
            })
            .catch((err) => {
              ws.send(JSON.stringify({
                jsonrpc: '2.0',
                error: { code: -32000, message: err.message },
                id: msg.id,
              }));
            });
          return;
        }

        // 旧协议 AGENT_REQUEST
        if (msg.type === 'AGENT_REQUEST') {
          sendToExtension(msg.task_id || `ws_${Date.now()}`, msg.action, msg.payload || {})
            .then((response) => ws.send(JSON.stringify(response)))
            .catch((err) => ws.send(JSON.stringify({
              type: 'AGENT_RESPONSE',
              task_id: msg.task_id,
              status: 'error',
              data: { error: err.message },
            })));
          return;
        }

        // ping
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      });
    }

    ws.on('error', (err) => {
      console.error('[NativeHost] WebSocket error:', err.message);
    });
  });
}

// ═══════════════════════════════════════════
// 生命周期
// ═══════════════════════════════════════════

async function shutdown() {
  transition(State.DRAINING);

  const drainStart = Date.now();
  while (pendingRequests.size > 0 && (Date.now() - drainStart) < 45000) {
    await new Promise((r) => setTimeout(r, 500));
  }

  await cleanupAll();
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
    httpServer = null;
  }
  transition(State.EXITED);
  process.exit(0);
}

async function main() {
  transition(State.STARTING);

  await initOffloader();

  httpServer = createServer(async (req, res) => {
    if (!handleSseConnection(req, res)) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

      // 兼容旧 POST /api/agent
      if (req.method === 'POST' && req.url === '/api/agent') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
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

      if (req.method === 'GET' && req.url === '/api/macros') {
        try {
          const result = await sendToExtension('macros', 'LOGEXUS:MACRO_LIST');
          res.writeHead(200);
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(503);
          res.end(JSON.stringify({ error: String(err) }));
        }
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  // WebSocket 升级
  setupWebSocket(httpServer);

  httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
    console.error(`[NativeHost] HTTP+WS on http://${HTTP_HOST}:${HTTP_PORT}`);
  });

  httpServer.on('error', async (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[NativeHost] Port ${HTTP_PORT} in use, retrying...`);
      await new Promise((r) => setTimeout(r, 500));
      httpServer.close();
      httpServer.listen(HTTP_PORT, HTTP_HOST);
    } else {
      console.error('[NativeHost] HTTP server error:', err);
    }
  });

  // ── Native Messaging stdin/stdout（方案二：Chrome 自动拉起 + 生命周期）──
  let nmBuffer = Buffer.alloc(0);
  let nmReading = false;
  let nmExpectedLen = 0;

  process.stdin.on('data', (chunk) => {
    nmBuffer = Buffer.concat([nmBuffer, chunk]);

    while (nmBuffer.length >= 4) {
      if (!nmReading) {
        nmExpectedLen = nmBuffer.readUInt32LE(0);
        nmReading = true;
        nmBuffer = nmBuffer.slice(4);
      }
      if (nmReading && nmBuffer.length >= nmExpectedLen) {
        let msg;
        try {
          msg = JSON.parse(nmBuffer.toString('utf-8', 0, nmExpectedLen));
        } catch {
          msg = null;
        }
        nmBuffer = nmBuffer.slice(nmExpectedLen);
        nmReading = false;

        if (msg?.type === 'ping') {
          const pong = Buffer.from(JSON.stringify({ type: 'pong', status: 'ok' }), 'utf-8');
          const header = Buffer.alloc(4);
          header.writeUInt32LE(pong.length, 0);
          process.stdout.write(Buffer.concat([header, pong]));
        }
      } else {
        break;
      }
    }
  });

  // stdin 关闭 → Chrome 断开 Native Messaging → 退出进程
  process.stdin.on('end', () => {
    console.error('[NativeHost] stdin closed (Chrome disconnected) — shutting down');
    shutdown();
  });

  // 进程退出时的清理
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());
}

main().catch((err) => {
  console.error('[NativeHost] crashed:', err);
  process.exit(1);
});
