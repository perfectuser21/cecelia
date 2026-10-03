/**
 * commander-watchdog — Commander 看门狗 + 心跳 + Bark 阈值（任务 17ea4536，决策 3c98fb36）。
 *
 * 09-30 02:52 escort（陪跑 Commander，OpenClaw cron `escort-<host>-<TAG>`）被移除后 5 小时无人陪跑。
 * PRD「兜底」层：执行器底线 → 看门狗拉新 Commander → Brain 判 lost → Bark。本模块是中间那两环：
 *
 *  1. 心跳（recordCommanderHeartbeat）：escort 每 tick 末尾 curl `POST /api/brain/commander-heartbeat`
 *     {tag, host, serial, escort_name, escort_id}。Brain 单是起跑后才由 wall-report 建的，escort 拿不到单号，
 *     故按 TAG 定位：payload.tag → 账本 run_id（task_runs `%-<TAG>__%`）→ serial 唯一在途镜像单；
 *     命中写 payload.commander_heartbeat_at（+tag/host/serial/escort_name/escort_id，顺手补齐 lost 善后要的现场）。
 *     kind=launch（wf-launch 起跑瞬间）存 working_memory `commander_launch:<TAG>`，看门狗/心跳后续合并。
 *  2. 看门狗（runCommanderWatchdog，每轮调度，5min 自 gate）：在途 run 起跑 ≥15min 且心跳缺失/超 15min →
 *     ssh 网关（注册表 primary worker，openclaw CLI 在那）先 `cron list --json` 同名仍在表就收养其 id（与 wf-run.sh #2035
 *     自带看门狗共存，连续收养 2 次仍无心跳才判死），否则 `openclaw cron rm <旧 escort>` + `cron add` 同名 escort，
 *     消息注明「接班：只读账本与日志接上，不重新发起」；新 id 回写 payload，计数 +1，task_events commander_relaunched。
 *     同一 run 接班计数 ≥3 → Bark 一次（payload.commander_bark_at）并停止再拉。失败只留痕并推后下次尝试。
 *  3. 趋势（runWorkflowTrendBark，北京 08:30–10:00 窗口、当日去重）：同一 wf 连续 2 个自然日零线索 → Bark；
 *     一台 serial 近 72h 有批但 24h 无 completed → Bark。单批 0 线索、单次接班、单批 lost 不叫（PRD 叫人边界）。
 *
 * 外部命令经 deps 注入（execFileFn / bark），单测全桩；机器名一律走 machine-registry。
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { SSH_BASE_ARGS } from './lib/ssh-args.js';
import { sshRun } from './lib/ssh-exec.js';
import { resolveMachineId, resolvePrimaryWorkerId, sshTargetFor } from './machine-registry.js';
import { recordTaskEventSafe } from './lib/task-event-log.js';
import { sendBark as defaultBark } from './notifier.js';
import { deriveRunTag, workflowRunLabel } from './workflow-run-lost-deadline.js';
import { buildCommanderHeartbeat, runRoleHandover, validateExistingRolePolicy } from './commander-role-handover.js';

export const DEFAULT_HEARTBEAT_STALE_MS = 15 * 60 * 1000;
export const MAX_RELAUNCH = 3;
export const MAX_ADOPT = 2;
const DEFAULT_GATE_MS = 5 * 60 * 1000;
const BATCH_LIMIT = 20;
const SSH_TIMEOUT_MS = 45_000;
const SAFE_ARG = /^[A-Za-z0-9._-]{1,64}$/;
const RUN_TYPES_SQL = `(task_type = 'workflow_run' OR (task_type = 'device_job' AND payload->>'source' = 'cron'))`;
const LAUNCH_KEY = (tag) => `commander_launch:${tag}`;
const TREND_KEY = 'workflow_trend_bark:last_day';
const ESCORT_SOP = process.env.COMMANDER_ESCORT_SOP || '/Users/administrator/.openclaw/cmdr-escort.txt';
const ESCORT_FEISHU_TO = process.env.COMMANDER_ESCORT_FEISHU_TO || 'chat:oc_ef60d6e3f199d90dd695b6ecc213d662';

let lastWatchdogAt = 0;

function positiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
function firstString(...values) {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}
function safeArg(v) {
  const s = firstString(v);
  return s && SAFE_ARG.test(s) ? s : null;
}
/** 远端 shell 单引号包裹（与 wf-launch.sh sq() 同法） */
function sq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}
function gatewayTarget() {
  try { return sshTargetFor(resolvePrimaryWorkerId()); } catch { return null; }
}

