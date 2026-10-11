/**
 * 技能工厂一轮：先自动裁判（任务 2231ecc0），再推进器（任务 a5f42455）。挂 scheduler-jobs（factory-cycle），按 FACTORY_CYCLE_INTERVAL_MS 自 gate。
 *
 * 开关（默认开）：环境变量 FACTORY_PUSHER_ENABLED=false，或 brain_config key=factory_pusher_enabled value=false（不重启即生效）。
 */
import { STAGE_NAMES, listLedger, transitionLedger, patchLedger, recordRun, resetLedgerWindow } from './factory-ledger.js';
import { decideLedger, buildExecSpec, buildTicketSpec, PUSHER_TAG } from './factory-pusher.js';
import { makeJudgeStore, runFactoryJudge, JUDGE_KEY } from './factory-judge.js';
import { resolveWorkflowConfig } from './factory-workflow-config.js';

export const FACTORY_CYCLE_INTERVAL_MS = Number(process.env.FACTORY_PUSHER_INTERVAL_MS) > 0
  ? Number(process.env.FACTORY_PUSHER_INTERVAL_MS) : 5 * 60 * 1000;
const OPEN = ['queued', 'in_progress', 'blocked', 'paused'];

export async function isFactoryPusherEnabled(db, env = process.env) {
  if (String(env.FACTORY_PUSHER_ENABLED ?? '').toLowerCase() === 'false') return false;
  try {
    const { rows } = await db.query("SELECT value FROM brain_config WHERE key = 'factory_pusher_enabled'");
    if (rows.length && ['false', '"false"', '0', 'off'].includes(String(rows[0].value).trim().toLowerCase())) return false;
  } catch { /* 配置表不可读按默认开 */ }
  return true;
}

/** 推进器真库查询。 */
export function makePusherStore(db) {
  return {
    listLedgers: () => listLedger(db, { limit: 500 }),
    /** 在途：本行任何未结束的单；或已终态但裁判未出最终结论的执行单（等核验）。 */
    async inFlight(ledgerId) {
      const { rows } = await db.query(
        `SELECT id, status, task_type FROM tasks
          WHERE payload->>'factory_ledger_id' = $1
            AND (status = ANY($2::text[])
                 OR (payload->>'factory_dispatch' = 'true' AND COALESCE(payload->'factory'->>'stage','') <> 'verify'
                     AND status IN ('completed','failed') AND result ? 'delivery'
                     AND COALESCE(result->'${JUDGE_KEY}'->>'state','') <> 'final'))
          ORDER BY created_at DESC LIMIT 1`, [ledgerId, OPEN]);
      return rows[0] || null;
    },
    async countRounds(ledgerId, stage) {
      const { rows } = await db.query(
        `SELECT count(*)::int AS n FROM tasks WHERE payload->>'factory_ledger_id' = $1
            AND payload->>'factory_dispatch' = 'true' AND payload->'factory'->>'stage' = $2`, [ledgerId, String(stage)]);
      return rows[0]?.n ?? 0;
    },
    /** 本阶段（stage_changed_at 之后）已最终裁判的执行单，从新到旧数连续 fail（safe_stop 不计、inconclusive 跳过）。 */
    async consecutiveFails(ledgerId, stage, since) {
      const { rows } = await db.query(
        `SELECT result->'${JUDGE_KEY}' AS j FROM tasks
          WHERE payload->>'factory_ledger_id' = $1 AND payload->>'factory_dispatch' = 'true'
            AND payload->'factory'->>'stage' = $2 AND result->'${JUDGE_KEY}'->>'state' = 'final'
            AND created_at >= $3
          ORDER BY COALESCE(completed_at, updated_at) DESC LIMIT 50`, [ledgerId, String(stage), since]);
      let n = 0;
      for (const { j } of rows) {
        if (j.verdict === 'pass') break;
        if (j.verdict === 'fail' && !j.safe_stop) n += 1;
      }
      return n;
    },
    async tickets(ledgerId, stage, since) {
      const { rows } = await db.query(
        `SELECT count(*) FILTER (WHERE status = 'completed')::int AS done, count(*)::int AS total FROM tasks
          WHERE payload->>'factory_ledger_id' = $1 AND (payload->>'factory_ticket_stage')::int = $2 AND created_at >= $3`,
        [ledgerId, stage, since]);
      return { done: rows[0]?.done ?? 0, total: rows[0]?.total ?? 0 };
    },
  };
}

async function setNextAction(db, ledger, text) {
  const next = `${PUSHER_TAG} ${text}`;
  if (ledger.next_action === next) return false;
  await patchLedger(db, ledger.id, { next_action: next });
  return true;
}

