/**
 * 发布线·退回（决策 de6dff5d 第 3 步）。
 *
 * 自动：自动裁判落库后 fire-and-forget 调 onJudgmentRecorded，出错只记日志，绝不影响 span 上报和裁判落库。
 *   触发 = 生产版最近 K 次不同运行（RELEASE_ROLLBACK_FAILURES，默认 3）全都没绿。每条裁判取 run_id === trigger_ref 那次运行，
 *   按 run_id 去重；那次运行带版本的 span 必须全部属于生产版（report.run_version_ids），混了别的版本的不算。
 *   RELEASE_LINE_AUTO_ROLLBACK：off 不评估；advisory（默认）只记 rollback_advisory + P1，不改指针；on 才真退回（rollback_auto + P0 + Bark）。
 *   默认 advisory 的原因：退回只改账面指针，执行端仍跑已部署的 release（还没有重新部署执行器），而且代码/技能变更不进内容版本，
 *   失败可能算错版本——这两件事落地前不真退。
 * 只退到曾经收敛过的、之前当过生产版的版本；没有 → rollback_unavailable。去重落库：同一 Activity、同一生产版 24 小时内只记一次，
 *   其间出现过一次全绿运行才重置。告警：生产版曾收敛（从受保护状态退化）才发 P1；从未收敛的只记事件和日志，不告警、不发 Bark。
 * 并发：拿 release-line 锁后重新读指针、重新评估，最后比较交换改指针（WHERE production_version_id = 评估时的版本），影响 0 行就放弃。
 */
import { raise as defaultRaise } from '../alerting.js';
import { sendBark as defaultSendBark } from '../notifier.js';
import {
  releaseLineFlags, releaseLineReady, lockReleaseLine, getPointer, everConverged, recordEvent, movePointer,
  refreshRecipesForActivity, withReleaseTx, fire,
} from './release-line.js';

const DEDUP_WINDOW_MS = 24 * 3600 * 1000;
const POINTER_KINDS = ['initial', 'promote', 'group_promote', 'bootstrap', 'rollback_auto', 'rollback_manual'];

/** 生产版最近 K 次不同运行的结果（纯读）。 */
export async function evaluateProductionFailures(db, activityId, versionId, k) {
  const builds = new Set((await db.query('SELECT build_id FROM activity_version_builds WHERE activity_version_id = $1', [versionId])).rows.map(r => r.build_id));
  const judgments = (await db.query(
    `SELECT id, trigger_ref, report, judged_at FROM activity_judgments
      WHERE activity_id = $1 AND trigger_kind = 'auto' AND trigger_ref IS NOT NULL ORDER BY id DESC LIMIT 200`, [activityId])).rows;
  const seen = new Set(), runs = [];
  for (const j of judgments) {
    if (seen.has(j.trigger_ref)) continue;
    const run = (j.report?.runs || []).find(r => r.run_id === j.trigger_ref);
    if (!run) continue;
    seen.add(j.trigger_ref);
    const versions = j.report?.run_version_ids?.[j.trigger_ref];
    if (!Array.isArray(versions) || versions.length === 0 || !versions.every(b => builds.has(b))) continue;
    runs.push({ run_id: j.trigger_ref, green: Boolean(run.green), judgment_id: j.id, judged_at: j.judged_at });
    if (runs.length >= k) break;
  }
  return { failing: runs.length >= k && runs.every(r => !r.green), runs };
}

/** 退回目标：之前当过生产版、且曾经收敛过的最近一个版本；没有返回 null。 */
export async function rollbackTarget(db, activityId, productionVersionId) {
  const rows = (await db.query(
    `SELECT to_version_id, max(id) AS last FROM activity_release_events
      WHERE activity_id = $1 AND kind = ANY($2::text[]) AND to_version_id IS NOT NULL AND to_version_id <> $3
      GROUP BY to_version_id ORDER BY last DESC`, [activityId, POINTER_KINDS, productionVersionId])).rows;
  for (const r of rows) if (await everConverged(db, activityId, r.to_version_id)) return r.to_version_id;
  return null;
}

