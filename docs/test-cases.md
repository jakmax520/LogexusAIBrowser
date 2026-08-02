# Logexus AI Browser — 测试用例

> 适用于当前版本 (v0.2.0) 功能自测。测试环境：Chrome ≥ 114，已加载 `dist/` 扩展，Native Host 已启动。

## 前置准备

1. `npm run build` 构建扩展
2. `chrome://extensions` → 开发者模式 → 加载已解压 → 选择 `dist/`
3. 复制扩展 ID（32 位字符串）
4. 打开目标测试页面：`https://www.bing.com`
5. 新 Tab 打开 `dist/test-agent.html`，填入扩展 ID，点击连接

### Native Host 模式前置（JSON-RPC 2.0 / MCP SSE 测试用）

```bash
cd native-host && npm install && node host.js
# Native Host 启动在 http://127.0.0.1:9527，健康检查 http://127.0.0.1:9527/health
```

---

## 一、通信连接测试

### TC-01：通信连接（test-agent.html）

| 项 | 内容 |
|:--|:--|
| **前置** | 扩展已加载，test-agent.html 已打开 |
| **步骤** | 1. 输入扩展 ID<br>2. 点击「连接」<br>3. 观察连接状态 |
| **期望** | 状态显示「已连接」绿色标记；日志输出 `连接成功! status=success` |

### TC-02：Daemon WebSocket 连接

| 项 | 内容 |
|:--|:--|
| **前置** | 扩展已加载，Native Host 已启动 |
| **步骤** | 1. 运行 `python scripts/verify-ws.py`<br>2. 观察输出 |
| **期望** | (1) WebSocket 连接成功<br>(2) system.ping 返回 pong<br>(3) 无扩展连接时返回 error（"No extension connected"） |

### TC-03：JSON-RPC 2.0 — system.ping

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动，扩展已连接 |
| **步骤** | 1. 通过 WebSocket 发送 `{"jsonrpc":"2.0","method":"system.ping","id":"1"}`<br>2. 等待响应 |
| **期望** | 返回 `{"jsonrpc":"2.0","result":{"pong":true,...},"id":"1"}` |

### TC-04：JSON-RPC 2.0 — system.register

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动 |
| **步骤** | 1. 通过 WebSocket 发送 `{"jsonrpc":"2.0","method":"system.register","params":{"role":"agent"},"id":"1"}`<br>2. 等待响应 |
| **期望** | 返回注册成功确认，包含 sessionId |

### TC-05：JSON-RPC 2.0 — 无效方法

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动 |
| **步骤** | 1. 发送 `{"jsonrpc":"2.0","method":"invalid.method","id":"1"}` |
| **期望** | 返回错误码 `-32601` (METHOD_NOT_FOUND) |

---

## 二、基础操作测试（AGENT_REQUEST 协议）

### TC-10：observe — 采集页面状态

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 点击 `observe` 预设按钮<br>2. 查看日志输出 |
| **期望** | 日志输出元素数量 ≥ 1；每个元素含 `id`/`tag`/`text`/`type`/`placeholder`/`ariaLabel`/`inViewport` 字段；元素总数 ≤ 150 |

### TC-11：observe — 元素上限验证

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过，打开一个元素较多的页面（如 Bing 搜索结果页） |
| **步骤** | 1. 发送 observe<br>2. 统计返回的元素数量<br>3. 在页面 Console 执行 `document.querySelectorAll('[data-agent-id]').length` |
| **期望** | 返回元素数 = DOM 中 data-agent-id 元素数；不超过 150 个；视口内元素排在前面 |

### TC-12：type — 输入文本

| 项 | 内容 |
|:--|:--|
| **前置** | TC-10 通过，已获取搜索框元素 ID |
| **步骤** | 1. 从 observe 结果中找到搜索框 ID（`el_N`，`tag: "input"`）<br>2. 选择 action=`type`，Target ID 填入该元素 ID<br>3. Value 填入 `OpenAI`<br>4. 点击「发送」 |
| **期望** | 日志显示 `status=success`；Bing 搜索框中实际出现 "OpenAI" 文字 |

### TC-13：click — 点击元素

| 项 | 内容 |
|:--|:--|
| **前置** | TC-12 通过 |
| **步骤** | 1. 执行 observe 获取更新后的元素列表<br>2. 找到搜索按钮 ID（`tag: "button"`，含 `search` 文字）<br>3. 选择 action=`click`，Target ID 填入该元素 ID<br>4. 点击「发送」 |
| **期望** | 日志显示 `status=success`；Bing 开始搜索，页面 URL 和内容发生变化 |

