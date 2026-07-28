// ── 审计日志 ──

import { useRef, useEffect, useState } from 'react';
import type { AuditEntry } from '../../shared/types';

interface Props {
  audits: AuditEntry[];
  filterText: string;
  onFilterChange: (text: string) => void;
  onClear: () => void;
  onExport: () => void;
  count: number;
}

const ACTION_LABELS: Record<string, string> = {
  observe: '采集页面',
  click: '点击元素',
  type: '输入文本',
  navigate: '页面跳转',
  extract: '提取数据',
  scroll: '滚动页面',
  screenshot: '截图',
};

export function AuditLog({ audits, filterText, onFilterChange, onClear, onExport, count }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [audits.length]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 工具栏 */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-100 dark:border-gray-700">
        <input
          className="flex-1 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2D2D2D] px-2 py-1 placeholder-gray-400 outline-none focus:border-primary-500"
          placeholder={`筛选日志 (${count} 条)`}
          value={filterText}
          onChange={(e) => onFilterChange(e.target.value)}
        />
        <button
          className="text-[10px] px-2 py-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#333]"
          onClick={onClear}
          title="清空日志"
        >
          清空
        </button>
        <button
          className="text-[10px] px-2 py-1 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#333]"
          onClick={onExport}
          title="导出 JSON"
        >
          导出
        </button>
      </div>

      {/* 日志列表 */}
      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-2 space-y-1.5">
        {audits.length === 0 && (
          <div className="flex items-center justify-center text-gray-400 dark:text-gray-500 text-sm mt-8">
            {filterText ? '无匹配日志' : '等待 AI Agent 指令...'}
          </div>
        )}

        {audits.map((entry) => (
          <div
            key={entry.id}
            className={`log-card slide-in border-l-2 ${
              entry.status === 'success'
                ? 'border-l-green-400'
                : entry.status === 'blocked'
                  ? 'border-l-amber-400'
                  : 'border-l-red-400'
            }`}
          >
            <button
              className="flex items-center gap-2 w-full text-left"
              onClick={() => toggle(entry.id)}
            >
              <span className={`status-dot ${
                entry.status === 'success' ? 'bg-green-500' :
                entry.status === 'blocked' ? 'bg-amber-500' : 'bg-red-500'
              }`} />

              <span className="text-xs text-gray-400">{formatTime(entry.timestamp)}</span>

              <code className="text-xs font-mono bg-gray-100 dark:bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                {ACTION_LABELS[entry.action] || entry.action}
              </code>

              <span className="flex-1 text-xs text-gray-500 truncate">
                {entry.targetId ? `${entry.targetId}` : ''}
                {entry.value ? ` "${entry.value.slice(0, 20)}"` : ''}
              </span>

              <span className="text-xs text-gray-400">#{entry.taskId.slice(-4)}</span>
            </button>

            {expanded.has(entry.id) && (
              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 space-y-1 text-xs">
                {entry.reasoning && (
                  <div className="text-gray-500">
                    <span className="font-medium">Reasoning: </span>
                    {entry.reasoning}
                  </div>
                )}
                <div className={entry.status === 'success' ? 'text-green-600' : 'text-red-500'}>
                  <span className="font-medium">Result: </span>
                  {entry.result}
                </div>
              </div>
            )}
          </div>
        ))}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
