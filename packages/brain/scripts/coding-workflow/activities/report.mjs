// report 活动：把 PR 等交付信息 PATCH 回 Brain 任务的 result.coding_workflow。
// 只传 result、不传 status（Brain 的 result 是 jsonb 顶层合并，不会覆盖已有的 handoff 等字段）。
// 链在 verify 失败（没有 PR）时，把 verification 失败结论回写到 result.coding_workflow。
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

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 合同对抗摘要与升级记录（有才带）：coding commander 从 Brain 的 result.coding_workflow 读取并处理升级。 */
const ganFields = (input) => ({
  ...(isPlainObject(input.gan) ? { gan: input.gan } : {}),
  ...(Array.isArray(input.escalations) && input.escalations.length > 0 ? { escalations: input.escalations } : {}),
});

/**
 * 回写内容：有 pr_url → 交付信息（有 verification 一并带上）；
 * 没有 pr_url 但有 verification（链在验收处失败）→ 失败结论；两者都没有返回 null。
 */
function codingWorkflowResult(input) {
  const verification = isPlainObject(input.verification) ? input.verification : undefined;
  if (typeof input.pr_url === 'string' && input.pr_url !== '') {
    return {
      pr_url: input.pr_url,
      branch: input.branch,
      sprint_dir: input.sprint_dir,
      chain_files: input.chain_files,
      run_tag: input.run_tag,
      host: os.hostname(),
      ...(verification ? { verification } : {}),
      ...ganFields(input),
    };
  }
  if (verification) return { status: 'failed', run_tag: input.run_tag, sprint_dir: input.sprint_dir, verification, ...ganFields(input) };
  return null;
}

await runActivity(async (input) => {
  // 不碰文件系统，只需要 task_id；既无 pr_url 又无失败结论说明前序没走到可回写的地步，不发请求
  const taskId = input.task_id;
  if (typeof taskId !== 'string' || taskId === '') return fail('fatal', 'task_id_missing');
  const codingWorkflow = codingWorkflowResult(input);
  if (!codingWorkflow) return fail('fatal', 'pr_url_missing');

  const base = String(input.brain_url || DEFAULT_BRAIN_URL).replace(/\/+$/, '');
  const url = `${base}/api/brain/tasks/${encodeURIComponent(taskId)}`;
  const body = { result: { coding_workflow: codingWorkflow } };

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

  const what = codingWorkflow.pr_url ?? `验收失败 ${codingWorkflow.verification.reason_code}`;
  return {
    status: 'completed',
    outputs: { reported: true },
    evidence: [`已回写 Brain 任务 ${taskId}：${what}`],
  };
});
