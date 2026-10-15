// QA 门 / CI 修复状态的外部真相（审计 #34，旧 harness「台账先行，信外部真相」）：
// 本机 logDir/qa-<pr>.json、cifix-<pr>.json 是工作副本；关键字段（批准、升级、合并、计数）每轮有变化就写进
// Brain 任务 result.qa_state / result.ci_fix_state。本机文件缺失（换机、被删）时从 Brain 恢复，
// 不会把已升级、已批准的 PR 当新的重新处理。
// 人工重置一个 PR（例如清掉升级重跑）必须两边一起清：删本机文件，并把 Brain 的 result.<kind>_state 置 null。
import fs from 'node:fs';
import { syncTaskId, syncTask, rememberPr, syncEntry, forgetSyncedPr, validSyncPr } from './pr-sync.mjs';
import { prFile, stateDir } from './repos.mjs';

const KINDS = {
  qa: { file: (pr) => `qa-${pr}.json`, key: 'qa_state', fields: ['passed', 'approved', 'escalated', 'merged', 'revoked', 'bad', 'judge_bad', 'judge_pending', 'merge_failures', 'rounds', 'preview', 'preview_stopped', 'last_eval_error', 'cost_usd', 'stall_floor', 'smoke', 'smoke_note', 'smoke_missing', 'smoke_waived', 'smoke_refit', 'closed', 'reopened', 'awaiting_human'] },
  cifix: { file: (pr) => `cifix-${pr}.json`, key: 'ci_fix_state', fields: ['attempts', 'archived_attempts', 'reruns', 'escalated', 'update_branch', 'cost_usd'] },
  commander: { file: (pr) => `commander-${pr}.json`, key: 'commander_state', fields: ['interventions', 'human'] },
};
const MIRRORED = 'mirrored';

const filePath = (cfg, kind, pr) => prFile(cfg, KINDS[kind].file(pr));

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function pick(kind, s) {
  return Object.fromEntries(KINDS[kind].fields.filter((f) => s[f] !== undefined).map((f) => [f, s[f]]));
}

/** 本机缺状态文件的 PR：从 Brain 任务 result 恢复。尽力而为，失败只记日志。 */
export async function restoreStates(ctx, prs) {
  for (const pr of prs ?? []) {
    if (!validSyncPr(pr)) continue;
    for (const kind of Object.keys(KINDS)) {
      const file = filePath(ctx.cfg, kind, pr.number);
      if (fs.existsSync(file)) continue;
      try {
        const taskId = await syncTaskId(ctx, pr);
        if (!taskId) continue;
        const task = await syncTask(ctx, taskId, pr);
        const saved = task.result?.[KINDS[kind].key];
        if (!saved || typeof saved !== 'object') continue;
        fs.mkdirSync(stateDir(ctx.cfg), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify({ ...saved, [MIRRORED]: JSON.stringify(pick(kind, saved)) }, null, 2)}\n`);
        ctx.log(`PR #${pr.number} 本机没有 ${KINDS[kind].file(pr.number)}，已从 Brain 任务 ${taskId} 恢复`);
      } catch (error) {
        ctx.log(`PR #${pr.number} 从 Brain 恢复状态失败：${error?.message || error}`);
      }
    }
  }
}

/** 关键字段与上次写入 Brain 的不同 → PATCH result.<kind>_state；成功后记下已同步的快照。尽力而为。 */
export async function mirrorStates(ctx, prs) {
  // ctx.syncPrs 包含本轮确认的终态，以及合并门当轮更新后的身份；不能用旧 open 列表盖掉它。
  const candidates = new Map((prs ?? []).filter(validSyncPr).map((pr) => [pr.number, pr]));
  for (const [number, pr] of ctx.syncPrs ?? []) candidates.set(number, pr);
  for (const pr of candidates.values()) {
    rememberPr(ctx, pr);
    for (const kind of Object.keys(KINDS)) {
      const file = filePath(ctx.cfg, kind, pr.number);
      const s = readJson(file);
      if (!s) continue;
      const snapshot = JSON.stringify(pick(kind, s));
      if (s[MIRRORED] === snapshot) continue;
      try {
        const taskId = await syncTaskId(ctx, pr);
        if (!taskId) continue;
        const task = await syncTask(ctx, taskId, pr);
        const prior = task.result?.[KINDS[kind].key];
        // 远端非镜像扩展字段留在原处；镜像字段完全以本机当前快照为准，撤销的字段也要消失。
        const extra = prior && typeof prior === 'object' && !Array.isArray(prior)
          ? Object.fromEntries(Object.entries(prior).filter(([key]) => !KINDS[kind].fields.includes(key))) : {};
        const r = await ctx.brain.patch(taskId, { result: { [KINDS[kind].key]: { ...extra, ...JSON.parse(snapshot) } } });
        if (!r.ok) {
          ctx.log(`PR #${pr.number} 状态写入 Brain 失败（HTTP ${r.status}），下轮重试`);
          continue;
        }
        const latest = readJson(file);
        if (latest) fs.writeFileSync(file, `${JSON.stringify({ ...latest, [MIRRORED]: snapshot }, null, 2)}\n`);
      } catch (error) {
        ctx.log(`PR #${pr.number} 状态写入 Brain 失败：${error?.message || error}`);
      }
    }
    const qa = readJson(filePath(ctx.cfg, 'qa', pr.number)) ?? {};
    const entry = syncEntry(ctx.cfg, pr);
    const terminal = pr.state === 'CLOSED' ? Boolean(qa.closed) : pr.state === 'MERGED' && Boolean(qa.merged);
    const previewDone = !ctx.cfg.qaGate || (ctx.cfg.previewType ?? 'brain_preview') !== 'brain_preview' || qa.preview_stopped;
    if (terminal && previewDone && !entry?.receipt_pending && !entry?.learning_pending && !hasUnmirroredStates(ctx.cfg, pr.number)) forgetSyncedPr(ctx, pr);
  }
}

export function hasUnmirroredStates(cfg, pr) {
  return Object.keys(KINDS).some((kind) => {
    const s = readJson(filePath(cfg, kind, pr));
    return s && s[MIRRORED] !== JSON.stringify(pick(kind, s));
  });
}
