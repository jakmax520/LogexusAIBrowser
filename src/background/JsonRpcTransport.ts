// ── Logexus AI Browser — JSON-RPC 2.0 传输层 ──
// 封装 WebSocket 生命周期 + JSON-RPC 2.0 + MV3 保活 + 断线重连
//
// 保活三角：
//   1. chrome.alarms 每 15s — 防止 SW 被 Chrome 回收
//   2. chrome.runtime.getPlatformInfo() 每 20s — 重置 30s 空闲倒计时
//   3. WebSocket system.ping 每 20s — 检测 TCP 连接存活
//
// 重连：指数退避 1s→2s→4s→8s→16s→30s(cap)，成功后重置

import {
  parseJsonRpc,
  makeSuccess,
  makeError,
  RPC_ERROR_CODES,
  METHOD_SYSTEM_PING,
  METHOD_SYSTEM_REGISTER,
} from '../shared/jsonrpc';
import type {
  JsonRpcRequest,
  JsonRpcSuccess,
  JsonRpcError,
  SystemRegisterParams,
} from '../shared/jsonrpc';

// ── 配置常量 ──
const DAEMON_URL = 'ws://127.0.0.1:9527';
const WS_TOKEN = 'lx_3696ac533d9ddfb81d5e50340f205317';
const ALARM_NAME = 'jsonrpc-keepalive';
const PING_INTERVAL_MS = 20_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_CAP_MS = 30_000;
const STORAGE_SESSION_KEY = 'jsonrpc_sessionId';
const EXTENSION_VERSION = '0.1.5';

// ── 请求处理器类型 ──
export type RequestHandler = (
  method: string,
  params: Record<string, unknown>
) => Promise<unknown>;

// ── 遗留命令处理器（非 JSON-RPC 的旧协议消息）──
export type LegacyCommandHandler = (msg: Record<string, unknown>) => boolean; // 返回 true 表示已处理

// ── 事件回调 ──
export type ConnectionChangeCallback = (connected: boolean) => void;

// ═══════════════════════════════════════════
// JsonRpcTransport
// ═══════════════════════════════════════════

export class JsonRpcTransport {
  private ws: WebSocket | null = null;
  private handler: RequestHandler | null = null;
  private legacyHandler: LegacyCommandHandler | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private backoff = 0;
  private sessionId: string;
  private onConnectionChange: ConnectionChangeCallback | null = null;

  constructor() {
    this.sessionId = this.generateSessionId();
  }

  // ── 公开 API ──

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** 注册 JSON-RPC 请求处理器 */
  onRequest(handler: RequestHandler): void {
    this.handler = handler;
  }

  /** 注册遗留命令处理器（非 JSON-RPC 消息，如 Macro 命令、ping 等）*/
  setLegacyCommandHandler(handler: LegacyCommandHandler): void {
    this.legacyHandler = handler;
  }

  /** 注册连接状态变化回调 */
  setConnectionChangeCallback(cb: ConnectionChangeCallback): void {
    this.onConnectionChange = cb;
  }

  /** 发送请求到 daemon（Extension 作为 client 主动发请求时用） */
  sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const req: JsonRpcRequest = { jsonrpc: '2.0', method, params, id };
      this.ws.send(JSON.stringify(req));

      const timeout = setTimeout(() => {
        reject(new Error(`Request timeout: ${method}`));
      }, 30000);

