# Logexus AI Browser — 集成指南

> ⚠️ **已废弃 (Deprecated)** — 本文档描述的是 v0.1.x 架构（基于独立 Daemon 进程）。
> 请使用新版本文档：**[integration-guide-v0.2.0.md](integration-guide-v0.2.0.md)**
>
> 主要变化：Daemon + MCP Wrapper → 单进程 Native Host（WebSocket + MCP SSE + HTTP 三合一）
>
> 本文档仅作为历史参考保留。

## 架构

```
你的应用 (Tauri/React/任何)
  └── WebSocket 客户端
        ↓ ws://localhost:9527?token=<token>&role=agent
      daemon/server.js
        ↓ WebSocket
      Chrome Extension
```

## 三步集成

### 1. 确保 daemon 在运行

```bash
cd LogexusAIBrowser/daemon
npm install && npm start
# 输出: Daemon listening on ws://127.0.0.1:9527
```

### 2. 确保扩展已加载

Chrome 加载 `dist/` 扩展，扩展 SW 自动连接 daemon。

### 3. 在应用中连接 daemon

#### React / TypeScript 示例

```typescript
// useMyBrowser.ts — 可在 Logexus Tauri 项目中直接使用
import { useState, useEffect, useRef, useCallback } from 'react';

const DAEMON_URL = 'ws://127.0.0.1:9527?token=lx_3696ac533d9ddfb81d5e50340f205317&role=agent';

interface AgentResponse {
  type: 'AGENT_RESPONSE';
  task_id: string;
  status: 'success' | 'error' | 'blocked';
  data: {
    action_result?: string;
    current_url?: string;
    new_observation?: Array<{
      id: string; tag: string; text: string; inViewport: boolean;
    }>;
    screenshot?: string;
    error?: string;
  };
}

export function useMyBrowser() {
  const [connected, setConnected] = useState(false);
  const [elements, setElements] = useState<Array<{id:string;tag:string;text:string}>>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const callbacks = useRef(new Map<string, (r: AgentResponse) => void>());

  useEffect(() => {
    const ws = new WebSocket(DAEMON_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => { setConnected(false); setTimeout(() => connect, 3000); };

    ws.onmessage = (e) => {
      const resp: AgentResponse = JSON.parse(e.data);
      const cb = callbacks.current.get(resp.task_id);
      if (cb) { callbacks.current.delete(resp.task_id); cb(resp); }

      if (resp.data.new_observation) {
        setElements(resp.data.new_observation);
      }
    };

    return () => ws.close();
  }, []);

  const send = useCallback(<T extends AgentResponse>(
    action: string, payload: Record<string, unknown> = {}
  ): Promise<T> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }
      const taskId = `task_${Date.now()}`;
      callbacks.current.set(taskId, resolve as (r: AgentResponse) => void);
      wsRef.current.send(JSON.stringify({
        type: 'AGENT_REQUEST', task_id: taskId, action, payload,
      }));
      setTimeout(() => {
        if (callbacks.current.has(taskId)) {
          callbacks.current.delete(taskId);
          reject(new Error('Timeout'));
        }
      }, 30000);
    });
  }, []);

  // 6 种工具方法
  const observe = useCallback(() => send('observe', {}), [send]);
  const click = useCallback((targetId: string) => send('click', { target_id: targetId }), [send]);
  const type = useCallback((targetId: string, value: string) => send('type', { target_id: targetId, value }), [send]);
  const navigate = useCallback((url: string) => send('navigate', { value: url }), [send]);
  const extract = useCallback((selector: string) => send('extract', { value: selector }), [send]);
  const scroll = useCallback((dir: 'up' | 'down') => send('scroll', { value: dir }), [send]);
  const screenshot = useCallback(() => send('screenshot', {}), [send]);

  return { connected, elements, observe, click, type, navigate, extract, scroll, screenshot };
}
```

#### Python 示例

