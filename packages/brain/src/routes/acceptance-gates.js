/**
 * acceptance-gates.js — 建单期与收单期的前置闸（D1 Task 12/13）
 *
 * 全部 fail-closed：宁可不建单也不建错单，宁可拒收判定也不收一份指向不明被测对象的判定。
 * 从 routes/acceptance.js 分出来是 500 行闸逼出来的（同 Task 7/11 的先例），但边界本身成立：
 * 这里只回答「这一笔准不准写」，一个字都不碰判定本身。
 *
 *   建单期：租户白名单（A16②）→ 版本戳双源对账（A9/J12-A）→ 上一轮复盘闭环（A15①⑥⑦）
 *   收单期：冻结锁（J12-A）——run 的版本戳变了，这一轮判的已经不是同一个东西
 */

/** 逃生阀的门槛：按字符数算，中文按字计（A15⑥） */
export const FORCE_REASON_MIN_CHARS = 20;

const SHA40 = /^[0-9a-f]{40}$/;

/** 冻结锁比对的三项：两个部署面 + 规程本身 */
export const FROZEN_STAMP_FIELDS = ['backend_sha', 'frontend_sha', 'spec_sha'];

/**
 * 验收专用租户白名单（A16②）。env 缺失返回 null = 拒绝一切建单，绝不降级放行——
 * 「没配白名单」和「白名单允许所有人」是两件事，把前者当后者就是拿生产客户账号做验收。
 */
export function loadTenantAllowlist() {
  const raw = process.env.ACCEPTANCE_TENANT_ALLOWLIST;
  if (!raw || raw.trim() === '') return null;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * 建单期双源对账（J12-A）。源① 是被测系统自报，源② 是构建侧 GitHub API；
 * 两个源的取数实现属 D2，D1 只校验与落库——本函数不去拉任何远端。
 * 返回 null = 放行。
 */
export function validateVersionStamps(head) {
  for (const [a, b] of [['backend_sha', 'backend_sha_src2'], ['frontend_sha', 'frontend_sha_src2']]) {
    if (!SHA40.test(head[a] || '') || !SHA40.test(head[b] || '')) {
      return { error: 'sha_format_invalid', field: a };
    }
    if (head[a] !== head[b]) {
      return { error: 'sha_source_mismatch', field: a, src1: head[a], src2: head[b] };
    }
  }
  if (!head.spec_sha) return { error: 'spec_sha_required' };
  return null;
}

/**
 * 建单前置（A15①⑥⑦ / A16② / A9）。返回 null = 放行；否则返回 {status, body}。
 * 放行时可能就地给 head 补上 force 三项留痕——强开必须留痕，两者同一步完成。
 *
 * 租户与版本戳这两条排在复盘闭环之前：前两条只看这一单自己，判起来不用查库；
 * 第三条要按 gp 回查上一轮。先做便宜且必挂的检查，避免为一单必然被拒的建单去查库。
 */
export async function checkCreateGate(pool, { gp_id, run_key, head, force_reason, force_opened_by }) {
  const allowlist = loadTenantAllowlist();
  if (allowlist === null) {
    return { status: 503, body: {
      error: 'acceptance_tenant_allowlist_unset',
      hint: 'ACCEPTANCE_TENANT_ALLOWLIST 未配置；缺白名单时拒绝建单而非放行',
    } };
  }
  if (!allowlist.includes(head.tenant_account)) {
    return { status: 400, body: {
      error: 'tenant_account_not_allowed', tenant_account: head.tenant_account || null,
    } };
  }

  const stampError = validateVersionStamps(head);
  if (stampError) return { status: 400, body: stampError };

  // A15①：同 gp 上一轮复盘没闭环就开新一轮，等于让上一轮的教训无处落地。
  // 没有 gp_id 的单不挂在任何一条 GP 上，无「上一轮」可言，这条闸对它不适用。
  if (!gp_id) return null;
  const { rows: prevRuns } = await pool.query(
    `SELECT run_key, detail FROM acceptance_runs
      WHERE gp_id = $1 AND run_key <> $2 ORDER BY created_at DESC LIMIT 1`,
    [gp_id, run_key]
  );
  const prevRun = prevRuns[0];
  if (!prevRun || prevRun.detail?.review_closed_at) return null;

  const forced = typeof force_reason === 'string' && [...force_reason].length >= FORCE_REASON_MIN_CHARS;
  if (!forced) {
    return { status: 409, body: {
      error: 'previous_review_not_closed',
      previous_run_key: prevRun.run_key,
      hint: `上一轮复盘未闭环；如需强开请给 force_reason（≥${FORCE_REASON_MIN_CHARS} 字）`,
    } };
  }
  head.force_reason = force_reason;
  head.force_opened_by = force_opened_by || null;
  head.force_opened_at = new Date().toISOString();
  return null;
}

/**
 * 冻结锁判据（J12-A，纯计算）。run 一旦带了版本戳，人列提交就必须自报当前 sha；
 * 对不上说明 staging 重新部署或规程改版，这一轮的判定不再指向同一个被测对象。
 *
 * @returns {{kind:'skip'}|{kind:'missing'}|{kind:'unchanged'}|{kind:'changed', changed:string[]}}
 */
export function checkFrozenStamps(runDetail = {}, submitted = {}) {
  // 没带版本戳的 run（历史单、手工单）没有可冻结的对象，这条闸对它不适用。
  // 判据取 backend_sha 而不是「detail 非空」：detail 里还装着一堆与版本无关的单头字段。
  if (!runDetail?.backend_sha) return { kind: 'skip' };
  // 带戳的 run 提交却不自报 sha，不能当成「没变」放行——那是把冻结锁静默关掉。
  if (FROZEN_STAMP_FIELDS.some((k) => !submitted[k])) return { kind: 'missing' };
  const changed = FROZEN_STAMP_FIELDS.filter((k) => submitted[k] !== runDetail[k]);
  return changed.length > 0 ? { kind: 'changed', changed } : { kind: 'unchanged' };
}
