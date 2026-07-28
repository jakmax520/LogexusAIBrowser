// ── Side Panel 状态订阅 Hook ──

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AuditEntry, AuthRequest } from '../../shared/types';
import {
  MSG_AUTH_REQUEST,
  MSG_AUDIT_LOG,
  MSG_CONNECTION_STATUS,
  MSG_CAPTCHA_ALERT,
  MSG_AUTH_RESPONSE,
} from '../../shared/messages';
import { saveAudits, loadAudits, clearAudits } from './logStorage';

interface ConnectionInfo {
  connected: boolean;
  tabId?: number;
  tabCount?: number;
  url?: string;
}

interface PanelState {
  connected: boolean;
  connectionInfo: ConnectionInfo | null;
  audits: AuditEntry[];
  pendingAuth: AuthRequest | null;
  captchaAlert: boolean;
  darkMode: boolean;
  filterText: string;
}

export function useAgentState() {
  const [state, setState] = useState<PanelState>({
    connected: false,
    connectionInfo: null,
    audits: [],
    pendingAuth: null,
    captchaAlert: false,
    darkMode: localStorage.getItem('logexus-dark') === '1',
    filterText: '',
  });

  const portRef = useRef<chrome.runtime.Port | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  // 启动时恢复日志
  useEffect(() => {
    loadAudits().then((saved) => {
      if (saved.length > 0) {
        setState((prev) => ({ ...prev, audits: saved }));
      }
    });
  }, []);

  // 审计日志变更 → 延迟持久化
  useEffect(() => {
    if (state.audits.length === 0) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveAudits(state.audits);
    }, 1000);
  }, [state.audits]);

  // 连接 SW
  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'logexus-ui' });
    portRef.current = port;

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case MSG_CONNECTION_STATUS:
          setState((prev) => ({
            ...prev,
            connected: msg.payload.connected,
            connectionInfo: msg.payload,
          }));
          break;

        case MSG_AUTH_REQUEST:
          setState((prev) => ({ ...prev, pendingAuth: msg.payload }));
          break;

        case MSG_CAPTCHA_ALERT:
          setState((prev) => ({ ...prev, captchaAlert: true }));
          break;

        case MSG_AUDIT_LOG:
          setState((prev) => ({
            ...prev,
            audits: [...prev.audits, msg.payload],
            pendingAuth: null,
          }));
          break;
      }
    });

    return () => port.disconnect();
  }, []);

  // 暗色模式
  useEffect(() => {
    const root = document.documentElement;
    if (state.darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('logexus-dark', state.darkMode ? '1' : '0');
  }, [state.darkMode]);

  const toggleDarkMode = useCallback(() => {
    setState((prev) => ({ ...prev, darkMode: !prev.darkMode }));
  }, []);

  const setFilterText = useCallback((text: string) => {
    setState((prev) => ({ ...prev, filterText: text }));
  }, []);

  const dismissCaptcha = useCallback(() => {
    setState((prev) => ({ ...prev, captchaAlert: false }));
  }, []);

  const clearAllAudits = useCallback(async () => {
    setState((prev) => ({ ...prev, audits: [] }));
    await clearAudits();
  }, []);

  const respondAuth = useCallback((approved: boolean) => {
    if (state.pendingAuth) {
      portRef.current?.postMessage({
        type: MSG_AUTH_RESPONSE,
        payload: { requestId: state.pendingAuth.requestId, approved },
      });
    }
  }, [state.pendingAuth]);

  const filteredAudits = state.filterText
    ? state.audits.filter((a) => {
        const q = state.filterText.toLowerCase();
        return (
          a.action.toLowerCase().includes(q) ||
          (a.targetId && a.targetId.includes(q)) ||
          (a.value && a.value.toLowerCase().includes(q)) ||
          (a.reasoning && a.reasoning.toLowerCase().includes(q)) ||
          a.taskId.includes(q)
        );
      })
    : state.audits;

  const exportAudits = useCallback(() => {
    const json = JSON.stringify(state.audits, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logexus-audit-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state.audits]);

  return {
    ...state,
    filteredAudits,
    respondAuth,
    toggleDarkMode,
    setFilterText,
    dismissCaptcha,
    clearAllAudits,
    exportAudits,
  };
}
