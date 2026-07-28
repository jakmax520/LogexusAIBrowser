// ── Service Worker — 纯 API 网关 + 安全授权 ──

import {
  MSG_AGENT_REQUEST,
  MSG_OBSERVE,
  MSG_EXECUTE,
  MSG_OBSERVE_RESULT,
  MSG_EXECUTE_RESULT,
  MSG_AUTH_REQUEST,
  MSG_AUDIT_LOG,
  MSG_CONNECTION_STATUS,
  MSG_PING,
} from '../shared/messages';
import type {
  AgentRequest,
  AgentResponse,
  AuditEntry,
  AuthRequest,
  InteractiveElement,
} from '../shared/types';

// ── 状态 ──
let csPort: chrome.runtime.Port | null = null;
let uiPorts: Set<chrome.runtime.Port> = new Set();
let currentTabId: number | null = null;
let auditIdCounter = 0;

// 授权模式：true = 每步都需用户确认，false = 首次确认后信任
let authRequired = true;
let sessionAuthorized = false;

// ── 初始化：连接当前 Tab 的 Content Script ──
async function connectToTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  currentTabId = tab.id;

  try {
    csPort = chrome.tabs.connect(tab.id, { name: 'logexus-cs' });

    csPort.onMessage.addListener((msg) => {
      handleCSMessage(msg);
    });

    csPort.onDisconnect.addListener(() => {
      console.log('[SW] CS disconnected');
      csPort = null;
      broadcast(MSG_CONNECTION_STATUS, { connected: false });
    });

    broadcast(MSG_CONNECTION_STATUS, { connected: true, tabId: tab.id, url: tab.url });
  } catch (err) {
    console.error('[SW] Failed to connect CS:', err);
    // 尝试注入 Content Script
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/index.js'],
      });
      csPort = chrome.tabs.connect(tab.id, { name: 'logexus-cs' });
      csPort.onMessage.addListener((msg) => handleCSMessage(msg));
      csPort.onDisconnect.addListener(() => {
        csPort = null;
        broadcast(MSG_CONNECTION_STATUS, { connected: false });
      });
      broadcast(MSG_CONNECTION_STATUS, { connected: true, tabId: tab.id, url: tab.url });
    } catch (e) {
      console.error('[SW] CS injection failed:', e);
    }
  }
}

// ── 处理来自 Content Script 的消息 ──
function handleCSMessage(msg: { type: string; payload: unknown }): void {
  // 消息由 pending 请求的处理函数消费
  // 通过自定义事件转发给等待中的 Promise
  const event = new CustomEvent(`cs:${msg.type}`, { detail: msg.payload });
  self.dispatchEvent(event);
}

// ── Side Panel 连接管理 ──
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'logexus-ui') {
    uiPorts.add(port);

    port.onMessage.addListener((msg) => {
      if (msg.type === 'LOGEXUS:AUTH_RESPONSE') {
        const event = new CustomEvent('auth:response', {
          detail: { requestId: msg.payload.requestId, approved: msg.payload.approved },
        });
        self.dispatchEvent(event);
      }
    });

    port.onDisconnect.addListener(() => {
      uiPorts.delete(port);
    });

    // 发送当前连接状态
    port.postMessage({
      type: MSG_CONNECTION_STATUS,
      payload: { connected: csPort !== null, tabId: currentTabId },
    });
  }
});

// ── 广播到所有 UI ──
function broadcast(type: string, payload: unknown): void {
  for (const port of uiPorts) {
    try {
      port.postMessage({ type, payload });
    } catch {
      uiPorts.delete(port);
    }
  }
}

// ── 外部 Agent 调用入口 ──
chrome.runtime.onMessageExternal.addListener(
  (request: AgentRequest, sender, sendResponse) => {
    handleAgentRequest(request, sender).then(sendResponse);
    return true; // 异步响应
  }
);

// 也支持内部消息（开发测试用）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === MSG_AGENT_REQUEST) {
    handleAgentRequest(request as AgentRequest, sender).then(sendResponse);
    return true;
  }
  return false;
});

