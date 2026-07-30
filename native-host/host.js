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
        if (remaining.length > 0) {
          chunks.push(remaining);
          receivedLen = remaining.length;
        } else {
          receivedLen = 0;
        }
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
    process.stdin.on('end', () => {
      process.stdin.removeListener('data', onData);
      resolve(null);
    });
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
      resolve({
        type: 'AGENT_RESPONSE',
        task_id: taskId,
        status: 'error',
        data: { error: 'Extension timeout after 45s' },
      });
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
  const schemas = TOOL_SCHEMAS.filter((t) => VISIBLE_TOOLS.includes(t.name));
  return { tools: schemas };
});

// CallTool — 路由到对应的执行器
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = args || {};
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
  // GET /sse — SSE 长连接
  if (req.url === '/sse' && req.method === 'GET') {
    console.error('[NativeHost] SSE client connected');
    transition(State.RUNNING);
    if (degradedTimer) {
      clearTimeout(degradedTimer);
      degradedTimer = null;
    }

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

  // POST /messages — SSE 客户端的后续消息
  if (req.url === '/messages' && req.method === 'POST' && sseTransport) {
    sseTransport.handlePostMessage(req, res);
    return true;
  }

  // GET /health — 健康检查
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
// 生命周期
// ═══════════════════════════════════════════

async function shutdown() {
  transition(State.DRAINING);

  // 等待 pending 请求完成
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

  // 初始化 FileOffloader
  await initOffloader();

  // 启动 HTTP Server（MCP SSE endpoint + health check + 旧路径兼容）
  httpServer = createServer((req, res) => {
    if (!handleSseConnection(req, res)) {
      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // 兼容旧路径：POST /api/agent
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

      // Macro list
      if (req.method === 'GET' && req.url === '/api/macros') {
        const result = await sendToExtension('macros', 'LOGEXUS:MACRO_LIST');
        res.writeHead(200);
        res.end(JSON.stringify(result));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
    console.error(`[NativeHost] HTTP server on http://${HTTP_HOST}:${HTTP_PORT}`);
  });

  // 端口冲突重试
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

    // 旧协议兼容：直接按 taskId 匹配
    if (taskId && pendingRequests.has(taskId)) {
      const resolve = pendingRequests.get(taskId);
      pendingRequests.delete(taskId);
      if (resolve) resolve(m);
      continue;
    }

    // ping
    if (m.type === 'ping') {
      sendNativeMessage({ type: 'pong', status: 'ok' });
    }
  }
}

main().catch((err) => {
  console.error('[NativeHost] crashed:', err);
  process.exit(1);
});
