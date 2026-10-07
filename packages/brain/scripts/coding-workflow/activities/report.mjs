// report 活动：把 PR 等交付信息 PATCH 回 Brain 任务的 result.coding_workflow。
// 只传 result、不传 status（Brain 的 result 是 jsonb 顶层合并，不会覆盖已有的 handoff 等字段）。
import os from 'node:os';
import { runActivity, fail, log } from '../lib/protocol.mjs';

const DEFAULT_BRAIN_URL = 'http://localhost:5221';
const REQUEST_TIMEOUT_MS = 20000;

/** 失败响应的诊断信息：HTTP 状态 + 响应体 JSON 里的 code 字段（解析失败或没有则省略）。 */
async function httpEvidence(res) {
  const evidence = { http_status: res.status };
  try {
    const code = (await res.json())?.code;
    if (typeof code === 'string' || typeof code === 'number') evidence.body_code = code;
  } catch {
    // 响应体不是 JSON：只留 http_status
  }
  return evidence;
}

await runActivity(async (input) => {
  // 不碰文件系统，只需要 task_id；pr_url 缺失说明前序 publish 没完成，不发请求
  const taskId = input.task_id;
  if (typeof taskId !== 'string' || taskId === '') return fail('fatal', 'task_id_missing');
  if (typeof input.pr_url !== 'string' || input.pr_url === '') return fail('fatal', 'pr_url_missing');

  const base = String(input.brain_url || DEFAULT_BRAIN_URL).replace(/\/+$/, '');
  const url = `${base}/api/brain/tasks/${encodeURIComponent(taskId)}`;
  const body = {
    result: {
      coding_workflow: {
        pr_url: input.pr_url,
        branch: input.branch,
        sprint_dir: input.sprint_dir,
        chain_files: input.chain_files,
        run_tag: input.run_tag,
        host: os.hostname(),
      },
    },
  };

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const evidence = [await httpEvidence(res)];
      if (res.status === 404 || res.status === 400) return fail('fatal', 'task_not_found', { evidence });
      if (res.status >= 500 || res.status === 429 || res.status === 408) return fail('retryable', 'brain_unavailable', { evidence });
      return fail('fatal', `brain_http_${res.status}`, { evidence });
    }
  } catch (error) {
    log(`[report] PATCH ${url} 失败: ${error?.message || error}`);
    return fail('retryable', 'brain_unavailable');
  }

  return {
    status: 'completed',
    outputs: { reported: true },
    evidence: [`已回写 Brain 任务 ${taskId}：${input.pr_url}`],
  };
});
