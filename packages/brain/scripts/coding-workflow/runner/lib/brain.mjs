// Brain 任务 API 的最小客户端：列 queued、认领、PATCH（网络错误与 5xx 有限重试）。
const REQUEST_TIMEOUT_MS = 20000;
const MAX_LIST_GROWTH = 16;
export const EXECUTOR_KIND = 'coding-workflow-runner';
const RETRY_DELAYS_MS = [1000, 3000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: null, error: String(error?.message || error) };
  }
}

const retryable = (r) => r.status === 0 || r.status >= 500 || r.status === 429;

export function brainClient(baseUrl, { listLimit = 500, log = () => {} } = {}) {
  const tasksUrl = `${baseUrl}/api/brain/tasks`;
  const json = (method, body) => ({
    method,
    headers: { 'content-type': 'application/json', 'x-session-id': 'coding-workflow-runner' },
    body: JSON.stringify(body),
  });

  return {
    /**
     * GET 某状态的 data 任务（含 payload/result）。Brain 按 created_at 降序 + limit 截断、不支持翻页，
     * 满页说明可能截掉了最早的任务：加倍 limit 重查，直到不满页（上限 16 倍，仍满则记日志）。失败抛错。
     */
    async listTasks(status) {
      for (let limit = listLimit; ; limit *= 2) {
        const r = await request(`${tasksUrl}?status=${status}&task_type=data&limit=${limit}`, { method: 'GET' });
        if (!r.ok) throw new Error(`brain_list_failed:${r.status}${r.error ? `:${r.error}` : ''}`);
        const rows = Array.isArray(r.body) ? r.body : (Array.isArray(r.body?.tasks) ? r.body.tasks : []);
        if (rows.length < limit) return rows;
        if (limit >= listLimit * MAX_LIST_GROWTH) {
          log(`${status} 任务超过 ${limit} 条，最早的任务可能未列出`);
          return rows;
        }
      }
    },

    /** GET 单个任务；返回 { ok, status, body }。 */
    getTask(id) {
      return request(`${tasksUrl}/${encodeURIComponent(id)}`, { method: 'GET' });
    },

    /** POST /tasks/:id/claim，显式 executor_kind（Brain 视为外部执行体，不打回不清 claim）；409 = 已被别人认领。 */
    claim(id, claimer) {
      return request(`${tasksUrl}/${encodeURIComponent(id)}/claim`, json('POST', { claimer, executor_kind: EXECUTOR_KIND }));
    },

    /** PATCH /tasks/:id；网络错误、5xx、429 重试两次。返回最后一次 { ok, status, body }。 */
    async patch(id, body) {
      let r = await request(`${tasksUrl}/${encodeURIComponent(id)}`, json('PATCH', body));
      for (const delay of RETRY_DELAYS_MS) {
        if (r.ok || !retryable(r)) break;
        await sleep(delay);
        r = await request(`${tasksUrl}/${encodeURIComponent(id)}`, json('PATCH', body));
      }
      return r;
    },
  };
}
