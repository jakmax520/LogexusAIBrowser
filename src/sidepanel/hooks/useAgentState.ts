// ── Side Panel 状态订阅 Hook ──

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AuditEntry, AuthRequest } from '../../shared/types';
import {
  MSG_AUTH_REQUEST,
  MSG_AUDIT_LOG,
  MSG_CONNECTION_STATUS,
  MSG_AUTH_RESPONSE,
} from '../../shared/messages';

interface ConnectionInfo {
  connected: boolean;
  tabId?: number;
  url?: string;
}

interface PanelState {
  connected: boolean;
  connectionInfo: ConnectionInfo | null;
  audits: AuditEntry[];
  pendingAuth: AuthRequest | null;
}

export function useAgentState() {
  const [state, setState] = useState<PanelState>({
    connected: false,
    connectionInfo: null,
    audits: [],
    pendingAuth: null,
  });

  const portRef = useRef<chrome.runtime.Port | null>(null);

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
          setState((prev) => ({
            ...prev,
            pendingAuth: msg.payload,
          }));
          break;

        case MSG_AUDIT_LOG:
          setState((prev) => ({
            ...prev,
            audits: [...prev.audits, msg.payload],
            pendingAuth: null, // 操作已执行，清除授权等待
          }));
          break;
      }
    });

    return () => {
      port.disconnect();
    };
  }, []);

  const respondAuth = useCallback((approved: boolean) => {
    if (state.pendingAuth) {
      portRef.current?.postMessage({
        type: MSG_AUTH_RESPONSE,
        payload: { requestId: state.pendingAuth.requestId, approved },
      });
    }
  }, [state.pendingAuth]);

  return { ...state, respondAuth };
}
