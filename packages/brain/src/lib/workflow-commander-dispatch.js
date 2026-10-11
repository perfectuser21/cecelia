/**
 * workflow-commander-dispatch.js — Brain 主动把 workflow 派给 work-commander（任务 f38e7cc2；
 * 决策 23cc0951 Brain 选定机器·手机·账号再下派 / 3c98fb36 Commander 只照调度单起跑 / e8f872cb）。
 *
 * 为什么是新 task_type workflow_dispatch 而不是 workflow_run 加 source=brain 分支：
 *   workflow_run 是「外部起跑、Brain 只记账」的镜像——isExternalRunMirror（活性豁免）、commander-watchdog（接班）、
 *   workflow-run-lost-deadline（判 lost）都按 workflow_run 全量收；混进主动派发要在三处各开例外，漏一处就会
 *   被看门狗接班重拉 escort 或被判 lost。新类型从注册表派生自动不进镜像集合，零例外。
 *
 * 流程（一个 scheduler job，60s 一轮）：
 *   派发：queued 的 workflow_dispatch → 按 config/factory-workflows.json 的 commander 登记解析调度单
 *        （<能力> <机器> <profile> <serial> <biz>，缺项/非法 → failed 写缺什么，不猜）→ 发布时段外不认领 →
 *        CAS 认领 → 领 Brain 设备锁（manual-dispatch-device-gate 同一闸；被占只等不接管）→
 *        ssh MMV 起 `openclaw agent --agent work-commander`，调度单与纪律经 stdin 作为消息（不进命令行）→ in_progress
 *   收割：读 MMV ~/brain-runs/<run_id>.exit + 日志尾，取 Commander 最后输出的 `COMMANDER_RESULT {json}` →
 *        completed（带证据）/ failed（原因）→ 释放设备锁 → task_runs 补终态
 * us-vps 零执行：本文件只 ssh 推活与收尸，不跑推理。
 */
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { SSH_BASE_ARGS } from './ssh-args.js';
import { sshWithStdin, sshRun } from './ssh-exec.js';
import { resolvePrimaryWorkerId, sshTargetFor } from '../machine-registry.js';
import { buildRemoteCommand, parseReceipt, isSafeRunId } from '../openclaw-agent-executor.js';
import { resolveWorkflowConfig } from './factory-workflow-config.js';
import { withinPublishHours } from './factory-pusher.js';
import { checkDeviceLockForManualDispatch } from './manual-dispatch-device-gate.js';
import { releaseDeviceLocksHeldBy } from '../device-lock-helpers.js';
import { finalizeTask } from './task-terminal.js';
import { recordTaskEventSafe } from './task-event-log.js';
import { startRun, finishRun } from './task-run.js';

export const WORKFLOW_DISPATCH_TASK_TYPE = 'workflow_dispatch';
export const COMMANDER_AGENT = 'work-commander';
const CLAIMER = 'workflow-commander-dispatch';
const DEFAULT_TIMEOUT_MIN = 40;
const BATCH = 3;
const REAP_SSH_TIMEOUT_MS = 15_000;
// 调度单每一项都会被 Commander 拼进 wf-launch.sh 命令行：只许字母/数字/中文与 ._-，不许空白和引号。
const ORDER_TOKEN = /^[\p{L}\p{N}._-]+$/u;
const ARG_TOKEN = /^(--[a-z][a-z-]*|[\p{L}\p{N}._,:/=-]+)$/u;

const fail = (error) => ({ ok: false, error });

