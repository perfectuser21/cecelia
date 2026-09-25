/**
 * skill-dist-drift.js — skill 分发漂移检测（链 bf5088a3 棒8，任务 1141f101）
 *
 * 真身（MMV ~/.claude/skills）与各跑场机（xian-m4 / xian-m1）的 skill 清单哈希每 30min 比对一次，
 * 结果写 working_memory[skill_manifest_drift]，晨报/日报读它出 🟡 AMBER（见 lib/skill-dist-report.js）。
 *
 * 纪律：
 *  - us-vps 零执行：Brain 不在本机算哈希，只把 skill-manifest.sh（base64）经 ssh 送到目标机执行，读回一行 JSON。
 *  - 只读：目标机上只跑 find/sha256，不写任何文件。
 *  - 探不到 ≠ 零个 skill：ssh 失败/超时 → unreachable，输出垃圾/被截断 → invalid，都是「未核对」，
 *    不产生 missing、不计入漂移（防「探不到=零个=全漂移」的假警）；只有 ssh 通了且目录真不存在才是 dir_missing。
 *  - 每条 exec 显式 timeout（EXEC_TIMEOUT_MS）+ maxBuffer（defaultExecAsync 内置），各机并行，总耗时 ≈ 单机超时。
 *  - 跑场机经 mmv 跳板（us-vps 只保证有 mmv 别名；跑场机别名以 MMV 的 ~/.ssh/config 为准，代码里不写 IP/用户名）。
 */
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { defaultExecAsync, buildHostCmd } from './host-exec.js';
import { parseManifestOutput, compareManifests } from './lib/skill-manifest.js';
import { SKILL_DIST_KEY } from './lib/skill-dist-report.js';

export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const EXEC_TIMEOUT_MS = 45_000;
export const TRUTH_ALIAS = 'mmv';
export const DEFAULT_RUNNERS = Object.freeze(['xian-m4', 'xian-m1']);
/** 每台跑场机检两处，都应等于真身（旧 cron 的两跳：~/.claude/skills → ~/.codex-gwremote/skills）。 */
export const DIRS = Object.freeze([
  { label: 'claude', token: '@home/.claude/skills' },
  { label: 'codex-gwremote', token: '@home/.codex-gwremote/skills' },
]);
const TRUTH_TOKEN = '@home/.claude/skills';
const LIST_CAP = 30;
const QUERY_TIMEOUT_MS = 10_000;
const SSH = 'ssh -o BatchMode=yes -o ConnectTimeout=10';
const ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TOKEN_RE = /^@home\/[A-Za-z0-9._/-]+$/;
const SCRIPT_PATH = fileURLToPath(new URL('./lib/skill-manifest.sh', import.meta.url));

/** SKILL_DRIFT_RUNNERS（逗号/空格分隔）→ 别名列表；非法别名直接抛错（别名会拼进 shell 命令）。 */
export function resolveRunners(envValue = process.env.SKILL_DRIFT_RUNNERS) {
  const list = String(envValue ?? '').split(/[\s,]+/).filter(Boolean);
  if (!list.length) return [...DEFAULT_RUNNERS];
  for (const a of list) {
    if (!ALIAS_RE.test(a)) throw new Error(`SKILL_DRIFT_RUNNERS 含非法别名: ${JSON.stringify(a)}`);
  }
  return list;
}

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/**
 * 构造「在目标机执行清单脚本」的命令。脚本文本 base64 后经 echo 送达，命令行里没有单引号，
 * 多层 ssh 引号不会破裂。hostAlias=null 表示真身（直连 mmv），否则经 mmv 跳板到该别名。
 */
export function buildManifestCmd({ hostAlias = null, dirToken, scriptText, inContainer, keyExistsFn }) {
  if (!TOKEN_RE.test(dirToken)) throw new Error(`非法目录 token: ${dirToken}`);
  if (hostAlias !== null && !ALIAS_RE.test(hostAlias)) throw new Error(`非法别名: ${hostAlias}`);
  const b64 = Buffer.from(scriptText, 'utf8').toString('base64');
  const remote = `echo ${b64} | (base64 -d 2>/dev/null || base64 -D) | bash -s -- ${dirToken}`;
  const cmd = hostAlias === null
    ? `${SSH} ${TRUTH_ALIAS} ${shQuote(remote)}`
    : `${SSH} ${TRUTH_ALIAS} ${shQuote(`${SSH} ${hostAlias} ${shQuote(remote)}`)}`;
  return buildHostCmd(cmd, inContainer, keyExistsFn);
}

function briefError(err) {
  const raw = String(err?.stderr || err?.message || err);
  const line = raw.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('Command failed')) || 'exec failed';
  const prefix = err?.killed || err?.signal || err?.code === 'ETIMEDOUT' ? 'timeout: ' : '';
  return `${prefix}${line}`.slice(0, 160);
}

