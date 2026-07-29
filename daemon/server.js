#!/usr/bin/env node
/**
 * Logexus AI Browser — WebSocket Daemon
 *
 * 本地消息中枢：Chrome Extension 和外部 AI Agent 通过 WebSocket 接入。
 * ws://localhost:9527
 *
 * 角色：
 *   1. 消息路由：Agent 请求 → Extension → 响应 → Agent
 *   2. 认证网关：token 验证
 *   3. 连接管理：追踪 Extension 实例
 *
 * 启动：node daemon/server.js
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';

const PORT = 9527;
const HOST = '127.0.0.1';
const AUTH_TOKEN = process.env.LOGEXUS_TOKEN || 'lx_3696ac533d9ddfb81d5e50340f205317';

// ── 状态 ──
/** @type {Map<import('ws').WebSocket, {role:string, connectedAt:number}>} */
const clients = new Map();
const pendingRequests = new Map();
let extensionWs = null;

// ── 日志 ──
function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

// ═══════════════════════════════════════════
// WebSocket Server
// ═══════════════════════════════════════════

const wss = new WebSocketServer({ host: HOST, port: PORT });

wss.on('listening', () => {
  log(`Daemon listening on ws://${HOST}:${PORT}`);
  log(`Auth token: ${AUTH_TOKEN === 'lx_3696ac533d9ddfb81d5e50340f205317' ? '(default)' : '(custom)'}`);
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${HOST}`);
  const token = url.searchParams.get('token') || '';
  const role = url.searchParams.get('role') || 'agent';
  const clientId = url.searchParams.get('clientId') || 'unknown';

  // 认证
  if (token !== AUTH_TOKEN) {
    log(`Auth failed: ${clientId} (${role})`);
    ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid token' }));
    ws.close(4001, 'Unauthorized');
    return;
  }

  // 注册
  const info = { ws, role, connectedAt: Date.now() };
  clients.set(ws, info);

  if (role === 'extension') {
    extensionWs = ws;
    log(`Extension connected: ${clientId}`);
    broadcastAgents({ type: 'extension_status', connected: true });
  } else {
    log(`Agent connected: ${clientId}`);
  }

  // ── 消息处理（JSON-RPC 2.0 + 旧协议兼容）──
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    const taskId = msg.task_id;
    const rpcId = msg.id;

    // ═══ JSON-RPC 2.0 路由 ═══
    if (msg.jsonrpc === '2.0') {
      // Agent → Extension：JSON-RPC Request（有 method + id）
      if (role === 'agent' && msg.method && rpcId) {
        if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'No extension connected' },
            id: rpcId,
          }));
          return;
        }
        extensionWs.send(JSON.stringify(msg));

        const timer = setTimeout(() => {
          pendingRequests.delete(rpcId);
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32005, message: 'Extension timeout after 45s' },
            id: rpcId,
          }));
        }, 45000);

        pendingRequests.set(rpcId, (response) => {
          clearTimeout(timer);
          ws.send(JSON.stringify(response));
        });
        return;
      }

      // Extension → Agent：JSON-RPC Response（有 result 或 error + id）
      if (role === 'extension' && rpcId && (msg.result !== undefined || msg.error)) {
        const pending = pendingRequests.get(rpcId);
        if (pending) {
          pendingRequests.delete(rpcId);
          pending(msg);
        }
        return;
      }

      // JSON-RPC Notification（无 id，如 system.ping / system.register）
      if (role === 'agent' && msg.method && !rpcId) {
        if (msg.method === 'system.ping') {
          ws.send(JSON.stringify({ jsonrpc: '2.0', result: { pong: true, timestamp: Date.now() }, id: rpcId }));
          return;
        }
        // 其他 notification 转发给 extension
        if (extensionWs?.readyState === WebSocket.OPEN) {
          extensionWs.send(JSON.stringify(msg));
        }
        return;
      }

      // 未处理的 JSON-RPC 消息
      if (rpcId) {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method not found or invalid role: ${msg.method || 'unknown'}` },
          id: rpcId,
        }));
      }
      return;
    }

    // ═══ 旧协议兼容 ═══

    // Agent → Extension：AGENT_REQUEST
    if (msg.type === 'AGENT_REQUEST' && role === 'agent') {
      if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'AGENT_RESPONSE', task_id: taskId, status: 'error',
          data: { error: 'No extension connected' },
        }));
        return;
      }
      extensionWs.send(JSON.stringify(msg));

      const timer = setTimeout(() => {
        pendingRequests.delete(taskId);
        ws.send(JSON.stringify({
          type: 'AGENT_RESPONSE', task_id: taskId, status: 'error',
          data: { error: 'Extension timeout after 45s' },
        }));
      }, 45000);

      pendingRequests.set(taskId, (response) => {
        clearTimeout(timer);
        ws.send(JSON.stringify(response));
      });
      return;
    }

    // Extension → Agent：AGENT_RESPONSE
    if (msg.type === 'AGENT_RESPONSE' && role === 'extension') {
      const pending = pendingRequests.get(taskId);
      if (pending) {
        pendingRequests.delete(taskId);
        pending(msg);
      }
      return;
    }

    // ping/pong (旧协议)
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      return;
    }

    // 未处理
    ws.send(JSON.stringify({ type: 'error', message: `Unhandled: ${msg.type}` }));
  });

  // ── 断开 ──
  ws.on('close', () => {
    clients.delete(ws);
    if (role === 'extension') {
      extensionWs = null;
      log('Extension disconnected');
      broadcastAgents({ type: 'extension_status', connected: false });
      // 清理 pending
      for (const [id, resolve] of pendingRequests) {
        resolve({
          type: 'AGENT_RESPONSE', task_id: id, status: 'error',
          data: { error: 'Extension disconnected' },
        });
      }
      pendingRequests.clear();
    } else {
      log(`Agent disconnected: ${clientId}`);
    }
  });

  ws.on('error', (err) => {
    log(`WS error (${clientId}): ${err.message}`);
  });
});

// ── 广播给所有 Agent ──
function broadcastAgents(msg) {
  const json = JSON.stringify(msg);
  for (const [, info] of clients) {
    if (info.role === 'agent' && info.ws.readyState === WebSocket.OPEN) {
      info.ws.send(json);
    }
  }
}

// ── 状态查询：HTTP health check ──
createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    clients: clients.size,
    extensionConnected: extensionWs !== null,
    pendingRequests: pendingRequests.size,
    uptime: process.uptime(),
  }));
}).listen(9528, HOST, () => {
  log(`Health check: http://${HOST}:9528`);
});

// ── 优雅退出 ──
process.on('SIGINT', () => {
  log('Shutting down...');
  wss.close();
  process.exit(0);
});

log('Logexus Daemon started');
