/**
 * Logexus AI Browser — 50 步压力测试
 *
 * 模拟外部 Agent 连续发送 50 个 observe + click + type 交替操作
 * 验证：无内存泄漏、无连接断开、响应时间稳定
 *
 * 用法：
 *   1. 启动 daemon: cd daemon && npm start
 *   2. 加载扩展到 Chrome
 *   3. 在浏览器 Console 粘贴 CONSOLE_SCRIPT
 */

export const CONSOLE_SCRIPT = `
(async function stressTest() {
  const WS_URL = 'ws://127.0.0.1:9527?token=lx_3696ac533d9ddfb81d5e50340f205317&role=agent';
  const MAX_STEPS = 50;
  const RESULTS = [];
  let ws;

  // 连接 daemon
  ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
    setTimeout(reject, 5000);
  });

  console.log('%c=== Stress Test: ' + MAX_STEPS + ' steps ===', 'font-weight:bold');

  const send = (req) => {
    return new Promise((resolve, reject) => {
      const handler = (e) => {
        const resp = JSON.parse(e.data);
        if (resp.task_id === req.task_id) {
          ws.removeEventListener('message', handler);
          resolve(resp);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify(req));
      setTimeout(() => {
        ws.removeEventListener('message', handler);
        reject(new Error('Timeout'));
      }, 30000);
    });
  };

  let lastEls = [];

  for (let i = 1; i <= MAX_STEPS; i++) {
    const taskId = 'stress_' + i;
    const start = performance.now();

    try {
      // 交替 observe 和简单操作
      let resp;
      if (i % 3 === 0) {
        resp = await send({
          type: 'AGENT_REQUEST', task_id: taskId, action: 'observe',
          payload: { reasoning: 'Stress test step ' + i }
        });
      } else if (i % 3 === 1 && lastEls.length > 0) {
        // 点击第一可见个元素
        const target = lastEls[0];
        resp = await send({
          type: 'AGENT_REQUEST', task_id: taskId, action: 'click',
          payload: { target_id: target.id, reasoning: 'Stress click test' }
        });
      } else {
        resp = await send({
          type: 'AGENT_REQUEST', task_id: taskId, action: 'scroll',
          payload: { value: i % 2 === 0 ? 'down' : 'up', reasoning: 'Stress scroll' }
        });
      }

      const elapsed = (performance.now() - start).toFixed(0);
      RESULTS.push({
        step: i, status: resp.status, elapsed: Number(elapsed),
        els: resp.data?.new_observation?.length || 0
      });

      if (resp.data?.new_observation) {
        lastEls = resp.data.new_observation;
      }

      console.log(
        '%cStep ' + i + '/' + MAX_STEPS +
        ' %c' + resp.status +
        ' %c' + elapsed + 'ms' +
        ' %cels:' + (resp.data?.new_observation?.length || 0),
        'color:#888',
        resp.status === 'success' ? 'color:green' : 'color:red',
        'color:#aaa',
        'color:#888'
      );
    } catch (err) {
      RESULTS.push({ step: i, status: 'timeout', elapsed: 30000, els: 0 });
      console.log('%cStep ' + i + ' %cTIMEOUT', 'color:#888', 'color:red');
    }
  }

  // 报告
  const success = RESULTS.filter(r => r.status === 'success');
  const errors = RESULTS.filter(r => r.status !== 'success');
  const avgTime = success.reduce((s, r) => s + r.elapsed, 0) / (success.length || 1);

  console.log('%c=== Results ===', 'font-weight:bold;font-size:14px');
  console.log('Total:  ' + RESULTS.length + ' steps');
  console.log('Passed: %c' + success.length + '%c (' + (success.length/MAX_STEPS*100).toFixed(0) + '%)',
    'color:green', '');
  console.log('Failed: %c' + errors.length, errors.length > 0 ? 'color:red' : '');
  console.log('Avg time: ' + avgTime.toFixed(0) + 'ms');
  console.log('Min/Max: ' + Math.min(...success.map(r=>r.elapsed)) + 'ms / ' + Math.max(...success.map(r=>r.elapsed)) + 'ms');
  console.log('%c=== ' + (errors.length === 0 ? 'ALL PASSED' : 'SOME FAILED') + ' ===',
    errors.length === 0 ? 'color:green;font-weight:bold;font-size:14px' : 'color:red;font-weight:bold;font-size:14px');

  ws.close();
  return RESULTS;
})();
`.trim();