async function mergeTaskPayload(pool, taskId, patch) {
  const res = await pool.query(
    `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
      WHERE id = $1 AND status = 'in_progress' RETURNING id`,
    [taskId, JSON.stringify(patch)],
  );
  return (res?.rowCount ?? res?.rows?.length ?? 0) > 0;
}

// ── 心跳 ──────────────────────────────────────────────────────────────────
async function findRunByTag(pool, tag) {
  const { rows } = await pool.query(
    `SELECT id, payload FROM tasks WHERE status = 'in_progress' AND ${RUN_TYPES_SQL} AND payload->>'tag' = $1
      ORDER BY created_at DESC LIMIT 2`, [tag]);
  return rows?.[0] ? { row: rows[0], via: 'tag' } : null;
}
async function findRunByLedger(pool, tag) {
  const { rows } = await pool.query(
    `SELECT t.id, t.payload FROM tasks t JOIN task_runs r ON r.task_id = t.id
      WHERE t.status = 'in_progress' AND ${RUN_TYPES_SQL.replace(/task_type/g, 't.task_type').replace(/payload/g, 't.payload')}
        AND r.run_id LIKE $1 ESCAPE '\\'
      ORDER BY r.started_at DESC LIMIT 2`, [`%-${tag}\\_\\_%`]);
  return rows?.[0] ? { row: rows[0], via: 'ledger' } : null;
}
async function findRunBySerial(pool, serial) {
  const { rows } = await pool.query(
    `SELECT id, payload FROM tasks WHERE status = 'in_progress' AND task_type = 'device_job'
        AND payload->>'source' = 'cron' AND payload->>'serial' = $1 ORDER BY created_at DESC LIMIT 2`, [serial]);
  return rows?.length === 1 ? { row: rows[0], via: 'serial' } : null;
}

