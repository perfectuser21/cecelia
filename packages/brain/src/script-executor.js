/**
 * script-executor.js — executor=script：确定性脚本步的派发 / 收割 / 重试（链 bf5088a3 棒 3，任务 5cdbd52a）。
 *
 * 设计稿：docs/superpowers/specs/2026-09-25-script-executor-design.md
 *
 * us-vps 零执行（决策 96054a8b）：本文件里没有任何一行在 Brain 本机执行脚本——只把活经 ssh 推到跑场机
 * （host 由 lib/script-task-spec.js 校验只认 machine-registry 的计算工作机），隔轮回来读 .exit 收尸。
 *
 * 传输安全（硬约束 2）：
 *   · ssh 命令行永远是常量 `sh -s`；runner 脚本经 stdin 送达，里面只有校验过的 run_id / timeout 整数与 base64。
 *   · cmd / cwd / env 值先组成 job 脚本（值一律单引号转义），再整体 base64，远端解码成 0600 文件执行、跑完即删。
 *     引号/美元符/反引号只是命令内容，逃不出传输层。env 值不进 ssh 命令行、不进日志/事件/留痕，
 *     收割回来的 stdout/stderr 还会把 env 值替换成 ***。
 *   · 超时：远端 supervisor 用独立进程组跑 job，到点 TERM 再 KILL 整个进程组，标 .timedout，exit 记 124。
 *
 * 幂等（硬约束 3）：run_id = script-<task.id>-a<第几次尝试>，确定性；远端 .pid/.exit 已在就回 ALREADY，
 * 绝不起第二个进程。ssh 超时 ≠ 远端没起来，所以派发失败重试一次是安全的。
 *
 * 失败如实（硬约束 4）：exit≠0 / 超时原样收割。先按 retry-policy 的 script_exec 类重排（一次重试，
 * payload.script_attempts[] 记每次 run_id/exit/错误），耗尽后 finalizeTask(failed) 带 exit code 与截断 stderr。
 * 成功终态写 completed（不是 completed_no_pr）：hard 依赖门禁只放行 completed，脚本步后面挂 agent 步必须能放行。
 *
 * run 留痕经棒 1 的 startRun/finishRun，终态经棒 2 的 finalizeTask，本文件不直写 task_runs / 终态。
 */
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { SSH_BASE_ARGS } from './lib/ssh-args.js';
import { sshWithStdin, sshRun } from './lib/ssh-exec.js';
import { sshTargetFor, resolveMachineId, listComputeWorkerIds } from './machine-registry.js';
import { recordTaskEventSafe } from './lib/task-event-log.js';
import { startRun, finishRun } from './lib/task-run.js';
import { finalizeTask } from './lib/task-terminal.js';
import { getBackoffMs } from './lib/retry-policy.js';
import { isAllowed } from './circuit-breaker.js';
import { recordDispatchResult } from './dispatch-stats.js';
import {
  SCRIPT_LIMITS,
  validateScriptPayload,
  isScriptPayloadError,
} from './lib/script-task-spec.js';

export const SCRIPT_SOURCE = 'script';
export const SCRIPT_BREAKER_KEY = 'script';
export const SCRIPT_HOST_CONCURRENCY_DEFAULT = 2;
const REAP_BATCH = 10;
const REAP_SSH_TIMEOUT_MS = 20_000;
const SAFE_ID = /^[A-Za-z0-9._-]+$/;
const SAFE_NONCE = /^[A-Za-z0-9]{4,64}$/;

// ── 传输注入（测试用）：把 ssh 换成假传输，其余逻辑全部真跑 ─────────────────────
let transport = {};
export function _setScriptTransport(t) { transport = { ...t }; }
export function _resetScriptTransport() { transport = {}; }

async function resolvePool(deps) {
  if (deps?.pool) return deps.pool;
  return (await import('./db.js')).default;
}

function assertSafeId(name, value) {
  const v = String(value);
  if (!SAFE_ID.test(v) || v.includes('..')) throw new Error(`invalid ${name}`);
  return v;
}

/** run_id 既进远端 shell 又当文件名，收割侧复用同一条判据。 */
export function isSafeRunId(runId) {
  const v = String(runId);
  return SAFE_ID.test(v) && !v.includes('..');
}

