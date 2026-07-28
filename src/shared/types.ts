// ── Logexus AI Browser — API 契约类型 ──

// ── 工具操作类型 ──
export type ToolAction =
  | 'observe'
  | 'click'
  | 'type'
  | 'navigate'
  | 'extract'
  | 'scroll';

// ── 交互元素 (页面降噪后) ──
export interface InteractiveElement {
  id: string;           // "el_0", "el_1" ...
  tag: string;          // "button", "a", "input" ...
  text: string;         // textContent 截断 ≤ 60 字符
  type: string | null;  // input type
  placeholder: string | null;
  ariaLabel: string | null;
  inViewport: boolean;
}

// ── 页面状态 ──
export interface PageState {
  url: string;
  title: string;
  elements: InteractiveElement[];
}

// ── 外部 Agent → 扩展：指令请求 ──
export interface AgentRequest {
  type: 'AGENT_REQUEST';
  task_id: string;
  action: ToolAction;
  payload: {
    target_id?: string; // "el_15"
    value?: string;     // 输入文本 / URL / CSS 选择器 / scroll 方向
    reasoning?: string; // Agent 思考过程，展示在 Side Panel
  };
}

// ── 扩展 → 外部 Agent：执行响应 ──
export interface AgentResponse {
  type: 'AGENT_RESPONSE';
  task_id: string;
  status: 'success' | 'error' | 'blocked';
  data: {
    action_result?: string;
    current_url?: string;
    new_observation?: InteractiveElement[];
    screenshot?: string;    // base64, 校验失败时补充
    error?: string;
  };
}

// ── 动作执行结果 (内部) ──
export interface ActionResult {
  success: boolean;
  newUrl?: string;
  domChanged?: boolean;
  error?: string;
  data?: string[];
}

// ── 审计日志条目 ──
export interface AuditEntry {
  id: number;
  timestamp: number;
  taskId: string;
  action: ToolAction;
  targetId?: string;
  value?: string;
  reasoning?: string;
  status: 'success' | 'error' | 'blocked';
  result: string;
}

// ── 授权请求 ──
export interface AuthRequest {
  requestId: string;
  action: ToolAction;
  targetId?: string;
  value?: string;
  reasoning?: string;
  pageUrl: string;
}
