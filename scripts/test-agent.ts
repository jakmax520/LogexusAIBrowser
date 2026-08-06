/**
 * Logexus AI Browser — 外部 Agent 测试脚本
 *
 * ⚠️ v0.2.1 起扩展移除了 `externally_connectable` 与 `onMessageExternal` 网页直连入口
 * （安全修复：任何网站可伪造 __auth_approved 绕过授权）。外部 Agent 一律通过
 * 本地 daemon（ws://127.0.0.1:9527?role=agent）走 JSON-RPC 2.0 接入。
 *
 * 用法：
 *   1. 安装 native-host 并确保 daemon 已启动（见 docs/operations.md）
 *   2. Chrome 打开任意网页（如 https://www.bing.com）
 *   3. 按 F12 → Console，粘贴下方 CONSOLE_SCRIPT 内容执行
 */

// ── Console 粘贴版 ──
export const CONSOLE_SCRIPT = `
(async function test() {
  const WS = 'ws://127.0.0.1:9527?role=agent';
  let id = 0;
  const pending = new Map();

  const ws = new WebSocket(WS);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('daemon 未连接，请先启动 native-host'));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    const cb = pending.get(msg.id);
    if (cb) { pending.delete(msg.id); cb(msg); }
  };

  const call = (method, params = {}) => new Promise((res) => {
    const rid = 't' + (++id);
    pending.set(rid, res);
    ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id: rid }));
  });

  try {
    console.log('=== Step 1: browser.get_context ===');
    let ctx = await call('browser.get_context');
    if (ctx.error) { console.error('错误:', ctx.error.message); return; }
    const els = ctx.result?.elements || [];
    console.log('elements:', els.length);
    els.slice(0, 5).forEach(el =>
      console.log('  [' + el.id + '] <' + el.tag + '> "' + (el.text||'').slice(0,40) + '"')
    );

    // 找到搜索框
    const search = els.find(el => el.tag === 'input' && (el.type === 'search' || el.type === 'text'));
    if (search) {
      console.log('=== Step 2: action.input → ' + search.id + ' ===');
      const r = await call('action.input', { elementId: search.id, text: 'OpenAI' });
      console.log('result:', r.result?.success, '|', r.result?.error || '');
    }

    // 找到搜索按钮
    let ctx2 = await call('browser.get_context');
    const btn = (ctx2.result?.elements || []).find(el => el.tag === 'button' && /search|搜索/i.test(el.text));
    if (btn) {
      console.log('=== Step 3: action.click → ' + btn.id + ' ===');
      const r = await call('action.click', { elementId: btn.id });
      console.log('result:', r.result?.success, '|', r.result?.error || '');
    }

    console.log('=== Done ===');
  } catch (e) {
    console.error('测试失败:', e.message);
  } finally {
    ws.close();
  }
})();
`.trim();