/** 第几次尝试 = 已记录失败次数 + 1。 */
export function attemptNumberOf(payload) {
  return (Array.isArray(payload?.script_attempts) ? payload.script_attempts.length : 0) + 1;
}

/** 确定性 run_id：同一次尝试永远同一个 id（硬约束 3 的根）。 */
export function scriptRunIdFor(taskId, attempt) {
  assertSafeId('taskId', taskId);
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('invalid attempt');
  return `script-${taskId}-a${attempt}`;
}

const shq = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;

/**
 * job 脚本：cd → export env → cmd。所有值单引号转义；cmd 是命令内容本身（校验保证单行无控制字符），
 * 作为文件内容经 base64 传输，不是 ssh 命令行的一部分。
 */
export function buildJobScript({ cmd, cwd, env }) {
  const lines = ['#!/bin/sh'];
  if (cwd) {
    if (cwd === '~') lines.push('cd "$HOME" || exit 125');
    else if (cwd.startsWith('~/')) lines.push(`cd "$HOME"/${shq(cwd.slice(2))} || exit 125`);
    else lines.push(`cd ${shq(cwd)} || exit 125`);
  }
  for (const [key, value] of Object.entries(env ?? {})) lines.push(`export ${key}=${shq(value)}`);
  lines.push(cmd);
  return `${lines.join('\n')}\n`;
}

// 远端 supervisor：独立进程组跑 job，超时 TERM→KILL 整个组，exit 最后原子落盘。全部是静态文本，无任何插值。
const SUPERVISOR = [
  'RID="$1"; T="$2"; D="$HOME/brain-runs"',
  'set -m',
  'sh "$D/$RID.sh" >"$D/$RID.out" 2>"$D/$RID.err" </dev/null &',
  'CP=$!',
  '( sleep "$T"; if kill -0 "$CP" 2>/dev/null; then : > "$D/$RID.timedout"; kill -TERM -- "-$CP" 2>/dev/null; sleep 3; kill -KILL -- "-$CP" 2>/dev/null; fi ) >/dev/null 2>&1 </dev/null &',
  'WP=$!',
  'wait "$CP"',
  'RC=$?',
  'kill -- "-$WP" 2>/dev/null; kill "$WP" 2>/dev/null',
  'if [ -f "$D/$RID.timedout" ]; then RC=124; fi',
  'rm -f "$D/$RID.sh" "$D/$RID.sup"',
  'echo "$RC" > "$D/$RID.exit.tmp" && mv "$D/$RID.exit.tmp" "$D/$RID.exit"',
].join('\n');

/**
 * 发往 `ssh <target> sh -s` 标准输入的 runner：幂等探针 → 解码 job 到 0600 文件 → 起 supervisor（后台）→ 回 DISPATCHED。
 * 只含校验过的 run_id / timeout 整数与 base64，没有任何 payload 明文。
 */
export function buildRunnerScript({ runId, timeoutSec, jobScript }) {
  assertSafeId('runId', runId);
  if (!Number.isInteger(timeoutSec) || timeoutSec < SCRIPT_LIMITS.MIN_TIMEOUT_SEC || timeoutSec > SCRIPT_LIMITS.MAX_TIMEOUT_SEC) {
    throw new Error(`invalid timeout ${timeoutSec}`);
  }
  if (typeof jobScript !== 'string' || jobScript === '') throw new Error('invalid jobScript');
  const b64 = Buffer.from(jobScript, 'utf8').toString('base64');
  return [
    `RID='${runId}'; T=${timeoutSec}`,
    'D="$HOME/brain-runs"',
    'mkdir -p "$D" && chmod 700 "$D" || { echo MKDIR_FAILED; exit 3; }',
    'if [ -f "$D/$RID.pid" ] || [ -f "$D/$RID.exit" ]; then echo ALREADY; exit 0; fi',
    'umask 077',
    `printf '%s' '${b64}' | base64 --decode > "$D/$RID.sh" || { echo DECODE_FAILED; exit 4; }`,
    'cat > "$D/$RID.sup" <<\'BRAIN_SUP_EOF\'',
    SUPERVISOR,
    'BRAIN_SUP_EOF',
    'nohup sh "$D/$RID.sup" "$RID" "$T" >/dev/null 2>&1 </dev/null &',
    'echo $! > "$D/$RID.pid"',
    'echo DISPATCHED',
    '',
  ].join('\n');
}

