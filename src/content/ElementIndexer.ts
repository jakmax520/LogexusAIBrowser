// ── 交互元素索引注入 ──

import type { InteractiveElement } from './DOMReducer';

const AGENT_ID_ATTR = 'data-agent-id';

/**
 * 为 DOM 中筛选出的元素注入 data-agent-id 属性，支持 CSS 选择器精确定位。
 */
export function injectIndex(elements: InteractiveElement[]): void {
  // 清除旧索引
  document.querySelectorAll(`[${AGENT_ID_ATTR}]`).forEach((el) => {
    el.removeAttribute(AGENT_ID_ATTR);
  });

  // 注入新索引
  elements.forEach((elm) => {
    // 按 tag + text + placeholder 反向查找
    const candidates = Array.from(
      document.querySelectorAll(elm.tag)
    ) as HTMLElement[];

    // 优先 text 匹配，其次 placeholder
    let match: HTMLElement | null = null;

    if (elm.text) {
      match = candidates.find(
        (e) =>
          (e.textContent || '').replace(/\s+/g, ' ').trim().startsWith(elm.text)
      ) || null;
    }

    if (!match && elm.placeholder) {
      match = candidates.find(
        (e) => e.getAttribute('placeholder') === elm.placeholder
      ) || null;
    }

    if (!match && elm.ariaLabel) {
      match = candidates.find(
        (e) => e.getAttribute('aria-label') === elm.ariaLabel
      ) || null;
    }

    if (match) {
      match.setAttribute(AGENT_ID_ATTR, elm.id);
    }
  });
}

/**
 * 根据 ID 查询注入索引的元素
 */
export function findByAgentId(id: number | string): HTMLElement | null {
  return document.querySelector(`[${AGENT_ID_ATTR}="el_${id}"]`);
}
