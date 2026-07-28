// ── DOM 降噪与可见性计算 ──

const INTERACTIVE_TAGS = new Set([
  'a', 'button', 'input', 'textarea', 'select',
]);

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'combobox', 'listbox',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option',
  'radio', 'checkbox', 'switch', 'tab', 'searchbox',
]);

const MAX_ELEMENTS = 80;

export interface InteractiveElement {
  id: string;
  tag: string;
  text: string;
  type: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  inViewport: boolean;
}

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;

  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isInViewport(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.left >= 0 &&
    rect.right <= window.innerWidth
  );
}

function isInteractive(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (el.hasAttribute('onclick')) return true;
  if (el.getAttribute('contenteditable') === 'true') return true;

  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;

  return false;
}

function trimText(text: string | null, maxLen = 60): string {
  if (!text) return '';
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) + '...' : cleaned;
}

export function reduceDOM(): InteractiveElement[] {
  const candidates = Array.from(
    document.querySelectorAll('a, button, input, textarea, select, [role], [onclick], [contenteditable="true"]')
  ) as HTMLElement[];

  const visible = candidates.filter((el) => isVisible(el) && isInteractive(el));

  // 按可见性排序：视口内优先
  visible.sort((a, b) => {
    const aIn = isInViewport(a) ? 0 : 1;
    const bIn = isInViewport(b) ? 0 : 1;
    return aIn - bIn;
  });

  const limited = visible.slice(0, MAX_ELEMENTS);

  return limited.map((el, i) => ({
    id: `el_${i}`,
    tag: el.tagName.toLowerCase(),
    text: trimText(el.textContent) || trimText((el as HTMLInputElement).value),
    type: el.getAttribute('type') || null,
    placeholder: el.getAttribute('placeholder') || null,
    ariaLabel: el.getAttribute('aria-label') || null,
    inViewport: isInViewport(el),
  }));
}