/** 收割命令：.exit 在才输出 EXIT/TIMEDOUT + 分段 stdout/stderr 尾部；marker 带一次性 nonce，输出里伪造 marker 骗不了解析。 */
export function buildReapCommand(runId, nonce) {
  assertSafeId('runId', runId);
  if (!SAFE_NONCE.test(String(nonce))) throw new Error('invalid nonce');
  const f = `~/brain-runs/${runId}`;
  return `if [ -f ${f}.exit ]; then echo "EXIT=$(cat ${f}.exit)"; if [ -f ${f}.timedout ]; then echo TIMEDOUT=1; else echo TIMEDOUT=0; fi; echo '---OUT-${nonce}---'; tail -c ${SCRIPT_LIMITS.MAX_STDOUT_BYTES} ${f}.out 2>/dev/null; echo; echo '---ERR-${nonce}---'; tail -c ${SCRIPT_LIMITS.MAX_STDERR_BYTES} ${f}.err 2>/dev/null; else echo NO_EXIT; fi`;
}

const tailBytes = (text, max) => {
  const buf = Buffer.from(text, 'utf8');
  return buf.length <= max ? text : buf.subarray(buf.length - max).toString('utf8');
};

/** 解析收割输出；.exit 还没落地（NO_EXIT）/ 形状不对返回 null（一律不动，等下一轮）。 */
export function parseReapOutput(out, nonce) {
  const text = String(out ?? '');
  const outMarker = `---OUT-${nonce}---\n`;
  const errMarker = `---ERR-${nonce}---`;
  const oi = text.indexOf(outMarker);
  if (oi < 0) return null;
  const header = text.slice(0, oi);
  const exitMatch = header.match(/^EXIT=(\d+)$/m);
  if (!exitMatch) return null;
  const outStart = oi + outMarker.length;
  const ei = text.indexOf(errMarker, outStart);
  if (ei < 0) return null;
  let stdout = text.slice(outStart, ei);
  if (stdout.endsWith('\n')) stdout = stdout.slice(0, -1); // 命令里 echo 补的那个换行
  let stderr = text.slice(ei + errMarker.length);
  if (stderr.startsWith('\n')) stderr = stderr.slice(1);
  return {
    exit: parseInt(exitMatch[1], 10),
    timedOut: /^TIMEDOUT=1$/m.test(header),
    stdout: tailBytes(stdout, SCRIPT_LIMITS.MAX_STDOUT_BYTES),
    stderr: tailBytes(stderr, SCRIPT_LIMITS.MAX_STDERR_BYTES),
  };
}

/** env 值脱敏：值 ≥3 字符才替换（更短的不是凭据，替换只会误伤输出）；长值优先。 */
export function redactEnvValues(text, env) {
  let out = String(text ?? '');
  const values = Object.values(env ?? {}).filter((v) => typeof v === 'string' && v.length >= 3);
  values.sort((a, b) => b.length - a.length);
  for (const v of values) out = out.split(v).join('***');
  return out;
}

export function hostConcurrency(env = process.env) {
  const n = Number.parseInt(env.SCRIPT_HOST_CONCURRENCY ?? '', 10);
  return Number.isInteger(n) && n >= 1 ? n : SCRIPT_HOST_CONCURRENCY_DEFAULT;
}

// ── 派发前出口（dispatcher 在 claim 之后、标 in_progress 之前调用）──────────────────
/**
 * @returns {Promise<{outcome:'proceed'}|{outcome:'skip'}|{outcome:'return', result:object}>}
 *   proceed：交给主流程标 in_progress 并 triggerCeceliaRun；skip：并发槽满/熔断，claim 已放、已进 holSkipIds；
 *   return：终态（违规 payload 已 failed），dispatcher 直接把 result 当本轮结果。
 */
