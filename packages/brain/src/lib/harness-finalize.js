/**
 * harness-finalize — 收账权收归（决策 dc18d43d/c3f473eb）。
 * harness_initiative(skill-relay) 的任何 completed 请求一律当"申请"：
 * Brain 机械核验外部真相（PR MERGED + evaluator gate 事件）后才放行终态。
 * 不信任任何请求体自声明（LLM 跑 curl 可伪造）。核验失败保守拒绝。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { _parseBaseRepo, _hasEvaluatorGate } from '../harness-relay-watchdog.js';

const execFileAsync = promisify(execFile);

// 默认 gh 调用：execFile（无 shell）+ 参数数组化——彻底消灭引号注入面（pr_url 是 LLM 自报值，
// 本特性威胁模型正主）。异步不阻塞事件循环。deps.ghFn 可注入以便测试。
async function defaultGhFn(args) {
  const { stdout } = await execFileAsync('gh', args, { timeout: 10000 });
  return stdout;
}

export function isHarnessRelayTask(task) {
  return task?.task_type === 'harness_initiative' && task?.payload?.orchestrator === 'skill-relay';
}

function shortId(id) { return String(id).replace(/-/g, '').slice(0, 8); }

export async function finalizeHarnessTask(taskId, deps = {}) {
  const pool = deps.pool;
  const ghFn = deps.ghFn || defaultGhFn;

  const { rows } = await pool.query(
    `SELECT id, status, task_type, pr_url, payload FROM tasks WHERE id::text = $1`, [String(taskId)]
  );
  const task = rows[0];
  if (!task || !isHarnessRelayTask(task)) return { applies: false };

  const demote = async (reason) => {
    try {
      // 幂等：generator_done 每次可写；generator_done_at 仅首次写入（CASE WHEN payload ? 'generator_done_at'），
      // 防重复申请把首次降级时刻反复刷新，破坏 watchdog 6h 超时兜底的锚点。
      const upd = await pool.query(
        `UPDATE tasks SET payload = COALESCE(payload,'{}'::jsonb)
           || jsonb_build_object('generator_done', true)
           || CASE WHEN payload ? 'generator_done_at' THEN '{}'::jsonb
                   ELSE jsonb_build_object('generator_done_at', to_jsonb(NOW())) END
         WHERE id::text = $1 AND status = 'in_progress'`, [String(taskId)]
      );
      if ((upd?.rowCount ?? 0) === 0) {
        console.warn(`[harness-finalize] task=${taskId} 降级标记未落库（rowCount=0，任务非 in_progress）：${reason}`);
      }
    } catch (err) { console.warn(`[harness-finalize] generator_done 降级写失败（non-fatal）：${err.message}`); }
    console.warn(`[harness-finalize] task=${taskId} completed 申请被拒 → 降级中间态：${reason}`);
    return { applies: true, allow: false, reason };
  };

  // 1. 定位 PR 并核验 MERGED：tasks.pr_url → payload.pr_url → GitHub 分支名反查。
  //    pr_url 是 LLM 自报值——采信条件用完整正则严格锚定（与 _parseBaseRepo 白名单风格对齐）；
  //    不匹配即视同无 pr_url，落到 GitHub 分支名反查路径（真相来自 GitHub 非请求体）。
  const PR_URL_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
  let prUrl = [task.pr_url, task.payload?.pr_url].find(
    (u) => typeof u === 'string' && PR_URL_RE.test(u)
  ) || null;
  let prState = null;
  try {
    if (prUrl) {
      prState = JSON.parse(await ghFn(['pr', 'view', prUrl, '--json', 'state'])).state;
    } else {
      // 与 watchdog:44 _discoverPrFromGithub 同逻辑，但签名不同（无 shell 参数数组式 ghFn
      // vs watchdog 的 cmd 字符串 execFn）故独立实现——无 shell 优先，不复用字符串拼接路径。
      const repo = _parseBaseRepo(task.payload?.base_repo);
      if (repo) {
        const prs = JSON.parse(await ghFn(['pr', 'list', '--repo', repo, '--state', 'all', '--limit', '100', '--json', 'headRefName,url,state']));
        const hit = (Array.isArray(prs) ? prs : []).filter((p) => String(p?.headRefName || '').includes(shortId(taskId)));
        const merged = hit.find((p) => p.state === 'MERGED');
        if (merged) { prUrl = merged.url; prState = 'MERGED'; }
      }
    }
  } catch (err) {
    return demote(`pr_verify_failed: ${err.message}`);
  }
  if (prState !== 'MERGED') return demote(prUrl ? `pr_not_merged: state=${prState}` : 'pr_not_found');

  // 2. evaluator gate（外部真相第二判据，复用 watchdog 范式）
  const gated = await _hasEvaluatorGate(pool, taskId);
  if (!gated) return demote('no_evaluator_gate: PR 已 MERGED 但 evaluator 从未 done——需补验收');

  return { applies: true, allow: true, prUrl };
}
