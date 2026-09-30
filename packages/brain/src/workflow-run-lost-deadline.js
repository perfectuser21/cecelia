/**
 * workflow-run-lost-deadline — 整批总时限到期判 lost + 收割器放锁回桌面（任务 c2d73868，决策 3c98fb36）。
 *
 * 09-30 02:00–08:15 事故：三部手机各卡 6 小时，escort 02:52 被移除后无人陪跑；Brain 侧 device_job 镜像单
 * （wall-report start 经 ZenithJoy API 桥建的 in_progress 行）没有任何程序判 lost。PRD 第 2 层「Brain 对账」：
 * 整批总时限到期无 finalize → lost，不依赖 AI。
 *
 * 判据：status='in_progress' 的 workflow_run（Notion ssh 直派）与 device_job 镜像（payload.source='cron'），
 * COALESCE(started_at, due_at, created_at) 早于 NOW() - (总时限 4h + 宽限 30min，env 可配）。比较在 SQL 内做
 * （时区案 2026-09-15：禁 JS 解析无时区时间）。finalize 一到任务就不再 in_progress，自然不在查询结果里。
 *
 * 善后（每步 fail-open，只做一次，payload.lost_cleanup_at 为标记）：
 *   ① 执行机 `douyin-phone-adb --profile <p> lock-release <TAG>`（子命令无 --force，按 owner=TAG 释放；owner 是别的 run 即拒绝并记录）
 *   ② 执行机 `douyin-phone-adb --profile <p> return-safe-desktop`
 *   ③ MMV `openclaw cron rm <escort_id>`（payload.escort_id / commander_escort_id，阶段 B 看门狗写入；缺则记录跳过）
 * 现场解析：hostkey/profile 取 payload，缺则按 payload.serial 查 phone_registry（PR #5680 台账）；TAG 取 payload.tag/run_tag，
 * 缺则由该任务最新 task_runs.run_id（<账本run>__aN.<stage>）取账本 run 最后一段。参数走白名单正则，远端串作 ssh 单个 argv，本地零 shell。
 *
 * 能力名（workflowRunLabel）只认 payload.wf_id/capability/cap → 任务标题，绝不从账本 run_id 前缀推：对标 run 的账本前缀
 * 写死 social-keyword-leadgen-crontab-（zenithjoy 仓另行处理），Brain 读侧不得错分类。
 *
 * ZenithJoy `reconcileBrainMirrors` 以本地 worker_tasks 为准可能把本行翻回 in_progress：下一轮再判到期只重写终态、不重复善后。
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { SSH_BASE_ARGS } from './lib/ssh-args.js';
import { sshRun } from './lib/ssh-exec.js';
import { resolveMachineId, sshTargetFor } from './machine-registry.js';
import { finalizeTask } from './lib/task-terminal.js';
import { finishRun } from './lib/task-run.js';
import { recordTaskEventSafe } from './lib/task-event-log.js';

export const DEFAULT_DEADLINE_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_GRACE_MS = 30 * 60 * 1000;
export const LOST_REASON = 'lost_deadline';
const DEFAULT_GATE_MS = 5 * 60 * 1000;
const BATCH_LIMIT = 20;
const SSH_TIMEOUT_MS = 30_000;
const MMV_MACHINE_ID = 'us-mac-m4';
const PHONE_ADB = '~/.local/bin/douyin-phone-adb';
const SAFE_ARG = /^[A-Za-z0-9._-]{1,64}$/;

let lastRunAt = 0;

function positiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** 总时限 = 整批时限 + 宽限（毫秒），env WORKFLOW_RUN_DEADLINE_MS / WORKFLOW_RUN_DEADLINE_GRACE_MS 可配。 */
export function resolveDeadlineMs(env = process.env) {
  return positiveInt(env.WORKFLOW_RUN_DEADLINE_MS, DEFAULT_DEADLINE_MS)
    + positiveInt(env.WORKFLOW_RUN_DEADLINE_GRACE_MS, DEFAULT_GRACE_MS);
}

