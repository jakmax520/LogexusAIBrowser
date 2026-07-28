// ── 操作录制与回放引擎 ──

import type { AgentRequest } from '../shared/types';

export interface Macro {
  name: string;
  createdAt: number;
  steps: AgentRequest[];
}

const STORAGE_KEY = 'logexus_macros';

// ── 加载所有宏 ──
export async function loadMacros(): Promise<Macro[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || [];
}

// ── 保存宏 ──
export async function saveMacro(macro: Macro): Promise<void> {
  const macros = await loadMacros();
  // 同名覆盖
  const idx = macros.findIndex((m) => m.name === macro.name);
  if (idx >= 0) macros[idx] = macro;
  else macros.push(macro);
  await chrome.storage.local.set({ [STORAGE_KEY]: macros });
}

// ── 删除宏 ──
export async function deleteMacro(name: string): Promise<void> {
  const macros = await loadMacros();
  await chrome.storage.local.set({
    [STORAGE_KEY]: macros.filter((m) => m.name !== name),
  });
}

// ── 录制引擎 ──
let recording = false;
let recordName = '';
let recordSteps: AgentRequest[] = [];

export function startRecording(name: string): void {
  recording = true;
  recordName = name;
  recordSteps = [];
}

export function stopRecording(): void {
  recording = false;
}

export function isRecording(): boolean {
  return recording;
}

export async function finishRecording(): Promise<Macro | null> {
  if (!recording || recordSteps.length === 0) return null;

  const macro: Macro = {
    name: recordName,
    createdAt: Date.now(),
    steps: [...recordSteps],
  };

  await saveMacro(macro);
  recording = false;
  recordSteps = [];
  return macro;
}

export function recordStep(req: AgentRequest): void {
  if (recording) {
    recordSteps.push(req);
  }
}
