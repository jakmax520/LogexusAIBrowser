# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] - 2026-08-22

### Fixed
- fix(background): 多 Tab navigate 不再每次新开 tab — MV3 Service Worker 空闲会被 Chrome 回收，`currentTabId` 内存变量随之丢失，导致后续 `navigate` 走 `chrome.tabs.create` 新建 tab。现将 `currentTabId` 持久化到 `chrome.storage.session`，SW 重启后恢复并校验 tab 是否仍存在（`chrome.tabs.get`）——存在则 `chrome.tabs.update` 复用当前 tab，不存在（用户已关）才新建。
  - 新增 `persistCurrentTabId` / `restoreCurrentTabId` / `currentTabStillExists` 辅助函数
  - `handleNavigate` 导航前恢复 + 校验；`activateCurrentTab` / `tabs.onActivated` 更新后持久化；`tabs.onRemoved` 时清理持久化缓存

## [0.2.1] - 2025-08

### Added
- Native Host 开机自启配置（daemon 静默启动）
- Native Host 内置 MCP SSE Server（SSE over HTTP 模式）

## [0.2.0] - 2025-07

### Added
- AI-powered 浏览器自动化引擎（My Logexus Browser 分组）
- 多 Tab 连接 + 安全授权 + JSON-RPC + CDP 集成
