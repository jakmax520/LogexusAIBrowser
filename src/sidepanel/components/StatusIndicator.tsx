// ── 连接状态指示器 ──

interface Props {
  connected: boolean;
  tabId?: number;
  url?: string;
  authGranted: boolean;
}

export function StatusIndicator({ connected, tabId, url, authGranted }: Props) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-[#252525] border-b border-gray-200 dark:border-gray-700">
      {/* 连接状态 */}
      <span className={`status-dot ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {connected ? `Tab #${tabId}` : '未连接'}
      </span>

      {connected && url && (
        <span className="text-xs text-gray-400 truncate flex-1" title={url}>
          {new URL(url).hostname}
        </span>
      )}

      {/* 授权状态 */}
      <span className={`text-xs px-2 py-0.5 rounded-full ${
        authGranted
          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
      }`}>
        {authGranted ? '已授权' : '待授权'}
      </span>
    </div>
  );
}
