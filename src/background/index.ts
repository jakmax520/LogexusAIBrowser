// ── Service Worker — API 网关 + 多 Tab + 安全授权 + WS + CDP ──

import {
  MSG_AGENT_REQUEST,
  MSG_OBSERVE,
  MSG_EXECUTE,
  MSG_AUTH_REQUEST,
  MSG_AUDIT_LOG,
  MSG_CONNECTION_STATUS,
  MSG_CAPTCHA_ALERT,
  MSG_PING,
  MSG_PONG,
} from '../shared/messages';
import type {
  AgentRequest,
  AgentResponse,
  InteractiveElement,
} from '../shared/types';
import {
  startRecording,
  finishRecording,
  loadMacros,
  deleteMacro,
} from './MacroEngine';

// ── 状态 ──
const connectedTabs = new Set<number>();
let currentTabId: number | null = null;
const uiPorts = new Set<chrome.runtime.Port>();
let auditIdCounter = 0;
let authRequired = false; // TODO: 上线前改回 true
let sessionAuthorized = false;

// ── sendMessage 工具函数 ──
function sendToTab(tabId: number, msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(resp as Record<string, unknown> || null);
      }
    });
  });
}

// ── 初始化当前 Tab ──
async function activateCurrentTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  currentTabId = tab.id;

  // 等待 CS 就绪（最多 5 秒）
  for (let i = 0; i < 10; i++) {
    const resp = await sendToTab(tab.id, { type: MSG_PING });
    if (resp?.type === MSG_PONG) {
      connectedTabs.add(tab.id);
      broadcast(MSG_CONNECTION_STATUS, {
        connected: true, tabCount: connectedTabs.size, currentTabId: tab.id, url: tab.url,
      });
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ── UI 连接 ──
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'logexus-ui') {
    uiPorts.add(port);
    port.onDisconnect.addListener(() => uiPorts.delete(port));
    port.postMessage({
      type: MSG_CONNECTION_STATUS,
      payload: { connected: connectedTabs.size > 0, tabCount: connectedTabs.size, currentTabId },
    });
  }
});

function broadcast(type: string, payload: unknown): void {
  for (const port of uiPorts) {
    try { port.postMessage({ type, payload }); } catch { uiPorts.delete(port); }
  }
}

// ── 外部 Agent 入口 ──
chrome.runtime.onMessageExternal.addListener((req: AgentRequest, _sender, sendResponse) => {
  handleAgentRequest(req).then(sendResponse);
  return true;
});
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req.type === MSG_AGENT_REQUEST) {
    handleAgentRequest(req as AgentRequest).then(sendResponse);
    return true;
  }
  return false;
});

// ═══════════════════════════════════════════
// 核心路由
// ═══════════════════════════════════════════

async function handleAgentRequest(req: AgentRequest): Promise<AgentResponse> {
  // 1. 确保 CS 就绪
  if (connectedTabs.size === 0) await activateCurrentTab();
  if (connectedTabs.size === 0) {
    return { type: 'AGENT_RESPONSE', task_id: req.task_id, status: 'error', data: { error: 'No active tab' } };
  }

  // 2. navigate newtab
  if (req.action === 'navigate' && req.payload.value?.startsWith('newtab:')) {
    return handleNewTab(req);
  }

  // 3. 授权
  if (req.action !== 'observe' && req.action !== 'screenshot' && authRequired && !sessionAuthorized) {
    const approved = await requestAuth(req);
    if (!approved) {
      emitAudit(req, 'blocked', 'Authorization denied');
      return { type: 'AGENT_RESPONSE', task_id: req.task_id, status: 'blocked', data: { action_result: 'User denied authorization' } };
    }
    sessionAuthorized = true;
  }

  // 4. 路由
  if (req.action === 'observe') return handleObserve(req);
  if (req.action === 'screenshot') return handleScreenshot(req);
  return handleExecute(req);
}

// ═══════════════════════════════════════════
// OBSERVE
// ═══════════════════════════════════════════

async function handleObserve(req: AgentRequest): Promise<AgentResponse> {
  const tabId = currentTabId!;
  const resp = await sendToTab(tabId, { type: MSG_OBSERVE });
  if (!resp || resp.error) {
    return { type: 'AGENT_RESPONSE', task_id: req.task_id, status: 'error', data: { error: (resp?.error as string) || 'Observe failed' } };
  }
  return {
    type: 'AGENT_RESPONSE', task_id: req.task_id, status: 'success',
    data: { action_result: 'Page observed', current_url: resp.url as string, new_observation: resp.elements as InteractiveElement[] },
  };
}

