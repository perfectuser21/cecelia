// Brain 任务 API 的最小客户端：列 queued、认领、PATCH（网络错误与 5xx 有限重试）。
const REQUEST_TIMEOUT_MS = 20000;
const MAX_LIST_GROWTH = 16;
export const EXECUTOR_KIND = 'coding-workflow-runner';
const RETRY_DELAYS_MS = [1000, 3000];
/** 候选类型：旧借壳 data 在前（迁移窗口），独立类型 coding_workflow 在后（任务 0a70684f）。 */
const LIST_TASK_TYPES = ['data', 'coding_workflow'];

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
  // Brain 内部令牌（runner.sh 从凭据文件读入）：POST /spans 等内部入口走 internalAuthOrLoopback，runner 经 socat 不算 loopback
  const internal = process.env.CECELIA_INTERNAL_TOKEN ? { 'x-internal-token': process.env.CECELIA_INTERNAL_TOKEN } : {};
  const json = (method, body) => ({
    method,
    headers: { 'content-type': 'application/json', 'x-session-id': 'coding-workflow-runner', ...internal },
    body: JSON.stringify(body),
  });

  async function listByType(status, taskType) {
    for (let limit = listLimit; ; limit *= 2) {
      const r = await request(`${tasksUrl}?status=${status}&task_type=${taskType}&limit=${limit}`, { method: 'GET' });
      if (!r.ok) throw new Error(`brain_list_failed:${r.status}${r.error ? `:${r.error}` : ''}`);
      const rows = Array.isArray(r.body) ? r.body : (Array.isArray(r.body?.tasks) ? r.body.tasks : []);
      if (rows.length < limit) return rows;
      if (limit >= listLimit * MAX_LIST_GROWTH) {
        log(`${status} ${taskType} 任务超过 ${limit} 条，最早的任务可能未列出`);
        return rows;
      }
    }
  }

  return {
    /**
     * GET 某状态的候选任务（含 payload/result）：旧借壳 data + 独立类型 coding_workflow（派发总闸 F，任务 0a70684f）
     * 两类各查一遍按 id 去重合并。Brain 按 created_at 降序 + limit 截断、不支持翻页，满页说明可能截掉了最早的任务：
     * 加倍 limit 重查，直到不满页（上限 16 倍，仍满则记日志）。失败抛错。
     */
    async listTasks(status) {
      const seen = new Set();
      const merged = [];
      for (const taskType of LIST_TASK_TYPES) {
        for (const row of await listByType(status, taskType)) {
          if (row?.id && seen.has(row.id)) continue;
          if (row?.id) seen.add(row.id);
          merged.push(row);
        }
      }
      return merged;
    },

    /** GET 单个任务；返回 { ok, status, body }。 */
    getTask(id) {
      return request(`${tasksUrl}/${encodeURIComponent(id)}`, { method: 'GET' });
    },

    /** POST /tasks/:id/claim，显式 executor_kind（Brain 视为外部执行体，不打回不清 claim）；409 = 已被别人认领。 */
    claim(id, claimer, leaseSeconds) {
      const lease = leaseSeconds ? { lease_seconds: leaseSeconds } : {};
      return request(`${tasksUrl}/${encodeURIComponent(id)}/claim`, json('POST', { claimer, executor_kind: EXECUTOR_KIND, ...lease }));
    },

    /** POST /tasks/:id/heartbeat（统一领单租约续约）；409 = 租约已被 Brain 回收，404 = 旧 Brain 无此端点。 */
    heartbeat(id, claimer, leaseSeconds) {
      return request(`${tasksUrl}/${encodeURIComponent(id)}/heartbeat`, json('POST', { claimer, lease_seconds: leaseSeconds }));
    },

    /** POST /spans（决策 b34e346a：执行记录，单条或数组）；返回 { ok, status, body }。 */
    postSpans(rows) {
      return request(`${baseUrl}/api/brain/spans`, json('POST', rows));
    },

    /** POST /learnings-received（审计 #22：交付复盘落库，必须带 task_id）；返回 { ok, status, body }。 */
    postLearnings(body) {
      return request(`${baseUrl}/api/brain/learnings-received`, json('POST', body));
    },

    /** 只读确认 learnings-received 返回的 ID 与原文；该列表无 task_id 过滤。 */
    listLearnings({ limit = 100, offset = 0 } = {}) {
      return request(`${baseUrl}/api/brain/learnings?limit=${limit}&offset=${offset}`, { method: 'GET' });
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