### TC-14：navigate — 页面跳转

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 选择 action=`navigate`<br>2. Value 填入 `https://www.google.com`<br>3. 点击「发送」 |
| **期望** | 日志显示 `status=success`；浏览器跳转到 Google 首页；observe 结果中 URL 已变化 |

### TC-15：extract — 数据提取

| 项 | 内容 |
|:--|:--|
| **前置** | TC-14 通过（已跳转到 Google） |
| **步骤** | 1. 选择 action=`extract`<br>2. Value 填入 `h3`（提取所有三级标题）<br>3. 点击「发送」 |
| **期望** | 日志显示 `status=success`；`data` 数组包含页面所有 h3 文本内容 |

### TC-16：scroll — 页面滚动

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过，当前页面有可滚动内容 |
| **步骤** | 1. 选择 action=`scroll`<br>2. Value 填入 `down`<br>3. 点击「发送」<br>4. 再次发送 scroll，Value 填入 `up` |
| **期望** | 每次 status=success；页面实际发生滚动；滚动后 observe 结果中 `inViewport` 字段变化 |

### TC-17：screenshot — 主动截图

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 点击 `screenshot` 预设按钮<br>2. 查看日志 |
| **期望** | 日志显示 `status=success`；输出截图 base64 数据 |

### TC-18：截图自动附带 — 元素不存在

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 选择 action=`click`<br>2. Target ID 填入不存在的元素 ID，如 `el_99999`<br>3. 点击「发送」 |
| **期望** | 日志显示 `status=error`；`data.error` 包含 `Element el_99999 not found`；**`data.screenshot` 自动附带截图** |

---

## 三、JSON-RPC 2.0 操作测试

### TC-20：browser.get_context — 获取页面上下文

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动，扩展已连接，已打开 Bing |
| **步骤** | 1. 通过 WebSocket 发送 `{"jsonrpc":"2.0","method":"browser.get_context","id":"1"}`<br>2. 查看响应 |
| **期望** | 返回 `result.url`、`result.title`、`result.elements` 数组；elements 中每个元素含 id/tag/text/inViewport |

### TC-21：action.click — JSON-RPC 点击

| 项 | 内容 |
|:--|:--|
| **前置** | TC-20 通过，已获取搜索框元素 ID |
| **步骤** | 1. 发送 `{"jsonrpc":"2.0","method":"action.click","params":{"elementId":"el_N"},"id":"1"}` |
| **期望** | 返回 `result.success: true`；页面搜索框获得焦点 |

### TC-22：action.input — JSON-RPC CDP 输入

| 项 | 内容 |
|:--|:--|
| **前置** | TC-21 通过 |
| **步骤** | 1. 发送 `{"jsonrpc":"2.0","method":"action.input","params":{"elementId":"el_N","text":"OpenAI"},"id":"1"}` |
| **期望** | 返回 `result.success: true`；搜索框出现 "OpenAI"；使用 CDP 逐字符输入（绕过 React/Vue 绑定） |

### TC-23：action.scroll — JSON-RPC 滚动

| 项 | 内容 |
|:--|:--|
| **前置** | TC-20 通过 |
| **步骤** | 1. 发送 `{"jsonrpc":"2.0","method":"action.scroll","params":{"direction":"down"},"id":"1"}`<br>2. 再发送 direction=`up` |
| **期望** | 每次返回 success=true；页面实际滚动 |

### TC-24：browser.navigate — JSON-RPC 导航

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动 |
| **步骤** | 1. 发送 `{"jsonrpc":"2.0","method":"browser.navigate","params":{"url":"https://www.google.com"},"id":"1"}` |
| **期望** | 返回 success=true + newUrl；浏览器跳转到 Google；15s 内完成页面加载 |

### TC-25：browser.reload — JSON-RPC 刷新

| 项 | 内容 |
|:--|:--|
| **前置** | 已有一个活跃页面 |
| **步骤** | 1. 发送 `{"jsonrpc":"2.0","method":"browser.reload","id":"1"}` |
| **期望** | 返回 success=true + newUrl 不变；页面完成刷新 |

### TC-26：JSON-RPC 错误码 — NO_ACTIVE_TAB

| 项 | 内容 |
|:--|:--|
| **前置** | 关闭所有浏览器标签页 |
| **步骤** | 1. 发送 `{"jsonrpc":"2.0","method":"browser.get_context","id":"1"}` |
| **期望** | 返回错误码 `-32000` (NO_ACTIVE_TAB) |

### TC-27：JSON-RPC 错误码 — ELEMENT_NOT_FOUND

| 项 | 内容 |
|:--|:--|
| **前置** | 有活跃页面 |
| **步骤** | 1. 发送 `{"jsonrpc":"2.0","method":"action.click","params":{"elementId":"el_99999"},"id":"1"}` |
| **期望** | 返回错误码 `-32001` (ELEMENT_NOT_FOUND) |

