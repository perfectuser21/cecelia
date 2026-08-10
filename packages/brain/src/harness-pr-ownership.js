/**
 * harness-pr-ownership — 判定某个 PR / 分支是否属于某条 harness run。
 *
 * 背景（法源：决策 e8f6134f-4131-4145-a893-79eb098011d9；事故 PR #4755）：
 *   CI 通用 auto-merge 曾用「PR 标题是否 feat(harness): 前缀」判断一个 PR 是不是
 *   harness 产出的。标题是 LLM 自由撰写的字段——generator 修 bug 会写 fix(...)、
 *   重构会写 refactor(...)，凡前缀非 feat(harness): 的 harness PR 全部漏过闸，被通用
 *   auto-merge 抢先合并，架空 evaluator+judge 裁判权（#4755 实证：合并时
 *   evaluate_verdict / judge_verdict 均为 NULL，裁判一次没跑）。
 *
 * 本模块把归属判据改向 Brain 自身的权威数据求证：initiative_runs.pr_url 由 kernel
 * （relay-watchdog / 回调）写入，不经 agent 之手，是非 LLM 撰写的可靠来源。
 *
 * 判据优先级：
 *   1. pr_url / pr_number 精确匹配 initiative_runs.pr_url（最强，kernel 写入）。
 *   2. 分支名内嵌的 task / initiative 短 id 前缀匹配（降级兜底，覆盖 pr_url 尚未
 *      回写的竞态窗口）。
 *
 * 纯函数层，不直接依赖 pg——route 传真 pool.query，单测/ smoke 传 fake，便于验真。
 */

/**
 * 从 cp-* 分支名里抽取 task / initiative 短 id 候选 token。
 *
 * 分支形状：
 *   generator:  cp-<MMDDHHMM>-<taskshort8>            (e.g. cp-08101107-04e4690d)
 *   sub-task:   cp-<MMDDHHMM>-ws-<init8>-<logical>
 *   手工 /dev:  cp-<MMDDHHMM>-<slug...>-<hex8>
 *
 * 只保留「>=8 位、且至少含一个 a-f 字母」的十六进制 token——借此排除 8 位纯数字的
 * 时间戳段（如 08101107），避免把时间戳当 id 误匹配。
 *
 * @param {string} branch
 * @returns {string[]} 去重后的小写 hex token
 */
export function extractBranchIdTokens(branch) {
  if (!branch) return [];
  const toks = String(branch).split(/[^0-9a-zA-Z]+/).filter(Boolean);
  const hex = toks.filter(
    (t) => /^[0-9a-f]{8,}$/i.test(t) && /[a-f]/i.test(t),
  );
  return [...new Set(hex.map((t) => t.toLowerCase()))];
}

/**
 * 构造归属查询 SQL + 参数。无任何可用判据（既无 pr_url/pr_number，分支也抽不出
 * id token）时返回 null，由调用方按「无法判定」处理。
 *
 * @param {{branch?: string, prNumber?: string|number, prUrl?: string}} input
 * @returns {{sql: string, params: any[]}|null}
 */
export function buildOwnershipQuery({ branch, prNumber, prUrl } = {}) {
  const clauses = [];
  const params = [];

  if (prUrl) {
    params.push(prUrl);
    clauses.push(`r.pr_url = $${params.length}`);
  }
  if (prNumber !== undefined && prNumber !== null && /^[0-9]+$/.test(String(prNumber))) {
    params.push(`%/pull/${prNumber}`);
    clauses.push(`r.pr_url LIKE $${params.length}`);
  }
  for (const tok of extractBranchIdTokens(branch)) {
    params.push(`${tok}%`);
    clauses.push(`r.current_task_id::text LIKE $${params.length}`);
    params.push(`${tok}%`);
    clauses.push(`r.initiative_id::text LIKE $${params.length}`);
  }

  if (clauses.length === 0) return null;

  const sql = `SELECT r.id, r.initiative_id, r.current_task_id, r.pr_url
       FROM initiative_runs r
      WHERE ${clauses.join(' OR ')}
      ORDER BY r.started_at DESC NULLS LAST
      LIMIT 1`;
  return { sql, params };
}

/**
 * 求证一个 PR / 分支是否属于某条 harness run。
 *
 * @param {(sql: string, params: any[]) => Promise<{rows: any[]}>} query
 *        执行 SQL 的函数（route 传 pool.query 的绑定；测试传 fake）
 * @param {{branch?: string, prNumber?: string|number, prUrl?: string}} input
 * @returns {Promise<{owned: boolean, run_id?: string, initiative_id?: string, matched_by?: string, reason?: string}>}
 */
export async function resolvePrOwnership(query, { branch, prNumber, prUrl } = {}) {
  const built = buildOwnershipQuery({ branch, prNumber, prUrl });
  if (!built) return { owned: false, reason: 'no_usable_identifier' };

  const { rows } = await query(built.sql, built.params);
  if (rows && rows.length > 0) {
    const row = rows[0];
    return {
      owned: true,
      run_id: row.id,
      initiative_id: row.initiative_id,
      matched_by: prUrl || prNumber ? 'pr' : 'branch',
      pr_url: row.pr_url || null,
    };
  }
  return { owned: false };
}