/** 按 workflow 登记解析调度单；任何缺项/非法都返回 error（不猜、不自选）。 */
export function resolveCommanderOrder(task, deps = {}) {
  const resolveConfig = deps.resolveConfig ?? ((k) => resolveWorkflowConfig(k));
  const key = task?.payload?.workflow_key;
  if (!key) return fail('payload 缺 workflow_key');
  const cfg = resolveConfig(key);
  if (!cfg) return fail(`workflow ${key} 未在 config/factory-workflows.json 登记`);
  const c = cfg.commander || {};
  const d = cfg.device || {};
  const fields = { capability: c.capability, machine: c.machine || d.ssh_host, profile: d.profile, serial: d.serial, biz: c.biz };
  const lack = Object.entries(fields).filter(([, v]) => typeof v !== 'string' || !v).map(([k]) => k);
  if (lack.length) return fail(`workflow ${key} 的 commander 调度单缺 ${lack.join('/')}`);
  const bad = Object.entries(fields).filter(([, v]) => !ORDER_TOKEN.test(v)).map(([k]) => k);
  if (bad.length) return fail(`workflow ${key} 调度单字段含非法字符：${bad.join('/')}`);
  const extra = task.payload.commander_args ?? [];
  if (!Array.isArray(extra) || extra.some((a) => typeof a !== 'string' || !ARG_TOKEN.test(a))) {
    return fail('payload.commander_args 只许旗标与无空白无引号的值');
  }
  const order = [fields.capability, fields.machine, fields.profile, fields.serial, fields.biz, ...extra].join(' ');
  const minutes = Number(c.timeout_min) > 0 ? Number(c.timeout_min) : DEFAULT_TIMEOUT_MIN;
  return { ok: true, key, cfg, order, serial: fields.serial, machine: fields.machine, timeoutSec: Math.round(minutes * 60) };
}

/** 给 Commander 的消息：调度单 + Brain 任务号/run_id + 纪律 + 回写约定。 */
export function buildCommanderMessage(task, r, runId) {
  const minutes = Math.round(r.timeoutSec / 60);
  return [
    `本次由 Brain 主动派发（决策 23cc0951：机器/手机/账号已由 Brain 选定）。Brain 任务 ${task.id}；run_id=${runId}；workflow=${r.key}。`,
    `调度单：${r.order}`,
    '照做：',
    '1. 先加载 $workflow-commander，照第二节用 wf-launch.sh 按上面调度单原样发起；不换机器、不换手机、不补参数。退出码按表处理（3=手机忙不叠跑、4=能力未部署如实报）。',
    `2. 陪跑到该 run 终态（wf-status.sh 读到 state=finished），总时限 ${minutes} 分钟内；读不到就说读不到，不编结论。`,
    '3. Brain 已代领本手机的 Brain 设备锁（owner=本任务），收尾由 Brain 释放；执行机侧手机锁由 wf-run 自己拿放。',
    '4. 最后一行只输出一行（单行 JSON，别加代码块）：',
    'COMMANDER_RESULT {"status":"completed|failed|blocked","tag":"<run TAG>","launch_exit":<wf-launch 退出码>,"evidence":["证据ID或作品页读回"],"summary":"一句话结论"}',
    '   completed 只在 run 终态 completed 且验收读回成立时写；其余写 failed/blocked 并说明原因。',
    task.title ? `任务标题：${task.title}` : null,
    task.description ? `任务说明：${task.description}` : null,
    ...(Array.isArray(r.cfg.brief) && r.cfg.brief.length ? ['正文纪律：', ...r.cfg.brief.map((l) => `- ${l}`)] : []),
    r.cfg.acceptance ? `验收：${r.cfg.acceptance}` : null,
  ].filter(Boolean).join('\n');
}