---

## 四、CDP 引擎测试

### TC-30：CDP — evaluate JS 执行

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 在 test-agent 中选择 action=`evaluate`<br>2. Value 填入 `document.title`<br>3. 点击发送 |
| **期望** | 返回 `status=success`；`data.action_result` 包含页面标题 |

### TC-31：CDP — evaluate 复杂表达式

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. action=`evaluate`<br>2. Value 填入 `JSON.stringify({url:location.href,links:document.querySelectorAll('a').length})`<br>3. 点击发送 |
| **期望** | 返回 JSON 字符串，包含当前 URL 和页面链接总数 |

### TC-32：CDP — network_start / network_stop

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 发送 `network_start`<br>2. 刷新页面或点击链接触发网络请求<br>3. 发送 `network_stop` |
| **期望** | network_stop 返回请求列表，每个含 `url`/`method`/`status`/`type`/`timestamp` 字段；最多 200 条 |

### TC-33：CDP — network 空捕获

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 发送 `network_start`<br>2. 立即发送 `network_stop`（不触发任何网络请求） |
| **期望** | 返回空数组或少量已完成的请求 |

### TC-34：CDP — console_start / console_stop

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 发送 `console_start`<br>2. 在目标网页 Console 执行 `console.log('test123')`<br>3. 发送 `console_stop` |
| **期望** | console_stop 返回消息列表，包含 `{level:"log", text:"test123", timestamp}` |

### TC-35：CDP — console 多级别捕获

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 发送 `console_start`<br>2. 在目标网页执行 `console.warn('warn_msg'); console.error('err_msg')`<br>3. 发送 `console_stop` |
| **期望** | 返回列表包含 warn 和 error 级别消息；level 字段分别为 "warning" 和 "error" |

### TC-36：CDP — perf_start / perf_stop

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 发送 `perf_start`<br>2. 等待 5 秒<br>3. 发送 `perf_stop` |
| **期望** | 返回指标列表，含 JSHeapUsedSize、TaskDuration 等性能指标 |

### TC-37：CDP — cdp_detach 清理

| 项 | 内容 |
|:--|:--|
| **前置** | 执行过 CDP 操作（如 evaluate） |
| **步骤** | 1. 发送 `cdp_detach`<br>2. 再发送 `evaluate`（`document.title`） |
| **期望** | detach 返回 success；evaluate 仍正常工作（自动重新 attach） |

---

## 五、Side Panel UI 测试

### TC-40：Side Panel — 连接状态显示

| 项 | 内容 |
|:--|:--|
| **前置** | 扩展已加载 |
| **步骤** | 1. 点击工具栏扩展图标打开 Side Panel<br>2. 观察状态栏<br>3. 切换浏览器 Tab<br>4. 关闭所有 Tab 观察 |
| **期望** | 有活动 Tab 时显示「已连接」绿色圆点 + Tab 编号 + 域名 + 「已授权/待授权」徽章；无 Tab 时显示「未连接」红色圆点 |

### TC-41：Side Panel — 授权弹窗

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过，首次操作（未授权状态） |
| **步骤** | 1. 在 test-agent.html 发送任意非 observe 操作<br>2. 观察 Side Panel |
| **期望** | Side Panel 弹出琥珀色卡片，显示：操作类型 + 目标元素 + AI 思考原因；出现「允许」「拒绝」按钮 |

### TC-42：Side Panel — 授权通过后执行

| 项 | 内容 |
|:--|:--|
| **前置** | TC-41 弹出授权弹窗 |
| **步骤** | 1. 点击「允许」<br>2. 查看 test-agent.html 日志 |
| **期望** | 操作成功执行；test-agent 收到 `status=success`；授权弹窗消失；状态指示器显示「已授权」 |

### TC-43：Side Panel — 授权拒绝

| 项 | 内容 |
|:--|:--|
| **前置** | TC-41 弹出授权弹窗 |
| **步骤** | 1. 点击「拒绝」<br>2. 查看 test-agent.html 日志 |
| **期望** | test-agent 收到 `status=blocked`；操作未执行；下次操作重新触发授权弹窗 |

### TC-44：Side Panel — 审计日志展示

| 项 | 内容 |
|:--|:--|
| **前置** | 已完成若干操作 |
| **步骤** | 1. 打开 Side Panel<br>2. 滚动审计日志区域<br>3. 点击任一日志条目展开详情 |
| **期望** | 每条日志显示：时间戳 + 操作中文标签 + 状态色标（绿/琥珀/红）+ task_id；展开后显示 reasoning 和 result；最新日志在最底部；自动滚动到底部 |

