// ── Logexus AI Browser — JSON-RPC 2.0 协议定义 ──
// 对端共识：daemon/SkillHub (ws://127.0.0.1:9527) ↔ Extension SW

import type { InteractiveElement } from './types';

// ═══════════════════════════════════════════
// JSON-RPC 2.0 核心类型
// ═══════════════════════════════════════════

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id: string;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  result: unknown;
  id: string;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  error: JsonRpcErrorBody;
  id: string;
}

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcSuccess | JsonRpcError;

// ═══════════════════════════════════════════
// Method 常量
// ═══════════════════════════════════════════

export const METHOD_BROWSER_GET_CONTEXT = 'browser.get_context';
export const METHOD_BROWSER_NAVIGATE = 'browser.navigate';
export const METHOD_BROWSER_RELOAD = 'browser.reload';
export const METHOD_BROWSER_GET_COOKIES = 'browser.get_cookies';
export const METHOD_ACTION_CLICK = 'action.click';
export const METHOD_ACTION_INPUT = 'action.input';
export const METHOD_ACTION_SCROLL = 'action.scroll';
export const METHOD_SYSTEM_PING = 'system.ping';
export const METHOD_SYSTEM_REGISTER = 'system.register';

// ═══════════════════════════════════════════
// Method → Params 参数类型映射
// ═══════════════════════════════════════════

export interface BrowserGetContextParams {
  includeScreenshot?: boolean;
}

export interface ActionClickParams {
  elementId: string;
}

export interface ActionInputParams {
  elementId: string;
  text: string;
}

export interface ActionScrollParams {
  direction: 'up' | 'down';
  distance?: number;
}

export interface BrowserNavigateParams {
  url: string;
  newTab?: boolean;
}

export interface BrowserGetCookiesParams {
  domain: string;
}

export interface SystemRegisterParams {
  sessionId: string;
  version: string;
}

// ═══════════════════════════════════════════
// Method → Result 返回类型映射
// ═══════════════════════════════════════════

export interface BrowserGetContextResult {
  url: string;
  title: string;
  elements: InteractiveElement[];
  screenshot?: string; // base64 JPEG
}

export interface BrowserGetCookiesResult {
  cookies: string; // Netscape cookie 格式，仅在本地内存流转
}

export interface ActionResult {
  success: boolean;
  url?: string;
  newObservation?: InteractiveElement[];
  error?: string;
}

export interface SystemPingResult {
  pong: true;
  timestamp: number;
}

// ═══════════════════════════════════════════
// JSON-RPC 2.0 标准 + 自定义错误码
// ═══════════════════════════════════════════

export const RPC_ERROR_CODES = {
  // 标准 JSON-RPC 2.0
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // 自定义业务错误
  NO_ACTIVE_TAB: -32000,
  ELEMENT_NOT_FOUND: -32001,
  ACTION_FAILED: -32002,
  AUTH_BLOCKED: -32003,
  CONTENT_SCRIPT_UNREACHABLE: -32004,
  TIMEOUT: -32005,
} as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[keyof typeof RPC_ERROR_CODES];

// ═══════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════

export function isJsonRpcMessage(msg: unknown): msg is JsonRpcMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return m.jsonrpc === '2.0' && typeof m.method === 'string';
}

export function isJsonRpcRequest(msg: unknown): msg is JsonRpcRequest {
  if (!isJsonRpcMessage(msg)) return false;
  const m = msg as unknown as Record<string, unknown>;
  return typeof m.id === 'string' && m.method !== undefined;
}

export function makeSuccess(id: string, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', result, id };
}

export function makeError(id: string, code: RpcErrorCode, message: string, data?: unknown): JsonRpcError {
  return { jsonrpc: '2.0', error: { code, message, data }, id };
}

// 从未知 JSON 中解析 JSON-RPC 消息
export function parseJsonRpc(raw: string): JsonRpcMessage | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (isJsonRpcMessage(obj)) return obj;
    return null;
  } catch {
    return null;
  }
}
