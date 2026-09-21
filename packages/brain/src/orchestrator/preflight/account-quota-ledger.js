/**
 * account-quota-ledger.js — 模型账号配额判据（G5 step1「接单即选到有额度的执行体」）
 *
 * 唯一知道「多满算不可用」语义的地方。只读 ops_model_accounts，不做选号决策
 * （选号在 capability-gate），也不碰 selectBestAccount 的 tier 降级瀑布
 * （那套吃 account_usage_cache，本表缺 sonnet/omelette/extra_used/7d-reset 列）。
 *
 * 三态而非布尔：当前布尔把「数据说这个号满了」和「我读不到数据」压成同一个 true，
 * 正是 2026-08-19 三起事故的根因形状（capability-gate.js:190-196 案卷）。
 */
import { MODEL_ACCOUNT_STATUS, runtimeToLedgerAccountId } from '../../ops-model-accounts-collector.js';

/** 主理人 0920 拍板：7d ≥ 90 或 5h ≥ 95 排除。 */
export const DISPATCH_GATE_FIVE_HOUR_PCT = 95;
export const DISPATCH_GATE_SEVEN_DAY_PCT = 90;

/** ledger 进程内缓存周期。采集器 5min 一轮，30s 足够摊薄热路径查询又不至于太陈。 */
export const LEDGER_CACHE_TTL_MS = 30_000;

/** 读不到账本连续多久后转 fail-closed（= 采集器自 gate 5min × FAILURE_STREAK_THRESHOLD 3）。 */
export const LEDGER_UNAVAILABLE_FAIL_CLOSED_MS = 15 * 60 * 1000;

export const QUOTA_VERDICTS = Object.freeze(['usable', 'unusable', 'unknown']);

/** 确定性否定事实：这两个 status 表示号根本登不上，与 pct 无关。 */
const CREDENTIAL_DEAD_STATUSES = Object.freeze(['key_expired', 'no_credential']);

/**
 * 窗口在这么多分钟内重置 → 该窗用量当 0 算（优先把快过期的额度用掉）。
 * 口径照搬 account-usage.js:646-653 的 RESET_SOON_MINUTES + effectivePct，
 * 两处必须一致，否则同一个号在中间件和 kernel 闸会得出相反结论。
 */
export const RESET_SOON_MINUTES = 30;

/**
 * 即将重置的窗当 0 算。
 *
 * 0920 上产的判据只看水位不看到期：7d=91%、10 分钟后滚窗的号照样判死。
 * 0921 实证 claude-account2 当时 7d=85%、2 小时后就重置 —— 光看水位会把
 * 一个马上自愈的号当成需要干预的号。
 *
 * 缺重置时刻（null / 非法串）一律**不豁免**：缺数据不能当成"快重置了"，
 * 那是把未知当有利，和 NULL 弃权的方向相反（这里 pct 是已知的、确凿超阈的）。
 */
function effectivePct(pct, resetAt, now) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return pct;
  if (!resetAt) return pct;
  const t = new Date(resetAt).getTime();
  if (!Number.isFinite(t)) return pct;           // 非法时间串 → 不豁免
  return (t - now) / 60_000 <= RESET_SOON_MINUTES ? 0 : pct;
}

const verdict = (v, reason, pct = null) => ({ verdict: v, reason, pct });

/**
 * 一行账本 → 三态裁决。
 *
 * 顺序不可调换：status 终态必须排在新鲜度判据之前。
 * upsertModelAccountFailure 的 CASE 规定 status 只在 consecutive_failures+1 >= 3
 * 时才落终态，而成功路径一律 consecutive_failures=0 且 status='ok'。因此
 * status ∈ {key_expired,no_credential,rate_limited} **蕴含** consecutive_failures>=3>0。
 * 若把「consecutive_failures>0 → unknown」排在前面，第 2、3 条就成了死支：
 * grok key 过期会被当 unknown 放行，而且用 {status:'key_expired',failures:0} 这种
 * 生产不可能存在的 fixture 还能把「八条分支全覆盖」测绿。
 */