// ── 核心：处理 Agent 请求 ──
async function handleAgentRequest(
  req: AgentRequest,
  _sender: chrome.runtime.MessageSender
): Promise<AgentResponse> {
  // 1. 检查 CS 连接
  if (!csPort) {
    await connectToTab();
  }

  if (!csPort) {
    return {
      type: 'AGENT_RESPONSE',
      task_id: req.task_id,
      status: 'error',
      data: { error: 'No active tab connection' },
    };
  }

  // 2. 授权检查
  if (authRequired && !sessionAuthorized) {
    const authReq: AuthRequest = {
      requestId: req.task_id,
      action: req.action,
      targetId: req.payload.target_id,
      value: req.payload.value,
      reasoning: req.payload.reasoning,
      pageUrl: '',
    };

    broadcast(MSG_AUTH_REQUEST, authReq);

    // 等待用户确认（30s 超时）
    const approved = await waitForAuth(req.task_id);
    if (!approved) {
      const response: AgentResponse = {
        type: 'AGENT_RESPONSE',
        task_id: req.task_id,
        status: 'blocked',
        data: { action_result: 'User denied authorization' },
      };
      emitAudit(req, 'blocked', 'Authorization denied');
      return response;
    }
    sessionAuthorized = true;
  }

  // 3. 路由到操作处理
  if (req.action === 'observe') {
    return handleObserve(req);
  }

  return handleExecute(req);
}

// ── OBSERVE: 采集页面状态 ──
function handleObserve(req: AgentRequest): Promise<AgentResponse> {
  return new Promise((resolve) => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      self.removeEventListener(`cs:${MSG_OBSERVE_RESULT}`, handler);

      resolve({
        type: 'AGENT_RESPONSE',
        task_id: req.task_id,
        status: 'success',
        data: {
          action_result: 'Page observed',
          current_url: detail.url,
          new_observation: detail.elements as InteractiveElement[],
        },
      });
    };

    self.addEventListener(`cs:${MSG_OBSERVE_RESULT}`, handler);
    csPort?.postMessage({ type: MSG_OBSERVE });

    setTimeout(() => {
      self.removeEventListener(`cs:${MSG_OBSERVE_RESULT}`, handler);
      resolve({
        type: 'AGENT_RESPONSE',
        task_id: req.task_id,
        status: 'error',
        data: { error: 'Observe timed out' },
      });
    }, 15000);
  });
}

// ── EXECUTE: 执行动作 ──
function handleExecute(req: AgentRequest): Promise<AgentResponse> {
  return new Promise((resolve) => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const { result, pageState } = detail;
      self.removeEventListener(`cs:${MSG_EXECUTE_RESULT}`, handler);

      const response: AgentResponse = {
        type: 'AGENT_RESPONSE',
        task_id: req.task_id,
        status: result.success ? 'success' : 'error',
        data: {
          action_result: result.success
            ? `${req.action} succeeded`
            : result.error || 'Action failed',
          current_url: pageState.url,
          new_observation: pageState.elements as InteractiveElement[],
          error: result.error,
        },
      };

      emitAudit(req, response.status, response.data.action_result!);
      resolve(response);
    };

    self.addEventListener(`cs:${MSG_EXECUTE_RESULT}`, handler);

    csPort?.postMessage({
      type: MSG_EXECUTE,
      payload: {
        action: req.action,
        targetId: req.payload.target_id,
        value: req.payload.value,
      },
    });

    setTimeout(() => {
      self.removeEventListener(`cs:${MSG_EXECUTE_RESULT}`, handler);
      resolve({
        type: 'AGENT_RESPONSE',
        task_id: req.task_id,
        status: 'error',
        data: { error: 'Action timed out after 30s' },
      });
    }, 30000);
  });
}

// ── 授权等待 ──
function waitForAuth(requestId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail.requestId === requestId) {
        self.removeEventListener('auth:response', handler);
        resolve(detail.approved);
      }
    };
    self.addEventListener('auth:response', handler);

    setTimeout(() => {
      self.removeEventListener('auth:response', handler);
      resolve(false);
    }, 30000);
  });
}

// ── 审计日志 ──
function emitAudit(req: AgentRequest, status: 'success' | 'error' | 'blocked', result: string): void {
  auditIdCounter++;
  const entry: AuditEntry = {
    id: auditIdCounter,
    timestamp: Date.now(),
    taskId: req.task_id,
    action: req.action,
    targetId: req.payload.target_id,
    value: req.payload.value,
    reasoning: req.payload.reasoning,
    status,
    result,
  };

  broadcast(MSG_AUDIT_LOG, entry);
}

// ── 心跳：每 5 秒检查 CS 存活 ──
setInterval(async () => {
  if (csPort) {
    try {
      csPort.postMessage({ type: MSG_PING });
    } catch {
      csPort = null;
      broadcast(MSG_CONNECTION_STATUS, { connected: false });
    }
  }
}, 5000);

// ── Tab 切换自动重连 ──
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  currentTabId = activeInfo.tabId;
  csPort?.disconnect();
  csPort = null;
  sessionAuthorized = false;
  await connectToTab();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (tabId === currentTabId && changeInfo.status === 'complete') {
    // 页面刷新后重连
    csPort?.disconnect();
    csPort = null;
    sessionAuthorized = false;
    await connectToTab();
  }
});

// ── 启动时连接 ──
connectToTab();