export async function prepareScriptDispatch(task, deps = {}) {
  const pool = await resolvePool(deps);
  const actions = deps.actions ?? [];
  const holSkipIds = deps.holSkipIds ?? [];
  const releaseClaim = () => pool.query(
    'UPDATE tasks SET claimed_by = NULL, claimed_at = NULL, updated_at = NOW() WHERE id = $1',
    [task.id],
  );

  const { rows: fullRows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [task.id]);
  const full = fullRows[0] ?? task;

  let spec;
  try {
    spec = validateScriptPayload(full.payload);
  } catch (err) {
    if (!isScriptPayloadError(err)) throw err;
    // 确定性错误：不重试，终态 failed（建单入口本该拦住，走到这里说明有人绕过入口直写库）
    await finalizeTask(pool, task.id, 'failed', {
      set: { completed_at: 'now', error_message: `script_payload_invalid: ${err.message}`.slice(0, 500) },
      mergePayload: { failure_class: 'script_payload_invalid', script_payload_error: { field: err.field, reason: err.reason } },
      onlyIfStatus: 'queued',
    });
    await recordTaskEventSafe(pool, task.id, 'script_payload_rejected', { field: err.field, reason: err.reason });
    return {
      outcome: 'return',
      result: { dispatched: false, reason: 'script_payload_invalid', task_id: task.id, terminal: true, actions },
    };
  }

  // 熔断：ssh 派发连续失败才会开（与 cecelia-run / openclaw-agent 互不牵连）
  if (!isAllowed(SCRIPT_BREAKER_KEY)) {
    await releaseClaim();
    holSkipIds.push(task.id);
    return { outcome: 'skip' };
  }

  // 并发槽：同一跑场机上 in_progress 的 script 数达上限 → 退回。P0 停整轮（高优信号不许被绕过），非 P0 让位。
  const limit = hostConcurrency(deps.env);
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM tasks
      WHERE task_type = 'script_run' AND executor_kind = 'script' AND status = 'in_progress'
        AND payload->>'host_id' = $1`,
    [spec.host],
  );
  if ((rows[0]?.n ?? 0) >= limit) {
    await releaseClaim();
    if (task.priority === 'P0') {
      return {
        outcome: 'return',
        result: { dispatched: false, reason: 'script_host_pool_full', task_id: task.id, host: spec.host, actions },
      };
    }
    holSkipIds.push(task.id);
    return { outcome: 'skip' };
  }

  await pool.query(
    `UPDATE tasks SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb, updated_at = NOW()
      WHERE id = $1 AND status = 'queued'`,
    [task.id, JSON.stringify({ host_id: spec.host })],
  );
  return { outcome: 'proceed' };
}

/** prepareScriptDispatch 的兜底包装：异常不许把 claim 永远挂在任务上（候选循环不在 postClaimException 覆盖范围）。 */
export async function dispatchScriptTask(task, deps = {}) {
  try {
    return await prepareScriptDispatch(task, deps);
  } catch (err) {
    console.error(`[dispatch] script 派发前检查异常 (task=${task.id}): ${err.message}`);
    try {
      const pool = await resolvePool(deps);
      await pool.query(
        'UPDATE tasks SET claimed_by = NULL, claimed_at = NULL, updated_at = NOW() WHERE id = $1',
        [task.id],
      );
      await recordDispatchResult(pool, false, 'script_prepare_exception', undefined, task.id);
    } catch (releaseErr) {
      console.error(`[dispatch] script claim 释放失败（非致命，task=${task.id}）: ${releaseErr.message}`);
    }
    return { outcome: 'skip' };
  }
}

// ── 派发 ───────────────────────────────────────────────────────────────────────
/**
 * 把一条 script_run 任务经 ssh 推到跑场机执行。
 *
 * 返回：
 *   {success:true, runId, executor:'script', alreadyRunning?}   已派发（含幂等命中）
 *   {success:false, reason:'script_spawn_failed', error}          ssh 两次都失败（dispatcher 回队并计数）
 *   {success:false, reason:'script_payload_invalid', taskTerminal:true}  违规 payload：本函数已把任务终态 failed
 */
export async function triggerScriptRun(task, deps = {}) {
  const pool = await resolvePool(deps);
  const spawnFn = deps.spawnFn ?? transport.spawnFn ?? nodeSpawn;
  const payload = task.payload ?? {};

  let spec;
  try {
    spec = validateScriptPayload(payload);
  } catch (err) {
    if (!isScriptPayloadError(err)) throw err;
    await finalizeTask(pool, task.id, 'failed', {
      set: { completed_at: 'now', error_message: `script_payload_invalid: ${err.message}`.slice(0, 500) },
      mergePayload: { failure_class: 'script_payload_invalid', script_payload_error: { field: err.field, reason: err.reason } },
      onlyIfStatus: ['queued', 'in_progress'],
    });
    await recordTaskEventSafe(pool, task.id, 'script_payload_rejected', { field: err.field, reason: err.reason });
    return { success: false, taskId: task.id, reason: 'script_payload_invalid', error: err.message, taskTerminal: true, configError: true };
  }

  const attempt = attemptNumberOf(payload);
  let runId;
  let runner;
  let target;
  try {
    runId = scriptRunIdFor(task.id, attempt);
    runner = buildRunnerScript({
      runId,
      timeoutSec: spec.timeout_sec,
      jobScript: buildJobScript({ cmd: spec.cmd, cwd: spec.cwd, env: spec.env }),
    });
    target = sshTargetFor(spec.host);
  } catch (err) {
    return { success: false, taskId: task.id, reason: 'script_spawn_failed', error: err.message };
  }

  // ssh 派发失败重试一次再判死。安全：远端 runner 自带 ALREADY 探针，第一次其实起来了的话第二次只回 ALREADY。
  const once = async () => {
    const out = await sshWithStdin(spawnFn, [...SSH_BASE_ARGS, target, 'sh -s'], runner);
    if (/^ALREADY$/m.test(out)) return 'already';
    if (/^DISPATCHED$/m.test(out)) return 'dispatched';
    throw new Error(`no DISPATCHED marker: ${out.slice(0, 120)}`);
  };
  let outcome;
  try {
    outcome = await once();
  } catch (first) {
    console.warn(`[script] 派发失败，重试一次 (task=${task.id}): ${first.message}`);
    try {
      outcome = await once();
    } catch (second) {
      return { success: false, taskId: task.id, reason: 'script_spawn_failed', error: `${first.message} | 重试: ${second.message}` };
    }
  }

  const alreadyRunning = outcome === 'already';
  const envKeys = Object.keys(spec.env);
  await pool.query(
    `UPDATE tasks
        SET executor_kind = 'script',
            payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb,
            status = 'in_progress',
            started_at = COALESCE(started_at, NOW()),
            updated_at = NOW()
      WHERE id = $1 AND status IN ('queued', 'in_progress')`,
    [task.id, JSON.stringify({ script_run_id: runId, host_id: spec.host })],
  );
  await recordTaskEventSafe(pool, task.id, 'script_spawned', {
    run_id: runId, host: spec.host, attempt, timeout_sec: spec.timeout_sec, env_keys: envKeys, already_running: alreadyRunning,
  });
  // 一次执行 = 一行 task_runs（棒 1 run 原语，fail-open）：ssh 已把脚本起到跑场机，此刻起算开始。
  await startRun({
    taskId: task.id,
    runId,
    source: SCRIPT_SOURCE,
    context: { host: spec.host, attempt, timeout_sec: spec.timeout_sec, env_keys: envKeys, already_running: alreadyRunning },
  }, { pool });
  return { success: true, taskId: task.id, runId, executor: 'script', alreadyRunning };
}

// ── 收割 ───────────────────────────────────────────────────────────────────────
async function settleScriptRun(pool, row, parsed, { hostId, runId }) {
  const payload = row.payload ?? {};
  const env = payload.env ?? {};
  const stdout = redactEnvValues(parsed.stdout, env);
  const stderr = redactEnvValues(parsed.stderr, env);
  const prior = Array.isArray(payload.script_attempts) ? payload.script_attempts : [];
  const attemptNo = prior.length + 1;
  const artifacts = [
    `${hostId}:~/brain-runs/${runId}.out`,
    `${hostId}:~/brain-runs/${runId}.err`,
    ...(Array.isArray(payload.artifact_paths) ? payload.artifact_paths.map((p) => `${hostId}:${p}`) : []),
  ];
  const script = {
    exit_code: parsed.exit, timed_out: parsed.timedOut, host: hostId, run_id: runId,
    attempts: attemptNo, stdout, stderr, artifacts,
  };

  if (parsed.exit === 0 && !parsed.timedOut) {
    // 成功终态写 completed：hard 依赖门禁只放行 completed。
    await finalizeTask(pool, row.id, 'completed', { mergeResult: { script }, onlyIfStatus: 'in_progress' });
    await finishRun({ runId, status: 'completed', exitCode: 0, artifacts }, { pool });
    await recordTaskEventSafe(pool, row.id, 'script_reaped', { run_id: runId, exit: 0 });
    return 'completed';
  }

  const code = parsed.timedOut ? 'script_timeout' : `script_exit_${parsed.exit}`;
  await finishRun({
    runId,
    status: parsed.timedOut ? 'timeout' : 'failed',
    exitCode: parsed.exit,
    artifacts,
    error: code,
  }, { pool });
  const attempts = [...prior, {
    attempt: attemptNo, run_id: runId, exit_code: parsed.exit, timed_out: parsed.timedOut, error: code,
    stderr_tail: stderr.slice(-500), ended_at: new Date().toISOString(),
  }];

  const backoffMs = getBackoffMs('script_exec', prior.length);
  if (backoffMs !== null) {
    const nextRunAt = new Date(Date.now() + backoffMs).toISOString();
    const requeued = await pool.query(
      `UPDATE tasks
          SET status = 'queued', claimed_by = NULL, claimed_at = NULL, updated_at = NOW(),
              payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
        WHERE id = $1 AND status = 'in_progress'
        RETURNING id`,
      [row.id, JSON.stringify({ script_attempts: attempts, next_run_at: nextRunAt, script_run_id: null })],
    );
    await recordTaskEventSafe(pool, row.id, 'script_attempt_failed', {
      run_id: runId, exit: parsed.exit, timed_out: parsed.timedOut, will_retry: true, next_run_at: nextRunAt,
    });
    return requeued.rowCount > 0 ? 'retried' : 'skipped';
  }

  const firstErrLine = stderr.split('\n').map((l) => l.trim()).find(Boolean);
  await finalizeTask(pool, row.id, 'failed', {
    set: {
      completed_at: 'now',
      error_message: `${code}${firstErrLine ? `: ${firstErrLine}` : ''}`.slice(0, 500),
    },
    mergeResult: { script },
    mergePayload: { script_attempts: attempts, failure_class: 'script_failed' },
    onlyIfStatus: 'in_progress',
  });
  await recordTaskEventSafe(pool, row.id, 'script_attempt_failed', {
    run_id: runId, exit: parsed.exit, timed_out: parsed.timedOut, will_retry: false,
  });
  return 'failed';
}

/**
 * 收割在跑的 script_run：远端 .exit 落地即结算。
 * 三态：exit 0 → completed；exit≠0/超时 → 按 retry-policy 重排或 failed；NO_EXIT → 一律不动（还在跑），
 * 卡死交给活性合同 script（staleMinutes 75 + onStale fail）。取数 LIMIT 10、单条 ssh 20s，老任务先收。
 */
export async function reapScriptRuns(pool, deps = {}) {
  const execFileFn = deps.execFileFn ?? transport.execFileFn ?? nodeExecFile;
  const { rows } = await pool.query(
    `SELECT id, payload FROM tasks
      WHERE task_type = 'script_run' AND status = 'in_progress' AND executor_kind = 'script'
        AND payload->>'script_run_id' IS NOT NULL
      ORDER BY started_at ASC NULLS FIRST
      LIMIT ${REAP_BATCH}`,
  );
  const out = { reaped: 0, completed: 0, failed: 0, retried: 0 };
  const computeWorkers = listComputeWorkerIds();
  for (const row of rows ?? []) {
    const runId = row.payload?.script_run_id;
    const hostId = resolveMachineId(row.payload?.host_id ?? row.payload?.host);
    if (!isSafeRunId(runId) || !hostId || !computeWorkers.includes(hostId)) {
      console.warn(`[script] 收割跳过非法 run/host: task=${row.id} run=${String(runId).slice(0, 60)}`);
      continue;
    }
    const nonce = randomBytes(8).toString('hex');
    let stdout;
    try {
      stdout = await sshRun(execFileFn, [
        ...SSH_BASE_ARGS, sshTargetFor(hostId), buildReapCommand(runId, nonce),
      ], { timeout: REAP_SSH_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    } catch (err) {
      console.warn(`[script] 收割 ${runId} 探测失败（不动，下一轮再来）: ${err.message}`);
      continue;
    }
    const parsed = parseReapOutput(stdout, nonce);
    if (!parsed) continue;
    const verdict = await settleScriptRun(pool, row, parsed, { hostId, runId });
    if (verdict === 'skipped') continue;
    out.reaped++;
    if (verdict === 'completed') out.completed++;
    else if (verdict === 'retried') out.retried++;
    else out.failed++;
  }
  return out;
}