export function judgeAccount(row, { now = Date.now() } = {}) {
  // 1. 无行
  if (!row) return verdict('unknown', 'no_ledger_row');

  const status = String(row.status ?? 'unknown');
  const failures = Number(row.consecutive_failures ?? 0);
  // 即将滚窗重置的窗当 0 算（见 effectivePct）。两个窗各用各的重置时刻：
  // reset_at 是 5h 窗的，seven_day_reset_at 是 7d 窗的，混用会豁免错窗口。
  const fiveHour = effectivePct(row.five_hour_pct, row.reset_at, now);
  const sevenDay = effectivePct(row.seven_day_pct, row.seven_day_reset_at, now);
  const pcts = [fiveHour, sevenDay].filter((p) => typeof p === 'number' && Number.isFinite(p));
  const worstPct = pcts.length > 0 ? Math.max(...pcts) : null;

  // 2. 凭据确定性失效 —— 与 pct 无关（失败不擦白 pct，死号会留着旧的低读数）
  if (CREDENTIAL_DEAD_STATUSES.includes(status)) {
    return verdict('unusable', 'credential_invalid', worstPct);
  }

  // 3. 采集器被限流 —— 弃权，绝不判死。429 ≠ 配额耗尽（account-usage.js 的 B49 案卷）
  if (status === 'rate_limited') return verdict('unknown', 'collector_rate_limited', worstPct);

  // 4. 新鲜度：本轮没被验证过的读数不作数。
  //    last_checked_at 不是新鲜度证据 —— 失败路径照刷它。
  if (failures > 0) return verdict('unknown', 'reading_unverified', worstPct);

  // 5/6. 额度闸（pct 只可能是整数，node-pg 对 int4 列不接受浮点）
  if (typeof fiveHour === 'number' && fiveHour >= DISPATCH_GATE_FIVE_HOUR_PCT) {
    return verdict('unusable', 'five_hour_exhausted', worstPct);
  }
  if (typeof sevenDay === 'number' && sevenDay >= DISPATCH_GATE_SEVEN_DAY_PCT) {
    return verdict('unusable', 'seven_day_exhausted', worstPct);
  }

  // 7. 两窗皆无读数 → 弃权（拍板：不加分不减分，交给认证失败/真 429 回调决定）
  if (worstPct === null) return verdict('unknown', 'pct_unknown');

  // 8.
  return verdict('usable', 'within_budget', worstPct);
}

/** 判据认得的 status 必须都在采集器的枚举里（禁手抄，migration 449 的列注释已陈旧）。 */
export function judgedStatuses() {
  return Object.freeze([...CREDENTIAL_DEAD_STATUSES, 'rate_limited', 'ok', 'unknown']
    .filter((s) => MODEL_ACCOUNT_STATUS.includes(s)));
}

// ⚠️ 加列时必须同步这里。judgeAccount 读什么、这条 SELECT 就得取什么——
// 0921 事故：seven_day_reset_at 建了列、采到了数据，唯独漏了这行 SELECT，
// judgeAccount 读到 undefined，soon-reset 豁免上产即死（单测手工构造 row、
// smoke 自插自读，两边都绕开了这条 SELECT 所以全绿）。
// 现由 account-quota-ledger.test.js 的机械守卫比对，漏列会直接红。
const LEDGER_SQL = `
  SELECT account_id, provider, five_hour_pct, seven_day_pct,
         status, consecutive_failures, reset_at, seven_day_reset_at,
         seven_day_sonnet_pct, seven_day_opus_pct, last_checked_at
    FROM ops_model_accounts
`;

/**
 * 创建 ledger 装载器。
 *
 * 一次 evaluate 只读一次全表（8 行），结果缓存 LEDGER_CACHE_TTL_MS。
 * 绝不逐候选查询 —— 候选最坏十几个，而这是派发热路径。
 *
 * @param {object} deps
 * @param {(sql:string)=>Promise<{rows:object[]}>} [deps.query] 查询接缝
 * @param {{query:Function}} [deps.pool] 或直接给 pool
 * @param {()=>number} [deps.now]
 */
export function createQuotaLedgerLoader({ query, pool, now = Date.now } = {}) {
  const runQuery = query ?? (pool ? (sql) => pool.query(sql) : null);
  if (typeof runQuery !== 'function') {
    throw new Error('createQuotaLedgerLoader requires deps.query or deps.pool');
  }

  let cache = null;          // { at, byLedgerId }
  let degraded = null;       // { since }

  function snapshotFrom(byLedgerId, { degradedReason = null, failClosed = false } = {}) {
    return {
      degraded: Boolean(degradedReason),
      degradedReason,
      verdictFor(runtimeAccountId) {
        if (degradedReason) {
          if (failClosed) return verdict('unusable', 'ledger_unavailable_fail_closed');
          return verdict('unknown', degradedReason === 'ledger_empty' ? 'ledger_empty' : 'ledger_unavailable');
        }
        const ledgerId = runtimeToLedgerAccountId(runtimeAccountId);
        return judgeAccount(ledgerId ? byLedgerId.get(ledgerId) : null);
      },
    };
  }

  return async function loadAccountQuota() {
    const t = now();
    if (cache && t - cache.at < LEDGER_CACHE_TTL_MS) {
      return snapshotFrom(cache.byLedgerId);
    }
    try {
      const res = await runQuery(LEDGER_SQL);
      const rows = res?.rows ?? [];
      if (rows.length === 0) {
        // 表空 = 系统未就绪，不是「所有号都没额度」。仍然降级留痕。
        degraded = degraded ?? { since: t };
        cache = null;
        const failClosed = t - degraded.since >= LEDGER_UNAVAILABLE_FAIL_CLOSED_MS;
        return snapshotFrom(new Map(), { degradedReason: 'ledger_empty', failClosed });
      }
      degraded = null;
      cache = { at: t, byLedgerId: new Map(rows.map((r) => [r.account_id, r])) };
      return snapshotFrom(cache.byLedgerId);
    } catch (err) {
      degraded = degraded ?? { since: t };
      cache = null;
      const failClosed = t - degraded.since >= LEDGER_UNAVAILABLE_FAIL_CLOSED_MS;
      return snapshotFrom(new Map(), {
        degradedReason: `ledger_unavailable:${String(err?.code || err?.message || err).slice(0, 120)}`,
        failClosed,
      });
    }
  };
}
