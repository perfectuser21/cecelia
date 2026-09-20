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
import { defaultExecAsync, buildHostCmd } from './host-exec.js';

/**
 * status 五态枚举（唯一一份，route builder 同源 import，禁手抄副本）。
 *
 * `rate_limited` 是 0920 新增（任务 424d9dd2）：此前 429 被归进 `unknown`，
 * 与「真没查到」混为一谈，于是读侧既看不出该退避、也看不出账号其实健康。
 * usage 接口的 429 ≠ 配额耗尽 —— account-usage.js:585-613 已为这条踩过一次坑
 * （B49 把健康账号判死导致 pipeline 卡死）。
 */
export const MODEL_ACCOUNT_STATUS = Object.freeze(['ok', 'unknown', 'rate_limited', 'key_expired', 'no_credential']);

/**
 * 自 gate 周期。scheduler 的调度模型是「统一 60s 轮询 + 模块自 gate」
 * （scheduler-jobs.js:5-9）——幂等由模块自己负责，别的 job 都自带窗口。
 * 本采集器此前是裸调用，等于每分钟全量打 8 个账号的厂商 usage API
 * （≈480 次/小时），两个 Claude 号因此恒 429 —— 那个 429 是我们自己造的。
 */
export const COLLECT_INTERVAL_MS = 5 * 60 * 1000;

/** 单轮全部账号探测的总预算：超了就把剩下的留到下一轮（保留上轮数据），不让一轮无限延长。 */
export const COLLECT_BUDGET_MS = 60_000;

/** 可重试错误的轮内重试次数与退避（主理人 0920：一次查不到可能只是网络抖动）。 */
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

/** 连续失败多少轮才算「真的有问题」（3 × 5min = 15min）。 */
const FAILURE_STREAK_THRESHOLD = 3;

/**
 * 8 个静态模型账号注册表（端点「恰好 8 条」的 ground truth）。
 * 凭据全在 mmv；forwardable/forward_targets 为静态配置：
 *   Codex 可经车道2 转发到 xian-m4/xian-m1；Claude Code / Grok 锁本机。
 */
export const MODEL_ACCOUNTS = Object.freeze([
  { account_id: 'claude-account1', provider: 'claude', plan: 'max', host_alias: 'mmv',
    forwardable: false, forward_targets: [], credential_path: '~/.claude-account1/.credentials.json',
    runtime_account_id: 'account1' },
  { account_id: 'claude-account2', provider: 'claude', plan: 'max', host_alias: 'mmv',
    forwardable: false, forward_targets: [], credential_path: '~/.claude-account2/.credentials.json',
    runtime_account_id: 'account2' },
  { account_id: 'codex-team1', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team1/auth.json',
    runtime_account_id: 'team1' },
  { account_id: 'codex-team2', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team2/auth.json',
    runtime_account_id: 'team2' },
  { account_id: 'codex-team3', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team3/auth.json',
    runtime_account_id: 'team3' },
  { account_id: 'codex-team4', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team4/auth.json',
    runtime_account_id: 'team4' },
  { account_id: 'codex-team5', provider: 'codex', plan: 'team', host_alias: 'mmv',
    forwardable: true, forward_targets: ['xian-m4', 'xian-m1'], credential_path: '~/.codex-team5/auth.json',
    runtime_account_id: 'team5' },
  { account_id: 'grok', provider: 'grok', plan: null, host_alias: 'mmv',
    forwardable: false, forward_targets: [], credential_path: '~/.grok/auth.json',
    runtime_account_id: 'grok' },
]);

/**
 * 账号 id 双向映射（唯一来源，禁各处手写正则/拼串）。
 * 表侧 `claude-account1` / `codex-team1` / `grok`；运行时侧 `account1` / `team1` / `grok`。
 * `${provider}-${runtime}` 对 grok 得到 'grok-grok' —— 拼串规则必然要写特例，所以用显式字段。
 */
const RUNTIME_TO_LEDGER = Object.freeze(
  Object.fromEntries(MODEL_ACCOUNTS.map((a) => [a.runtime_account_id, a.account_id])),
);
const LEDGER_TO_RUNTIME = Object.freeze(
  Object.fromEntries(MODEL_ACCOUNTS.map((a) => [a.account_id, a.runtime_account_id])),
);

/** 运行时账号 id（候选池用）→ 账本 account_id。未知返回 null。 */
export function runtimeToLedgerAccountId(runtimeId) {
  if (!runtimeId) return null;
  return RUNTIME_TO_LEDGER[runtimeId] ?? null;
}

