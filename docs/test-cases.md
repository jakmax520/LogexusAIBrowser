# Logexus AI Browser — 测试用例

> 适用于 MVP 第一阶段功能自测。测试环境：Chrome ≥ 114，已加载 `dist/` 扩展。

## 前置准备

1. `npm run build` 构建扩展
2. `chrome://extensions` → 开发者模式 → 加载已解压 → 选择 `dist/`
3. 复制扩展 ID（32 位字符串）
4. 打开目标测试页面：`https://www.bing.com`
5. 新 Tab 打开 `dist/test-agent.html`，填入扩展 ID，点击连接

---

## TC-01：通信连接

| 项 | 内容 |
|:--|:--|
| **前置** | 扩展已加载，test-agent.html 已打开 |
| **步骤** | 1. 输入扩展 ID<br>2. 点击「连接」<br>3. 观察连接状态 |
| **期望** | 状态显示「已连接」绿色标记；日志输出 `连接成功! status=success` |

---

## TC-02：observe — 采集页面状态

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 点击 `observe` 预设按钮<br>2. 查看日志输出 |
| **期望** | 日志输出元素数量 ≥ 1；每个元素含 `id`/`tag`/`text`/`inViewport` 字段 |

---

## TC-03：type — 输入文本

| 项 | 内容 |
|:--|:--|
| **前置** | TC-02 通过，已获取搜索框元素 ID |
| **步骤** | 1. 从 observe 结果中找到搜索框 ID（`el_N`，`tag: "input"`）<br>2. 选择 action=`type`，Target ID 填入该元素 ID<br>3. Value 填入 `OpenAI`<br>4. 点击「发送」 |
| **期望** | 日志显示 `status=success`；Bing 搜索框中实际出现 "OpenAI" 文字 |

---

## TC-04：click — 点击元素

| 项 | 内容 |
|:--|:--|
| **前置** | TC-03 通过 |
| **步骤** | 1. 执行 observe 获取更新后的元素列表<br>2. 找到搜索按钮 ID（`tag: "button"`，含 `search` 文字）<br>3. 选择 action=`click`，Target ID 填入该元素 ID<br>4. 点击「发送」 |
| **期望** | 日志显示 `status=success`；Bing 开始搜索，页面 URL 和内容发生变化 |

---

## TC-05：navigate — 页面跳转

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 选择 action=`navigate`<br>2. Value 填入 `https://www.google.com`<br>3. 点击「发送」 |
| **期望** | 日志显示 `status=success`；浏览器跳转到 Google 首页；observe 结果中 URL 已变化 |

---

## TC-06：extract — 数据提取

| 项 | 内容 |
|:--|:--|
| **前置** | TC-05 通过（已跳转到 Google） |
| **步骤** | 1. 选择 action=`extract`<br>2. Value 填入 `h3`（提取所有三级标题）<br>3. 点击「发送」 |
| **期望** | 日志显示 `status=success`；`data` 数组包含页面所有 h3 文本内容 |

---

## TC-07：scroll — 页面滚动

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过，当前页面有可滚动内容 |
| **步骤** | 1. 选择 action=`scroll`<br>2. Value 填入 `down`<br>3. 点击「发送」<br>4. 再次发送 scroll，Value 填入 `up` |
| **期望** | 每次 status=success；页面实际发生滚动；滚动后 observe 结果中 `inViewport` 字段变化 |

---

## TC-08：screenshot — 主动截图

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 点击 `screenshot` 预设按钮<br>2. 查看日志 |
| **期望** | 日志显示 `status=success`；输出截图大小（KB 级别 base64） |

---

## TC-09：截图自动触发 — 元素不存在

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 选择 action=`click`<br>2. Target ID 填入不存在的元素 ID，如 `el_99999`<br>3. 点击「发送」 |
| **期望** | 日志显示 `status=error`；`data.error` 包含 `Element el_99999 not found`；**`data.screenshot` 自动附带截图** |

---

## TC-10：Side Panel — 连接状态显示

| 项 | 内容 |
|:--|:--|
| **前置** | 扩展已加载 |
| **步骤** | 1. 点击工具栏扩展图标打开 Side Panel<br>2. 观察状态栏<br>3. 切换浏览器 Tab<br>4. 关闭所有 Tab 观察 |
| **期望** | 有活动 Tab 时显示「已连接」绿色标记 + Tab 编号 + 域名；无 Tab 时显示「未连接」|

---

## TC-11：Side Panel — 授权弹窗

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过，首次操作（未授权状态） |
| **步骤** | 1. 在 test-agent.html 发送任意非 observe 操作<br>2. 观察 Side Panel |
| **期望** | Side Panel 弹出黄色授权卡片，显示：操作类型（如 click）、目标元素、AI 思考原因；出现「允许」「拒绝」按钮 |

---

## TC-12：Side Panel — 授权通过后执行