async function readLaunch(pool, tag) {
  try {
    const { rows } = await pool.query('SELECT value_json FROM working_memory WHERE key = $1', [LAUNCH_KEY(tag)]);
    const v = rows?.[0]?.value_json;
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

/**
 * 心跳/起跑登记。body: {kind?: 'launch'|'tick', tag, host?, serial?, profile?, cap?, escort_name?, escort_id?}
 * @returns {Promise<{matched:boolean, task_id?:string, via?:string, stored?:string}>}
 */
export async function recordCommanderHeartbeat(pool, body = {}, deps = {}) {
  const tag = safeArg(body.tag);
  const serial = safeArg(body.serial);
  if (body.tag && !tag) throw Object.assign(new Error('tag 非法（只允许 [A-Za-z0-9._-]{1,64}）'), { status: 400 });
  if (!tag && !serial) throw Object.assign(new Error('缺 tag 或 serial'), { status: 400 });
  const now = new Date(deps.now ?? Date.now()).toISOString();
  const fields = {
    tag, host: safeArg(body.host), serial, profile: safeArg(body.profile),
    escort_name: safeArg(body.escort_name), escort_id: safeArg(body.escort_id), cap: safeArg(body.cap),
  };
  const patch = { commander_heartbeat_at: now, commander_adopt_count: 0 };
  for (const [k, v] of Object.entries(fields)) if (v) patch[k] = v;

  let hit = tag ? await findRunByTag(pool, tag) : null;
  if (!hit && tag) hit = await findRunByLedger(pool, tag);
  if (!hit && serial) hit = await findRunBySerial(pool, serial);
  if (hit) {
    const launch = tag && !hit.row.payload?.escort_id && !patch.escort_id ? await readLaunch(pool, tag) : null;
    if (launch?.escort_id) patch.escort_id = launch.escort_id;
    if (launch?.host && !patch.host) patch.host = launch.host;
    const ok = await mergeTaskPayload(pool, hit.row.id, patch);
    return { matched: ok, task_id: hit.row.id, via: hit.via };
  }
  if (body.kind === 'launch' && tag) {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
      [LAUNCH_KEY(tag), JSON.stringify({ ...fields, at: now })],
    );
    return { matched: false, stored: 'launch' };
  }
  return { matched: false, stored: 'none' };
}

// ── 看门狗 ────────────────────────────────────────────────────────────────
/** 接班 escort 的 `openclaw cron add` 远端串（消息与 wf-launch.sh 同骨架，加接班条款与 Brain 单号）。 */
export function buildEscortRelaunchRemote({ host, tag, serial, profile, taskId, relaunchCount, cap }, deps = {}) {
  const name = `escort-${host}-${tag}`;
  const gateway = gatewayTarget();
  if (!gateway) throw new Error('gateway_not_dispatchable');
  const gatewayExec = `ssh -o BatchMode=yes -o ConnectTimeout=10 ${gateway}`;
  const heartbeatUrl = `${(process.env.COMMANDER_BRAIN_URL || 'http://localhost:5221').replace(/\/$/, '')}/api/brain/commander-heartbeat`;
  const heartbeat = buildCommanderHeartbeat({ taskId, tag, host, serial, profile, cap, escortName: name,
    gateway, heartbeatUrl }, deps.buildHeartbeatCommand);
  const skillRoot = process.env.COMMANDER_SKILL_ROOT || '/Users/administrator/openclaw-root/workspaces-root/clawd-work-commander/skills';
  const skill = typeof cap === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(cap)
    ? `先执行 ${gatewayExec} ${sq(`cat ${sq(`${skillRoot}/wf-${cap}/SKILL.md`)}`)} 读取相同workflow专属skill；核对commander_capability=${cap}。读不到或不匹配只保留现场和缺证据，不套用别的workflow。`
    : '调度能力缺失：只读账本与日志、写心跳，不自选workflow或套用其他专属skill；记录缺能力证据。';
  const msg = `先执行 ${gatewayExec} ${sq(`cat ${sq(ESCORT_SOP)}`)} 读取网关 SOP 并严格遵守辅佐三原则。`
    + `你可能落在任意跑场机；SOP、日志、findings、openclaw CLI 均在网关，相关读写经 ${gatewayExec} 执行，不能把本机文件不存在当成网关文件不存在。`
    + '终态优先：先检查同TAG协调器请求；已有finalize请求时只核终态并完成售后，不再发运行期心跳或触碰手机。'
    + skill
    + `接班：前任 escort 心跳中断（第${relaunchCount}次接班），你只读账本与日志接上现场，不重新发起 run、不重跑任何步骤。`
    + `本轮上下文: ${cap ? `cap=${cap} ` : ''}TAG=${tag} 机器=${host} serial=${serial ?? '未知'} profile=${profile ?? '未知'} `
    + `日志=/Users/administrator/.openclaw/m4-logs/${host}-live.log escort名=${name} Brain单=${taskId}。`
    + `仅运行期每轮末尾必须发心跳: ${gatewayExec} ${sq(heartbeat)}`;
  const delivery = deps.delivery === 'none' || process.env.COMMANDER_ESCORT_DELIVERY === 'none' ? '--no-deliver'
    : `--announce --channel feishu --to ${sq(ESCORT_FEISHU_TO)} --account main --best-effort-deliver`;
  return `openclaw cron add --timeout 90000 --name ${sq(name)} --agent work-commander --session ${sq(`session:${name}`)} `
    + `--every 10m ${delivery} --message ${sq(msg)}`;
}

async function loadRunTags(pool, taskId) {
  try {
    const { rows } = await pool.query(
      `SELECT run_id, ended_at FROM task_runs WHERE task_id = $1 ORDER BY started_at DESC LIMIT 10`, [taskId]);
    return (rows ?? []).map((r) => r.run_id);
  } catch { return []; }
}
async function loadPhone(pool, serial) {
  if (!serial) return null;
  try {
    const { rows } = await pool.query('SELECT host, profile FROM phone_registry WHERE serial = $1 LIMIT 1', [serial]);
    return rows?.[0] ?? null;
  } catch { return null; }
}

async function resolveRelaunchContext(pool, task) {
  const p = task.payload ?? {};
  const serial = safeArg(p.serial ?? p.device_serial);
  let tag = safeArg(p.tag ?? p.run_tag);
  if (!tag) tag = deriveRunTag(task, await loadRunTags(pool, task.id));
  const launch = tag ? await readLaunch(pool, tag) : null;
  let host = safeArg(p.host ?? p.hostkey ?? p.machine ?? launch?.host);
  let profile = safeArg(p.profile ?? launch?.profile);
  if (serial && (!host || !profile)) {
    const phone = await loadPhone(pool, serial);
    host = host ?? safeArg(phone?.host);
    profile = profile ?? safeArg(phone?.profile);
  }
  // host 允许注册表别名（xian-m4）也允许 id（xian-mac-m4）；escort 名按 wf-launch 用别名，这里保留原样
  const hostOk = host && resolveMachineId(host) ? host : null;
  return {
    tag, host: hostOk, serial, profile,
    escortId: safeArg(p.escort_id ?? p.commander_escort_id ?? launch?.escort_id),
    cap: safeArg(p.cap ?? p.capability ?? launch?.cap),
    relaunchCount: positiveInt(p.commander_relaunch_count, 0),
  };
}

/** `openclaw cron list --json`（{jobs:[{id,name}]}）里按名整串全等找在表的 escort；读不到/格式不对 → null（不当"不存在"）。 */
export function findEscortByName(listJson, name) {
  try {
    const parsed = typeof listJson === 'string' ? JSON.parse(listJson) : listJson;
    const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : (Array.isArray(parsed) ? parsed : null);
    if (!jobs) return null;
    const hit = jobs.find((j) => j && j.name === name && typeof j.id === 'string');
    return { found: Boolean(hit), id: hit?.id ?? null };
  } catch { return null; }
}

async function relaunchEscort(pool, task, ctx, { execFileFn, now, bark, roleHandover, buildHeartbeatCommand, existingRolePolicy }) {
  const gateway = gatewayTarget();
  if (!gateway) return { ok: false, error: 'gateway_not_dispatchable' };
  const sshOpts = { timeout: SSH_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 1024 * 1024 };
  const name = `escort-${ctx.host}-${ctx.tag}`;
  if (roleHandover !== undefined) {
    if (typeof roleHandover !== 'function') return { ok: false, error: 'invalid_role_handover' };
    try {
      const remote = command => sshRun(execFileFn, [...SSH_BASE_ARGS, gateway, command], sshOpts);
      return await runRoleHandover(task, ctx, {
        roleHandover, now, maxAdopt: MAX_ADOPT, existingRolePolicy,
        list: () => remote('openclaw cron list --all --json'),
        remove: id => remote(`openclaw cron rm ${sq(id)}`),
        add: () => remote(buildEscortRelaunchRemote({ ...ctx, taskId: task.id,
          relaunchCount: ctx.relaunchCount + 1 }, { buildHeartbeatCommand, delivery: 'none' })),
        activate: id => remote(`openclaw cron run ${sq(id)} --timeout 90000`),
        patch: patch => mergeTaskPayload(pool, task.id, patch),
        event: (type, evidence) => recordTaskEventSafe(pool, task.id, type, evidence),
      });
    } catch (error) { return { ok: false, error: error.message }; }
  }

  // 与 wf-run.sh 自己的看门狗（#2035，按 id 判 absent 才重拉）共存：同名 escort 仍在表就收养其 id、不再加一个
  // （两个陪跑互相串线）；连续收养 2 次心跳仍不来 = 那个 escort 是死的，转入 rm+add。
  const adoptCount = positiveInt(task.payload?.commander_adopt_count, 0);
  if (adoptCount < MAX_ADOPT) {
    let listed = null;
    try {
      listed = findEscortByName(await sshRun(execFileFn, [...SSH_BASE_ARGS, gateway, 'openclaw cron list --json'], sshOpts), name);
    } catch (err) {
      console.warn(`[cmdr-watchdog] cron list 读取失败（按不存在处理）: ${err.message}`);
    }
    if (listed?.found) {
      const nowIso = new Date(now).toISOString();
      await mergeTaskPayload(pool, task.id, {
        escort_id: listed.id, escort_name: name, tag: ctx.tag, host: ctx.host,
        commander_relaunched_at: nowIso, commander_adopt_count: adoptCount + 1,
      });
      await recordTaskEventSafe(pool, task.id, 'commander_adopted', { escort_id: listed.id, prev_escort_id: ctx.escortId ?? null, adopt_count: adoptCount + 1, tag: ctx.tag, host: ctx.host });
      console.warn(`[cmdr-watchdog] ${task.id} 同名 escort 仍在表，收养 ${listed.id}（第 ${adoptCount + 1} 次，心跳仍缺）`);
      return { ok: true, adopted: true, id: listed.id };
    }
  }
  if (ctx.escortId) {
    try {
      await sshRun(execFileFn, [...SSH_BASE_ARGS, gateway, `openclaw cron rm ${ctx.escortId}`], sshOpts);
    } catch (err) {
      console.warn(`[cmdr-watchdog] 旧 escort ${ctx.escortId} 注销失败（fail-open）: ${err.message}`);
    }
  }
  const count = ctx.relaunchCount + 1;
  let out = '';
  try {
    out = await sshRun(execFileFn, [...SSH_BASE_ARGS, gateway,
      buildEscortRelaunchRemote({ ...ctx, taskId: task.id, relaunchCount: count }, { buildHeartbeatCommand })], sshOpts);
  } catch (err) {
    return { ok: false, error: `ssh_add_failed: ${String(err.stderr || err.message).slice(0, 200)}` };
  }
  const id = String(out).match(/"id":\s*"([A-Za-z0-9._-]{4,64})"/)?.[1] ?? null;
  if (!id) return { ok: false, error: `no_id_in_reply: ${String(out).trim().slice(0, 120)}` };
  const nowIso = new Date(now).toISOString();
  const patch = {
    escort_id: id, escort_name: `escort-${ctx.host}-${ctx.tag}`, tag: ctx.tag, host: ctx.host,
    commander_relaunch_count: count, commander_relaunched_at: nowIso,
    commander_relaunch_log: [...(Array.isArray(task.payload?.commander_relaunch_log) ? task.payload.commander_relaunch_log : []),
      { at: nowIso, escort_id: id, prev_escort_id: ctx.escortId ?? null }].slice(-5),
  };
  let barked = false;
  if (count >= MAX_RELAUNCH) {
    patch.commander_bark_at = nowIso;
    const title = `Commander 接班 ${count} 次仍失联`;
    const body = `${workflowRunLabel(task)} TAG=${ctx.tag} 机器=${ctx.host} serial=${ctx.serial ?? '-'} 单=${task.id.slice(0, 8)}：escort 心跳反复中断，已停止自动再拉，请人看现场`;
    try { barked = (await bark(title, body, { dedupeKey: `commander-relaunch:${task.id}`, dedupeTtlSec: 86400 })) !== false; }
    catch (err) { console.warn(`[cmdr-watchdog] Bark 发送失败: ${err.message}`); }
  }
  await mergeTaskPayload(pool, task.id, patch);
  await recordTaskEventSafe(pool, task.id, 'commander_relaunched', {
    escort_id: id, prev_escort_id: ctx.escortId ?? null, count, tag: ctx.tag, host: ctx.host, barked,
  });
  // 新周期任务通常首轮还要再等 10min；立即入队首轮，避免 15min 过期 + 5min 调度门后再等周期。
  // 入队不等于有效接班：恢复仍只认新 Commander 的真实心跳；入队失败留痕，不伪报 active。
  try {
    await sshRun(execFileFn, [...SSH_BASE_ARGS, gateway, `openclaw cron run ${sq(id)} --timeout 90000`], sshOpts);
    await recordTaskEventSafe(pool, task.id, 'commander_activation_requested', { escort_id: id, tag: ctx.tag, host: ctx.host });
  } catch (err) {
    await recordTaskEventSafe(pool, task.id, 'commander_activation_failed', {
      escort_id: id, tag: ctx.tag, host: ctx.host, error: String(err.message).slice(0, 200),
    });
    console.warn(`[cmdr-watchdog] ${task.id} 首轮入队失败，等待周期但尚未恢复: ${err.message}`);
  }
  console.warn(`[cmdr-watchdog] ${task.id} escort 接班 #${count} → ${id}（${ctx.host}/${ctx.tag}）${barked ? ' Bark 已发' : ''}`);
  return { ok: true, id, count, barked };
}

/**
 * scheduler-jobs handler。deps: execFileFn / bark / now / gateMs / staleMs。
 * @returns {Promise<{scanned:number, relaunched:number, barked:number, failed:number, skipped:number}>}
 */
export async function runCommanderWatchdog(pool, deps = {}) {
  validateExistingRolePolicy(deps.existingRolePolicy, deps.roleHandover);
  const now = deps.now ?? Date.now();
  const gateMs = deps.gateMs ?? DEFAULT_GATE_MS;
  if (gateMs > 0 && now - lastWatchdogAt < gateMs) return { scanned: 0, relaunched: 0, barked: 0, failed: 0, skipped: 0, skipped_reason: 'interval_gate' };
  lastWatchdogAt = now;
  const execFileFn = deps.execFileFn ?? nodeExecFile;
  const bark = deps.bark ?? defaultBark;
  const staleMs = deps.staleMs ?? positiveInt(process.env.COMMANDER_HEARTBEAT_STALE_MS, DEFAULT_HEARTBEAT_STALE_MS);
  let rows;
  try {
    ({ rows } = await pool.query(
      `SELECT id, title, task_type, payload
         FROM tasks
        WHERE status = 'in_progress' AND ${RUN_TYPES_SQL}
          AND COALESCE(started_at, due_at, created_at) < NOW() - ($1::bigint * interval '1 millisecond')
          AND GREATEST(COALESCE(NULLIF(payload->>'commander_heartbeat_at', '')::timestamptz, '-infinity'::timestamptz),
                       COALESCE(NULLIF(payload->>'commander_relaunched_at', '')::timestamptz, '-infinity'::timestamptz))
              < NOW() - ($1::bigint * interval '1 millisecond')
          AND COALESCE(NULLIF(payload->>'commander_relaunch_count', '')::int, 0) < $2::int
          AND payload->>'commander_bark_at' IS NULL
        ORDER BY COALESCE(started_at, due_at, created_at) ASC
        LIMIT ${BATCH_LIMIT}`,
      [staleMs, MAX_RELAUNCH],
    ));
  } catch (err) {
    console.warn(`[cmdr-watchdog] 扫描失败: ${err.message}`);
    return { scanned: 0, relaunched: 0, barked: 0, failed: 0, skipped: 0, error: err.message };
  }
  const out = { scanned: rows?.length ?? 0, relaunched: 0, adopted: 0, barked: 0, failed: 0, skipped: 0 };
  for (const task of rows ?? []) {
    try {
      const ctx = await resolveRelaunchContext(pool, task);
      if (!ctx.tag || !ctx.host) {
        out.skipped += 1;
        if (deps.roleHandover === undefined) await mergeTaskPayload(pool, task.id, { commander_relaunched_at: new Date(now).toISOString() });
        await recordTaskEventSafe(pool, task.id, 'commander_relaunch_skipped', { reason: !ctx.tag ? 'no_tag' : 'no_host', serial: ctx.serial });
        continue;
      }
      const r = await relaunchEscort(pool, task, ctx, { execFileFn, now, bark, roleHandover: deps.roleHandover,
        buildHeartbeatCommand: deps.buildHeartbeatCommand, existingRolePolicy: deps.existingRolePolicy });
      if (r.ok && r.adopted) { out.adopted += 1; continue; }
      if (r.ok) { out.relaunched += 1; if (r.barked) out.barked += 1; continue; }
      out.failed += 1;
      if (deps.roleHandover === undefined) await mergeTaskPayload(pool, task.id, { commander_relaunched_at: new Date(now).toISOString() });
      await recordTaskEventSafe(pool, task.id, 'commander_relaunch_failed', { error: r.error, tag: ctx.tag, host: ctx.host });
      console.warn(`[cmdr-watchdog] ${task.id} escort 接班失败: ${r.error}`);
    } catch (err) {
      out.failed += 1;
      console.warn(`[cmdr-watchdog] ${task.id} 处理异常: ${err.message}`);
    }
  }
  return out;
}

// ── 趋势 Bark ──────────────────────────────────────────────────────────────
function beijingParts(ms) {
  const d = new Date(ms + 8 * 3600 * 1000);
  return { day: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function dayOffset(day, delta) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * 每日趋势 Bark（北京 08:30–10:00 窗口，working_memory 当日去重）。deps: bark / now / staleSerialMs / windowOverride。
 */
export async function runWorkflowTrendBark(pool, deps = {}) {
  const now = deps.now ?? Date.now();
  const bark = deps.bark ?? defaultBark;
  const { day, minutes } = beijingParts(now);
  if (!deps.windowOverride && (minutes < 8 * 60 + 30 || minutes > 10 * 60)) return { skipped: 'outside_window' };
  try {
    const { rows } = await pool.query('SELECT value_json FROM working_memory WHERE key = $1', [TREND_KEY]);
    if (rows?.[0]?.value_json?.day === day) return { skipped: 'already_today' };
  } catch (err) {
    console.warn(`[trend-bark] 去重键读取失败（照跑）: ${err.message}`);
  }
  const out = { day, zeroLeads: [], staleSerials: [], barks: 0 };
  // ① 同一 wf 连续 2 个自然日（北京）零线索：能力名只认 payload 字段/标题前段，不认账本 run_id 前缀
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(payload->>'wf_id', payload->>'capability', payload->>'cap', split_part(title, ' · ', 1)) AS label,
              (COALESCE(completed_at, updated_at)::timestamptz AT TIME ZONE 'Asia/Shanghai')::date::text AS day,
              COUNT(*) AS runs,
              COALESCE(SUM(COALESCE(NULLIF(payload->>'leads', '')::numeric, NULLIF(result->'metrics'->>'leads', '')::numeric, 0)), 0) AS leads
         FROM tasks
        WHERE status IN ('completed', 'failed') AND ${RUN_TYPES_SQL}
          AND COALESCE(completed_at, updated_at) >= NOW() - interval '4 days'
        GROUP BY 1, 2`);
    const d1 = dayOffset(day, -1);
    const d2 = dayOffset(day, -2);
    const byLabel = new Map();
    for (const r of rows ?? []) {
      if (!byLabel.has(r.label)) byLabel.set(r.label, {});
      byLabel.get(r.label)[r.day] = { runs: Number(r.runs), leads: Number(r.leads) };
    }
    for (const [label, days] of byLabel) {
      const a = days[d1]; const b = days[d2];
      if (a && b && a.runs > 0 && b.runs > 0 && a.leads === 0 && b.leads === 0) out.zeroLeads.push(label);
    }
    if (out.zeroLeads.length) {
      const sent = await bark('workflow 连续 2 天零线索', `${out.zeroLeads.join('、')}：${d2}/${d1} 两天有批但 0 线索，请看趋势表`, { dedupeKey: `trend:zero-leads:${day}`, dedupeTtlSec: 86400 });
      if (sent !== false) out.barks += 1;
    }
  } catch (err) {
    console.warn(`[trend-bark] 零线索统计失败: ${err.message}`);
  }
  // ② 一台 serial 近 72h 有批但 24h 无 completed
  try {
    const { rows } = await pool.query(
      `SELECT p.serial, p.nickname,
              COUNT(t.id) FILTER (WHERE t.created_at >= NOW() - interval '72 hours') AS recent_runs,
              MAX(t.completed_at) FILTER (WHERE t.status = 'completed') AS last_ok
         FROM phone_registry p
         LEFT JOIN tasks t ON t.task_type = 'device_job' AND t.payload->>'source' = 'cron'
              AND t.payload->>'serial' = p.serial AND t.created_at >= NOW() - interval '7 days'
        WHERE p.enabled = true
        GROUP BY p.serial, p.nickname`);
    const staleMs = deps.staleSerialMs ?? 24 * 3600 * 1000;
    const names = [];
    for (const r of rows ?? []) {
      if (Number(r.recent_runs) <= 0) continue;
      const lastOk = r.last_ok ? new Date(r.last_ok).getTime() : null;
      if (lastOk === null || now - lastOk > staleMs) { out.staleSerials.push(r.serial); names.push(r.nickname || r.serial); }
    }
    if (names.length) {
      const sent = await bark('手机 24h 无成功批', `${names.join('、')}：近 72h 有批但 24h 内没有 completed，请查设备`, { dedupeKey: `trend:stale-serial:${day}`, dedupeTtlSec: 86400 });
      if (sent !== false) out.barks += 1;
    }
  } catch (err) {
    console.warn(`[trend-bark] 手机 24h 统计失败: ${err.message}`);
  }
  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
      [TREND_KEY, JSON.stringify({ day, zero_leads: out.zeroLeads, stale_serials: out.staleSerials, barks: out.barks })],
    );
  } catch (err) {
    console.warn(`[trend-bark] 去重键写入失败: ${err.message}`);
  }
  return out;
}
