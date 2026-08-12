/**
 * callback-utils.js — 执行回调公共工具函数
 *
 * 供 callback-processor.js（队列消费）和 routes/execution.js（HTTP fallback）共用。
 */

/**
 * 将外部回调 status 字符串映射为内部 DB 状态。
 *
 * 兼容两套 callback contract：
 *   - bridge / cecelia-run.sh：'AI Done' / 'AI Failed' / 'AI Quota Exhausted'
 *   - docker-executor.writeDockerCallback：'success' / 'failed' / 'timeout'
 *
 * docker-executor 与本处理器的 contract 不一致曾导致跑成功的容器任务卡在
 * in_progress，60min 后被 tick 误判超时 → 三次失败 quarantine（修于本次）。
 */
export function normalizeCallbackStatus(status) {
  if (status === 'AI Done' || status === 'success') return 'completed';
  if (status === 'AI Failed' || status === 'failed' || status === 'timeout') return 'failed';
  if (status === 'AI Quota Exhausted') return 'quota_exhausted';
  return 'in_progress';
}

/**
 * 从 GitHub PR URL 提取数字 PR 编号。
 * 例："https://github.com/org/repo/pull/123" → 123
 * 无 URL 或无匹配返回 null。
 */
export function extractPrNumber(pr_url) {
  if (!pr_url) return null;
  const m = pr_url.match(/\/pull\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * 如果 dev 任务完成时没有 PR URL，将 newStatus 改为 'completed_no_pr'。
 * Harness 模式任务和 decomposition 任务豁免（它们不需要 PR）。
 *
 * @returns {Promise<string>} 可能已更新的 newStatus
 */
const GITHUB_PR_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

export function isValidGithubPrUrl(url) {
  return typeof url === 'string' && GITHUB_PR_URL_RE.test(url.trim());
}

function _isValidGithubPrUrl(url) { return isValidGithubPrUrl(url); }

/**
 * 纯函数：从 explicit URL + task row 解析权威 pr_url（无 DB 查询）。
 * 优先级：explicit > task.pr_url > task.payload.pr_url > task.payload.existing_pr_url
 * 供 docker-executor 直接传入已有 task 对象使用。
 */
export function resolveCanonicalPrUrlSync(explicitUrl, taskRow) {
  if (isValidGithubPrUrl(explicitUrl)) return explicitUrl;
  const candidate = taskRow?.pr_url
    || taskRow?.payload?.pr_url
    || taskRow?.payload?.existing_pr_url;
  return isValidGithubPrUrl(candidate) ? candidate : null;
}

/**
 * 解析权威 pr_url：callback/stdout > tasks.pr_url > payload.pr_url > payload.existing_pr_url。
 * 单一 resolver，Docker queue、callback-processor、HTTP fallback 共用。
 *
 * Fix C: 逐项独立校验，invalid 高优先级不遮蔽合法低优先级。
 * 每个来源先 trim 再校验；返回首个通过校验的 trimmed URL。
 *
 * @returns {Promise<string|null>} 合法的 GitHub PR URL 或 null
 */
export async function resolveCanonicalPrUrl(callbackPrUrl, task_id, pool) {
  // Priority 1: explicit callback/stdout
  const trimmedExplicit = typeof callbackPrUrl === 'string' ? callbackPrUrl.trim() : null;
  if (_isValidGithubPrUrl(trimmedExplicit)) return trimmedExplicit;

  try {
    const { rows } = await pool.query(
      'SELECT pr_url, payload FROM tasks WHERE id = $1',
      [task_id]
    );
    const row = rows[0];
    if (!row) return null;

    // Priority 2: tasks.pr_url（独立校验，不用 || 短路）
    const trimmedTaskPrUrl = typeof row.pr_url === 'string' ? row.pr_url.trim() : null;
    if (_isValidGithubPrUrl(trimmedTaskPrUrl)) return trimmedTaskPrUrl;

    // Priority 3: payload.pr_url
    const trimmedPayloadPrUrl = typeof row.payload?.pr_url === 'string' ? row.payload.pr_url.trim() : null;
    if (_isValidGithubPrUrl(trimmedPayloadPrUrl)) return trimmedPayloadPrUrl;

    // Priority 4: payload.existing_pr_url
    const trimmedExistingUrl = typeof row.payload?.existing_pr_url === 'string' ? row.payload.existing_pr_url.trim() : null;
    if (_isValidGithubPrUrl(trimmedExistingUrl)) return trimmedExistingUrl;

    return null;
  } catch {
    return null;
  }
}

export async function maybeMarkCompletedNoPr(newStatus, pr_url, task_id, pool, prefix) {
  if (newStatus !== 'completed' || pr_url) return newStatus;
  try {
    const taskRow = await pool.query(
      'SELECT task_type, pr_url, payload FROM tasks WHERE id = $1',
      [task_id]
    );
    const row = taskRow.rows[0];
    if (!row) return newStatus;
    const taskType = row.task_type;
    const isDecomposition = row.payload?.decomposition;
    if (taskType === 'dev' && !isDecomposition) {
      const isHarness = row.payload?.harness_mode;
      if (!isHarness) {
        // Fix C: 逐项独立校验（invalid tasks.pr_url 不遮蔽合法 payload.existing_pr_url）
        // 场景：Agent stdout 只写 "PR #4827"，tasks.pr_url="PR #4827"（非法），
        //       tasks.payload.existing_pr_url 有完整合法 URL。
        const t1 = typeof row.pr_url === 'string' ? row.pr_url.trim() : null;
        const t2 = typeof row.payload?.pr_url === 'string' ? row.payload.pr_url.trim() : null;
        const t3 = typeof row.payload?.existing_pr_url === 'string' ? row.payload.existing_pr_url.trim() : null;
        const hasCanonical = _isValidGithubPrUrl(t1) || _isValidGithubPrUrl(t2) || _isValidGithubPrUrl(t3);
        if (hasCanonical) {
          console.log(`[${prefix}] Dev task ${task_id} has canonical pr_url from DB/payload → skip completed_no_pr`);
          return newStatus;
        }
        console.warn(`[${prefix}] Dev task ${task_id} completed without PR → completed_no_pr`);
        return 'completed_no_pr';
      }
    }
  } catch (prCheckErr) {
    console.error(`[${prefix}] PR check error (non-fatal): ${prCheckErr.message}`);
  }
  return newStatus;
}

/**
 * 从 result 对象提取 findings 字符串（供 decomp-checker 读取）。
 * result 可以是 string 或含 findings/result 字段的 object。
 */
export function extractFindingsValue(result) {
  const raw = (result !== null && typeof result === 'object')
    ? (result.findings || result.result || result)
    : result;
  if (!raw) return null;
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}

/**
 * 构建 last_run_result payload 对象（写入 tasks.payload）。
 */
export function buildLastRunResult({ run_id, checkpoint_id, status, duration_ms, iterations, pr_url, result }) {
  return {
    run_id,
    checkpoint_id,
    status,
    duration_ms,
    iterations,
    pr_url: pr_url || null,
    completed_at: new Date().toISOString(),
    result_summary: (result !== null && typeof result === 'object') ? result.result : result,
  };
}

export const EXEC_META_KEYS = ['duration_ms', 'total_cost_usd', 'num_turns', 'input_tokens', 'output_tokens'];

/**
 * 从 result 对象中提取执行元数据（duration_ms 等）并序列化为 JSON 字符串。
 * 若 result 不是对象或不含任何元数据键，返回 null。
 * 使用条件写入（仅 result 为空时写入）保证幂等性。
 */
export function buildExecMetaJson(result) {
  if (result === null || typeof result !== 'object') return null;
  const hasAnyMetaKey = EXEC_META_KEYS.some(k => k in result);
  if (!hasAnyMetaKey) return null;
  const execMeta = {};
  for (const k of EXEC_META_KEYS) execMeta[k] = result[k] ?? 0;
  return JSON.stringify(execMeta);
}

/**
 * 为失败任务构建 errorMessage 和 blockedDetail 字段。
 * 仅在 newStatus === 'failed' 时返回有效值，否则两者均为 null。
 *
 * @returns {{ errorMessage: string|null, blockedDetail: string|null }}
 */
export function buildFailureFields(newStatus, result, stderr, exit_code, task_id) {
  if (newStatus !== 'failed') return { errorMessage: null, blockedDetail: null };

  let errorMessage;
  if (result === null) {
    const ts = new Date().toISOString();
    const exitCodeStr = exit_code != null ? exit_code : 'N/A';
    let fallback = `[callback: result=null] task=${task_id} exit_code=${exitCodeStr} at ${ts} | callback received but result was null`;
    const stderrTail = stderr ? String(stderr).slice(-300) : '';
    if (stderrTail) fallback += ` | stderr: ${stderrTail}`;
    errorMessage = fallback;
  } else if (typeof result === 'object') {
    errorMessage = result.result || result.error || result.stderr || JSON.stringify(result);
  } else {
    errorMessage = String(result);
  }
  errorMessage = errorMessage.slice(0, 2000);

  const stderrSource = stderr
    || (result !== null && typeof result === 'object' ? result.stderr : null)
    || (typeof result === 'string' ? result : '');
  const blockedDetail = JSON.stringify({
    exit_code: exit_code != null ? exit_code : 1,
    stderr_tail: String(stderrSource || '').slice(-500),
    timestamp: new Date().toISOString(),
  });

  return { errorMessage, blockedDetail };
}