```python
import json
import websocket

class MyBrowser:
    def __init__(self, url="ws://127.0.0.1:9527?token=lx_3696ac533d9ddfb81d5e50340f205317&role=agent"):
        self.ws = websocket.create_connection(url)
        self.task_counter = 0

    def _send(self, action, **payload):
        self.task_counter += 1
        task_id = f"py_{self.task_counter}"
        req = {"type": "AGENT_REQUEST", "task_id": task_id, "action": action, "payload": payload}
        self.ws.send(json.dumps(req))
        return json.loads(self.ws.recv())

    def observe(self):   return self._send("observe")
    def click(self, id): return self._send("click", target_id=id)
    def type(self, id, text): return self._send("type", target_id=id, value=text)
    def navigate(self, url):  return self._send("navigate", value=url)
    def extract(self, sel):   return self._send("extract", value=sel)
    def screenshot(self):     return self._send("screenshot")

# 使用
browser = MyBrowser()
result = browser.observe()
for el in result["data"]["new_observation"][:5]:
    print(f"[{el['id']}] <{el['tag']}> {el['text']}")
```

#### Rust / Tauri 示例

```rust
// 在 Logexus 的 Rust 后端中添加
use tokio_tungstenite::connect_async;
use futures_util::StreamExt;

async fn connect_browser() {
    let url = "ws://127.0.0.1:9527?token=lx_3696ac533d9ddfb81d5e50340f205317&role=agent";
    let (ws, _) = connect_async(url).await.unwrap();
    // 发送 AGENT_REQUEST，接收 AGENT_RESPONSE ...
}
```

## 在 Logexus UI 中添加「My Browser」按钮

在 Logexus 项目的 `src/components/` 中创建一个 `MyBrowserPanel.tsx`：

```tsx
import { useMyBrowser } from './hooks/useMyBrowser';

export function MyBrowserPanel() {
  const { connected, elements, observe, click } = useMyBrowser();

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-sm">{connected ? 'My Browser 已连接' : '未连接'}</span>
        {connected && (
          <button className="text-xs bg-indigo-500 text-white px-3 py-1 rounded" onClick={observe}>
            采集页面
          </button>
        )}
      </div>

      {/* 页面元素列表 */}
      {elements.length > 0 && (
        <div className="space-y-1">
          {elements.slice(0, 20).map(el => (
            <button
              key={el.id}
              className="w-full text-left text-xs p-2 rounded border hover:border-indigo-400"
              onClick={() => click(el.id)}
            >
              [{el.id}] &lt;{el.tag}&gt; {el.text.slice(0, 40)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

## 端到端流程示例

```
1. 用户在 Logexus 中创建任务："采集 Crunchbase 上的 AI 融资数据"
2. Logexus AI 分析任务 → 调用 LLM 规划步骤
3. Step 1: Logexus → AGENT_REQUEST { action: "navigate", value: "https://crunchbase.com" }
4. 扩展 → Chrome 跳转 → 返回 AGENT_RESPONSE { current_url: "https://crunchbase.com" }
5. Step 2: Logexus → AGENT_REQUEST { action: "observe" }
6. 扩展 → 返回 80 个交互元素的精简 DOM 树
7. Step 3: Logexus AI 分析元素 → 找到搜索框 [el_3]
8. Logexus → AGENT_REQUEST { action: "type", target_id: "el_3", value: "AI startup" }
9. Step 4-N: 循环直到任务完成
```

## daemon 生产部署

### 设为开机自启 (Windows)

```bat
schtasks /create /tn "LogexusDaemon" /tr "node D:\CCWorkSpace\LogexusAIBrowser\daemon\server.js" /sc onlogon /rl highest
```

### 自定义 Token

```bash
# 生产环境使用强随机 token，替换默认值
set LOGEXUS_TOKEN=your-secure-random-token
node daemon/server.js
```

### 绑定 127.0.0.1 安全

daemon 仅监听 `127.0.0.1`，不接受外部网络连接，确保只有本机应用可以访问。