### TC-45：Side Panel — 日志筛选搜索

| 项 | 内容 |
|:--|:--|
| **前置** | 已完成若干不同类型操作（observe / click / type） |
| **步骤** | 1. 在日志区筛选框输入 "click"<br>2. 观察日志列表变化<br>3. 清空筛选框 |
| **期望** | 输入 "click" 后仅显示 action=click 的日志条目；清空后恢复显示全部 |

### TC-46：Side Panel — 日志清空

| 项 | 内容 |
|:--|:--|
| **前置** | Side Panel 有若干条日志 |
| **步骤** | 1. 点击日志工具栏「清空」按钮<br>2. 关闭 Side Panel 再重新打开 |
| **期望** | 日志列表立即清空显示「等待 AI Agent 指令...」；重新打开后保持清空（IndexedDB 已清除） |

### TC-47：Side Panel — 日志导出

| 项 | 内容 |
|:--|:--|
| **前置** | Side Panel 有若干条日志 |
| **步骤** | 1. 点击日志工具栏「导出」按钮<br>2. 查看下载的 JSON 文件内容 |
| **期望** | 浏览器触发 `.json` 文件下载；文件内容为完整审计日志数组，包含 timestamp / taskId / action / status 等字段 |

### TC-48：Side Panel — 日志跨会话持久化

| 项 | 内容 |
|:--|:--|
| **前置** | 已完成若干操作，Side Panel 有日志 |
| **步骤** | 1. 关闭 Side Panel（或刷新浏览器）<br>2. 等待 5 秒<br>3. 重新打开 Side Panel |
| **期望** | 之前审计日志完整恢复；时间戳和操作详情与原来一致 |

### TC-49：Side Panel — 暗色模式切换

| 项 | 内容 |
|:--|:--|
| **前置** | 扩展已加载 |
| **步骤** | 1. 打开 Side Panel<br>2. 点击标题栏右侧 ☾ 按钮<br>3. 观察颜色变化<br>4. 关闭再打开 Side Panel |
| **期望** | 点击后切换为暗色主题（深色背景 + 浅色文字）；再次点击切换回亮色；刷新后保持用户选择（localStorage） |

### TC-50：Side Panel — 模板面板

| 项 | 内容 |
|:--|:--|
| **前置** | 扩展已加载 |
| **步骤** | 1. 打开 Side Panel<br>2. 展开「指令模板」面板<br>3. 查看模板列表 |
| **期望** | 显示 4 个预定义模板：Bing 搜索测试（4 步）、竞品融资采集（6 步）、SEO 批量查询（6 步）、CRM 数据回填（7 步）；每个模板显示名称、描述、步骤数 |

### TC-51：Side Panel — 模板选中

| 项 | 内容 |
|:--|:--|
| **前置** | TC-50 通过 |
| **步骤** | 1. 点击「Bing 搜索测试」模板<br>2. 观察界面变化 |
| **期望** | 模板被选中高亮；模板步骤被加载（应通过回调传递给外部处理） |

### TC-52：Side Panel — 底部状态栏

| 项 | 内容 |
|:--|:--|
| **前置** | 扩展已加载 |
| **步骤** | 1. 打开 Side Panel<br>2. 观察底部状态栏 |
| **期望** | 连接时显示 "API Gateway Ready"；未连接时显示 "Connecting..." |

---

## 六、标签页与内容脚本测试

### TC-60：元素索引注入 — data-agent-id

| 项 | 内容 |
|:--|:--|
| **前置** | TC-10 通过 |
| **步骤** | 1. 发送 observe<br>2. 在目标网页 F12 → Console<br>3. 执行 `document.querySelectorAll('[data-agent-id]').length` |
| **期望** | Console 输出值等于 observe 返回的元素数量；每个交互元素均有 `data-agent-id="el_N"` 属性 |

### TC-61：多 Tab — 新 Tab 打开并自动连接

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 发送 `navigate`，value=`https://www.google.com`<br>2. 观察浏览器新 Tab<br>3. 观察 Side Panel 状态栏 Tab 数量变化 |
| **期望** | 新 Tab 打开 → 自动加载 → SW 自动注入 CS 并连接 → Side Panel 显示 Tab 计数变化 |

### TC-62：多 Tab — 用户手动切换 Tab

| 项 | 内容 |
|:--|:--|
| **前置** | TC-61 通过（至少 2 个已连接 Tab） |
| **步骤** | 1. 手动点击 Chrome 标签栏切换到前一 Tab<br>2. 打开 Side Panel 观察状态变化<br>3. 发送 observe |
| **期望** | Side Panel 切换显示新活跃 Tab ID + URL；授权状态重置为「待授权」；observe 返回切换后 Tab 的页面状态 |