// ═══════════════════════════════════════════
// EXECUTE
// ═══════════════════════════════════════════

async function handleExecute(req: AgentRequest): Promise<AgentResponse> {
  const tabId = currentTabId!;
  const navigating = req.action === 'navigate' || req.action === 'click';

  const resp = await sendToTab(tabId, {
    type: MSG_EXECUTE,
    action: req.action,
    targetId: req.payload.target_id,
    value: req.payload.value,
  });

  // CS 未响应 → 可能是页面导航导致 CS 卸载
  if (!resp && navigating) {
    await waitForPageLoad(tabId);
    const obs = await sendToTab(tabId, { type: MSG_OBSERVE });
    if (obs && obs.elements) {
      const response: AgentResponse = {
        type: 'AGENT_RESPONSE', task_id: req.task_id, status: 'success',
        data: { action_result: `${req.action} succeeded`, current_url: obs.url as string, new_observation: obs.elements as InteractiveElement[] },
      };
      emitAudit(req, 'success', response.data.action_result!);
      return response;
    }
  }

  if (resp && !resp.error) {
    const response: AgentResponse = {
      type: 'AGENT_RESPONSE', task_id: req.task_id, status: 'success',
      data: { action_result: `${req.action} succeeded`, current_url: resp.url as string, new_observation: resp.elements as InteractiveElement[] },
    };
    emitAudit(req, 'success', response.data.action_result!);
    return response;
  }

  if (resp?.error && (req.action === 'click' || req.action === 'type') && (resp.error as string).includes('not found')) {
    const obs = await sendToTab(tabId, { type: MSG_OBSERVE });
    if (obs && obs.elements) {
      const candidates = (obs.elements as InteractiveElement[]).filter((e) => e.inViewport);
      if (candidates.length > 0) {
        const retryResp = await sendToTab(tabId, { type: MSG_EXECUTE, action: req.action, targetId: candidates[0].id, value: req.payload.value });
        if (retryResp && !retryResp.error) {
          const response: AgentResponse = {
            type: 'AGENT_RESPONSE', task_id: req.task_id, status: 'success',
            data: { action_result: `${req.action} succeeded (retry)`, current_url: retryResp.url as string, new_observation: retryResp.elements as InteractiveElement[] },
          };
          emitAudit(req, 'success', response.data.action_result!);
          return response;
        }
      }
    }
  }

  let screenshot: string | undefined;
  try { screenshot = await chrome.tabs.captureVisibleTab(tabId, { format: 'jpeg', quality: 70 }); } catch { /* ignore */ }
  const response: AgentResponse = {
    type: 'AGENT_RESPONSE', task_id: req.task_id, status: 'error',
    data: { error: (resp?.error as string) || 'Action failed', screenshot },
  };
  emitAudit(req, 'error', response.data.error!);
  return response;
}

// ── 等待页面加载完成 ──
function waitForPageLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const l = (tid: number, info: chrome.tabs.TabChangeInfo) => {
      if (tid === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(l); resolve(); }
    };
    chrome.tabs.onUpdated.addListener(l);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(l); resolve(); }, 15000);
  });
}

// ═══════════════════════════════════════════
// SCREENSHOT / NEWTAB / AUTH / AUDIT
// ═══════════════════════════════════════════

async function handleScreenshot(req: AgentRequest): Promise<AgentResponse> {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(currentTabId!, { format: 'jpeg', quality: 80 });
    return { type: 'AGENT_RESPONSE', task_id: req.task_id, status: 'success', data: { action_result: 'Screenshot captured', screenshot: dataUrl } };
  } catch (err) {
    return { type: 'AGENT_RESPONSE', task_id: req.task_id, status: 'error', data: { error: `Screenshot failed: ${err}` } };
  }
}

