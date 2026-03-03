/**
 * NotebookLM 适配器 — 通过 cecelia-bridge 调用宿主机 CLI
 *
 * Brain 运行在 Docker 容器中（无 Python），通过 bridge HTTP 端点
 * 中转 NotebookLM CLI 调用。不可用时静默降级，不影响反刍流程。
 */

const BRIDGE_URL = process.env.EXECUTOR_BRIDGE_URL || 'http://localhost:3457';
const TIMEOUT_MS = 15000;
// queryNotebook 用更长的超时：notebooklm ask 命令自身需要 ~90s
export const QUERY_TIMEOUT_MS = 120000;

/**
 * 添加 URL 源到 NotebookLM（fire-and-forget）
 * @param {string} url - 要添加的 URL
 * @param {string} [notebookId] - 目标笔记本 ID（不传则使用当前激活笔记本）
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function addSource(url, notebookId) {
  try {
    const body = notebookId ? { url, notebook_id: notebookId } : { url };
    const response = await fetch(`${BRIDGE_URL}/notebook/add-source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await response.json();
    return data;
  } catch (err) {
    console.warn('[notebook-adapter] addSource failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 添加内联文本源到 NotebookLM（fire-and-forget）
 * 用于反刍洞察写回，形成持久化知识飞轮
 * @param {string} text - 要添加的文本内容
 * @param {string} [title] - 源标题
 * @param {string} [notebookId] - 目标笔记本 ID（不传则使用当前激活笔记本）
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function addTextSource(text, title, notebookId) {
  try {
    const body = notebookId ? { text, title, notebook_id: notebookId } : { text, title };
    const response = await fetch(`${BRIDGE_URL}/notebook/add-text-source`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await response.json();
    return data;
  } catch (err) {
    console.warn('[notebook-adapter] addTextSource failed:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 查询 NotebookLM 获取综合知识（主路：反刍深度思考）
 * 使用 120s 超时，因为 notebooklm ask 命令本身需要 ~90s
 * @param {string} query - 查询内容
 * @param {string} [notebookId] - 目标笔记本 ID（不传则使用当前激活笔记本）
 * @returns {Promise<{ok: boolean, text?: string, error?: string}>}
 */
export async function queryNotebook(query, notebookId) {
  try {
    const body = notebookId ? { query, notebook_id: notebookId } : { query };
    const response = await fetch(`${BRIDGE_URL}/notebook/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    const data = await response.json();
    return data;
  } catch (err) {
    console.warn('[notebook-adapter] queryNotebook failed:', err.message);
    return { ok: false, error: err.message };
  }
}