### TC-63：标签页分组 — "My Logexus Browser"

| 项 | 内容 |
|:--|:--|
| **前置** | 至少通过 Logexus 打开 2 个标签页 |
| **步骤** | 1. 通过 navigate 操作打开 2 个新标签页<br>2. 观察 Chrome 标签栏 |
| **期望** | Logexus 管理的标签页自动归入 "My Logexus Browser" 分组（紫色标识） |

### TC-64：浮动徽章 — "My Logexus Browser"

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 发送 observe（触发 CS 激活）<br>2. 观察目标页面右下角 |
| **期望** | 页面右下角显示 "My Logexus Browser" 浮动徽章，绿色圆点 + 模糊背景 |

### TC-65：心跳检测 — Content Script 断连自动重连

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 刷新目标网页（F5）<br>2. 等待 10 秒<br>3. 再次发送 observe |
| **期望** | 刷新后 SW 自动检测断连 → 重试注入 CS（最多 10 次）→ 恢复连接；observe 返回新页面状态 |

### TC-66：错误处理 — observe 超时（无活跃 Tab）

| 项 | 内容 |
|:--|:--|
| **前置** | 关闭所有浏览器 Tab |
| **步骤** | 1. 关闭所有 Tab<br>2. 在 test-agent.html 发送 observe |
| **期望** | 返回 `status=error`；`data.error` 包含 `No active tab` 相关信息 |

---

## 七、宏录制与回放测试

### TC-70：宏 — 开始录制

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 通过 Side Panel 或 SW 消息发送 `RECORD_START`（name="test_macro"）<br>2. 执行 observe → type → click 操作 |
| **期望** | 每个 AGENT_REQUEST 被录制；录制状态可通过 `RECORDING_STATUS` 查询 |

### TC-71：宏 — 停止录制并保存

| 项 | 内容 |
|:--|:--|
| **前置** | TC-70 通过 |
| **步骤** | 1. 发送 `RECORD_STOP`<br>2. 发送 `MACRO_LIST` 查询 |
| **期望** | MACRO_LIST_RESULT 包含 "test_macro"；包含录制的步骤数组 |

### TC-72：宏 — 删除宏

| 项 | 内容 |
|:--|:--|
| **前置** | TC-71 通过 |
| **步骤** | 1. 发送 `MACRO_DELETE`（name="test_macro"）<br>2. 发送 `MACRO_LIST` 查询 |
| **期望** | "test_macro" 不再出现在列表中 |

---

## 八、验证码与安全检测

### TC-80：验证码 — reCAPTCHA 检测

| 项 | 内容 |
|:--|:--|
| **前置** | 访问含 reCAPTCHA 的页面（或 mock 一个 iframe 含 recaptcha） |
| **步骤** | 1. 导航到含 reCAPTCHA 的页面<br>2. 观察 Side Panel |
| **期望** | Side Panel 弹出验证码警告横幅；CAPTCHA_ALERT 消息发送到 UI |

### TC-81：验证码 — hCaptcha 检测

| 项 | 内容 |
|:--|:--|
| **前置** | 访问含 hCaptcha 的页面 |
| **步骤** | 1. 导航到含 hCaptcha 的页面<br>2. 观察 Side Panel |
| **期望** | Side Panel 弹出验证码警告横幅 |

---

## 九、压力与集成测试

### TC-90：Python 集成测试 — 京东搜索 (JSON-RPC)

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动，扩展已连接 |
| **步骤** | 1. 运行 `python scripts/test_jd.py`<br>2. 观察输出 |
| **期望** | 所有步骤通过：navigate → get_context → click → input → get_context → click → 结果验证 |

### TC-91：WebSocket 连接验证

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动 |
| **步骤** | 1. 运行 `python scripts/verify-ws.py` |
| **期望** | 3 步全部通过：连接成功、ping/pong 正常、无扩展时返回错误 |

### TC-92：50 步压力测试

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动，扩展已连接，活跃页面可交互 |
| **步骤** | 1. 将 `scripts/stress-test.ts` 中的脚本粘贴到浏览器 Console<br>2. 观察执行过程 |
| **期望** | 50 步交替 observe/click/scroll 全部完成；无超时或断连；输出通过/失败计数和平均响应时间 |

### TC-93：WebSocket 重连（指数退避）

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动，扩展已连接 |
| **步骤** | 1. 手动停止 Daemon 进程<br>2. 等待 10 秒<br>3. 重启 Daemon<br>4. 观察扩展行为 |
| **期望** | Daemon 停止后扩展进入重连循环（1s→2s→4s→...→30s）；Daemon 重启后自动重连成功 |