/** 取文本里最后一个 `COMMANDER_RESULT {json}`；没有或坏 → null。 */
export function parseCommanderResult(text) {
  if (typeof text !== 'string') return null;
  const hits = [...text.matchAll(/COMMANDER_RESULT\s+(\{[^\n]*)/g)];
  if (!hits.length) return null;
  try {
    const v = JSON.parse(hits[hits.length - 1][1].trim());
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

const defaultSshDispatch = (args, input) => sshWithStdin(nodeSpawn, args, input);
const defaultSshProbe = (args) => sshRun(nodeExecFile, args, { timeout: REAP_SSH_TIMEOUT_MS, encoding: 'utf8' });
const defaultLockGate = (task) => checkDeviceLockForManualDispatch(task, CLAIMER);
const defaultReleaseLock = (taskId) => releaseDeviceLocksHeldBy(taskId);

async function releaseClaim(pool, id) {
  await pool.query(`UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = $1 AND claimed_by = $2 AND status = 'queued'`, [id, CLAIMER]);
}

async function failQueued(pool, id, reason, extra = {}) {
  await finalizeTask(pool, id, 'failed', {
    set: { error_message: reason },
    mergeResult: { workflow_dispatch: { reason, ...extra, at: new Date().toISOString() } },
    onlyIfStatus: ['queued', 'in_progress'],
  });
}

/** 派发一轮：返回 { dispatched, waiting, failed, skipped }。 */
export async function dispatchWorkflowCommanderTasks(pool, deps = {}) {
  const now = deps.now ?? (() => new Date());
  const sshDispatch = deps.sshDispatch ?? defaultSshDispatch;
  const lockGate = deps.lockGate ?? defaultLockGate;
  const releaseLock = deps.releaseLock ?? defaultReleaseLock;
  const out = { dispatched: 0, waiting: 0, failed: 0, skipped: 0 };
  const { rows } = await pool.query(
    `SELECT * FROM tasks
      WHERE task_type = '${WORKFLOW_DISPATCH_TASK_TYPE}' AND status = 'queued' AND claimed_by IS NULL
      ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, created_at ASC
      LIMIT ${BATCH}`,
  );
  for (const t of rows ?? []) {
    const r = resolveCommanderOrder(t, deps);
    if (r.ok && !withinPublishHours(now(), r.cfg.publish_hours)) { out.skipped++; continue; }
    const claim = await pool.query(
      `UPDATE tasks SET claimed_by = $2, claimed_at = NOW() WHERE id = $1 AND status = 'queued' AND claimed_by IS NULL RETURNING *`,
      [t.id, CLAIMER],
    );
    if (!claim.rows?.length) { out.skipped++; continue; }
    if (!r.ok) {
      await failQueued(pool, t.id, `workflow_dispatch_unresolved: ${r.error}`);
      out.failed++;
      continue;
    }
    const ttl = Math.min(240, Math.round(r.timeoutSec / 60) + 20);
    const gate = await lockGate({ ...t, payload: { ...(t.payload || {}), device_serial: r.serial, device_ttl_minutes: ttl } });
    if (!gate.pass) {
      if (gate.status === 422) {
        await failQueued(pool, t.id, `workflow_dispatch_device_unknown: ${r.serial}`, { gate: gate.body });
        out.failed++;
        continue;
      }
      await releaseClaim(pool, t.id);
      await recordTaskEventSafe(pool, t.id, 'workflow_dispatch_waiting', { serial: r.serial, gate: gate.body ?? null });
      out.waiting++;
      continue;
    }
    const runId = `wfd-${String(t.id).slice(0, 8)}-${now().getTime()}`;
    await pool.query(
      `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('run_id', $2::text, 'commander_order', $3::text, 'device_serial', $4::text, 'timeout_sec', $5::int), updated_at = NOW()
        WHERE id = $1`,
      [t.id, runId, r.order, r.serial, r.timeoutSec],
    );
    let spawned = null;
    let lastErr = null;
    for (let i = 0; i < 2 && !spawned; i++) {
      try {
        const remote = buildRemoteCommand({ runId, department: COMMANDER_AGENT, taskId: t.id, timeoutSec: r.timeoutSec });
        const target = deps.target ?? sshTargetFor(resolvePrimaryWorkerId());
        const so = await sshDispatch([...SSH_BASE_ARGS, target, remote], buildCommanderMessage(t, r, runId));
        if (/ALREADY/.test(so)) spawned = 'already';
        else if (/DISPATCHED/.test(so)) spawned = 'dispatched';
        else throw new Error(`no DISPATCHED marker: ${String(so).slice(0, 120)}`);
      } catch (err) {
        lastErr = err;
      }
    }
    if (!spawned) {
      await releaseLock(t.id);
      await failQueued(pool, t.id, `workflow_dispatch_spawn_failed: ${String(lastErr?.message || lastErr).slice(0, 200)}`);
      out.failed++;
      continue;
    }
    await pool.query(`UPDATE tasks SET executor_kind = 'openclaw-agent', updated_at = NOW() WHERE id = $1`, [t.id]);
    await pool.query(
      `UPDATE tasks SET status = 'in_progress', started_at = COALESCE(started_at, NOW()), updated_at = NOW() WHERE id = $1 AND status = 'queued'`,
      [t.id],
    );
    await recordTaskEventSafe(pool, t.id, 'workflow_dispatch_spawned', { run_id: runId, order: r.order, serial: r.serial, already_running: spawned === 'already' });
    await startRun({ taskId: t.id, runId, source: 'workflow-commander', context: { workflow_key: r.key, order: r.order, agent: COMMANDER_AGENT } }, { pool });
    out.dispatched++;
  }
  return out;
}

/** 收割一轮：返回 { completed, failed }。 */
export async function reapWorkflowCommanderRuns(pool, deps = {}) {
  const sshProbe = deps.sshProbe ?? defaultSshProbe;
  const releaseLock = deps.releaseLock ?? defaultReleaseLock;
  const out = { completed: 0, failed: 0 };
  const { rows } = await pool.query(
    `SELECT id, payload->>'run_id' AS run_id, payload FROM tasks
      WHERE task_type = '${WORKFLOW_DISPATCH_TASK_TYPE}' AND status = 'in_progress' AND payload->>'run_id' IS NOT NULL
      ORDER BY started_at ASC NULLS FIRST LIMIT 10`,
  );
  for (const row of rows ?? []) {
    if (!isSafeRunId(row.run_id)) continue;
    let stdout;
    try {
      const target = deps.target ?? sshTargetFor(resolvePrimaryWorkerId());
      stdout = await sshProbe([...SSH_BASE_ARGS, target,
        `if [ -f ~/brain-runs/${row.run_id}.exit ]; then echo EXIT=$(cat ~/brain-runs/${row.run_id}.exit); tail -c 40000 ~/brain-runs/${row.run_id}.log 2>/dev/null; else echo NO_EXIT; fi`]);
    } catch (err) {
      console.warn(`[workflow-dispatch] 收割 ${row.run_id} 探测失败: ${err.message}`);
      continue;
    }
    const m = String(stdout).match(/^EXIT=(\d+)/m);
    if (!m) continue;
    const exit = parseInt(m[1], 10);
    const tail = String(stdout).replace(/^EXIT=\d+\n?/m, '');
    const receipt = parseReceipt(exit, tail);
    const result = parseCommanderResult(receipt.text) ?? parseCommanderResult(tail);
    let status = 'failed';
    let reason = null;
    if (exit !== 0) reason = `openclaw_agent_exit_${exit}`;
    else if (!result) reason = 'commander_result_missing';
    else if (result.status === 'completed') status = 'completed';
    else reason = `commander_${String(result.status || 'unknown').replace(/[^a-z_]/gi, '')}`;
    await finalizeTask(pool, row.id, status, {
      ...(reason ? { set: { error_message: reason } } : {}),
      mergeResult: { receipt, commander_result: result, evidence: result?.evidence ?? [] },
      onlyIfStatus: 'in_progress',
    });
    await releaseLock(row.id);
    await finishRun({ runId: row.run_id, status: status === 'completed' ? 'completed' : 'failed', exitCode: exit, error: reason ?? undefined }, { pool });
    await recordTaskEventSafe(pool, row.id, 'workflow_dispatch_reaped', { run_id: row.run_id, exit, status, reason, tag: result?.tag ?? null });
    out[status === 'completed' ? 'completed' : 'failed']++;
  }
  return out;
}

/** scheduler job 入口：先收后派（收完放锁，同一轮就能派下一张）。 */
export async function runWorkflowCommanderDispatch(pool, deps = {}) {
  const reaped = await reapWorkflowCommanderRuns(pool, deps);
  const dispatched = await dispatchWorkflowCommanderTasks(pool, deps);
  return { reaped, dispatched };
}
