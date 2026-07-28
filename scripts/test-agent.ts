/**
 * Logexus AI Browser — 外部 Agent 测试脚本
 *
 * 用法一（推荐）：
 *   1. npx vite build 构建扩展
 *   2. Chrome 加载 dist/ 扩展
 *   3. 打开任意网页（如 https://www.bing.com）
 *   4. 打开 public/test-agent.html（或 dist/test-agent.html）
 *   5. 输入扩展 ID，开始测试
 *
 * 用法二：直接在浏览器 Console 粘贴以下脚本
 *   将 EXTENSION_ID 替换为你的扩展 ID
 */

// ── Console 粘贴版 ──
export const CONSOLE_SCRIPT = `
(async function test() {
  const EXT = 'YOUR_EXTENSION_ID_HERE'; // chrome://extensions 查看

  const send = (req) => chrome.runtime.sendMessage(EXT, req);

  console.log('=== Step 1: Observe ===');
  let res = await send({
    type: 'AGENT_REQUEST', task_id: 't1', action: 'observe', payload: {}
  });
  console.log(res.status, '| elements:', res.data?.new_observation?.length);

  // 打印前 5 个元素
  res.data?.new_observation?.slice(0,5).forEach(el =>
    console.log('  [' + el.id + '] <' + el.tag + '> "' + (el.text||'').slice(0,40) + '"')
  );

  // 找到搜索框
  const search = res.data?.new_observation?.find(el =>
    el.tag === 'input' && (el.type === 'search' || el.type === 'text')
  );
  if (search) {
    console.log('=== Step 2: Type into ' + search.id + ' ===');
    res = await send({
      type: 'AGENT_REQUEST', task_id: 't2', action: 'type',
      payload: { target_id: search.id, value: 'OpenAI', reasoning: '输入搜索词' }
    });
    console.log(res.status, '|', res.data?.action_result);
  }

  // 找到按钮
  const btn = res.data?.new_observation?.find(el =>
    el.tag === 'button' && /search|搜索/i.test(el.text)
  );
  if (btn) {
    console.log('=== Step 3: Click ' + btn.id + ' ===');
    res = await send({
      type: 'AGENT_REQUEST', task_id: 't3', action: 'click',
      payload: { target_id: btn.id, reasoning: '点击搜索按钮' }
    });
    console.log(res.status, '|', res.data?.action_result);
  }

  console.log('=== Done ===');
})();
`.trim();