### TC-94：Native Host MCP 工具列表

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动，Claude Code 已配置 MCP (`http://127.0.0.1:9527/sse`) |
| **步骤** | 1. 在 Claude Code 中查看可用 MCP 工具<br>2. 尝试调用 `observe` 工具 |
| **期望** | 可用工具列表包含 13 个工具：observe, click, type, navigate, extract, scroll, screenshot, evaluate, extract_network_apis, get_auth_cookies, screenshot_fullpage, export_pdf, get_storage<br>（不含 network_start/stop, console_start/stop, perf_start/stop — 已降噪隐藏） |

---

## 十、MV3 保活测试

### TC-100：Service Worker 不被回收

| 项 | 内容 |
|:--|:--|
| **前置** | 扩展已加载，Daemon 已连接 |
| **步骤** | 1. 打开 `chrome://extensions`<br>2. 点击扩展的 Service Worker 链接查看日志<br>3. 等待 5 分钟，不做任何操作<br>4. 检查 SW 是否仍在运行 |
| **期望** | SW 保持活跃（15s alarm + 20s ping + 20s platformInfo 三重保活） |

### TC-101：扩展更新后自动重载标签页

| 项 | 内容 |
|:--|:--|
| **前置** | 已有 Logexus 管理的标签页 |
| **步骤** | 1. 在 `chrome://extensions` 点击扩展的刷新按钮<br>2. 观察已有标签页 |
| **期望** | 被管理的标签页自动重新加载；Content Script 重新注入；连接恢复 |

---

## 测试结果记录

### 通信连接

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| TC-01 test-agent 连接 | ⬜ 待测 | |
| TC-02 Daemon WebSocket 连接 | ⬜ 待测 | |
| TC-03 system.ping | ⬜ 待测 | |
| TC-04 system.register | ⬜ 待测 | |
| TC-05 无效方法错误码 | ⬜ 待测 | |

### 基础操作（AGENT_REQUEST）

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| TC-10 observe 采集页面 | ⬜ 待测 | |
| TC-11 observe 元素上限 | ⬜ 待测 | |
| TC-12 type 输入文本 | ⬜ 待测 | |
| TC-13 click 点击元素 | ⬜ 待测 | |
| TC-14 navigate 页面跳转 | ⬜ 待测 | |
| TC-15 extract 数据提取 | ⬜ 待测 | |
| TC-16 scroll 页面滚动 | ⬜ 待测 | |
| TC-17 screenshot 主动截图 | ⬜ 待测 | |
| TC-18 截图自动附带 | ⬜ 待测 | |

### JSON-RPC 2.0 操作

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| TC-20 browser.get_context | ⬜ 待测 | |
| TC-21 action.click | ⬜ 待测 | |
| TC-22 action.input (CDP) | ⬜ 待测 | |
| TC-23 action.scroll | ⬜ 待测 | |
| TC-24 browser.navigate | ⬜ 待测 | |
| TC-25 browser.reload | ⬜ 待测 | |
| TC-26 错误码 NO_ACTIVE_TAB | ⬜ 待测 | |
| TC-27 错误码 ELEMENT_NOT_FOUND | ⬜ 待测 | |

### CDP 引擎

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| TC-30 evaluate JS 执行 | ⬜ 待测 | |
| TC-31 evaluate 复杂表达式 | ⬜ 待测 | |
| TC-32 network 捕获 | ⬜ 待测 | |
| TC-33 network 空捕获 | ⬜ 待测 | |
| TC-34 console 捕获 | ⬜ 待测 | |
| TC-35 console 多级别 | ⬜ 待测 | |
| TC-36 perf 性能追踪 | ⬜ 待测 | |
| TC-37 cdp_detach 清理 | ⬜ 待测 | |

### Side Panel UI

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| TC-40 连接状态显示 | ⬜ 待测 | |
| TC-41 授权弹窗 | ⬜ 待测 | |
| TC-42 授权通过 | ⬜ 待测 | |
| TC-43 授权拒绝 | ⬜ 待测 | |
| TC-44 审计日志展示 | ⬜ 待测 | |
| TC-45 日志筛选搜索 | ⬜ 待测 | |
| TC-46 日志清空 | ⬜ 待测 | |
| TC-47 日志导出 | ⬜ 待测 | |
| TC-48 日志持久化 | ⬜ 待测 | |
| TC-49 暗色模式 | ⬜ 待测 | |
| TC-50 模板面板 | ⬜ 待测 | |
| TC-51 模板选中 | ⬜ 待测 | |
| TC-52 底部状态栏 | ⬜ 待测 | |

