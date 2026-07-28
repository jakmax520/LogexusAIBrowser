// ── Logexus AI Browser — 消息协议常量 ──

// ── 外部 Agent ↔ 扩展 (通过 chrome.runtime.sendMessage) ──
export const MSG_AGENT_REQUEST = 'AGENT_REQUEST';
export const MSG_AGENT_RESPONSE = 'AGENT_RESPONSE';

// ── SW → Content Script ──
export const MSG_OBSERVE = 'LOGEXUS:OBSERVE';
export const MSG_EXECUTE = 'LOGEXUS:EXECUTE';
export const MSG_PING = 'LOGEXUS:PING';
export const MSG_PONG = 'LOGEXUS:PONG';

// ── Content Script → SW ──
export const MSG_OBSERVE_RESULT = 'LOGEXUS:OBSERVE_RESULT';
export const MSG_EXECUTE_RESULT = 'LOGEXUS:EXECUTE_RESULT';

// ── SW → Side Panel ──
export const MSG_AUTH_REQUEST = 'LOGEXUS:AUTH_REQUEST';
export const MSG_AUDIT_LOG = 'LOGEXUS:AUDIT_LOG';
export const MSG_CONNECTION_STATUS = 'LOGEXUS:CONNECTION_STATUS';

// ── Side Panel → SW ──
export const MSG_AUTH_RESPONSE = 'LOGEXUS:AUTH_RESPONSE'; // { requestId, approved: boolean }
