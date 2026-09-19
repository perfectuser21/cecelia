/**
 * ops-model-accounts-collector.js — 模型账号配额+机器可达性采集器（工厂·F5 指挥舱 刀2）
 *
 * 只做可观测数据，不做派单决策。8 个静态模型账号（Claude Code x2 + Codex team x5 + Grok）
 * 的实时配额快照落 ops_model_accounts 表，端点只读投影。
 *
 * 铁律（INV-1 [不刷 refresh_token]）：Grok key 过期只标 key_expired，本采集器任何路径
 * 绝不调用/刷新 refresh_token（脚本刷新 = 整条链被撤销，只能人工 grok login --device-auth）。
 * ——本文件除本注释外不出现 refresh_token 字样，测试注入的 refreshToken 探针调用计数恒为 0。
 *
 * 采集侧沿用刀1 host-exec ssh 逃逸到 mmv 读凭据 + 调三家 usage API；真凭据在 mmv、
 * 不进 CI，故 runModelAccountsCollector 暴露 fetchUsage/grokProbe 注入接缝，[integration]
 * 测试注入成功 fixture 走真 PG 写路径，缺省则走真实 host-exec（生产）。
 */
import { existsSync, readFileSync } from 'fs';
import { defaultExec, buildHostCmd } from './host-exec.js';

/** status 四态枚举（唯一一份，route builder 同源 import，禁手抄副本）。 */
export const MODEL_ACCOUNT_STATUS = Object.freeze(['ok', 'unknown', 'key_expired', 'no_credential']);

/**
 * 8 个静态模型账号注册表（端点「恰好 8 条」的 ground truth）。
 * 凭据全在 mmv；forwardable/forward_targets 为静态配置：
 *   Codex 可经车道2 转发到 xian-m4/xian-m1；Claude Code / Grok 锁本机。
 */
