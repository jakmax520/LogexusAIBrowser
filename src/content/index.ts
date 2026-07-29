// ── Content Script 入口 — sendMessage 模式 ──

import { reduceDOM } from './DOMReducer';
import { injectIndex } from './ElementIndexer';
import {
  navigateAction, clickAction, typeAction, scrollAction, extractAction, waitAction,
} from './ActionExecutor';
import { waitForStable } from './MutationWatcher';
// 内联常量 — 避免 @crxjs 动态 import 分割
const MSG_OBSERVE = 'LOGEXUS:OBSERVE';
const MSG_EXECUTE = 'LOGEXUS:EXECUTE';
const MSG_PING = 'LOGEXUS:PING';
const MSG_PONG = 'LOGEXUS:PONG';
const MSG_LOGEXUS_MANAGED = 'LOGEXUS:MANAGED';

let logexusManaged = false;

// ── 验证码检测 ──
const CAPTCHA_PATTERNS = [
  'iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', 'div.g-recaptcha', 'div.h-captcha',
  '[class*="captcha"]', '[id*="captcha"]', 'img[src*="captcha"]',
];
let captchaDetected = false;

function checkCaptcha(): boolean {
  for (const sel of CAPTCHA_PATTERNS) {
    try { if (document.querySelector(sel)) return true; } catch { /* */ }
  }
  return false;
}

// ── Logexus 管理标识 — 浮动徽章 ──
function showLogexusBadge(): void {
  if (logexusManaged) return;
  logexusManaged = true;

  const badge = document.createElement('div');
  badge.id = 'logexus-badge';
  badge.innerHTML = `
    <style>
      #logexus-badge {
        all: initial;
        position: fixed;
        bottom: 12px;
        right: 12px;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 14px;
        background: rgba(0,0,0,0.82);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 12px;
        font-weight: 500;
        color: #fff;
        letter-spacing: 0.3px;
        cursor: default;
        user-select: none;
        -webkit-user-select: none;
        transition: opacity 0.3s;
        box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      }
      #logexus-badge .lx-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #10b981;
        box-shadow: 0 0 6px #10b981;
        flex-shrink: 0;
      }
      #logexus-badge .lx-text {
        white-space: nowrap;
      }
      #logexus-badge .lx-divider {
        width: 1px;
        height: 12px;
        background: rgba(255,255,255,0.2);
        flex-shrink: 0;
      }
      #logexus-badge:hover {
        opacity: 0.7;
      }
    </style>
    <span class="lx-dot"></span>
    <span class="lx-text">My Logexus Browser</span>
  `;
  document.body.appendChild(badge);
}

// ── 消息处理（sendResponse 回调模式）──
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Logexus 管理标识
  if (msg.type === MSG_LOGEXUS_MANAGED) {
    showLogexusBadge();
    return false;
  }

  // PING
  if (msg.type === MSG_PING) {
    if (checkCaptcha() && !captchaDetected) {
      captchaDetected = true;
      chrome.runtime.sendMessage({ type: 'LOGEXUS:CAPTCHA_DETECTED', payload: {} }).catch(() => {});
    }
    sendResponse({ type: MSG_PONG });
    return true;
  }

  // OBSERVE
  if (msg.type === MSG_OBSERVE) {
    try {
      const elements = reduceDOM();
      injectIndex(elements);
      sendResponse({ url: window.location.href, title: document.title, elements });
    } catch (e: unknown) {
      sendResponse({ error: e instanceof Error ? e.message : String(e), url: window.location.href, elements: [] });
    }
    return true;
  }

  // EXECUTE
  if (msg.type === MSG_EXECUTE) {
    (async () => {
      try {
      const { action, targetId, value } = msg;
      let result: { success: boolean; error?: string; data?: string[]; newUrl?: string };

      switch (action) {
        case 'navigate':
          sendResponse({ success: true, url: value });
          requestAnimationFrame(() => {
            requestAnimationFrame(() => { navigateAction(value as string); });
          });
          return;
        case 'click': {
          const elId = Number(String(targetId).replace('el_', ''));
          const el = document.querySelector(`[data-agent-id=\"el_${elId}\"]`);
          if (el && (el.tagName === 'A' || (el as HTMLButtonElement).type === 'submit')) {
            const href = (el as HTMLAnchorElement).href;
            sendResponse({ success: true, url: href || window.location.href });
            // 延迟导航：先让 sendResponse 送达，再跳转
            const dest = href && href !== window.location.href ? href : null;
            if (dest) {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => { window.location.href = dest; });
              });
            } else {
              requestAnimationFrame(() => clickAction(elId));
            }
            return;
          }
          result = clickAction(elId);
          break;
        }
        case 'type':
          result = typeAction(Number(String(targetId).replace('el_', '')), value as string);
          break;
        case 'scroll':
          result = scrollAction(value as 'up' | 'down');
          break;
        case 'extract':
          result = extractAction(value as string);
          break;
        case 'wait':
          result = await waitAction(Number(value) || 1000);
          break;
        default:
          result = { success: false, error: `Unknown action: ${action}` };
      }

      // 等待 DOM 稳定
      if (result.success && action !== 'wait' && action !== 'navigate') {
        await waitForStable();
      }

      // 重新采集页面状态
      const elements = reduceDOM();
      injectIndex(elements);

      sendResponse({
        success: result.success,
        error: result.error,
        url: window.location.href,
        title: document.title,
        elements,
        data: result.data,
      });
      } catch (e: unknown) {
        sendResponse({ error: e instanceof Error ? e.message : String(e), url: window.location.href, elements: [] });
      }
    })();
    return true; // 异步响应
  }

  return false;
});