/** 执行一行的决策动作。返回执行摘要。 */
async function applyActions(db, ledger, cfg, decision, deps) {
  const done = [];
  let summary = decision.reason;
  for (const a of decision.actions) {
    if (a.type === 'transition') {
      await transitionLedger(db, ledger.id, { to_stage: a.to_stage, actor: 'rule', actor_name: 'factory-pusher', reason: a.reason, evidence_run_ids: a.evidence_run_ids, expected_from_stage: ledger.stage });
      summary = a.reason;
    } else if (a.type === 'reset_window') {
      await resetLedgerWindow(db, ledger.id, { reason: a.reason, actorName: 'factory-pusher', expectedStage: ledger.stage, evidenceRunIds: a.evidence_run_ids });
    } else if (a.type === 'block') {
      await patchLedger(db, ledger.id, { blocked_kind: a.kind, blocked_reason: a.reason });
      if (a.kind === 'resource') summary = `资源卡点：${a.reason}`;
    } else if (a.type === 'unblock') {
      await patchLedger(db, ledger.id, { blocked_kind: 'none', blocked_reason: null });
    } else if (a.type === 'dispatch') {
      const round = (await deps.store.countRounds(ledger.id, a.stage)) + 1;
      const out = await deps.createTask(buildExecSpec({ ledger, cfg, stage: a.stage, skill: a.skill, round }));
      const id = out?.task?.id;
      if (!id) throw new Error(`执行单建单失败：${JSON.stringify(out).slice(0, 200)}`);
      summary = `已建 ${a.stage} ${STAGE_NAMES[a.stage]} 执行单 ${id}（第 ${round} 轮，技能 ${a.skill}，滑窗 ${ledger.recent_pass}/${ledger.window_k}），等派发器认领`;
      a.task_id = id;
    } else if (a.type === 'dev_ticket' || a.type === 'commander_ticket') {
      const kind = a.type === 'dev_ticket' ? 'dev' : 'commander';
      const out = await deps.createTask(buildTicketSpec({ ledger, cfg, stage: a.stage, kind }));
      const id = out?.task?.id;
      if (!id) throw new Error(`工单建单失败：${JSON.stringify(out).slice(0, 200)}`);
      summary = `已建 ${a.stage} ${STAGE_NAMES[a.stage]} ${kind === 'dev' ? '/dev' : 'Commander'} 工单 ${id}，完成后自动推进`;
      a.task_id = id;
    } else if (a.type === 'notify') {
      await Promise.resolve(deps.raise?.(a.level, 'factory_guard_regress', a.message)).catch(() => {});
    }
    done.push(a);
  }
  const keep = decision.keep && String(ledger.next_action || '').includes(decision.keep);
  if (!keep) await setNextAction(db, ledger, summary);
  return { ledger_id: ledger.id, stage: ledger.stage, reason: decision.reason, actions: done.map((a) => ({ type: a.type, ...(a.task_id ? { task_id: a.task_id } : {}), ...(a.to_stage ? { to_stage: a.to_stage } : {}) })) };
}

export async function runFactoryPusher(db, deps) {
  const now = deps.now ? deps.now() : new Date();
  const results = [];
  for (const ledger of await deps.store.listLedgers()) {
    try {
      const cfg = deps.resolveConfig(ledger.workflow_key);
      const inFlight = await deps.store.inFlight(ledger.id);
      const consecutiveFails = ledger.stage === 3 ? await deps.store.consecutiveFails(ledger.id, 3, ledger.stage_changed_at) : 0;
      const t = [4, 5, 6].includes(ledger.stage) ? await deps.store.tickets(ledger.id, ledger.stage, ledger.stage_changed_at) : { done: 0, total: 0 };
      const decision = decideLedger({ ledger, cfg, inFlight, consecutiveFails, ticketsDone: t.done, ticketsTotal: t.total, now });
      results.push(await applyActions(db, ledger, cfg, decision, deps));
    } catch (e) {
      (deps.log || console.warn)(`推进台账 ${ledger.id} 失败：${e.message}`);
      results.push({ ledger_id: ledger.id, error: e.message, code: e.code });
    }
  }
  return results;
}

/** tick 入口：开关 → 裁判 → 推进器（进程内互斥，上一轮没跑完跳过）。deps 可注入（测试）。 */
let cycleRunning = false;
let lastRunAt = 0;
/** 调度器每 60s 全调所有 job（cadence 只是声明），这里按 FACTORY_CYCLE_INTERVAL_MS 自 gate；deps.force 越过（smoke 用）。 */
export async function runFactoryCycle(db, deps = {}) {
  const nowMs = (deps.now ? deps.now() : new Date()).getTime();
  if (!deps.force && nowMs - lastRunAt < FACTORY_CYCLE_INTERVAL_MS) return { skipped: 'throttled' };
  if (cycleRunning) return { skipped: 'running' };
  lastRunAt = nowMs;
  cycleRunning = true;
  try { return await runCycleOnce(db, deps); } finally { cycleRunning = false; }
}

async function runCycleOnce(db, deps) {
  if (!(await isFactoryPusherEnabled(db, deps.env))) return { skipped: 'disabled' };
  const createTask = deps.createTask || (async (args) => (await import('../actions.js')).createTask(args));
  const raise = deps.raise || (async (...a) => (await import('../alerting.js')).raise(...a));
  const log = deps.log || ((m) => console.log(`[factory-cycle] ${m}`));
  const resolveConfig = deps.resolveConfig || ((key) => resolveWorkflowConfig(key));
  const judge = await runFactoryJudge({
    store: deps.judgeStore || makeJudgeStore(db), createTask, resolveConfig, log, now: deps.now,
    recordRun: deps.recordRun || ((id, body) => recordRun(db, id, body)),
  });
  const push = await runFactoryPusher(db, { store: deps.pusherStore || makePusherStore(db), createTask, raise, log, resolveConfig, now: deps.now });
  return { judge, push };
}