| 项 | 内容 |
|:--|:--|
| **前置** | TC-11 弹出授权弹窗 |
| **步骤** | 1. 点击「允许」<br>2. 查看 test-agent.html 日志 |
| **期望** | 操作成功执行；test-agent 收到 `status=success`；授权弹窗消失 |

---

## TC-13：Side Panel — 授权拒绝

| 项 | 内容 |
|:--|:--|
| **前置** | TC-11 弹出授权弹窗 |
| **步骤** | 1. 点击「拒绝」<br>2. 查看 test-agent.html 日志 |
| **期望** | test-agent 收到 `status=blocked`；`data.action_result` 为 `User denied authorization`；操作未执行 |

---

## TC-14：Side Panel — 审计日志

| 项 | 内容 |
|:--|:--|
| **前置** | 已完成若干操作（TC-02 ~ TC-09） |
| **步骤** | 1. 打开 Side Panel<br>2. 滚动审计日志区域<br>3. 点击任一日志条目展开详情 |
| **期望** | 每条日志显示：时间戳 + 操作类型 + 状态色标 + 任务 ID；展开后显示 Reasoning 和 Result；最新日志在最底部 |

---

## TC-15：Service Worker — 心跳检测自动重连

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 刷新目标网页（F5）<br>2. 等待 5 秒<br>3. 再次发送 observe |
| **期望** | 刷新后短时间内可能显示未连接，5 秒内心跳检测到新页面后自动重连；observe 返回新页面状态 |

---

## TC-16：错误处理 — observe 超时

| 项 | 内容 |
|:--|:--|
| **前置** | 所有 Tab 关闭 |
| **步骤** | 1. 关闭所有浏览器 Tab<br>2. 在 test-agent.html 发送 observe |
| **期望** | 15 秒超时后返回 `status=error`；`data.error` 包含 `No active tab connection` 或 `Observe timed out` |

---

## TC-17：元素索引注入 — data-agent-id

| 项 | 内容 |
|:--|:--|
| **前置** | TC-02 通过 |
| **步骤** | 1. 发送 observe<br>2. 在目标网页按 F12 → Console<br>3. 执行 `document.querySelectorAll('[data-agent-id]').length` |
| **期望** | Console 输出值等于 observe 返回的元素数量；每个可交互元素均有 `data-agent-id="el_N"` 属性 |

---

## TC-18：多 Tab — 新 Tab 打开并自动连接

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 在 test-agent 中发送 `navigate`，value=`newtab: https://www.google.com`<br>2. 观察浏览器新 Tab 是否打开<br>3. 观察 Side Panel 状态栏 Tab 数量变化 |
| **期望** | 新 Tab 打开 → 自动加载 Google → SW 自动注入 CS 并连接 → Side Panel 显示 "2 tabs (active #xxx)" |

---

## TC-19：多 Tab — 用户手动切换 Tab

| 项 | 内容 |
|:--|:--|
| **前置** | TC-18 通过（至少 2 个已连接 Tab） |
| **步骤** | 1. 手动点击 Chrome 标签栏切换到前一 Tab<br>2. 打开 Side Panel 观察状态变化<br>3. 在 test-agent 发送 observe |
| **期望** | Side Panel 切换显示新活跃 Tab ID；授权状态重置为「待授权」；observe 返回切换后 Tab 的页面状态 |

---

## TC-20：Side Panel — 暗色模式切换

| 项 | 内容 |
|:--|:--|
| **前置** | 扩展已加载 |
| **步骤** | 1. 打开 Side Panel<br>2. 点击标题栏右侧 ☾ 按钮<br>3. 观察 Side Panel 颜色变化<br>4. 关闭再打开 Side Panel，观察是否保持 |
| **期望** | 点击后切换为暗色主题（深色背景 + 浅色文字）；再次点击切换回亮色；刷新后保持用户选择 |

---

## TC-21：Side Panel — 日志筛选搜索

| 项 | 内容 |
|:--|:--|
| **前置** | 已完成若干不同类型操作（observe / click / type） |
| **步骤** | 1. 在 Side Panel 日志区顶部筛选框输入 "click"<br>2. 观察日志列表变化<br>3. 清空筛选框输入 |
| **期望** | 输入 "click" 后仅显示 action=click 的日志条目；清空后恢复显示全部 |

---

## TC-22：Side Panel — 日志清空

| 项 | 内容 |
|:--|:--|
| **前置** | Side Panel 有若干条日志 |
| **步骤** | 1. 点击日志工具栏「清空」按钮<br>2. 关闭 Side Panel 再重新打开 |
| **期望** | 日志列表立即清空显示「等待 AI Agent 指令...」；重新打开后保持清空（IndexedDB 已清除） |

---

## TC-23：Side Panel — 日志导出