### 标签页与内容脚本

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| TC-60 元素索引注入 | ⬜ 待测 | |
| TC-61 新 Tab 自动连接 | ⬜ 待测 | |
| TC-62 手动切换 Tab | ⬜ 待测 | |
| TC-63 标签页分组 | ⬜ 待测 | |
| TC-64 浮动徽章 | ⬜ 待测 | |
| TC-65 心跳重连 | ⬜ 待测 | |
| TC-66 observe 超时 | ⬜ 待测 | |

### 宏录制

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| TC-70 开始录制 | ⬜ 待测 | |
| TC-71 停止录制并保存 | ⬜ 待测 | |
| TC-72 删除宏 | ⬜ 待测 | |

### 验证码检测

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| TC-80 reCAPTCHA 检测 | ⬜ 待测 | |
| TC-81 hCaptcha 检测 | ⬜ 待测 | |

### 压力与集成

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| TC-90 京东搜索集成测试 | ⬜ 待测 | |
| TC-91 WebSocket 连接验证 | ⬜ 待测 | |
| TC-92 50 步压力测试 | ⬜ 待测 | |
| TC-93 WebSocket 重连 | ⬜ 待测 | |
| TC-94 MCP 工具列表 | ⬜ 待测 | |

### MV3 保活

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| TC-100 SW 不被回收 | ⬜ 待测 | |
| TC-101 扩展更新后重载 | ⬜ 待测 | |

---

## 十一、Native Host v0.2.0 测试

> 前置：Native Host 已启动 (`node native-host/host.js`)，Extension 已加载并连接

### TC-200：Native Host 健康检查

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动 |
| **步骤** | 1. `curl http://127.0.0.1:9527/health`<br>2. 检查返回字段 |
| **期望** | 返回 `{"status":"STARTING"\|"RUNNING"\|"DEGRADED","extensionConnected":true/false,"pendingRequests":0,"sseConnected":false}` |

### TC-201：HTTP API — observe

| 项 | 内容 |
|:--|:--|
| **前置** | TC-200 通过，Chrome 有活跃标签页 |
| **步骤** | 1. `POST http://127.0.0.1:9527/api/agent` body=`{"action":"observe","payload":{"reasoning":"test"}}` |
| **期望** | 返回 `status=success`，`new_observation` 为非空数组，每个元素含 `id/tag/text/inViewport` |

### TC-202：HTTP API — navigate（非阻塞授权）

| 项 | 内容 |
|:--|:--|
| **前置** | TC-200 通过，`LOGEXUS_SKIP_AUTH=OFF` |
| **步骤** | 1. 发送 `navigate`（不带 `__auth_approved`）<br>2. 观察返回<br>3. 发送 `navigate`（带 `__auth_approved:true`） |
| **期望** | 第一次返回 `status=auth_required` + `auth_action/auth_value/hint`；第二次返回 `status=success`，浏览器跳转到目标 URL |

### TC-203：HTTP API — 404 处理

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动 |
| **步骤** | 1. `curl http://127.0.0.1:9527/nonexistent` |
| **期望** | HTTP 404 |

---

## 十二、MCP SSE v0.2.0 测试

### TC-210：MCP 工具列表

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动 |
| **步骤** | 1. 在 Claude Code 或 MCP 客户端连接 `http://127.0.0.1:9527/sse`<br>2. 列出可用工具 |
| **期望** | 工具列表为 13 个：`observe, click, type, navigate, extract, scroll, screenshot, evaluate, extract_network_apis, get_auth_cookies, screenshot_fullpage, export_pdf, get_storage`；不含 `network_start/stop, console_start/stop, perf_start/stop` |

### TC-211：文件卸载 — 截图落盘

| 项 | 内容 |
|:--|:--|
| **前置** | TC-200 通过，Chrome 有活跃页面 |
| **步骤** | 1. 通过 API 或 MCP 调用 `screenshot`<br>2. 检查返回是否含 `saved_path`<br>3. 验证 `%TEMP%/logexus/` 下文件存在 |
| **期望** | 返回 `saved_path` 非空 + `size_bytes`/`format` 字段；1 小时后文件自动清理 |

### TC-212：自动拉起（restart Chrome）

| 项 | 内容 |
|:--|:--|
| **前置** | 注册表已配置 Native Messaging Host |
| **步骤** | 1. 完全退出 Chrome<br>2. 重新打开 Chrome<br>3. 打开 Side Panel 检查连接状态 |
| **期望** | Extension 自动连接 Native Host；Side Panel 状态灯绿色；`health` 端点显示 `extensionConnected:true` |

---

## 测试结果记录 v0.2.0