async function recentlyNotified(db, activityId, kind, productionVersionId, runs, now) {
  const last = (await db.query(
    `SELECT id, created_at FROM activity_release_events WHERE activity_id = $1 AND kind = $2 AND from_version_id = $3
      ORDER BY id DESC LIMIT 1`, [activityId, kind, productionVersionId])).rows[0];
  if (!last || now - Date.parse(last.created_at) > DEDUP_WINDOW_MS) return false;
  const greenSince = (await db.query(
    `SELECT 1 FROM activity_judgments j WHERE j.activity_id = $1 AND j.judged_at > $2 AND j.trigger_kind = 'auto'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(j.report->'runs') r WHERE r->>'run_id' = j.trigger_ref AND r->>'green' = 'true')
      LIMIT 1`, [activityId, last.created_at])).rows[0];
  return !greenSince && runs.every(r => !r.green);
}

async function suggestedRelease(db, versionId) {
  try {
    if (!(await db.query("SELECT to_regclass('release_versions') IS NOT NULL AS ok")).rows[0]?.ok) return null;
    return (await db.query(
      `SELECT r.id, r.environment, r.target, r.created_at FROM release_versions r
        WHERE r.payload->'verification'->>'status' = 'verified'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.payload->'activities') a
                        JOIN activity_version_builds m ON m.build_id::text = a->>'id' WHERE m.activity_version_id = $1)
        ORDER BY r.created_at DESC LIMIT 1`, [versionId])).rows[0] ?? null;
  } catch { return null; }
}

/**
 * 自动裁判落库后的钩子。永不抛；返回 {action}。
 * @param {object} db  pg Pool（或测试里的 Client）
 */
export async function onJudgmentRecorded(db, activityId, judgment = {}, {
  env = process.env, alert = defaultRaise, bark = defaultSendBark, log = console, now = Date.now(),
} = {}) {
  try {
    const flags = releaseLineFlags(env);
    if (flags.autoRollback === 'off') return { action: 'off' };
    if (judgment?.trigger_kind && judgment.trigger_kind !== 'auto') return { action: 'not_auto' };
    if (!(await releaseLineReady(db))) return { action: 'not_migrated' };
    const pointer = await getPointer(db, activityId);
    if (!pointer) return { action: 'no_pointer' };
    const pre = await evaluateProductionFailures(db, activityId, pointer.production_version_id, flags.rollbackFailures);
    if (!pre.failing) return { action: 'none' };
    const after = [];
    const result = await withReleaseTx(db, async tx => {
      await lockReleaseLine(tx);
      const current = await getPointer(tx, activityId, { forUpdate: true });
      if (current?.production_version_id !== pointer.production_version_id) return { action: 'pointer_changed' };
      const prod = pointer.production_version_id;
      const ev = await evaluateProductionFailures(tx, activityId, prod, flags.rollbackFailures);
      if (!ev.failing) return { action: 'none' };
      const target = await rollbackTarget(tx, activityId, prod);
      const judgmentIds = ev.runs.map(r => r.judgment_id);
      const gate = { failing_runs: ev.runs.map(r => r.run_id), threshold: flags.rollbackFailures, mode: flags.autoRollback };
      if (target && flags.autoRollback === 'on') {
        const event = await movePointer(tx, activityId, prod, target, {
          kind: 'rollback_auto', actor: 'release_line_auto', reason: `consecutive_failed_runs_${flags.rollbackFailures}`, judgment_ids: judgmentIds, gate });
        if (!event) return { action: 'pointer_changed' };
        await refreshRecipesForActivity(tx, activityId, { cause: 'rollback_auto', causeEventId: event.id });
        const suggested = await suggestedRelease(tx, target);
        const text = `Activity ${activityId} 生产版连续 ${flags.rollbackFailures} 次运行失败，已自动退回到 ${target}；执行端仍跑已部署 release，需重新部署`
          + (suggested ? `（建议 release ${suggested.id} ${suggested.environment}/${suggested.target}）` : '');
        after.push(() => alert('P0', `activity_production_rollback:${activityId}`, text));
        after.push(() => bark(`Activity 生产版已自动退回`, text));
        return { action: 'rollback_auto', event_id: event.id, to_version_id: target, suggested_release_id: suggested?.id ?? null };
      }
      const kind = target ? 'rollback_advisory' : 'rollback_unavailable';
      if (await recentlyNotified(tx, activityId, kind, prod, ev.runs, now)) return { action: 'deduped', kind };
      const event = await recordEvent(tx, { activity_id: activityId, kind, actor: 'release_line_auto',
        reason: target ? 'auto_rollback_advisory_mode' : 'no_converged_rollback_target', from_version_id: prod, to_version_id: target, judgment_ids: judgmentIds, gate });
      const degraded = await everConverged(tx, activityId, prod);
      if (target) after.push(() => alert('P1', `activity_production_rollback_advisory:${activityId}`,
        `Activity ${activityId} 生产版连续 ${flags.rollbackFailures} 次运行失败，建议退回到 ${target}（advisory 模式未改指针）`));
      else if (degraded) after.push(() => alert('P1', `activity_production_rollback_unavailable:${activityId}`,
        `Activity ${activityId} 曾收敛的生产版连续 ${flags.rollbackFailures} 次运行失败，没有可退回的已收敛版本`));
      else log.info?.(`[release-line] ${activityId} 未收敛生产版连续失败，无可退目标（只记事件，不告警）`);
      return { action: kind, event_id: event?.id ?? null, to_version_id: target };
    });
    for (const fn of after) fire(fn);
    return result;
  } catch (e) {
    try { log.warn(`[release-line] 自动退回评估失败（不影响上报与裁判）: ${String(e?.message).slice(0, 200)}`); } catch { /* ignore */ }
    return { action: 'error', error: String(e?.message) };
  }
}

