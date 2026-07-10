/**
 * capture-inbox.js — 统一收件箱"推"入口（九要素T10）
 *
 * handoff/learning/issue 产出后顺手推一条 capture_atom（status 默认 pending_review），
 * 由 capture-triage tick 异步分诊。写入失败绝不抛——进箱失败不允许阻塞主流程。
 * routed_to_table/routed_to_id 在写入时是"来源指针"，triage 路由后才改写为目的地。
 * Spec: docs/superpowers/specs/2026-07-10-capture-inbox-t10-design.md
 */
const MAX_CONTENT_LEN = 1000;

export async function pushCaptureAtom(pool, { content, targetType, targetSubtype = null, routedToTable = null, routedToId = null } = {}) {
  if (!content || !targetType) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO capture_atoms (content, target_type, target_subtype, routed_to_table, routed_to_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [String(content).slice(0, MAX_CONTENT_LEN), targetType, targetSubtype, routedToTable, routedToId]
    );
    return rows[0]?.id ?? null;
  } catch (err) {
    console.warn(`[capture-inbox] push failed (non-fatal): ${err.message}`);
    return null;
  }
}
