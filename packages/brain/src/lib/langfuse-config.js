/**
 * langfuse-config.js — Langfuse 凭据加载（共享模块）
 *
 * 供 langfuse-reporter.js 和 routes/langfuse.js 共同引用，避免重复实现凭据加载逻辑。
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

let _config = null;
let _initAttempted = false;

/**
 * 从 ~/.credentials/langfuse.env 加载 Langfuse 凭据。
 * 返回配置对象，或 null（凭据缺失/文件不可读时）。
 * 结果被缓存，重复调用为 no-op。
 */
export function loadLangfuseConfig() {
  if (_initAttempted) return _config;
  _initAttempted = true;
  try {
    const credPath = join(homedir(), '.credentials', 'langfuse.env');
    const raw = readFileSync(credPath, 'utf-8');
    const cfg = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=["']?([^"'\n]+)["']?$/);
      if (m) cfg[m[1]] = m[2];
    }
    if (cfg.LANGFUSE_PUBLIC_KEY && cfg.LANGFUSE_SECRET_KEY && cfg.LANGFUSE_BASE_URL) {
      _config = cfg;
    }
  } catch {
    // Missing file or unreadable — stay disabled.
  }
  return _config;
}

export function _resetLangfuseConfig() {
  _config = null;
  _initAttempted = false;
}

export function _setLangfuseConfigForTesting(cfg) {
  _config = cfg;
  _initAttempted = true;
}