/** 取一份清单。永不抛错：{status:'ok',manifest} | {status:'dir_missing'} | {status:'unreachable'|'invalid',error} */
async function fetchManifest(exec, params) {
  let raw;
  try {
    raw = await exec(buildManifestCmd(params), { timeoutMs: EXEC_TIMEOUT_MS });
  } catch (err) {
    // 目录不存在时脚本退出码 3 → exec 抛错，但 stdout 里有 dir_missing：ssh 是通的，属真实状态
    const parsed = err?.stdout ? parseManifestOutput(err.stdout) : null;
    if (parsed && !parsed.ok && parsed.reason === 'dir_missing') return { status: 'dir_missing' };
    return { status: 'unreachable', error: briefError(err) };
  }
  const parsed = parseManifestOutput(raw);
  if (parsed.ok) return { status: 'ok', manifest: parsed.manifest };
  if (parsed.reason === 'dir_missing') return { status: 'dir_missing' };
  return { status: 'invalid', error: String(parsed.detail || 'invalid').slice(0, 160) };
}

const cap = (list) => list.slice(0, LIST_CAP);

function summarizeDir(label, fetched, truth) {
  if (fetched.status === 'ok') {
    const c = compareManifests(truth, fetched.manifest);
    const base = { label, status: c.in_sync ? 'ok' : 'drift', count: fetched.manifest.count, tree_hash: fetched.manifest.tree_hash };
    if (c.in_sync) return base;
    return {
      ...base,
      missing: cap(c.missing), missing_total: c.missing.length,
      extra: cap(c.extra), extra_total: c.extra.length,
      changed: cap(c.changed), changed_total: c.changed.length,
      broken: cap(c.broken), broken_total: c.broken.length,
    };
  }
  return { label, status: fetched.status, ...(fetched.error ? { error: fetched.error } : {}) };
}

async function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timeout ${ms}ms`)), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

async function readPrevious(pool) {
  const res = await withTimeout(pool.query('SELECT value_json FROM working_memory WHERE key = $1', [SKILL_DIST_KEY]), QUERY_TIMEOUT_MS, 'read state');
  let v = res?.rows?.[0]?.value_json;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return v && typeof v === 'object' ? v : null;
}

async function writeState(pool, state) {
  await withTimeout(pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [SKILL_DIST_KEY, JSON.stringify(state)],
  ), QUERY_TIMEOUT_MS, 'write state');
}

/**
 * scheduler-jobs handler（needsPool:true）。自 gate 30min；调度轮 60s 都会调用，故哨兵活性尺子 = 60s。
 * @param {import('pg').Pool} pool
 * @param {object} [opts] 供测试注入：exec / now / force / inContainer / keyExistsFn / runners / scriptText / dirs
 */
export async function runSkillDistDrift(pool, opts = {}) {
  const {
    exec = defaultExecAsync,
    now = Date.now(),
    force = false,
    inContainer = existsSync('/.dockerenv'),
    keyExistsFn,
    dirs = DIRS,
  } = opts;

  if (!force) {
    const prev = await readPrevious(pool);
    const last = Date.parse(prev?.checked_at);
    if (Number.isFinite(last) && now - last < CHECK_INTERVAL_MS) return { skipped: true, reason: 'interval_gate' };
  }

  const runners = opts.runners ?? resolveRunners();
  const scriptText = opts.scriptText ?? readFileSync(SCRIPT_PATH, 'utf8');
  const common = { scriptText, inContainer, keyExistsFn };

  // 全部并行；fetchManifest 永不抛错
  const truthP = fetchManifest(exec, { ...common, hostAlias: null, dirToken: TRUTH_TOKEN });
  const runnerPs = runners.map((id) => Promise.all(
    dirs.map((d) => fetchManifest(exec, { ...common, hostAlias: id, dirToken: d.token })),
  ));
  const [truthRes, ...runnerRes] = await Promise.all([truthP, ...runnerPs]);

  const truthOk = truthRes.status === 'ok';
  const truth = truthOk
    ? {
        status: 'ok', count: truthRes.manifest.count, tree_hash: truthRes.manifest.tree_hash,
        broken: cap(truthRes.manifest.broken), broken_total: truthRes.manifest.broken.length,
      }
    : { status: truthRes.status, ...(truthRes.error ? { error: truthRes.error } : {}) };

  const machines = runners.map((id, i) => ({
    id,
    dirs: dirs.map((d, j) => (truthOk
      ? summarizeDir(d.label, runnerRes[i][j], truthRes.manifest)
      : { label: d.label, status: 'unchecked' })),
  }));

  const has = (m, pred) => m.dirs.some((d) => pred(d.status));
  const summary = {
    drifted: machines.filter((m) => has(m, (s) => s === 'drift' || s === 'dir_missing')).map((m) => m.id),
    unverified: machines.filter((m) => has(m, (s) => s === 'unreachable' || s === 'invalid')).map((m) => m.id),
    ok: machines.filter((m) => m.dirs.every((d) => d.status === 'ok')).map((m) => m.id),
  };

  const state = { checked_at: new Date(now).toISOString(), truth, machines, summary };
  await writeState(pool, state);

  if (summary.drifted.length || summary.unverified.length || !truthOk) {
    console.warn(`[skill-dist-drift] 漂移=${summary.drifted.join(',') || '-'} 未核对=${summary.unverified.join(',') || '-'} 真身=${truth.status}`);
  }
  return { checked: true, truth: truth.status, drifted: summary.drifted, unverified: summary.unverified };
}
