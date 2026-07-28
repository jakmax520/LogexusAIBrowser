// ── 原子操作执行器（鲁棒增强版）──

import { findByAgentId } from './ElementIndexer';

// ── 导航 ──
export function navigateAction(url: string): { success: boolean; newUrl: string } {
  window.location.href = url;
  return { success: true, newUrl: url };
}

// ── 点击（修复竞态：同步执行 scrollIntoView + click）──
export function clickAction(elementId: number): { success: boolean; error?: string } {
  const el = findByAgentId(elementId);
  if (!el) {
    return { success: false, error: `Element el_${elementId} not found` };
  }

  // 检测 iframe
  const ownerDoc = el.ownerDocument;
  if (ownerDoc !== document) {
    return { success: false, error: `Element el_${elementId} is inside an iframe — not supported` };
  }

  // 同步滚动（无动画，避免竞态）
  el.scrollIntoView({ behavior: 'instant', block: 'center' });

  // 触发原生点击 + MouseEvent
  (el as HTMLElement).click();
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

  // 如果元素是链接，等待导航
  if (el.tagName === 'A' && (el as HTMLAnchorElement).href) {
    return { success: true };
  }

  // 如果是 submit 按钮，标记可能触发表单提交
  if ((el as HTMLButtonElement).type === 'submit') {
    return { success: true };
  }

  return { success: true };
}

// ── 输入（支持 input/textarea/select/contenteditable）──
export function typeAction(elementId: number, text: string): { success: boolean; error?: string } {
  const el = findByAgentId(elementId);
  if (!el) {
    return { success: false, error: `Element el_${elementId} not found` };
  }

  el.scrollIntoView({ behavior: 'instant', block: 'center' });

  const tag = el.tagName.toLowerCase();

  // SELECT 元素
  if (tag === 'select') {
    const selectEl = el as HTMLSelectElement;
    const options = Array.from(selectEl.options);
    const match = options.find(
      (o) => o.text.toLowerCase().includes(text.toLowerCase()) || o.value === text
    );
    if (match) {
      selectEl.value = match.value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      selectEl.dispatchEvent(new Event('input', { bubbles: true }));
      return { success: true };
    }
    return { success: false, error: `Option "${text}" not found in select` };
  }

  // contenteditable 元素
  if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') {
    el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  }

  // INPUT / TEXTAREA — 使用原生 setter 确保 React/Vue 响应
  const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
  (el as HTMLElement).focus();

  const nativeInputValueSetter =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  const nativeTextareaValueSetter =
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;

  if (tag === 'input' && nativeInputValueSetter) {
    nativeInputValueSetter.call(inputEl, text);
  } else if (tag === 'textarea' && nativeTextareaValueSetter) {
    nativeTextareaValueSetter.call(inputEl, text);
  } else {
    (inputEl as HTMLInputElement).value = text;
  }

  inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));

  // 触发 keyup/keydown 以确保 Angular 等框架检测
  inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
  inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

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
