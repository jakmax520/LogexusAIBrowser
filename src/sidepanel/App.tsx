// ── Side Panel 根组件 — 授权网关 + 审计日志 + 验证码提醒 ──

import { useAgentState } from './hooks/useAgentState';
import { StatusIndicator } from './components/StatusIndicator';
import { AuthDialog } from './components/AuthDialog';
import { AuditLog } from './components/AuditLog';
import { TemplatePanel } from './components/TemplatePanel';

export function App() {
  const {
    connected,
    connectionInfo,
    audits,
    filteredAudits,
    filterText,
    pendingAuth,
    captchaAlert,
    darkMode,
    respondAuth,
    toggleDarkMode,
    setFilterText,
    dismissCaptcha,
    clearAllAudits,
    exportAudits,
  } = useAgentState();

  return (
    <div className="flex flex-col h-screen">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-sm font-semibold">Logexus AI Browser</h1>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 font-mono">
            {audits.length > 0 ? `${audits.length} ops` : 'ready'}
          </span>
          <button
            className="text-xs px-1.5 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-[#333]"
            onClick={toggleDarkMode}
            title={darkMode ? '切换亮色' : '切换暗色'}
          >
            {darkMode ? '☀' : '☾'}
          </button>
        </div>
      </div>

      {/* 连接状态 */}
      <StatusIndicator
        connected={connected}
        tabId={connectionInfo?.tabId}
        tabCount={connectionInfo?.tabCount}
        url={connectionInfo?.url}
        authGranted={!pendingAuth && audits.length > 0}
      />

      {/* 授权弹窗 */}
      {pendingAuth && (
        <AuthDialog
          request={pendingAuth}
          onApprove={() => respondAuth(true)}
          onDeny={() => respondAuth(false)}
        />
      )}

      {/* 验证码提醒 */}
      {captchaAlert && (
        <div className="mx-3 mt-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 slide-in">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🤖</span>
            <span className="text-sm font-medium text-red-700 dark:text-red-400">
              检测到验证码 — Agent 已暂停
            </span>
          </div>
          <div className="text-xs text-red-600 dark:text-red-500 mb-2">
            请在页面中手动完成验证码验证
          </div>
          <button
            className="text-xs px-3 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white transition-colors"
            onClick={dismissCaptcha}
          >
            已完成验证，继续
          </button>
        </div>
      )}

      {/* 审计日志 */}
      <AuditLog
        audits={filteredAudits}
        filterText={filterText}
        onFilterChange={setFilterText}
        onClear={clearAllAudits}
        onExport={exportAudits}
        count={audits.length}
      />

      {/* 指令模板 */}
      <TemplatePanel onSelect={(tpl) => {
        console.log('[UI] Template selected:', tpl.name, tpl.steps.length, 'steps');
      }} />

      {/* 底部状态栏 */}
      <div className="px-4 py-1.5 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-400 flex justify-between">
        <span>{connected ? 'API Gateway Ready' : 'Connecting...'}</span>
        <span>{darkMode ? 'dark' : 'light'}</span>
      </div>
    </div>
  );
}
