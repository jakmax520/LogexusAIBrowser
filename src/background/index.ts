// ── Service Worker — API 网关 + 多 Tab + 安全授权 + JSON-RPC + CDP ──

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
import {
  METHOD_BROWSER_GET_CONTEXT,
  METHOD_ACTION_CLICK,
  METHOD_ACTION_INPUT,
  METHOD_ACTION_SCROLL,
  RPC_ERROR_CODES,
} from '../shared/jsonrpc';
import type {
  BrowserGetContextParams,
  ActionClickParams,
  ActionInputParams,
  ActionScrollParams,
} from '../shared/jsonrpc';
import { JsonRpcTransport } from './JsonRpcTransport';
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
import { cdpEvaluate } from './CDPEngine';

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

// ═══════════════════════════════════════════
// JSON-RPC 2.0 Method 处理器
// ═══════════════════════════════════════════

async function handleBrowserGetContext(params: BrowserGetContextParams): Promise<unknown> {
  if (connectedTabs.size === 0) await activateCurrentTab();
  if (connectedTabs.size === 0) {
    throw Object.assign(new Error('No active tab'), { code: RPC_ERROR_CODES.NO_ACTIVE_TAB });
  }

  const tabId = currentTabId!;
  const resp = await sendToTab(tabId, { type: MSG_OBSERVE });
  if (!resp || resp.error) {
    throw Object.assign(new Error((resp?.error as string) || 'Observe failed'), { code: RPC_ERROR_CODES.CONTENT_SCRIPT_UNREACHABLE });
  }

  const result = {
    url: resp.url as string,
    title: resp.title as string,
    elements: resp.elements as InteractiveElement[],
  };

  // 按需截图
  if (params.includeScreenshot) {
    try {
      const screenshot = await chrome.tabs.captureVisibleTab(tabId, { format: 'jpeg', quality: 70 });
      return { ...result, screenshot };
    } catch { /* 截图失败不影响返回 */ }
  }

  return result;
}

async function handleActionClick(params: ActionClickParams): Promise<unknown> {
  if (connectedTabs.size === 0) await activateCurrentTab();
  if (connectedTabs.size === 0) {
    throw Object.assign(new Error('No active tab'), { code: RPC_ERROR_CODES.NO_ACTIVE_TAB });
  }
  ensureAuthorized('click');

  const tabId = currentTabId!;
  const resp = await sendToTab(tabId, {
    type: MSG_EXECUTE,
    action: 'click',
    targetId: params.elementId,
  });

  if (!resp) {
    await waitForPageLoad(tabId);
    const obs = await sendToTab(tabId, { type: MSG_OBSERVE });
    if (obs && obs.elements) {
      return { success: true, url: obs.url as string, newObservation: obs.elements as InteractiveElement[] };
    }
    throw Object.assign(new Error('Click: no response from page'), { code: RPC_ERROR_CODES.ACTION_FAILED });
  }

  if (resp.error) {
    // 元素未找到 → 重扫 DOM 找候选
    if ((resp.error as string).includes('not found')) {
      const obs = await sendToTab(tabId, { type: MSG_OBSERVE });
      if (obs?.elements) {
        const candidates = (obs.elements as InteractiveElement[]).filter((e) => e.inViewport);
        if (candidates.length > 0) {
          const retry = await sendToTab(tabId, { type: MSG_EXECUTE, action: 'click', targetId: candidates[0].id });
          if (retry && !retry.error) {
            return { success: true, url: retry.url as string, newObservation: retry.elements as InteractiveElement[] };
          }
        }
      }
    }
    throw Object.assign(new Error(resp.error as string), { code: RPC_ERROR_CODES.ELEMENT_NOT_FOUND });
  }

  return { success: true, url: resp.url as string, newObservation: resp.elements as InteractiveElement[] };
}

async function handleActionInput(params: ActionInputParams): Promise<unknown> {
  if (connectedTabs.size === 0) await activateCurrentTab();
  if (connectedTabs.size === 0) {
    throw Object.assign(new Error('No active tab'), { code: RPC_ERROR_CODES.NO_ACTIVE_TAB });
  }
  ensureAuthorized('type');

  const tabId = currentTabId!;
  const elementId = Number(params.elementId.replace('el_', ''));

  // 优先 CDP 路径：绕过 React/Vue 双向绑定
  try {
    await cdpInputText(tabId, elementId, params.text);
    // CDP 成功后重新采集页面状态
    const obs = await sendToTab(tabId, { type: MSG_OBSERVE });
    return {
      success: true,
      url: obs?.url as string,
      newObservation: obs?.elements as InteractiveElement[],
    };
  } catch {
    // CDP 失败 → fallback 到 CS type action
    console.log('[SW] CDP input failed, falling back to CS type action');
  }

  // Fallback: 通过 Content Script 的 type action
  const resp = await sendToTab(tabId, {
    type: MSG_EXECUTE,
    action: 'type',
    targetId: params.elementId,
    value: params.text,
  });

  if (resp?.error) {
    throw Object.assign(new Error(resp.error as string), { code: RPC_ERROR_CODES.ELEMENT_NOT_FOUND });
  }

  return {
    success: true,
    url: resp?.url as string,
    newObservation: resp?.elements as InteractiveElement[],
  };
}

