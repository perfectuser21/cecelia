#!/usr/bin/env node
/**
 * 技能工厂派发器（factory-dispatcher）
 *
 * 在 MMV（本机 macOS）常驻：把 Brain 里 payload.factory_dispatch=true 的 queued 任务，
 * 代领设备锁后派给 OpenClaw 的 skill-factory agent 真机执行，并守望到终态。
 * ESM、零依赖；所有外部调用（Brain/ssh/openclaw/fs/时钟）经 deps 注入，便于测试。
 *
 * us-vps 零执行铁律：linux / 容器内启动自检直接拒绝运行。
 */
import { spawn, execFile } from 'node:child_process';
import { existsSync, openSync, closeSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isFactoryTask, readDispatchMode, refreshEligibleTask, envMinutes } from './factory-dispatcher-config.js';
export { FACTORY_TASK_TYPE, isFactoryTask, readDispatchMode } from './factory-dispatcher-config.js';
export const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TERMINAL_STATUSES = new Set(['completed', 'completed_no_pr', 'failed', 'cancelled', 'archived']);
const LOCK_SUBCOMMANDS = new Set(['lock-status', 'lock-acquire', 'lock-release', 'lock-refresh']);
const DEFAULT_SSH_HOST = 'xian-m4';
const AGENT_ID = 'skill-factory';
const UTF8_ENV = { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };
export const DEFAULT_OPTS = {
  claimer: `factory-dispatcher@${hostname()}`,
  stateDir: join(homedir(), '.factory-dispatcher'),
  openclawBin: 'openclaw',
  idlePollMs: 60_000,
  lockPollMs: 60_000,
  lockWaitTimeoutMs: 30 * 60_000,
  sessionPollMs: 30_000,
  sessionTimeoutMs: 60 * 60_000,
  exitGraceMs: 3 * 60_000,
  lockRefreshMs: 10 * 60_000,
  // 统一领单租约（派发总闸 G，任务 c5f6e683）：claim 带 lease_seconds，守望每轮心跳续约；派发器死了租约过期由 Brain 回收
  leaseSeconds: 600,
  workStartHour: 9,
  workEndHour: 23,
};

// ── 时间 ────────────────────────────────────────────────────────────────
function shanghaiParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return { ymd: `${get('year')}${get('month')}${get('day')}`, hour: Number(get('hour')) };
}

export function shanghaiYmd(date) {
  return shanghaiParts(date).ymd;
}

/** 上海时间 [startHour, endHour) 内才认领。 */
export function isWithinWorkHours(date, { workStartHour = 9, workEndHour = 23 } = {}) {
  const { hour } = shanghaiParts(date);
  return hour >= workStartHour && hour < workEndHour;
}