      const originalOnMessage = this.ws.onmessage;
      this.ws.onmessage = (event: MessageEvent) => {
        const msg = parseJsonRpc(event.data as string);
        if (msg && 'result' in msg && msg.id === id) {
          clearTimeout(timeout);
          this.ws!.onmessage = originalOnMessage;
          resolve((msg as JsonRpcSuccess).result);
          return;
        }
        if (msg && 'error' in msg && msg.id === id) {
          clearTimeout(timeout);
          this.ws!.onmessage = originalOnMessage;
          reject((msg as JsonRpcError).error);
          return;
        }
        // 非匹配消息，交给原始处理器
        if (originalOnMessage) originalOnMessage.call(this.ws!, event);
      };
    });
  }

  /** 发送通知（无 id，不期待响应） */
  sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = { jsonrpc: '2.0' as const, method, params };
    this.ws.send(JSON.stringify(msg));
  }

  /** 建立 WebSocket 连接 + 启动保活 */
  async connect(): Promise<void> {
    // 尝试恢复 session
    await this.restoreSessionId();

    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      const clientId = `ext_${this.sessionId}`;
      this.ws = new WebSocket(
        `${DAEMON_URL}?token=${WS_TOKEN}&role=extension&clientId=${clientId}`
      );

      this.ws.onopen = () => {
        console.log('[SW] JSON-RPC transport connected');
        this.backoff = 0;
        this.startKeepAlive();
        this.registerWithDaemon();
        this.onConnectionChange?.(true);
      };

      this.ws.onmessage = (event: MessageEvent) => {
        this.handleMessage(event.data as string);
      };

      this.ws.onclose = () => {
        console.log('[SW] JSON-RPC transport closed');
        this.cleanup();
        this.onConnectionChange?.(false);
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[SW] JSON-RPC transport error:', err);
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  /** 清理所有资源 */
  disconnect(): void {
    this.cleanup();
    if (this.ws) {
      this.ws.onclose = null; // 阻止重连
      this.ws.close();
      this.ws = null;
    }
  }

  // ═══════════════════════════════════════════
  // 内部方法
  // ═══════════════════════════════════════════

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private async restoreSessionId(): Promise<void> {
    try {
      const stored = await chrome.storage.session.get(STORAGE_SESSION_KEY);
      if (stored[STORAGE_SESSION_KEY]) {
        this.sessionId = stored[STORAGE_SESSION_KEY] as string;
      } else {
        await chrome.storage.session.set({ [STORAGE_SESSION_KEY]: this.sessionId });
      }
    } catch {
      // chrome.storage.session 不可用时使用内存 sessionId
    }
  }

  private async registerWithDaemon(): Promise<void> {
    const params: SystemRegisterParams = {
      sessionId: this.sessionId,
      version: EXTENSION_VERSION,
    };
    this.sendNotification(METHOD_SYSTEM_REGISTER, params as unknown as Record<string, unknown>);
  }

  private handleMessage(raw: string): void {
    const msg = parseJsonRpc(raw);
    if (!msg) {
      // 不是 JSON-RPC 消息，尝试按旧协议处理
      this.handleLegacyMessage(raw);
      return;
    }

    if ('method' in msg) {
      // 收到的请求（daemon → extension）
      this.handleRequest(msg as JsonRpcRequest);
    }
    // 响应/错误由 sendRequest 的 Promise 处理
  }

  private async handleRequest(req: JsonRpcRequest): Promise<void> {
    // system.ping — 直接在 transport 层响应
    if (req.method === METHOD_SYSTEM_PING) {
      this.sendResponse(makeSuccess(req.id, { pong: true, timestamp: Date.now() }));
      return;
    }

    // 其他 method — 交给业务 handler
    if (!this.handler) {
      this.sendResponse(
        makeError(req.id, RPC_ERROR_CODES.INTERNAL_ERROR, 'No request handler registered')
      );
      return;
    }

    try {
      const result = await this.handler(req.method, req.params || {});
      this.sendResponse(makeSuccess(req.id, result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.sendResponse(makeError(req.id, RPC_ERROR_CODES.INTERNAL_ERROR, message));
    }
  }

  private sendResponse(res: JsonRpcSuccess | JsonRpcError): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(res));
    }
  }

  /** 兼容旧协议消息（daemon 使用 type 字段的消息） */
  private handleLegacyMessage(raw: string): void {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;

      // 优先交给遗留命令处理器（Macro、ping 等）
      if (this.legacyHandler?.(obj)) return;

      // 将旧协议 AGENT_REQUEST 包装为 JSON-RPC 请求交给 handler
      if (obj.type === 'AGENT_REQUEST' && this.handler) {
        const action = obj.action as string;
        const payload = (obj.payload || {}) as Record<string, unknown>;
        const taskId = obj.task_id as string;

        // 映射旧 action → JSON-RPC method
        const methodMap: Record<string, string> = {
          observe: 'browser.get_context',
          click: 'action.click',
          type: 'action.input',
          scroll: 'action.scroll',
          screenshot: 'browser.get_context',
        };
        const method = methodMap[action] || action;

        // 映射参数
        const params: Record<string, unknown> = {};
        if (payload.target_id) params.elementId = payload.target_id;
        if (payload.value) params.text = payload.value;

        this.handler(method, params)
          .then((result) => {
            // 包装回旧协议格式
            const response = {
              type: 'AGENT_RESPONSE',
              task_id: taskId,
              status: 'success',
              data: {
                action_result: `${action} succeeded`,
                current_url: (result as Record<string, unknown>)?.url,
                new_observation: (result as Record<string, unknown>)?.elements,
                screenshot: (result as Record<string, unknown>)?.screenshot,
              },
            };
            this.ws?.send(JSON.stringify(response));
          })
          .catch((err) => {
            this.ws?.send(
              JSON.stringify({
                type: 'AGENT_RESPONSE',
                task_id: taskId,
                status: 'error',
                data: { error: err instanceof Error ? err.message : String(err) },
              })
            );
          });
      }
    } catch {
      // 无法解析，忽略
    }
  }

  // ═══════════════════════════════════════════
  // 保活三角
  // ═══════════════════════════════════════════

  private startKeepAlive(): void {
    // 1. chrome.alarms — 每 15s 触发，防止 Chrome 终止 SW
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.25 });

    // 2. 每 20s 调用 chrome.runtime.getPlatformInfo() + 发送 system.ping
    this.keepAliveTimer = setInterval(() => {
      // 调用任意 chrome API 重置 30s 休眠倒计时
      chrome.runtime.getPlatformInfo(() => {
        // 回调即代表 API 调用成功，SW 空闲计时器已重置
      });

      // WebSocket 层心跳
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ jsonrpc: '2.0', method: METHOD_SYSTEM_PING, id: `ping_${Date.now()}` }));
      }
    }, PING_INTERVAL_MS);
  }

  // ═══════════════════════════════════════════
  // 重连
  // ═══════════════════════════════════════════

  private scheduleReconnect(): void {
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.backoff),
      RECONNECT_CAP_MS
    );
    this.backoff++;
    console.log(`[SW] JSON-RPC reconnect in ${delay}ms (attempt ${this.backoff})`);
    setTimeout(() => this.connect(), delay);
  }

  private cleanup(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
    // 不移除 alarm — SW 重启后 alarm 仍需要触发来唤醒 SW
  }
}