const httpError = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

/**
 * 手动退回：默认目标同自动退回；也可指定任何曾经当过生产版的版本（未收敛的事件里标 manual_target_unconverged）。
 */
export async function rollbackActivity(db, activityId, { actor, reason, to_version_id: toVersionId = null } = {}) {
  if (typeof actor !== 'string' || !actor.trim()) throw httpError(400, 'ACTOR_REQUIRED', 'actor 必填');
  if (typeof reason !== 'string' || !reason.trim()) throw httpError(400, 'REASON_REQUIRED', 'reason 必填');
  return withReleaseTx(db, async tx => {
    await lockReleaseLine(tx);
    const pointer = await getPointer(tx, activityId, { forUpdate: true });
    if (!pointer) throw httpError(404, 'NO_PRODUCTION_VERSION', 'Activity 没有生产版');
    let target = toVersionId;
    let unconverged = false;
    if (target) {
      const was = (await tx.query(
        'SELECT 1 FROM activity_release_events WHERE activity_id = $1 AND to_version_id = $2 AND kind = ANY($3::text[]) LIMIT 1',
        [activityId, target, POINTER_KINDS])).rows[0];
      if (!was) throw httpError(409, 'NOT_PREVIOUS_PRODUCTION', '目标版本从未当过生产版');
      if (target === pointer.production_version_id) throw httpError(400, 'ALREADY_PRODUCTION', '目标就是当前生产版');
      unconverged = !(await everConverged(tx, activityId, target));
    } else {
      target = await rollbackTarget(tx, activityId, pointer.production_version_id);
      if (!target) throw httpError(409, 'NO_ROLLBACK_TARGET', '没有曾收敛过的历史生产版可退，可显式指定 to_version_id');
    }
    const event = await movePointer(tx, activityId, pointer.production_version_id, target, {
      kind: 'rollback_manual', actor: actor.trim(), reason: reason.trim(), gate: { converged: false, manual_target_unconverged: unconverged } });
    if (!event) throw httpError(409, 'POINTER_CHANGED', '生产指针已被并发修改，请重试');
    const recipes = await refreshRecipesForActivity(tx, activityId, { cause: 'rollback_manual', causeEventId: event.id });
    return { event, recipes, manual_target_unconverged: unconverged };
  });
}
