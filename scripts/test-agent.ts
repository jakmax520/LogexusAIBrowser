/**
 * Logexus AI Browser — 外部 Agent 模拟测试脚本
 *
 * 用法：
 *   1. 在 Chrome 中加载扩展
 *   2. 打开任意网页（如 https://www.google.com）
 *   3. 在浏览器 Console 中运行此脚本，或通过 Node.js + Puppeteer 调用
 *
 * 本脚本模拟外部 AI Agent 向扩展发送 AGENT_REQUEST 并接收 AGENT_RESPONSE。
 */

import type { AgentRequest, AgentResponse } from '../src/shared/types';

// ── 模拟 Agent 请求 ──
const EXTENSION_ID = 'YOUR_EXTENSION_ID'; // chrome://extensions 中查看

// 测试任务序列：Google 搜索 "OpenAI"
const testSequence: AgentRequest[] = [
  {
    type: 'AGENT_REQUEST',
    task_id: 'test_001',
    action: 'observe',
    payload: {
      reasoning: '首先观察页面，识别搜索框',
    },
  },
  {
    type: 'AGENT_REQUEST',
    task_id: 'test_002',
    action: 'type',
    payload: {
      target_id: 'el_0',
      value: 'OpenAI',
      reasoning: '在搜索框中输入 OpenAI',
    },
  },
  {
    type: 'AGENT_REQUEST',
    task_id: 'test_003',
    action: 'observe',
    payload: {
      reasoning: '确认输入成功，查找搜索按钮',
    },
  },
  {
    type: 'AGENT_REQUEST',
    task_id: 'test_004',
    action: 'extract',
    payload: {
      value: 'h3',
      reasoning: '提取搜索结果标题',
    },
  },
];

async function runTest() {
  console.log('[Test Agent] Starting test sequence...\n');

  for (const req of testSequence) {
    console.log(`[Agent] → ${req.action} (${req.task_id})`);
    if (req.payload.reasoning) {
      console.log(`  Reasoning: ${req.payload.reasoning}`);
    }

    try {
      const response: AgentResponse = await chrome.runtime.sendMessage(
        EXTENSION_ID,
        req
      );

      console.log(`[Agent] ← ${response.status}`);
      if (response.data.action_result) {
        console.log(`  Result: ${response.data.action_result}`);
      }
      if (response.data.current_url) {
        console.log(`  URL: ${response.data.current_url}`);
      }
      if (response.data.new_observation) {
        console.log(`  Elements: ${response.data.new_observation.length}`);
        // 只打印前 5 个元素
        for (const el of response.data.new_observation.slice(0, 5)) {
          console.log(`    [${el.id}] <${el.tag}> "${el.text}"`);
        }
      }
      if (response.data.error) {
        console.log(`  Error: ${response.data.error}`);
      }

      // 模拟 Agent 思考延迟
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(`  Failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    console.log('');
  }

  console.log('[Test Agent] Test sequence completed.');
}

// ── 直接在浏览器 Console 运行 ──
// 将 EXTENSION_ID 替换为你的扩展 ID 后，复制以下代码到 Console：

export function consoleScript(): string {
  return `
(async function testAgent() {
  const EXT_ID = '${EXTENSION_ID}';
  const send = (req) => chrome.runtime.sendMessage(EXT_ID, req);

  console.log('=== Step 1: Observe ===');
  let res = await send({
    type: 'AGENT_REQUEST', task_id: 'test_001', action: 'observe',
    payload: { reasoning: 'Observe the page' }
  });
  console.log('Response:', res.status);
  console.log('Elements found:', res.data.new_observation?.length);

  // 找到搜索框
  const searchInput = res.data.new_observation?.find(
    el => el.tag === 'input' && el.type === 'search'
  );
  if (searchInput) {
    console.log('Found search input:', searchInput.id);

    console.log('=== Step 2: Type ===');
    res = await send({
      type: 'AGENT_REQUEST', task_id: 'test_002', action: 'type',
      payload: { target_id: searchInput.id, value: 'OpenAI', reasoning: 'Type search query' }
    });
    console.log('Type result:', res.status);
  }

  console.log('=== Step 3: Observe again ===');
  res = await send({
    type: 'AGENT_REQUEST', task_id: 'test_003', action: 'observe',
    payload: { reasoning: 'Re-observe after typing' }
  });
  console.log('Updated elements:', res.data.new_observation?.length);
})();
`.trim();
}

// 打印可用脚本
console.log('=== Browser Console Test Script ===');
console.log(consoleScript());

// 如果直接在 Node.js 中运行，自动执行测试
if (typeof chrome !== 'undefined') {
  runTest();
}
