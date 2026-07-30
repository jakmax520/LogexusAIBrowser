// Logexus AI Browser — File Offloader
// 大体积数据(>10KB)写入临时目录，MCP Response 仅返回 saved_path 指针

import { writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OFFLOAD_DIR = join(tmpdir(), 'logexus');
const TTL_MS = 3600_000;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

/** @type {Map<string, {path:string, expiresAt:number}>} */
const pending = new Map();

export async function init() {
  await mkdir(OFFLOAD_DIR, { recursive: true });
  await cleanupExpired();
  setInterval(cleanupExpired, 600_000);
  console.error('[FileOffloader] Init done, dir:', OFFLOAD_DIR);
}

/**
 * @param {string} taskId
 * @param {string} type - screenshot|network|console|perf|fullpage|pdf|cookies
 * @param {string} ext  - jpg|json|png|pdf|txt
 * @param {Buffer|string} data
 * @returns {Promise<{saved_path:string, size_bytes:number, format:string, expires_at:number}>}
 */
export async function offload(taskId, type, ext, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const fname = `${Date.now()}_${taskId}_${type}.${ext}`;
  const path = join(OFFLOAD_DIR, fname);
  await writeFile(path, buf);

  const size = (await stat(path)).size;
  const expiresAt = Date.now() + TTL_MS;
  pending.set(taskId, { path, expiresAt });
  await enforceMaxSize();

  return { saved_path: path, size_bytes: size, format: ext, expires_at: expiresAt };
}

async function cleanupExpired() {
  const now = Date.now();
  for (const [taskId, entry] of pending) {
    if (now >= entry.expiresAt) {
      await rm(entry.path).catch(() => {});
      pending.delete(taskId);
    }
  }
}

export async function cleanupAll() {
  for (const entry of pending.values()) {
    await rm(entry.path).catch(() => {});
  }
  pending.clear();
}

async function enforceMaxSize() {
  let total = 0;
  const entries = [];
  for (const [taskId, entry] of pending) {
    const s = (await stat(entry.path).catch(() => ({ size: 0 }))).size;
    total += s;
    entries.push({ taskId, ...entry });
  }
  if (total > MAX_TOTAL_BYTES) {
    entries.sort((a, b) => a.expiresAt - b.expiresAt);
    const toDelete = entries.slice(0, Math.ceil(entries.length / 2));
    for (const { taskId, path } of toDelete) {
      await rm(path).catch(() => {});
      pending.delete(taskId);
    }
    console.error('[FileOffloader] Enforced max size — removed', toDelete.length, 'files');
  }
}

/** 判断是否需要 offload：单条数据 > 10KB */
export function shouldOffload(data) {
  const len = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
  return len > 10240;
}