// ── 契约 ────────────────────────────────────────────────────────────────
function requireSafe(value, field) {
  if (typeof value !== 'string' || !SAFE_ID_RE.test(value)) {
    throw new Error(`${field} 只允许 [A-Za-z0-9._-] 且首字符为字母数字，收到 ${JSON.stringify(value)}`);
  }
  return value;
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} 必须是非空字符串`);
  return value;
}

/** 解析 payload.factory 任务契约，补默认值；任何不合规返回 { ok:false, error }。 */
export function parseFactoryContract(task) {
  try {
    const payload = task?.payload || {};
    if (payload.factory_dispatch !== true) throw new Error('payload.factory_dispatch 必须是 true');
    const f = payload.factory;
    if (!f || typeof f !== 'object') throw new Error('缺少 payload.factory');
    const stage = requireSafe(typeof f.stage === 'number' ? String(f.stage) : f.stage, 'stage');
    const device = f.device || {};
    const contract = {
      stage,
      workflow_key: requireText(f.workflow_key, 'workflow_key'),
      device: {
        node: requireText(device.node, 'device.node'),
        profile: requireSafe(device.profile, 'device.profile'),
        serial: requireText(device.serial, 'device.serial'),
        ssh_host: requireSafe(device.ssh_host ?? DEFAULT_SSH_HOST, 'device.ssh_host'),
      },
      agent: f.agent,
      skill: requireText(f.skill, 'skill'),
      round: f.round ?? 1,
      run_prefix: requireSafe(f.run_prefix ?? `sf${stage}`, 'run_prefix'),
      message: f.message == null ? '' : String(f.message),
    };
    if (contract.agent !== AGENT_ID) throw new Error(`agent 必须是 ${AGENT_ID}`);
    if (!Number.isInteger(contract.round) || contract.round < 1) throw new Error('round 必须是正整数');
    return { ok: true, contract };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function buildRunId({ runPrefix, taskId, date, round }) {
  return requireSafe(`${runPrefix}-${String(taskId).slice(0, 8)}-${shanghaiYmd(date)}-r${round}`, 'run_id');
}

export function buildSessionId(stage, taskId) {
  return requireSafe(`sf-${stage}-${String(taskId).slice(0, 8)}`, 'session_id');
}

export function buildAgentMessage({ runId, taskId, contract }) {
  const { device } = contract;
  const lines = [
    `【技能工厂派发】Brain 任务 id：${taskId}`,
    `run_id：${runId}`,
    `阶段 stage：${contract.stage}｜轮次 round：${contract.round}｜workflow_key：${contract.workflow_key}｜技能：${contract.skill}`,
    `设备：node=${device.node} profile=${device.profile} serial=${device.serial}（ssh ${device.ssh_host}）`,
    '',
    ...(contract.stage === 'verify' ? ['核验只读验收标准和同 run 原始证据；禁止读取执行会话，禁止对外动作，只判不修。'] : []),
    `设备锁：锁已由派发器代领，开工 lock-status 核对，不要再 lock-acquire；结束必须 lock-release 并回读 free（owner=${runId}）。`,
    `任务：先读任务正文按【执行参数】执行；结束把交付 JSON 写入 result.delivery（PATCH /api/brain/tasks/${taskId}）。`,
  ];
  if (contract.message) lines.push('', `补充说明：${contract.message}`);
  return `${lines.join('\n')}\n`;
}

// ── UTF-8 消息文件 ───────────────────────────────────────────────────────
export function decodeUtf8Strict(buf) {
  return new TextDecoder('utf-8', { fatal: true }).decode(buf);
}

/** Buffer utf8 写入 + fatal TextDecoder 读回逐字节核对，不依赖进程 locale。 */
export async function writeMessageFile(path, text, io) {
  const bytes = Buffer.from(text, 'utf8');
  await io.writeFile(path, bytes);
  const back = Buffer.from(await io.readFile(path));
  const decoded = decodeUtf8Strict(back);
  if (decoded !== text || Buffer.compare(back, bytes) !== 0) throw new Error(`消息文件读回与写入不一致：${path}`);
  return path;
}

// ── 设备锁 ───────────────────────────────────────────────────────────────
export function remoteLockCommand(profile, sub, arg) {
  requireSafe(profile, 'profile');
  if (!LOCK_SUBCOMMANDS.has(sub)) throw new Error(`不支持的锁命令 ${sub}`);
  const tail = arg === undefined ? '' : ` ${requireSafe(arg, 'run_id')}`;
  return `export PATH=$HOME/.local/bin:$PATH; douyin-phone-adb --profile ${profile} ${sub}${tail}`;
}

/** 取首个 lock= 行：lock=free / lock=held owner=X / lock=acquired owner=X ... */
export function parseLockStatus(stdout) {
  const line = String(stdout || '').split('\n').find((l) => l.startsWith('lock='));
  if (!line) return { state: 'unknown', owner: null };
  const state = line.slice(5).split(/\s/)[0];
  const m = line.match(/(?:^|\s)owner=(\S+)/);
  return { state, owner: m ? m[1] : null };
}

function makeLockClient(deps, host, profile) {
  const run = async (sub, arg) => deps.runSsh(host, remoteLockCommand(profile, sub, arg));
  return {
    async status() {
      const r = await run('lock-status');
      return r.code === 0 ? parseLockStatus(r.stdout) : { state: 'unknown', owner: null, error: (r.stderr || '').trim() };
    },
    async acquire(runId) {
      const r = await run('lock-acquire', runId);
      const p = parseLockStatus(r.stdout);
      if (r.code === 0 && p.state === 'acquired' && p.owner === runId) return { ok: true };
      return { ok: false, detail: (r.stderr || r.stdout || '').trim() };
    },
    async refresh(runId) {
      const r = await run('lock-refresh', runId);
      return r.code === 0 && parseLockStatus(r.stdout).state === 'refreshed';
    },
    async release(runId) {
      const r = await run('lock-release', runId);
      const p = parseLockStatus(r.stdout);
      return r.code === 0 && p.state === 'released' && p.owner === runId;
    },
  };
}

/** 只释放 owner 恰为自己 run_id 的锁，释放后回读必须 free。 */
async function releaseOwnLock(lock, runId, log) {
  const before = await lock.status();
  if (before.owner !== runId) {
    log(`锁不属于 ${runId}（state=${before.state} owner=${before.owner}），不释放`);
    return { released: false, owner: before.owner, state: before.state };
  }
  const ok = await lock.release(runId);
  const after = await lock.status();
  const released = ok && after.state === 'free';
  log(`释放锁 ${runId}：receipt=${ok} 回读=${after.state}`);
  return { released, owner: after.owner, state: after.state };
}

// ── 宿主自检与日志扫描 ───────────────────────────────────────────────────
export function hostSelfCheck({ platform, env, exists }) {
  if (platform !== 'darwin') return { ok: false, reason: `平台 ${platform} 不是 macOS：us-vps 零执行铁律，拒绝运行` };
  if (exists('/.dockerenv') || env.container || env.KUBERNETES_SERVICE_HOST) {
    return { ok: false, reason: '检测到容器环境：派发器只能在 MMV 本机常驻，拒绝运行' };
  }
  return { ok: true };
}

export function detectOkFalse(text) {
  const s = String(text || '');
  const m = /"ok"\s*:\s*false/.exec(s);
  if (!m) return null;
  return s.slice(Math.max(0, m.index - 200), m.index + 800).trim();
}

// ── 主流程 ───────────────────────────────────────────────────────────────
const isTerminal = (status) => TERMINAL_STATUSES.has(status);

/**
 * 租约心跳：409 = Brain 已按租约回收（回队或判 lost）→ 'lease_lost'，派发器必须停手且不再回写；
 * 旧 Brain 没有心跳端点（404）或客户端不支持 → 视为无租约，照旧。网络错误不判丢（下一轮再续）。
 */
async function leaseBeat(deps, opts, taskId) {
  if (typeof deps.brain.heartbeat !== 'function' || !opts.leaseSeconds) return 'ok';
  try {
    const r = await deps.brain.heartbeat(taskId, opts.claimer, opts.leaseSeconds);
    return r?.status === 409 ? 'lease_lost' : 'ok';
  } catch {
    return 'ok';
  }
}

function makeTaskOps(deps, taskId, meta, opts = {}) {
  return {
    async heartbeat() {
      if ((await leaseBeat(deps, opts, taskId)) === 'lease_lost') return 'lease_lost';
      const t = await deps.brain.getTask(taskId);
      if (isTerminal(t?.status)) return t.status;
      await deps.brain.patch(taskId, { status: 'in_progress' });
      return 'in_progress';
    },
    /** 落 failed；任务已是终态则不覆盖。 */
    async fail(reason, extra = {}) {
      const t = await deps.brain.getTask(taskId);
      if (isTerminal(t?.status)) {
        deps.log(`任务已是终态 ${t.status}，不覆盖（原因本应是：${reason}）`);
        return { outcome: 'session_terminal', status: t.status };
      }
      await deps.brain.patch(taskId, {
        status: 'failed',
        result: { fail_reason: reason, factory_dispatcher: { ...meta, ...extra, failed_at: deps.now().toISOString() } },
      });
      deps.log(`任务 ${taskId} 落 failed：${reason}`);
      return { outcome: 'failed', reason };
    },
  };
}

async function waitForLock(deps, opts, lock, runId, ops) {
  const deadline = deps.now().getTime() + opts.lockWaitTimeoutMs;
  let lastHolder = 'unknown';
  for (;;) {
    const st = await lock.status();
    if (st.state === 'free') {
      const acq = await lock.acquire(runId);
      if (acq.ok) return { acquired: true };
      // 回执异常但锁实际已在自己名下（ssh 抖动），按已领处理
      if ((await lock.status()).owner === runId) return { acquired: true };
      lastHolder = `acquire_failed: ${acq.detail}`;
    } else {
      lastHolder = st.owner ? `owner=${st.owner} state=${st.state}` : `state=${st.state}${st.error ? ` ${st.error}` : ''}`;
    }
    if (deps.now().getTime() >= deadline) return { acquired: false, lastHolder };
    const beat = await ops.heartbeat();
    if (beat === 'lease_lost') return { acquired: false, leaseLost: true };
    if (isTerminal(beat)) return { acquired: false, terminal: true };
    await deps.sleep(opts.lockPollMs);
  }
}

async function superviseSession(deps, opts, ctx) {
  const { taskId, runId, lock, handle, logFile, ops } = ctx;
  const startedAt = deps.now().getTime();
  let lastRefresh = startedAt;
  let exitedAt = null;
  for (;;) {
    await deps.sleep(opts.sessionPollMs);
    const now = deps.now().getTime();
    if ((await leaseBeat(deps, opts, taskId)) === 'lease_lost') return { kind: 'lease_lost' };
    const task = await deps.brain.getTask(taskId);
    if (isTerminal(task?.status)) return { kind: 'terminal', status: task.status };
    if (task?.status === 'queued') {
      deps.log(`任务被打回 queued，PATCH 回 in_progress`);
      await deps.brain.patch(taskId, { status: 'in_progress' });
    }
    const okFalse = detectOkFalse(await deps.readLog(logFile));
    if (okFalse) return { kind: 'abort', reason: `agent_ok_false: ${okFalse}` };
    if (handle.isExited()) {
      exitedAt ??= now;
      if (now - exitedAt >= opts.exitGraceMs) {
        return { kind: 'abort', reason: `session_exited_without_terminal exit_code=${handle.exitCode()} grace_ms=${opts.exitGraceMs}` };
      }
    }
    if (now - startedAt >= opts.sessionTimeoutMs) return { kind: 'abort', reason: `session_timeout after ${opts.sessionTimeoutMs}ms` };
    if (now - lastRefresh >= opts.lockRefreshMs) {
      lastRefresh = now;
      const st = await lock.status();
      if (st.owner === runId) await lock.refresh(runId);
      else deps.log(`锁已不在 ${runId} 名下（state=${st.state} owner=${st.owner}），不续期`);
    }
  }
}

/** 派发单个任务：claim → in_progress → 等锁代领 → 写消息 → 启动会话 → 守望 → 收尾放锁。 */
export async function dispatchTask(task, deps, userOpts = {}) {
  const opts = { ...DEFAULT_OPTS, ...userOpts };
  task = await refreshEligibleTask(task, deps.brain, opts.dispatchMode);
  if (!task) return { outcome: 'mode_rejected' };
  const taskId = task.id;
  const claim = await deps.brain.claim(taskId, opts.claimer, opts.leaseSeconds);
  if (claim.status === 409) {
    deps.log(`任务 ${taskId} 已被他人 claim，跳过`);
    return { outcome: 'claim_conflict' };
  }
  if (claim.status < 200 || claim.status >= 300) return { outcome: 'claim_error', status: claim.status };
  await deps.brain.patch(taskId, { status: 'in_progress' });

  const parsed = parseFactoryContract(task);
  if (!parsed.ok) return makeTaskOps(deps, taskId, {}).fail(`invalid_contract: ${parsed.error}`);
  const { contract } = parsed;
  const runId = buildRunId({ runPrefix: contract.run_prefix, taskId, date: deps.now(), round: contract.round });
  const sessionId = buildSessionId(contract.stage, taskId);
  const meta = { run_id: runId, session_id: sessionId, ssh_host: contract.device.ssh_host, profile: contract.device.profile };
  const ops = makeTaskOps(deps, taskId, meta, opts);
  const lock = makeLockClient(deps, contract.device.ssh_host, contract.device.profile);

  const waited = await waitForLock(deps, opts, lock, runId, ops);
  if (waited.leaseLost) {
    deps.log(`任务 ${taskId} 租约已被 Brain 回收（lease_lost），停止等锁，不回写`);
    return { outcome: 'lease_lost' };
  }
  if (waited.terminal) return { outcome: 'session_terminal' };
  if (!waited.acquired) {
    // 等超时：不释放任何锁（锁不是自己的）
    return ops.fail(`lock_wait_timeout after ${opts.lockWaitTimeoutMs}ms; last ${waited.lastHolder}`);
  }
  deps.log(`已代领设备锁 ${runId}`);

  const abort = async (reason, handle) => {
    if (handle) await handle.kill();
    const release = await releaseOwnLock(lock, runId, deps.log);
    return ops.fail(reason, { lock_released: release.released });
  };

  const runDir = join(opts.stateDir, 'runs');
  const messageFile = join(runDir, `${runId}.msg.txt`);
  const logFile = join(runDir, `${runId}.agent.log`);
  let handle;
  try {
    await deps.mkdir(runDir, { recursive: true });
    await writeMessageFile(messageFile, buildAgentMessage({ runId, taskId, contract }), deps);
    handle = await deps.spawnAgent({
      command: opts.openclawBin,
      args: ['agent', '--agent', AGENT_ID, '--session-id', sessionId, '--thinking', 'high', '--timeout', '3000', '--json', '--message-file', messageFile],
      env: { ...(opts.baseEnv || {}), ...UTF8_ENV },
      messageFile,
      logFile,
    });
  } catch (err) {
    return abort(`launch_failed: ${err.message}`, handle);
  }
  deps.log(`会话 ${sessionId} 已启动（run_id=${runId}）`);

  const end = await superviseSession(deps, opts, { taskId, runId, lock, handle, logFile, ops });
  if (end.kind === 'lease_lost') {
    // Brain 已按租约语义处置任务（回队或判 lost）：杀会话、放自己的锁，不再回写任务
    deps.log(`任务 ${taskId} 租约已被 Brain 回收（lease_lost），停手：杀会话、放锁、不回写`);
    await handle.kill();
    const release = await releaseOwnLock(lock, runId, deps.log);
    return { outcome: 'lease_lost', lock_released: release.released };
  }
  if (end.kind === 'abort') return abort(end.reason, handle);
  const release = await releaseOwnLock(lock, runId, deps.log);
  return { outcome: 'session_terminal', status: end.status, lock_released: release.released };
}

/** 一轮：时段外不认领；时段内挑第一个 queued 的技能工厂单派发。 */
export async function pollOnce(deps, userOpts = {}) {
  const opts = { ...DEFAULT_OPTS, ...userOpts };
  if (!isWithinWorkHours(deps.now(), opts)) return { skipped: 'off_hours' };
  const queued = await deps.brain.listQueued();
  const task = (queued || []).find((t) => t?.status === 'queued' && isFactoryTask(t, opts.dispatchMode));
  if (!task) return { skipped: 'no_task' };
  return dispatchTask(task, deps, opts);
}

// ── 真实依赖 ─────────────────────────────────────────────────────────────
/** claim 用的 executor_kind：必须在 tasks_executor_kind_check 允许值里（派给 OpenClaw skill-factory agent 执行 = openclaw-agent）。 */
export const CLAIM_EXECUTOR_KIND = 'openclaw-agent';

export function makeBrainClient(baseUrl) {
  const call = async (method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json, text };
  };
  const must = (r, what) => {
    if (r.status < 200 || r.status >= 300) throw new Error(`${what} HTTP ${r.status}: ${r.text.slice(0, 300)}`);
    return r.json;
  };
  return {
    listQueued: async () => must(await call('GET', '/api/brain/tasks?status=queued&limit=500'), 'list queued'),
    getTask: async (id) => must(await call('GET', `/api/brain/tasks/${id}`), 'get task'),
    claim: async (id, claimer, leaseSeconds) => call('POST', `/api/brain/tasks/${id}/claim`, {
      claimer, executor_kind: CLAIM_EXECUTOR_KIND, ...(leaseSeconds ? { lease_seconds: leaseSeconds } : {}),
    }),
    heartbeat: async (id, claimer, leaseSeconds) => call('POST', `/api/brain/tasks/${id}/heartbeat`, { claimer, lease_seconds: leaseSeconds }),
    patch: async (id, body) => must(await call('PATCH', `/api/brain/tasks/${id}`, body), 'patch task'),
  };
}

function runSsh(host, remoteCmd) {
  return new Promise((resolve) => {
    execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host, remoteCmd],
      { timeout: 90_000, encoding: 'utf8', env: { ...process.env, ...UTF8_ENV } },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 255) : 0, stdout, stderr }));
  });
}

async function spawnAgent({ command, args, env, logFile }) {
  const fd = openSync(logFile, 'a');
  const child = spawn(command, args, { env: { ...process.env, ...env }, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  let exited = false;
  let code = null;
  child.on('exit', (c, sig) => { exited = true; code = c ?? sig; });
  child.on('error', (e) => { exited = true; code = `spawn_error:${e.message}`; });
  const signalGroup = (sig) => { try { process.kill(-child.pid, sig); } catch { /* 已退出 */ } };
  return {
    isExited: () => exited,
    exitCode: () => code,
    kill: async () => {
      if (exited) return;
      signalGroup('SIGTERM');
      for (let i = 0; i < 20 && !exited; i += 1) await new Promise((r) => setTimeout(r, 500));
      if (!exited) signalGroup('SIGKILL');
    },
  };
}

export async function main() {
  const log = (msg) => console.log(`[${new Date().toISOString()}] [factory-dispatcher] ${msg}`);
  const check = hostSelfCheck({ platform: process.platform, env: process.env, exists: existsSync });
  if (!check.ok) {
    log(`宿主自检失败：${check.reason}`);
    process.exit(78);
  }
  const opts = {
    ...DEFAULT_OPTS,
    dispatchMode: readDispatchMode(process.env.FACTORY_DISPATCHER_MODE),
    stateDir: process.env.FACTORY_DISPATCHER_STATE_DIR || DEFAULT_OPTS.stateDir,
    openclawBin: process.env.OPENCLAW_BIN || DEFAULT_OPTS.openclawBin,
    lockWaitTimeoutMs: envMinutes('FACTORY_LOCK_WAIT_MIN', DEFAULT_OPTS.lockWaitTimeoutMs),
    sessionTimeoutMs: envMinutes('FACTORY_SESSION_TIMEOUT_MIN', DEFAULT_OPTS.sessionTimeoutMs),
  };
  const deps = {
    now: () => new Date(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log,
    brain: makeBrainClient(process.env.BRAIN_URL || 'http://localhost:5221'),
    runSsh,
    spawnAgent,
    readLog: (p) => fsp.readFile(p, 'utf8').catch(() => ''),
    writeFile: fsp.writeFile,
    readFile: fsp.readFile,
    mkdir: fsp.mkdir,
  };
  log(`启动：mode=${opts.dispatchMode} state=${opts.stateDir} brain=${process.env.BRAIN_URL || 'http://localhost:5221'}`);
  for (;;) {
    try {
      const r = await pollOnce(deps, opts);
      if (!r.skipped) log(`本轮结果：${JSON.stringify(r)}`);
    } catch (err) {
      log(`本轮异常：${err.stack || err.message}`);
    }
    await deps.sleep(opts.idlePollMs);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
