// ── 6 种原子操作执行器 ──

import { findByAgentId } from './ElementIndexer';

// ── 导航 ──
export function navigateAction(url: string): { success: boolean; newUrl: string } {
  window.location.href = url;
  return { success: true, newUrl: url };
}

// ── 点击 ──
export function clickAction(elementId: number): { success: boolean; error?: string } {
  const el = findByAgentId(elementId);
  if (!el) {
    return { success: false, error: `Element el_${elementId} not found` };
  }

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // 等待滚动完成后触发点击
  setTimeout(() => {
    (el as HTMLElement).click();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, 200);

  return { success: true };
}

// ── 输入 ──
export function typeAction(elementId: number, text: string): { success: boolean; error?: string } {
  const el = findByAgentId(elementId);
  if (!el) {
    return { success: false, error: `Element el_${elementId} not found` };
  }

  const inputEl = el as HTMLInputElement | HTMLTextAreaElement;

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  inputEl.focus();

  // 清空后赋值，确保触发 React/Vue 的响应
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, 'value'
  )?.set;
  const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype, 'value'
  )?.set;

  if (inputEl.tagName === 'INPUT' && nativeInputValueSetter) {
    nativeInputValueSetter.call(inputEl, text);
  } else if (inputEl.tagName === 'TEXTAREA' && nativeTextareaValueSetter) {
    nativeTextareaValueSetter.call(inputEl, text);
  } else {
    (inputEl as HTMLInputElement).value = text;
  }

  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));

  return { success: true };
}

// ── 滚动 ──
export function scrollAction(direction: 'up' | 'down'): { success: boolean } {
  const delta = direction === 'down' ? 300 : -300;
  window.scrollBy({ top: delta, behavior: 'smooth' });
  return { success: true };
}

// ── 数据提取 ──
export function extractAction(selector: string): { success: boolean; data: string[]; error?: string } {
  try {
    const elements = document.querySelectorAll(selector);
    const data = Array.from(elements).map((el) => el.textContent?.trim() || '');
    return { success: true, data };
  } catch {
    return { success: false, data: [], error: `Invalid selector: ${selector}` };
  }
}

// ── 等待 ──
export function waitAction(ms: number): Promise<{ success: boolean }> {
  const capped = Math.min(ms, 10000);
  return new Promise((resolve) => {
    setTimeout(() => resolve({ success: true }), capped);
  });
}
