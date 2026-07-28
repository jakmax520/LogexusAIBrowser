// ── CDP 引擎 — chrome.debugger API 封装 ──

interface CDPResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ── 确保 Tab 已 attach CDP ──
async function ensureAttached(tabId: number): Promise<void> {
  try {
    const targets = await chrome.debugger.getTargets();
    const attached = targets.some(
      (t) => t.tabId === tabId && t.attached
    );
    if (!attached) {
      await chrome.debugger.attach({ tabId }, '1.3');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('already attached')) throw err;
  }
}

// ═══════════════════════════════════════════
// 1. evaluate — 在页面上下文执行 JS
// ═══════════════════════════════════════════

export async function cdpEvaluate(
  tabId: number,
  expression: string
): Promise<CDPResult> {
  try {
    await ensureAttached(tabId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await chrome.debugger.sendCommand(
      { tabId },
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
        timeout: 10000,
      }
    );

    if (result.exceptionDetails) {
      return {
        success: false,
        error: result.exceptionDetails.text || 'JS execution error',
        data: result.exceptionDetails,
      };
    }

    return { success: true, data: result.result };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ═══════════════════════════════════════════
// 2. network — 捕获网络请求
// ═══════════════════════════════════════════

interface NetworkEntry {
  url: string; method: string; status?: number;
  type: string; timestamp: number;
}
let networkRequests: NetworkEntry[] = [];

function networkListener(
  _source: chrome.debugger.Debuggee,
  method: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any
): void {
  if (method === 'Network.requestWillBeSent' && params?.request) {
    networkRequests.push({
      url: params.request.url,
      method: params.request.method,
      type: params.type || 'Unknown',
      timestamp: Date.now(),
    });
  }
  if (method === 'Network.responseReceived' && params?.response) {
    const existing = networkRequests.find((r) => r.url === params.response.url && !r.status);
    if (existing) existing.status = params.response.status;
  }
  if (networkRequests.length > 200) {
    networkRequests = networkRequests.slice(-200);
  }
}

export async function cdpNetworkStart(tabId: number): Promise<CDPResult> {
  try {
    await ensureAttached(tabId);
    networkRequests = [];
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
    chrome.debugger.onEvent.addListener(networkListener);
    return { success: true, data: { message: 'Network capture started' } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function cdpNetworkStop(): CDPResult {
  chrome.debugger.onEvent.removeListener(networkListener);
  const data = [...networkRequests];
  networkRequests = [];
  return { success: true, data };
}

// ═══════════════════════════════════════════
// 3. console — 捕获控制台消息
// ═══════════════════════════════════════════

interface ConsoleEntry {
  level: string; text: string; timestamp: number;
}
let consoleMessages: ConsoleEntry[] = [];

function consoleListener(
  _source: chrome.debugger.Debuggee,
  method: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any
): void {
  if (method === 'Runtime.consoleAPICalled' && params) {
    const msgs = params.args || [];
    const text = msgs.map((m: { value?: string; description?: string }) => m.value || m.description || '').join(' ');
    consoleMessages.push({
      level: params.type || 'log',
      text: text.slice(0, 500),
      timestamp: Date.now(),
    });
    if (consoleMessages.length > 200) {
      consoleMessages = consoleMessages.slice(-200);
    }
  }
}

export async function cdpConsoleStart(tabId: number): Promise<CDPResult> {
  try {
    await ensureAttached(tabId);
    consoleMessages = [];
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    chrome.debugger.onEvent.addListener(consoleListener);
    return { success: true, data: { message: 'Console capture started' } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function cdpConsoleStop(): CDPResult {
  chrome.debugger.onEvent.removeListener(consoleListener);
  const data = [...consoleMessages];
  consoleMessages = [];
  return { success: true, data };
}

// ═══════════════════════════════════════════
// 4. performance — 性能追踪
// ═══════════════════════════════════════════

let performanceTraceStarted = false;

export async function cdpPerformanceStart(tabId: number): Promise<CDPResult> {
  try {
    await ensureAttached(tabId);
    await chrome.debugger.sendCommand({ tabId }, 'Performance.enable', { timeDomain: 'threadTicks' });
    performanceTraceStarted = true;
    return { success: true, data: { message: 'Performance trace started' } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function cdpPerformanceStop(tabId: number): Promise<CDPResult> {
  try {
    if (!performanceTraceStarted) return { success: false, error: 'No active trace' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await chrome.debugger.sendCommand({ tabId }, 'Performance.getMetrics');
    performanceTraceStarted = false;
    return { success: true, data: result.metrics };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ═══════════════════════════════════════════
// 5. 清理 — detach CDP
// ═══════════════════════════════════════════

export async function cdpDetach(tabId: number): Promise<void> {
  try {
    chrome.debugger.onEvent.removeListener(networkListener);
    chrome.debugger.onEvent.removeListener(consoleListener);
    await chrome.debugger.detach({ tabId });
  } catch { /* ignore */ }
}
