/**
 * harness-finalize — 收账权收归（决策 dc18d43d/c3f473eb）。
 * harness_initiative(skill-relay) 的任何 completed 请求一律当"申请"：
 * Brain 机械核验外部真相（PR MERGED + evaluator gate 事件）后才放行终态。
 * 不信任任何请求体自声明（LLM 跑 curl 可伪造）。核验失败保守拒绝。
 */
import { execSync } from 'node:child_process';
import { _parseBaseRepo, _hasEvaluatorGate } from '../harness-relay-watchdog.js';

export function isHarnessRelayTask(task) {
  return task?.task_type === 'harness_initiative' && task?.payload?.orchestrator === 'skill-relay';
}

function shortId(id) { return String(id).replace(/-/g, '').slice(0, 8); }

export async function finalizeHarnessTask(taskId, deps = {}) {
  const pool = deps.pool;
  const execFn = deps.execFn || ((cmd) => execSync(cmd, { encoding: 'utf8', timeout: 10000 }));
  const { rows } = await pool.query(
    `SELECT id, status, task_type, pr_url, payload FROM tasks WHERE id = $1`, [taskId]
  );
  const task = rows[0];
  if (!task || !isHarnessRelayTask(task)) return { applies: false };

  const demote = async (reason) => {
    try {
      await pool.query(
        `UPDATE tasks SET payload = COALESCE(payload,'{}'::jsonb)
           || jsonb_build_object('generator_done', true, 'generator_done_at', to_jsonb(NOW()))
         WHERE id = $1 AND status = 'in_progress'`, [taskId]
      );
    } catch (err) { console.warn(`[harness-finalize] generator_done 降级写失败（non-fatal）：${err.message}`); }
    console.warn(`[harness-finalize] task=${taskId} completed 申请被拒 → 降级中间态：${reason}`);
    return { applies: true, allow: false, reason };
  };

  // 1. 定位 PR 并核验 MERGED：tasks.pr_url → payload.pr_url → GitHub 分支名反查
  let prUrl = [task.pr_url, task.payload?.pr_url].find(
    (u) => typeof u === 'string' && u.startsWith('https://github.com/')
  ) || null;
  let prState = null;
  try {
    if (prUrl) {
      prState = JSON.parse(execFn(`gh pr view "${prUrl}" --json state`)).state;
    } else {
      const repo = _parseBaseRepo(task.payload?.base_repo);
      if (repo) {
        const prs = JSON.parse(execFn(`gh pr list --repo "${repo}" --state all --limit 100 --json headRefName,url,state`));
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
