// ── 授权确认弹窗 ──

import type { AuthRequest } from '../../shared/types';

interface Props {
  request: AuthRequest;
  onApprove: () => void;
  onDeny: () => void;
}

export function AuthDialog({ request, onApprove, onDeny }: Props) {
  return (
    <div className="mx-3 mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 slide-in">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🤖</span>
        <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
          AI Agent 请求执行操作
        </span>
      </div>

      <div className="space-y-1 text-sm text-amber-700 dark:text-amber-400">
        <div className="flex gap-2">
          <span className="text-xs font-medium w-12 shrink-0 text-amber-500">操作:</span>
          <code className="text-xs font-mono bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">
            {request.action}
            {request.targetId ? `(${request.targetId})` : ''}
            {request.value ? ` "${request.value.slice(0, 30)}"` : ''}
          </code>
        </div>

        {request.reasoning && (
          <div className="flex gap-2">
            <span className="text-xs font-medium w-12 shrink-0 text-amber-500">原因:</span>
            <span className="text-xs">{request.reasoning}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-3">
        <button
          className="flex-1 py-2 text-sm rounded-lg bg-green-500 hover:bg-green-600 text-white transition-colors"
          onClick={onApprove}
        >
          允许
        </button>
        <button
          className="flex-1 py-2 text-sm rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
          onClick={onDeny}
        >
          拒绝
        </button>
      </div>
    </div>
  );
}