### Native Host

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| TC-200 Health Check | ✅ 通过 | |
| TC-201 HTTP observe | ✅ 通过 | |
| TC-202 auth_required 非阻塞 | ✅ 通过 | 首次 `auth_required`，携带 `__auth_approved` 后 `success` |
| TC-203 404 处理 | ✅ 通过 | |

### 集成测试

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| 京东搜索端到端 | ✅ 通过 | navigate(新标签页) → observe → 搜索页正确返回 143 个元素 |
| Logexus Tauri WebSocket | ✅ 通过 | `browser.rs` JSON-RPC 2.0 零改动兼容 |

> 测试通过标记 ✅，失败标记 ❌ 并备注原因

---

## 十三、v0.2.1 自动启动与 NM 模式测试

> 前置：Native Host 已安装（`install.bat` / `install.sh`），Chrome Extension 已加载

### TC-300：Native Host 独立模式启动

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 依赖已安装 |
| **步骤** | 1. `node native-host/host.js`<br>2. 观察日志输出<br>3. 按 Ctrl+C 退出 |
| **期望** | 日志输出 `[NativeHost] INIT → STARTING` + `HTTP+WS on http://127.0.0.1:9527`；Ctrl+C 正常退出，不出现 stdin 关闭导致的意外 shutdown |

### TC-301：Native Host --nm 模式启动

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 依赖已安装 |
| **步骤** | 1. `node native-host/host.js --nm`<br>2. 按 Ctrl+C 发送 stdin end |
| **期望** | 日志输出 `[NativeHost] stdin closed by Chrome` → 自动进入 DRAINING → EXITED |

### TC-302：Native Host 健康检查

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动（独立模式） |
| **步骤** | 1. `curl -s http://127.0.0.1:9527/health`<br>2. 检查返回字段 |
| **期望** | 返回 `{"status":"STARTING"\|"RUNNING"\|"DEGRADED","extensionConnected":true/false,"pendingRequests":0,"sseConnected":false}` |

### TC-303：Chrome NM 自动拉起（备选方案）

| 项 | 内容 |
|:--|:--|
| **前置** | `install.bat` 已执行，Chrome 已完全重启 |
| **步骤** | 1. 打开 Side Panel<br>2. 观察连接状态<br>3. 检查 `health` 端点 |
| **期望** | Side Panel 状态灯绿色；`extensionConnected:true`；Native Host 通过 `--nm` 模式运行 |

### TC-304：独立模式 stdin 关闭不退出

| 项 | 内容 |
|:--|:--|
| **前置** | 独立模式启动（无 `--nm` 参数） |
| **步骤** | 1. 启动 Native Host<br>2. 在另一个终端发送 Ctrl+C 信号模拟 stdin 关闭<br>3. 检查进程是否存活 |
| **期望** | 进程**不退出**（独立模式忽略 stdin 关闭）；WebSocket 服务保持可用 |

### TC-305：NM 模式 stdin 关闭自动退出

| 项 | 内容 |
|:--|:--|
| **前置** | `--nm` 模式启动 |
| **步骤** | 1. 启动 Native Host `--nm`<br>2. 关闭 stdin（模拟 Chrome 断开） |
| **期望** | 进程自动进入 DRAINING → EXITED 并退出 |

### TC-306：`__auth_approved` 透传

| 项 | 内容 |
|:--|:--|
| **前置** | Native Host 已启动，Extension 已连接，`LOGEXUS_SKIP_AUTH=OFF` |
| **步骤** | 1. 发送 JSON-RPC `browser.navigate` 不带 `__auth_approved`<br>2. 观察返回<br>3. 重发带 `__auth_approved: true` |
| **期望** | 第一次返回 `auth_required`；第二次返回 `success`；AGENT_REQUEST 的 payload 中包含 `__auth_approved: true` |

### TC-307：macOS host.sh NM 入口（macOS 专用）

| 项 | 内容 |
|:--|:--|
| **前置** | macOS 环境，`install.sh` 已执行 |
| **步骤** | 1. 重启 Chrome<br>2. 打开 Side Panel 检查连接 |
| **期望** | Native Host 通过 `host.sh` 以 `--nm` 模式启动；连接正常 |

---

## 测试结果记录 v0.2.1

### 自动启动与 NM 模式

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| TC-300 独立模式启动 | ⬜ 待测 | |
| TC-301 --nm 模式 | ⬜ 待测 | |
| TC-302 健康检查 | ⬜ 待测 | |
| TC-303 NM 自动拉起 | ⬜ 待测 | |
| TC-304 独立模式 stdin 不退出 | ⬜ 待测 | |
| TC-305 NM 模式自动退出 | ⬜ 待测 | |
| TC-306 __auth_approved 透传 | ⬜ 待测 | |
| TC-307 macOS host.sh | ⬜ 待测 |
