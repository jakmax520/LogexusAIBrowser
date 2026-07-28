// ── Content Script 入口 — 纯执行器 ──

import { reduceDOM } from './DOMReducer';
import { injectIndex } from './ElementIndexer';
import {
  navigateAction,
  clickAction,
  typeAction,
  scrollAction,
  extractAction,
} from './ActionExecutor';
import { waitForStable } from './MutationWatcher';
import {
  MSG_OBSERVE,
  MSG_EXECUTE,
  MSG_PING,
  MSG_PONG,
  MSG_OBSERVE_RESULT,
  MSG_EXECUTE_RESULT,
} from '../shared/messages';
import type { PageState, ActionResult } from '../shared/types';

// ── 心跳 ──
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === MSG_PING) {
    sendResponse({ type: MSG_PONG });
    return true;
  }
  return false;
});

// ── SW 长连接 ──
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'logexus-cs') return;

  port.onMessage.addListener(async (msg) => {
    switch (msg.type) {
      // ── OBSERVE: 采集页面状态 ──
      case MSG_OBSERVE: {
        const elements = reduceDOM();
        injectIndex(elements);

        const pageState: PageState = {
          url: window.location.href,
          title: document.title,
          elements,
        };

        port.postMessage({
          type: MSG_OBSERVE_RESULT,
          payload: pageState,
        });
        break;
      }

      // ── EXECUTE: 执行动作 ──
      case MSG_EXECUTE: {
        const { action, targetId, value } = msg.payload;
        let result: ActionResult;

        switch (action) {
          case 'navigate':
            result = navigateAction(value as string);
            break;
          case 'click':
            result = clickAction(Number(targetId?.replace('el_', '')));
            break;
          case 'type':
            result = typeAction(Number(targetId?.replace('el_', '')), value as string);
            break;
          case 'scroll':
            result = scrollAction(value as 'up' | 'down');
            break;
          case 'extract':
            result = extractAction(value as string);
            break;
          default:
            result = { success: false, error: `Unknown action: ${action}` };
        }

        // 等待 DOM 稳定
        if (result.success) {
          await waitForStable();
        }

        result.newUrl = window.location.href;
        result.domChanged = true;

        // 附带最新页面状态
        const elements = reduceDOM();
        injectIndex(elements);

        port.postMessage({
          type: MSG_EXECUTE_RESULT,
          payload: {
            result,
            pageState: {
              url: window.location.href,
              title: document.title,
              elements,
            },
          },
        });
        break;
      }
    }
  });
});
