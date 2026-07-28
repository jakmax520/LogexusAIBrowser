/**
 * Logexus AI Browser — Native Messaging Host + Local API Server
 *
 * 双通道模式：
 *   1. Native Messaging (stdin/stdout) — Chrome Extension 通信
 *   2. HTTP API (localhost:9527) — 外部 AI Agent / MCP Wrapper 通信
 *
 * 用法：
 *   由 Chrome 自动启动（通过 Native Messaging 注册表）
 */

import * as http from 'node:http';

const HTTP_PORT = 9527;
const NATIVE_HOST_NAME = 'com.logexus.browser.host';

// ── 全局状态 ──
let pendingRequests = new Map<string, {
  resolve: (v: Record<string, unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
}>();

// ═══════════════════════════════════════════
// 1. Native Messaging：与 Chrome Extension 通信
// ═══════════════════════════════════════════

function readNativeMessage(): Promise<object | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let reading = false;
    let expectedLen = 0;
    let receivedLen = 0;

    const onData = (chunk: Buffer) => {
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
        const buf = Buffer.concat(chunks);
        try {
          resolve(JSON.parse(buf.toString('utf-8').slice(0, expectedLen)));
        } catch {
          resolve(null);
        }
      }
    };

    process.stdin.on('data', onData);
    process.stdin.on('end', () => { process.stdin.removeListener('data', onData); resolve(null); });
    setTimeout(() => { process.stdin.removeListener('data', onData); resolve(null); }, 60000);
  });
}

function sendNativeMessage(msg: object): void {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(Buffer.concat([header, buf]));
}

/**
 * 通过 Native Messaging 向扩展发送 AGENT_REQUEST 并等待响应
 */
function sendToExtension(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const taskId = req.task_id as string || `nm_${Date.now()}`;
    const timer = setTimeout(() => {
      pendingRequests.delete(taskId);
      resolve({ type: 'AGENT_RESPONSE', task_id: taskId, status: 'error', data: { error: 'Timeout after 45s' } });
    }, 45000);

    pendingRequests.set(taskId, { resolve, timer });
    sendNativeMessage(req);
  });
}

// ═══════════════════════════════════════════
// 2. HTTP API Server：供外部 AI Agent 调用
// ═══════════════════════════════════════════

function startHttpServer(): void {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end('{}');
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', chromeConnected: true, pending: pendingRequests.size }));
      return;
    }

    // API: POST /api/agent — 转发 AGENT_REQUEST 到扩展
    if (req.method === 'POST' && req.url === '/api/agent') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const agentReq = JSON.parse(body);
          if (!agentReq.action) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Missing action field' }));
            return;
          }

          if (!agentReq.task_id) {
            agentReq.task_id = `http_${Date.now()}`;
          }

          agentReq.type = 'AGENT_REQUEST';
          const result = await sendToExtension(agentReq);
          res.writeHead(200);
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    // Macro list
    if (req.method === 'GET' && req.url === '/api/macros') {
      const result = await sendToExtension({ type: 'LOGEXUS:MACRO_LIST' });
      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(HTTP_PORT, '127.0.0.1', () => {
    console.error(`[NativeHost] HTTP API listening on http://127.0.0.1:${HTTP_PORT}`);
  });
}

// ═══════════════════════════════════════════
// 3. 主循环
// ═══════════════════════════════════════════

async function main() {
  // 启动 HTTP 服务器
  startHttpServer();

  // Native Messaging 主循环
  while (true) {
    const msg = await readNativeMessage();
    if (!msg) {
      console.error('[NativeHost] Chrome disconnected, exiting');
      process.exit(0);
    }

    const m = msg as Record<string, unknown>;
    const taskId = m.task_id as string;

    // 来自扩展的响应 → 路由到等待中的 HTTP 请求
    if (m.type === 'AGENT_RESPONSE' && taskId && pendingRequests.has(taskId)) {
      const pending = pendingRequests.get(taskId)!;
      clearTimeout(pending.timer);
      pendingRequests.delete(taskId);
      pending.resolve(m);
      continue;
    }

    // 其他扩展消息（MACRO_LIST_RESULT 等）→ 找到对应的 pending
    if (taskId && pendingRequests.has(taskId)) {
      const pending = pendingRequests.get(taskId)!;
      clearTimeout(pending.timer);
      pendingRequests.delete(taskId);
      pending.resolve(m);
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