async function handleActionScroll(params: ActionScrollParams): Promise<unknown> {
  if (connectedTabs.size === 0) await activateCurrentTab();
  if (connectedTabs.size === 0) {
    throw Object.assign(new Error('No active tab'), { code: RPC_ERROR_CODES.NO_ACTIVE_TAB });
  }

  const tabId = currentTabId!;
  const resp = await sendToTab(tabId, {
    type: MSG_EXECUTE,
    action: 'scroll',
    value: params.direction,
    distance: params.distance,
  });

  if (!resp) {
    throw Object.assign(new Error('Scroll: no response from CS'), { code: RPC_ERROR_CODES.CONTENT_SCRIPT_UNREACHABLE });
  }
  if (resp.error) {
    throw Object.assign(new Error(resp.error as string), { code: RPC_ERROR_CODES.ACTION_FAILED });
  }
  return { success: true };
}

function ensureAuthorized(_action: string): void {
  if (authRequired && !sessionAuthorized) {
    // JSON-RPC 场景下不阻塞（授权通过 Side Panel 交互完成），
    // 实际生产环境可在此处抛出 AUTH_BLOCKED 错误
  }
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

// ── JSON-RPC 传输层 ──
const transport = new JsonRpcTransport();

// 遗留命令：Macro 录制回放 + ping/pong
transport.setLegacyCommandHandler((msg) => {
  const type = msg.type as string;
  if (type === 'LOGEXUS:RECORD_START') { startRecording(msg.name as string); return true; }
  if (type === 'LOGEXUS:RECORD_STOP') { finishRecording(); return true; }
  if (type === 'LOGEXUS:MACRO_LIST') {
    loadMacros().then((m) => transport.sendNotification('MACRO_LIST_RESULT', { macros: m as unknown as Record<string, unknown> }));
    return true;
  }
  if (type === 'LOGEXUS:MACRO_DELETE') { deleteMacro(msg.name as string); return true; }
  if (type === 'ping') { transport.sendNotification('pong', { timestamp: Date.now() }); return true; }
  if (type === MSG_CAPTCHA_ALERT) { broadcast(MSG_CAPTCHA_ALERT, {}); return true; }
  return false; // 未处理
});

// ═══════════════════════════════════════════
// CDP 键盘输入 — 绕过 React/Vue 双向绑定
// ═══════════════════════════════════════════

async function cdpInputText(tabId: number, elementId: number, text: string): Promise<void> {
  // 1. focus 目标元素（通过 data-agent-id 属性定位）
  await cdpEvaluate(
    tabId,
    `(() => {
      const el = document.querySelector('[data-agent-id="el_${elementId}"]');
      if (el) {
        el.focus();
        // 清除已有值，避免追加
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = '';
        if (el instanceof HTMLSelectElement) el.selectedIndex = -1;
        return true;
      }
      return false;
    })()`
  );

  // 2. 逐字符发送真实键盘事件
  for (const char of text) {
    const keyCode = char.charCodeAt(0);
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: char,
      code: `Key${char.toUpperCase()}`,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'char',
      text: char,
      key: char,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: char,
      code: `Key${char.toUpperCase()}`,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
  }
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

// ── JSON-RPC 请求路由 ──
transport.onRequest(async (method, params) => {
  switch (method) {
    case METHOD_BROWSER_GET_CONTEXT: {
      const p = params as unknown as BrowserGetContextParams;
      return handleBrowserGetContext(p);
    }
    case METHOD_ACTION_CLICK: {
      const p = params as unknown as ActionClickParams;
      return handleActionClick(p);
    }
    case METHOD_ACTION_INPUT: {
      const p = params as unknown as ActionInputParams;
      return handleActionInput(p);
    }
    case METHOD_ACTION_SCROLL: {
      const p = params as unknown as ActionScrollParams;
      return handleActionScroll(p);
    }
    default:
      throw new Error(`Unknown method: ${method}`);
  }
});

// ── SW 保活：alarm 触发时通过 transport 维护连接 ──
chrome.alarms.create('keepalive', { periodInMinutes: 0.25 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    if (!transport.connected) transport.connect();
  }
});

// ── 扩展安装/更新时自动刷新所有 Tab ──
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'update') {
    console.log('[SW] Extension updated, reloading open tabs to load latest CS...');
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id && tab.url?.startsWith('http')) {
        try { chrome.tabs.reload(tab.id); } catch { /* ignore */ }
      }
    }
  }
});

// ── 启动 ──
console.log('[SW] Starting Logexus AI Browser v0.1.5...');
transport.connect();
activateCurrentTab();