async function handleNewTab(req: AgentRequest): Promise<AgentResponse> {
  const url = req.payload.value!.replace(/^newtab:\s*/, '');
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    currentTabId = tab.id!;
    await new Promise((r) => {
      const l = (tid: number, info: chrome.tabs.TabChangeInfo) => {
        if (tid === tab.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(l); r(undefined); }
      };
      chrome.tabs.onUpdated.addListener(l);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(l); r(undefined); }, 15000);
    });
    // 等待 CS 就绪
    for (let i = 0; i < 15; i++) {
      const resp = await sendToTab(tab.id!, { type: MSG_PING });
      if (resp?.type === MSG_PONG) { connectedTabs.add(tab.id!); break; }
      await new Promise((r2) => setTimeout(r2, 500));
    }
    return handleObserve({ ...req, payload: {} });
  } catch (err) {
    return { type: 'AGENT_RESPONSE', task_id: req.task_id, status: 'error', data: { error: String(err) } };
  }
}

function requestAuth(req: AgentRequest): Promise<boolean> {
  return new Promise((resolve) => {
    broadcast(MSG_AUTH_REQUEST, { requestId: req.task_id, action: req.action, targetId: req.payload.target_id, value: req.payload.value, reasoning: req.payload.reasoning, pageUrl: '' });
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.requestId === req.task_id) { self.removeEventListener('auth:response', handler); resolve(d.approved); }
    };
    self.addEventListener('auth:response', handler);
    setTimeout(() => { self.removeEventListener('auth:response', handler); resolve(false); }, 30000);
  });
}

function emitAudit(req: AgentRequest, status: 'success' | 'error' | 'blocked', result: string): void {
  auditIdCounter++;
  broadcast(MSG_AUDIT_LOG, {
    id: auditIdCounter, timestamp: Date.now(), taskId: req.task_id, action: req.action,
    targetId: req.payload.target_id, value: req.payload.value, reasoning: req.payload.reasoning, status, result,
  });
}

// ── WebSocket ──
const DAEMON_WS = 'ws://127.0.0.1:9527';
const WS_TOKEN = 'lx_3696ac533d9ddfb81d5e50340f205317';
let daemonWs: WebSocket | null = null;

function connectDaemon(): void {
  if (daemonWs?.readyState === WebSocket.OPEN) return;
  try {
    daemonWs = new WebSocket(`${DAEMON_WS}?token=${WS_TOKEN}&role=extension&clientId=ext_${Date.now()}`);
    daemonWs.onopen = () => console.log('[SW] WebSocket connected to daemon');
    daemonWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        const type = msg.type as string;
        if (type === MSG_AGENT_REQUEST) {
          handleAgentRequest(msg as unknown as AgentRequest).then((r) => daemonWs?.send(JSON.stringify(r)));
          return;
        }
        if (type === MSG_CAPTCHA_ALERT) { broadcast(MSG_CAPTCHA_ALERT, {}); return; }
        if (type === 'LOGEXUS:RECORD_START') { startRecording(msg.name as string); return; }
        if (type === 'LOGEXUS:RECORD_STOP') { finishRecording(); return; }
        if (type === 'LOGEXUS:MACRO_LIST') { loadMacros().then((m) => daemonWs?.send(JSON.stringify({ type: 'MACRO_LIST_RESULT', macros: m }))); return; }
        if (type === 'LOGEXUS:MACRO_DELETE') { deleteMacro(msg.name as string); return; }
        if (type === 'ping') { daemonWs?.send(JSON.stringify({ type: 'pong', timestamp: Date.now() })); }
      } catch { /* ignore */ }
    };
    daemonWs.onclose = () => { daemonWs = null; setTimeout(connectDaemon, 3000); };
  } catch { setTimeout(connectDaemon, 5000); }
}

// ── Tab 事件 ──
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  currentTabId = tabId;
  sessionAuthorized = false;
  for (let i = 0; i < 10; i++) {
    const resp = await sendToTab(tabId, { type: MSG_PING });
    if (resp?.type === MSG_PONG) { connectedTabs.add(tabId); break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  broadcast(MSG_CONNECTION_STATUS, { connected: true, tabCount: connectedTabs.size, currentTabId });
});
chrome.tabs.onRemoved.addListener((tabId) => { connectedTabs.delete(tabId); if (currentTabId === tabId) currentTabId = null; });
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === 'complete') {
    connectedTabs.delete(tabId);
    sessionAuthorized = false;
    for (let i = 0; i < 10; i++) {
      const resp = await sendToTab(tabId, { type: MSG_PING });
      if (resp?.type === MSG_PONG) { connectedTabs.add(tabId); break; }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
});

// ── 启动 ──
console.log('[SW] Starting Logexus AI Browser v0.1.5...');
connectDaemon();
activateCurrentTab();