| 项 | 内容 |
|:--|:--|
| **前置** | Side Panel 有若干条日志 |
| **步骤** | 1. 点击日志工具栏「导出」按钮<br>2. 查看下载的 JSON 文件内容 |
| **期望** | 浏览器触发 `.json` 文件下载；文件内容为完整审计日志数组，包含 timestamp / action / status 等字段 |

---

## TC-24：Side Panel — 日志跨会话持久化

| 项 | 内容 |
|:--|:--|
| **前置** | 已完成若干操作，Side Panel 有日志 |
| **步骤** | 1. 关闭 Side Panel（或刷新浏览器页面）<br>2. 等待 5 秒<br>3. 重新打开 Side Panel |
| **期望** | 之前的审计日志完整恢复显示；时间戳和操作详情与原有一致 |

---

---

## TC-25：CDP — evaluate JS 执行

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过，扩展已加载 |
| **步骤** | 1. 在 test-agent 中选择 action=`evaluate`<br>2. Value 填入 `document.title`<br>3. 点击发送 |
| **期望** | 返回 `status=success`；`data.action_result` 包含页面标题 |

---

## TC-26：CDP — network 网络请求捕获

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 发送 `network_start`<br>2. 刷新页面或点击链接<br>3. 发送 `network_stop` |
| **期望** | network_stop 返回请求列表，每个含 url/method/status |

---

## TC-27：CDP — console 控制台消息捕获

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 发送 `console_start`<br>2. 在目标网页 Console 执行 `console.log('test123')`<br>3. 发送 `console_stop` |
| **期望** | console_stop 返回消息列表，包含 `test123` |

---

## TC-28：CDP — performance 性能追踪

| 项 | 内容 |
|:--|:--|
| **前置** | TC-01 通过 |
| **步骤** | 1. 发送 `perf_start`<br>2. 等待 5 秒<br>3. 发送 `perf_stop` |
| **期望** | perf_stop 返回指标列表，含 JSHeapUsedSize、TaskDuration 等 |

---

## 测试结果记录

| 用例 | 状态 | 备注 |
|:--|:--|:--|
| TC-01 通信连接 | ⬜ 待测 | |
| TC-02 observe | ⬜ 待测 | |
| TC-03 type | ⬜ 待测 | |
| TC-04 click | ⬜ 待测 | |
| TC-05 navigate | ⬜ 待测 | |
| TC-06 extract | ⬜ 待测 | |
| TC-07 scroll | ⬜ 待测 | |
| TC-08 screenshot 主动 | ⬜ 待测 | |
| TC-09 截图自动触发 | ⬜ 待测 | |
| TC-10 Side Panel 连接状态 | ⬜ 待测 | |
| TC-11 授权弹窗 | ⬜ 待测 | |
| TC-12 授权通过 | ⬜ 待测 | |
| TC-13 授权拒绝 | ⬜ 待测 | |
| TC-14 审计日志 | ⬜ 待测 | |
| TC-15 心跳重连 | ⬜ 待测 | |
| TC-16 observe 超时 | ⬜ 待测 | |
| TC-17 元素索引注入 | ⬜ 待测 | |
| TC-18 多 Tab — 新 Tab 打开 | ⬜ 待测 | |
| TC-19 多 Tab — 手动切换 | ⬜ 待测 | |
| TC-20 暗色模式切换 | ⬜ 待测 | |
| TC-21 日志筛选搜索 | ⬜ 待测 | |
| TC-22 日志清空 | ⬜ 待测 | |
| TC-23 日志导出 | ⬜ 待测 | |
| TC-24 日志持久化 | ⬜ 待测 | |
| TC-25 evaluate CDP | ⬜ 待测 | |
| TC-26 network CDP | ⬜ 待测 | |
| TC-27 console CDP | ⬜ 待测 | |
| TC-28 perf CDP | ⬜ 待测 | |

> 测试通过标记 ✅，失败标记 ❌ 并备注原因
| TC-03 type | ⬜ 待测 | |
| TC-04 click | ⬜ 待测 | |
| TC-05 navigate | ⬜ 待测 | |
| TC-06 extract | ⬜ 待测 | |
| TC-07 scroll | ⬜ 待测 | |
| TC-08 screenshot 主动 | ⬜ 待测 | |
| TC-09 截图自动触发 | ⬜ 待测 | |
| TC-10 Side Panel 连接状态 | ⬜ 待测 | |
| TC-11 授权弹窗 | ⬜ 待测 | |
| TC-12 授权通过 | ⬜ 待测 | |
| TC-13 授权拒绝 | ⬜ 待测 | |
| TC-14 审计日志 | ⬜ 待测 | |
| TC-15 心跳重连 | ⬜ 待测 | |
| TC-16 observe 超时 | ⬜ 待测 | |
| TC-17 元素索引注入 | ⬜ 待测 | |

> 测试通过标记 ✅，失败标记 ❌ 并备注原因