function firstString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** 能力名：payload.wf_id / capability / cap → 任务标题 → task_type。永不解析账本 run_id 前缀。 */
export function workflowRunLabel(task) {
  const p = task?.payload ?? {};
  return firstString(p.wf_id, p.capability, p.cap, task?.title, task?.task_type) ?? 'workflow_run';
}

/** run TAG：payload.tag / run_tag 优先；否则最新账本 run_id（去掉 __aN.<stage> 后）最后一个 `-` 段。非法字符一律 null。 */
export function deriveRunTag(task, runIds = []) {
  const explicit = firstString(task?.payload?.tag, task?.payload?.run_tag);
  if (explicit) return SAFE_ARG.test(explicit) ? explicit : null;
  for (const runId of runIds) {
    const ledger = String(runId ?? '').split('__')[0];
    const tag = ledger.slice(ledger.lastIndexOf('-') + 1);
    if (tag && SAFE_ARG.test(tag)) return tag;
  }
  return null;
}

async function loadRunIds(pool, taskId) {
  try {
    const { rows } = await pool.query(
      `SELECT run_id, ended_at FROM task_runs WHERE task_id = $1 ORDER BY started_at DESC LIMIT 10`,
      [taskId],
    );
    return rows ?? [];
  } catch (err) {
    console.warn(`[wf-lost] task_runs 读取失败 task=${taskId}: ${err.message}`);
    return [];
  }
}

async function loadPhone(pool, serial) {
  if (!serial) return null;
  try {
    const { rows } = await pool.query(`SELECT host, profile FROM phone_registry WHERE serial = $1 LIMIT 1`, [serial]);
    return rows?.[0] ?? null;
  } catch (err) {
    console.warn(`[wf-lost] phone_registry 读取失败 serial=${serial}: ${err.message}`);
    return null;
  }
}

/** 现场解析：hostkey / profile / tag / escort_id，缺项为 null（善后按项跳过）。 */
export async function resolveCleanupContext(pool, task, runIds) {
  const p = task?.payload ?? {};
  let hostkey = firstString(p.machine, p.host, p.hostkey);
  let profile = firstString(p.profile);
  const serial = firstString(p.serial, p.device_serial);
  if (serial && (!hostkey || !profile)) {
    const phone = await loadPhone(pool, serial);
    hostkey = hostkey ?? firstString(phone?.host);
    profile = profile ?? firstString(phone?.profile);
  }
  return {
    hostkey, profile, serial,
    tag: deriveRunTag(task, runIds),
    escortId: firstString(p.escort_id, p.commander_escort_id),
  };
}

function targetOf(machineName) {
  const id = resolveMachineId(machineName);
  if (!id) return null;
  try { return sshTargetFor(id); } catch { return null; }
}

/** 善后计划：每步 { step, target, remote }；做不了的步给 skipped 原因。 */
export function buildCleanupPlan(ctx) {
  const steps = [];
  const skipped = {};
  const execTarget = ctx.hostkey ? targetOf(ctx.hostkey) : null;
  if (!execTarget) {
    skipped.lock_release = skipped.return_safe_desktop = ctx.hostkey ? `unknown_machine:${ctx.hostkey}` : 'no_hostkey';
  } else if (!ctx.profile || !SAFE_ARG.test(ctx.profile)) {
    skipped.lock_release = skipped.return_safe_desktop = 'no_profile';
  } else {
    if (ctx.tag) steps.push({ step: 'lock_release', target: execTarget, remote: `${PHONE_ADB} --profile ${ctx.profile} lock-release ${ctx.tag}` });
    else skipped.lock_release = 'no_tag';
    steps.push({ step: 'return_safe_desktop', target: execTarget, remote: `${PHONE_ADB} --profile ${ctx.profile} return-safe-desktop` });
  }
  if (ctx.escortId && SAFE_ARG.test(ctx.escortId)) {
    const mmv = targetOf(MMV_MACHINE_ID);
    if (mmv) steps.push({ step: 'escort_rm', target: mmv, remote: `openclaw cron rm ${ctx.escortId}` });
    else skipped.escort_rm = 'mmv_not_dispatchable';
  } else {
    skipped.escort_rm = ctx.escortId ? 'bad_escort_id' : 'no_escort_id';
  }
  return { steps, skipped };
}

