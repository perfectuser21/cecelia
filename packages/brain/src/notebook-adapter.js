/**
 * NotebookLM CLI 松耦合适配器
 *
 * 通过 CLI 与 NotebookLM 交互：添加源 + 查询知识
 * 不可用时静默降级，不影响反刍流程
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const NOTEBOOKLM_CLI = '/home/xx/.local/bin/notebooklm';
const TIMEOUT_MS = 15000;

/**
 * 添加 URL 源到 NotebookLM（fire-and-forget）
 * @param {string} url - 要添加的 URL
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function addSource(url) {
  try {
    await execFileAsync(NOTEBOOKLM_CLI, ['add-source', '--url', url], {
      timeout: TIMEOUT_MS,
    });
    return { ok: true };
  } catch (err) {
    console.warn('[notebook-adapter] addSource failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 查询 NotebookLM 获取相关知识
 * @param {string} query - 查询内容
 * @returns {Promise<{ok: boolean, text?: string, error?: string}>}
 */
export async function queryNotebook(query) {
  try {
    const { stdout } = await execFileAsync(NOTEBOOKLM_CLI, ['query', '--q', query], {
      timeout: TIMEOUT_MS,
    });
    return { ok: true, text: stdout.trim() };
  } catch (err) {
    console.warn('[notebook-adapter] queryNotebook failed:', err.message);
    return { ok: false, error: err.message };
  }
}
