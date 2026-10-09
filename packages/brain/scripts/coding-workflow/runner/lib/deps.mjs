// 任务依赖：候选任务的 payload.depends_on 全部"完成且 PR 已合并"才可认领（新 worktree 从 origin/main 建，前置必须已进 main）。
import { run } from './proc.mjs';
import { depsOf } from './plan.mjs';

const GH_TIMEOUT_MS = 60 * 1000;
const FAILED_STATUSES = new Set(['failed', 'cancelled', 'canceled', 'quarantined']);

function prUrlOf(task) {
  const r = task?.result ?? {};
  return r.coding_workflow?.pr_url || r.merged_pr || r.pr_url || null;
}

/** 单个前置：'merged' | 'waiting' | 'failed'，附原因。 */
async function depState(ctx, id) {
  const r = await ctx.brain.getTask(id);
  if (!r.ok || !r.body) return { state: 'waiting', why: `${id} 查不到（HTTP ${r.status}）` };
  const task = r.body;
  if (FAILED_STATUSES.has(task.status)) return { state: 'failed', why: `${id} 状态 ${task.status}` };
  if (task.status !== 'completed') return { state: 'waiting', why: `${id} 状态 ${task.status}` };
  const url = prUrlOf(task);
  if (!url || task.result?.merged === true) return { state: 'merged' };
  const view = await run(ctx.cfg.ghBin, ['pr', 'view', url, '--json', 'state'], { cwd: ctx.cfg.repo, timeoutMs: GH_TIMEOUT_MS });
  let pr = null;
  try {
    pr = JSON.parse(view.stdout).state;
  } catch { /* gh 出错按未就绪处理，下轮再查 */ }
  if (pr === 'MERGED') return { state: 'merged' };
  if (pr === 'CLOSED') return { state: 'failed', why: `${id} 的 PR 已关闭未合并` };
  return { state: 'waiting', why: `${id} 的 PR ${pr ?? '状态未知'}` };
}

/** 过滤出前置全部合并的候选；被挡的记日志说明原因（前置失败需 Commander 处理，不会自动放行）。 */
export async function readyCandidates(ctx, candidates) {
  const ready = [];
  for (const task of candidates) {
    const deps = depsOf(task);
    let blocked = null;
    for (const id of deps) {
      const s = await depState(ctx, id);
      if (s.state !== 'merged') {
        blocked = s;
        break;
      }
    }
    if (!blocked) {
      ready.push(task);
      continue;
    }
    ctx.log(`任务 ${task.id} ${blocked.state === 'failed' ? '前置失败' : '前置未就绪'}：${blocked.why}，本轮不认领`);
  }
  return ready;
}