async function runCleanup(execFileFn, plan) {
  const cleanup = { ...plan.skipped };
  for (const s of plan.steps) {
    try {
      const out = await sshRun(execFileFn, [...SSH_BASE_ARGS, s.target, s.remote],
        { timeout: SSH_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 256 * 1024 });
      cleanup[s.step] = 'ok';
      cleanup[`${s.step}_out`] = String(out).trim().slice(0, 200);
    } catch (err) {
      cleanup[s.step] = 'failed';
      cleanup[`${s.step}_err`] = String(err?.stderr || err?.message || err).trim().slice(0, 200);
      console.warn(`[wf-lost] 善后 ${s.step} 失败（fail-open）: ${cleanup[`${s.step}_err`]}`);
    }
  }
  return cleanup;
}

async function settleLost(pool, task, { deadlineMs, execFileFn, now }) {
  const runs = await loadRunIds(pool, task.id);
  const ctx = await resolveCleanupContext(pool, task, runs.map((r) => r.run_id));
  const alreadyCleaned = Boolean(task.payload?.lost_cleanup_at);
  const cleanup = alreadyCleaned
    ? { skipped: 'already_cleaned', at: task.payload.lost_cleanup_at }
    : await runCleanup(execFileFn, buildCleanupPlan(ctx));
  const nowIso = new Date(now).toISOString();
  const capability = workflowRunLabel(task);
  const summary = { reason: LOST_REASON, deadline_ms: deadlineMs, capability, hostkey: ctx.hostkey, tag: ctx.tag, cleanup };

  const res = await finalizeTask(pool, task.id, 'failed', {
    onlyIfStatus: 'in_progress',
    mergeResult: { ...summary, lost_at: nowIso },
    mergePayload: { lost_deadline_at: nowIso, ...(alreadyCleaned ? {} : { lost_cleanup_at: nowIso }) },
  });
  for (const r of runs) {
    if (r.ended_at) continue;
    await finishRun({ runId: r.run_id, status: 'timeout', error: LOST_REASON }, { pool });
  }
  if (res?.rowCount) await recordTaskEventSafe(pool, task.id, LOST_REASON, summary);
  console.warn(`[wf-lost] ${task.task_type} ${task.id}（${capability}）超总时限 ${deadlineMs}ms 无 finalize → failed(${LOST_REASON}) cleanup=${JSON.stringify(cleanup)}`);
  return summary;
}

/**
 * scheduler-jobs handler（needsPool）。deps：execFileFn（测试桩 ssh）、now、env、gateMs（0 关自 gate）。
 * @returns {Promise<{scanned:number, lost:number, skipped?:string}>}
 */
export async function runWorkflowRunLostDeadline(pool, deps = {}) {
  const now = deps.now ?? Date.now();
  const gateMs = deps.gateMs ?? DEFAULT_GATE_MS;
  if (gateMs > 0 && now - lastRunAt < gateMs) return { scanned: 0, lost: 0, skipped: 'interval_gate' };
  lastRunAt = now;
  const execFileFn = deps.execFileFn ?? nodeExecFile;
  const deadlineMs = resolveDeadlineMs(deps.env ?? process.env);
  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT id, title, task_type, payload, started_at, due_at, created_at
         FROM tasks
        WHERE status = 'in_progress'
          AND (task_type = 'workflow_run' OR (task_type = 'device_job' AND payload->>'source' = 'cron'))
          AND COALESCE(started_at, due_at, created_at) < NOW() - ($1::bigint * interval '1 millisecond')
        ORDER BY COALESCE(started_at, due_at, created_at) ASC
        LIMIT ${BATCH_LIMIT}`,
      [deadlineMs],
    ));
  } catch (err) {
    console.warn(`[wf-lost] 到期扫描失败: ${err.message}`);
    return { scanned: 0, lost: 0, error: err.message };
  }
  const out = { scanned: rows?.length ?? 0, lost: 0 };
  for (const task of rows ?? []) {
    try {
      await settleLost(pool, task, { deadlineMs, execFileFn, now });
      out.lost += 1;
    } catch (err) {
      console.warn(`[wf-lost] 判 lost 失败 task=${task.id}: ${err.message}`);
    }
  }
  return out;
}
