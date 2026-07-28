// ── Side Panel 根组件 — 授权网关 + 审计日志 ──

import { useAgentState } from './hooks/useAgentState';
import { StatusIndicator } from './components/StatusIndicator';
import { AuthDialog } from './components/AuthDialog';
import { AuditLog } from './components/AuditLog';

export function App() {
  const { connected, connectionInfo, audits, pendingAuth, respondAuth } = useAgentState();

  return (
    <div className="flex flex-col h-screen">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-sm font-semibold">Logexus AI Browser</h1>
        <span className="text-[10px] text-gray-400 font-mono">
          {audits.length > 0 ? `${audits.length} ops` : 'ready'}
        </span>
      </div>

      {/* 连接状态 */}
      <StatusIndicator
        connected={connected}
        tabId={connectionInfo?.tabId}
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

      {/* 审计日志 */}
      <AuditLog audits={audits} />

      {/* 底部状态栏 */}
      <div className="px-4 py-1.5 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-400">
        {connected ? 'API Gateway Ready' : 'Connecting...'}
      </div>
    </div>
  );
}