export const MODEL_ACCOUNTS = Object.freeze([
  { account_id: 'claude-account1', provider: 'claude', plan: 'max', host_alias: 'mmv',
    forwardable: false, forward_targets: [], credential_path: '~/.claude-account1/.credentials.json' },
  { account_id: 'claude-account2', provider: 'claude', plan: 'max', host_alias: 'mmv',
    forwardable: false, forward_targets: [], credential_path: '~/.claude-account2/.credentials.json' },
  { account_id: 'codex-team1', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team1/auth.json' },
  { account_id: 'codex-team2', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team2/auth.json' },
  { account_id: 'codex-team3', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team3/auth.json' },
  { account_id: 'codex-team4', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team4/auth.json' },
  { account_id: 'codex-team5', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team5/auth.json' },
  { account_id: 'grok', provider: 'grok', plan: null, host_alias: 'mmv',
    forwardable: false, forward_targets: [], credential_path: '~/.grok/auth.json' },
]);

const EMPTY_SNAPSHOT = { five_hour_pct: null, seven_day_pct: null, reset_at: null };

/** pct 归一化：数字透传，缺失/非数字 → null（诚实留空，禁编造 0）。 */
function toPct(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Anthropic OAuth usage JSON → 同一 schema。
 * 形如 { five_hour: { utilization, resets_at }, seven_day: { utilization } }。
 * 结构缺失不抛，缺字段返回 null（INV-5）。
 */
export function parseAnthropicUsage(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    five_hour_pct: toPct(r.five_hour?.utilization),
    seven_day_pct: toPct(r.seven_day?.utilization),
    reset_at: r.five_hour?.resets_at ?? null,
  };
}

/**
 * ChatGPT wham usage JSON → 同一 schema（字段名不同：usage_percent / reset_time）。
 * 结构缺失不抛，缺字段返回 null。
 */
export function parseChatgptWhamUsage(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    five_hour_pct: toPct(r.five_hour?.usage_percent),
    seven_day_pct: toPct(r.seven_day?.usage_percent),
    reset_at: r.five_hour?.reset_time ?? null,
  };
}

/**
 * Grok gRPC-web 帧（已解出的对象）→ 同一 schema。
 * 结构缺失不抛，缺字段返回 null。
 */
export function parseGrokUsage(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    five_hour_pct: toPct(r.five_hour_pct),
    seven_day_pct: toPct(r.seven_day_pct),
    reset_at: r.reset_at ?? null,
  };
}

/**
 * Grok 采集错误分类（判定点拍板：grpc-status 7 PERMISSION_DENIED = key 过期，与瞬时错区分）。
 * 过期 → key_expired（人工续 key）；其余（超时/连接错）→ unknown（下轮自动重试）。
 */
export function classifyGrokUsageError(err) {
  const msg = String(err?.message || '');
  if (err?.grpcStatus === 7) return 'key_expired';
  if (/grpc-status[:\s]*7\b/i.test(msg) || /\bPERMISSION_DENIED\b/i.test(msg)) return 'key_expired';
  return 'unknown';
}

/** provider → parser 分派。 */
function parseUsageByProvider(provider, raw) {
  if (/grok/i.test(provider)) return parseGrokUsage(raw);
  if (/codex/i.test(provider)) return parseChatgptWhamUsage(raw);
  return parseAnthropicUsage(raw);
}

/** 非 Grok 采集错误分类：凭据文件缺失/损坏 → no_credential，其余 → unknown。 */
function classifyUsageError(err) {
  const msg = String(err?.message || '');
  if (/no_credential|No such file|not found|ENOENT|auth\.json|credentials\.json/i.test(msg)) return 'no_credential';
  return 'unknown';
}

/** only 过滤：按 provider 名或 account_id 命中（如 'grok'）。 */
function matchesOnly(acct, only) {
  if (!only) return true;
  const needle = String(only).toLowerCase();
  return String(acct.provider).toLowerCase() === needle
    || String(acct.account_id).toLowerCase() === needle
    || new RegExp(needle, 'i').test(acct.provider);
}

/** 探针脚本本体（自包含 ESM），base64 后经 ssh 投递到 mmv 用 node 从 stdin 执行——凭据不离开宿主。 */
const PROBE_SOURCE_B64 = Buffer.from(
  readFileSync(new URL('./model-accounts-usage-probe.js', import.meta.url), 'utf8'),
  'utf8',
).toString('base64');
/** mmv 非交互 ssh 的 PATH 不含 homebrew，node 用绝对路径（可 env 覆盖）。 */
const PROBE_NODE_BIN = process.env.MODEL_ACCOUNTS_PROBE_NODE || '/opt/homebrew/bin/node';
const PROBE_TIMEOUT_MS = 30_000;

/** 组装远端探针命令（导出供单测断言：脚本走 stdin、带 --run provider path、不含凭据内容）。 */
export function buildProbeCmd(acct, nodeBin = PROBE_NODE_BIN) {
  // `--` 之后才是脚本参数；标记不能叫 --run（node 自身 CLI 选项，会被 node 吞掉）。
  return `echo ${PROBE_SOURCE_B64} | base64 -d | ${nodeBin} --input-type=module - -- --probe-run ${acct.provider} ${acct.credential_path}`;
}

/**
 * 缺省真实采集：host-exec ssh 逃逸到 mmv 跑 model-accounts-usage-probe.js，
 * 探针在宿主读凭据、调三家 usage API，只回传归一后的 usage JSON。
 * 真凭据不进 CI（见合同「未覆盖真实链路清单」）——注入 fetchUsage/grokProbe 后本函数不被触及。
 * 探针非零退出时 exec 抛错，错误文本（stderr）交给上层分类：no_credential / grpc-status 7 → key_expired / 其余 unknown。
 */
function defaultFetchUsage(acct, exec = defaultExec, keyExistsFn, inContainer = existsSync('/.dockerenv')) {
  let raw;
  try {
    raw = exec(buildHostCmd(buildProbeCmd(acct), inContainer, keyExistsFn), { timeoutMs: PROBE_TIMEOUT_MS });
  } catch (err) {
    // execSync 的 message 会带整条命令（含凭据路径与脚本 base64）——既不能进 last_error，
    // 也会让 classifyUsageError 的 auth.json/credentials.json 正则把任何失败误判成 no_credential。
    // 只保留探针 stderr 的一行结论（no_credential: … / grpc-status: 7 … / HTTP 429 …）。
    const stderr = String(err?.stderr || '').trim();
    const e = new Error(stderr || `probe exec failed (status=${err?.status ?? 'n/a'})`);
    throw e;
  }
  if (!raw || !String(raw).trim()) {
    throw new Error('probe returned empty output');
  }
  return JSON.parse(String(raw));
}

/** last_error 写库前截断 ≤500（INV-6，沿用刀1 heartbeat slice）。 */
function truncErr(e) {
  return e == null ? null : String(e).slice(0, 500);
}

/**
 * 幂等 upsert 单条账号快照（INV-4：INSERT ... ON CONFLICT (account_id) DO UPDATE，非 SELECT-then-INSERT）。
 * forward_targets 以 jsonb 落库；last_checked_at/updated_at 用 DB 时钟。
 */
async function upsertModelAccount(pool, acct, snapshot, status, lastError) {
  await pool.query(
    `INSERT INTO ops_model_accounts
       (account_id, provider, plan, five_hour_pct, seven_day_pct, reset_at,
        host_alias, forwardable, forward_targets, status, last_error, last_checked_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,NOW(),NOW())
     ON CONFLICT (account_id) DO UPDATE SET
       provider=EXCLUDED.provider, plan=EXCLUDED.plan,
       five_hour_pct=EXCLUDED.five_hour_pct, seven_day_pct=EXCLUDED.seven_day_pct,
       reset_at=EXCLUDED.reset_at, host_alias=EXCLUDED.host_alias,
       forwardable=EXCLUDED.forwardable, forward_targets=EXCLUDED.forward_targets,
       status=EXCLUDED.status, last_error=EXCLUDED.last_error,
       last_checked_at=NOW(), updated_at=NOW()`,
    [
      acct.account_id, acct.provider, acct.plan ?? null,
      snapshot.five_hour_pct, snapshot.seven_day_pct, snapshot.reset_at,
      acct.host_alias, acct.forwardable, JSON.stringify(acct.forward_targets || []),
      status, truncErr(lastError),
    ],
  );
}

/**
 * 采集器：遍历 8 个静态账号，取 usage → 映射 status/pct → 幂等 upsert 落 ops_model_accounts。
 * 单账号失败只标该条（unknown/key_expired/no_credential + last_error），不阻塞整体。
 *
 * @param {import('pg').Pool} pool 真实连接池（写路径禁 mock）
 * @param {object} opts 注入接缝（缺省走真实 host-exec/网络）：
 *   - fetchUsage(account) => Promise<rawUsage> 通用 per-account usage 采集接缝
 *   - grokProbe() => rawGrokUsage grok 专用接缝（抛错模拟过期，err.grpcStatus===7 → key_expired），优先于 fetchUsage
 *   - only 限定采集子集（如 'grok'）
 *   注意：本采集器任何路径绝不触碰 refresh 类接缝（INV-1）。
 */
export async function runModelAccountsCollector(pool, opts = {}) {
  const { fetchUsage, grokProbe, only, exec, keyExistsFn, inContainer } = opts;
  const targets = MODEL_ACCOUNTS.filter((a) => matchesOnly(a, only));
  const results = [];

  for (const acct of targets) {
    let status = 'ok';
    let snapshot = { ...EMPTY_SNAPSHOT };
    let lastError = null;
    const isGrok = /grok/i.test(acct.provider);

    try {
      let raw;
      if (isGrok && typeof grokProbe === 'function') {
        raw = await grokProbe(acct);
      } else if (typeof fetchUsage === 'function') {
        raw = await fetchUsage(acct);
      } else {
        raw = defaultFetchUsage(acct, exec, keyExistsFn, inContainer);
      }
      snapshot = parseUsageByProvider(acct.provider, raw);
    } catch (err) {
      status = isGrok ? classifyGrokUsageError(err) : classifyUsageError(err);
      lastError = truncErr(err?.message || err);
    }

    await upsertModelAccount(pool, acct, snapshot, status, lastError);
    results.push({ account_id: acct.account_id, status });
  }

  return { collected: results.length, results };
}
