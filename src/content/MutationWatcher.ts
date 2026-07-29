// ── DOM 变化监听 + 静默期判定 ──

type WatcherCallback = () => void;

let observer: MutationObserver | null = null;
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
let callback: WatcherCallback | null = null;

const SILENCE_MS = 500;

/**
 * 启动 MutationObserver，监听 DOM 变化。
 * 当 500ms 内无新变化且网络无 Pending 请求时，触发回调。
 */
export function startWatching(cb: WatcherCallback): void {
  callback = cb;

  observer = new MutationObserver(() => {
    // 每次变化重置静默计时
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (isNetworkIdle()) {
        callback?.();
      }
    }, SILENCE_MS);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'disabled', 'aria-expanded'],
  });
}

/**
 * 停止监听
 */
export function stopWatching(): void {
  observer?.disconnect();
  observer = null;
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
  callback = null;
}

/**
 * 立即触发一次回调（用于导航后等待页面稳定）
 */
const MAX_WAIT_MS = 8000;

export function waitForStable(): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      if (document.readyState === 'complete' && (isNetworkIdle() || Date.now() - started > MAX_WAIT_MS)) {
        setTimeout(resolve, SILENCE_MS);
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });
}

function isNetworkIdle(): boolean {
  // 通过 Performance API 检查是否有未完成的资源加载
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const pending = entries.some((e) => {
    // transferSize === 0 且 duration > 0 可能仍在加载
    return e.transferSize === 0 && e.duration === 0 && !e.responseEnd;
  });
  return !pending;
}