/** 账本 account_id → 运行时账号 id。未知返回 null。 */
export function ledgerToRuntimeAccountId(ledgerId) {
  if (!ledgerId) return null;
  return LEDGER_TO_RUNTIME[ledgerId] ?? null;
}

const EMPTY_SNAPSHOT = { five_hour_pct: null, seven_day_pct: null, reset_at: null };

/**
 * pct 归一化：数字四舍五入成整数，缺失/非数字 → null（诚实留空，禁编造 0）。
 *
 * 必须取整：列是 INTEGER（migration 449:9-10），而 node-pg 的参数绑定**不取整**
 * ——实测传 89.6 直接抛 `invalid input syntax for type integer: "89.6"`。
 * 而 upsert 的调用在 try 之外，一抛就中断整轮采集，排在后面的账号
 * 这一轮全部不写（静默陈旧）。取整是让「配额账本可信」的前提。
 */
function toPct(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/** 测试接缝：判据的阈值语义依赖「表里只有整数」这条不变量。 */
export const toPctForTest = toPct;

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

/**
 * 非 Grok 采集错误分类：限流 → rate_limited，凭据文件缺失/损坏 → no_credential，其余 → unknown。
 *
 * rate_limited 必须先判：429 的报文里常同时出现 usage 端点路径，会被下面那条
 * credentials.json 正则误吞成 no_credential（把限流说成"没凭据"）。
 */
function classifyUsageError(err) {
  const msg = String(err?.message || '');
  if (/\b429\b|rate[_\s-]?limit|too many requests/i.test(msg)) return 'rate_limited';
  if (/no_credential|No such file|not found|ENOENT|auth\.json|credentials\.json/i.test(msg)) return 'no_credential';
  return 'unknown';
}

/**
 * 这个失败值不值得立刻再试一次（主理人 0920 拍板的三档）。
 *
 * - `unknown`（ssh 不通 / 超时 / 网络 / 解析失败）→ 重试。典型瞬时故障。
 * - `rate_limited` → **不重试**。重试只会加剧限流，与「采集器自造 429」同源。
 * - `key_expired` / `no_credential` → 不重试。确定性否定事实，再试一百次也一样。
 */
function isRetryableStatus(status) {
  return status === 'unknown';
}

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

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
async function defaultFetchUsage(acct, exec = defaultExecAsync, keyExistsFn, inContainer = existsSync('/.dockerenv')) {
  let raw;
  try {
    raw = await exec(buildHostCmd(buildProbeCmd(acct), inContainer, keyExistsFn), { timeoutMs: PROBE_TIMEOUT_MS });
  } catch (err) {
    // exec 的 message 会带整条命令（含凭据路径与脚本 base64）——既不能进 last_error，
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
 * 采集失败时的写库：只更新 status/last_error/计数/时间戳，**绝不触碰 pct 列**。
 *
 * 为什么（2026-09-20 实证，任务 424d9dd2）：旧实现失败后仍以 EMPTY_SNAPSHOT 走同一条
 * 全列 upsert，一次抖动就把上一轮真实读数擦成 NULL。于是表里 NULL 的语义变成了
 * 「最近一次采集失败」而不是「没查到」，读侧无从分辨，配额数据也就不能当选号权威。
 *
 * 连续失败计数与 status 的保持，全部在 SQL 里用 `+1` / `CASE` 完成 ——
 * 不做「SELECT 判态再 UPDATE」（铁律 761f242b），并发下也不会互相覆盖。
 * 未达阈值前 status 保持上一轮的值：抖动不该改变对账号的判断。
 *
 * @returns {{consecutive_failures:number,status:string}|null} RETURNING 行，供告警判定
 */
async function upsertModelAccountFailure(pool, acct, status, lastError) {
  const res = await pool.query(
    `INSERT INTO ops_model_accounts
       (account_id, provider, plan, host_alias, forwardable, forward_targets,
        status, last_error, consecutive_failures, last_checked_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,1,NOW(),NOW())
     ON CONFLICT (account_id) DO UPDATE SET
       provider=EXCLUDED.provider, plan=EXCLUDED.plan,
       host_alias=EXCLUDED.host_alias, forwardable=EXCLUDED.forwardable,
       forward_targets=EXCLUDED.forward_targets,
       consecutive_failures = ops_model_accounts.consecutive_failures + 1,
       status = CASE
                  WHEN ops_model_accounts.consecutive_failures + 1 >= ${FAILURE_STREAK_THRESHOLD}
                  THEN EXCLUDED.status
                  ELSE ops_model_accounts.status
                END,
       last_error = EXCLUDED.last_error,
       last_checked_at = NOW(), updated_at = NOW()
     RETURNING consecutive_failures, status`,
    [
      acct.account_id, acct.provider, acct.plan ?? null,
      acct.host_alias, acct.forwardable, JSON.stringify(acct.forward_targets || []),
      status, truncErr(lastError),
    ],
  );
  return res?.rows?.[0] ?? null;
}

/**
 * 幂等 upsert 单条账号快照（INV-4：INSERT ... ON CONFLICT (account_id) DO UPDATE，非 SELECT-then-INSERT）。
 * forward_targets 以 jsonb 落库；last_checked_at/updated_at 用 DB 时钟。
 * 成功即把连续失败计数归零。
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
       consecutive_failures = 0,
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
  const {
    fetchUsage, grokProbe, only, exec, keyExistsFn, inContainer,
    force = false,
    now = () => Date.now(),
    retryDelayMs = RETRY_DELAY_MS,
    onAlert = null,
  } = opts;

  // ── 自 gate ───────────────────────────────────────────────────────────
  // 60s 轮询 + 模块自 gate 是全局约定（scheduler-jobs.js:5-9）。本采集器此前漏了
  // 自己这半边，于是每分钟全量打 8 个账号的厂商 usage API，把两个 Claude 号打成 429。
  // only（选号侧按需刷新单账号）与 force 必须能绕过，否则刀1 的按需刷新接缝就没了。
  if (!force && !only) {
    const gate = await pool.query(
      'SELECT MAX(last_checked_at) AS last_collected_at FROM ops_model_accounts',
    );
    const lastAt = gate?.rows?.[0]?.last_collected_at;
    if (lastAt) {
      const elapsed = now() - new Date(lastAt).getTime();
      if (elapsed < COLLECT_INTERVAL_MS) {
        return {
          collected: 0, results: [], skipped: true, reason: 'self_gate',
          next_due_in_ms: COLLECT_INTERVAL_MS - elapsed,
        };
      }
    }
  }

  const targets = MODEL_ACCOUNTS.filter((a) => matchesOnly(a, only));
  const results = [];
  const startedAt = now();
  let budgetExhausted = false;

  for (const acct of targets) {
    // 单轮总预算：超了就把剩下的账号留到下一轮（它们保留上轮数据，不被擦白），
    // 而不是让一轮无限延长——事件循环不该被采集拖着走。
    if (now() - startedAt >= COLLECT_BUDGET_MS) {
      budgetExhausted = true;
      break;
    }

    const isGrok = /grok/i.test(acct.provider);
    let status = 'ok';
    let snapshot = { ...EMPTY_SNAPSHOT };
    let lastError = null;

    // 一次查不到可能只是网络抖动（主理人 0920）。可重试类错误轮内再试，
    // 429 与确定性否定事实（key_expired/no_credential）立即放弃。
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        let raw;
        if (isGrok && typeof grokProbe === 'function') {
          raw = await grokProbe(acct);
        } else if (typeof fetchUsage === 'function') {
          raw = await fetchUsage(acct);
        } else {
          raw = await defaultFetchUsage(acct, exec, keyExistsFn, inContainer);
        }
        snapshot = parseUsageByProvider(acct.provider, raw);
        status = 'ok';
        lastError = null;
        break;
      } catch (err) {
        status = isGrok ? classifyGrokUsageError(err) : classifyUsageError(err);
        lastError = truncErr(err?.message || err);
        if (!isRetryableStatus(status) || attempt === MAX_ATTEMPTS) break;
        await sleep(retryDelayMs * attempt);
      }
    }

    if (status === 'ok') {
      await upsertModelAccount(pool, acct, snapshot, status, lastError);
    } else {
      const row = await upsertModelAccountFailure(pool, acct, status, lastError);
      // 只在「刚好走满阈值」的那一轮响一次：之前是抖动不值得响，之后再响就是刷屏。
      if (onAlert && Number(row?.consecutive_failures) === FAILURE_STREAK_THRESHOLD) {
        await onAlert({
          account_id: acct.account_id,
          status,
          last_error: lastError,
          consecutive_failures: row.consecutive_failures,
        });
      }
    }
    results.push({ account_id: acct.account_id, status });
  }

  return {
    collected: results.length,
    results,
    ...(budgetExhausted ? { budget_exhausted: true } : {}),
  };
}
