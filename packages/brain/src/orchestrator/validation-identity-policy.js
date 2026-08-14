import { isPassVerdict } from './gates.js';

const MUTABLE_IDENTITY_BINDING = /(?<field>\battempt_id\b|\battemptId\b|\bATTEMPT_ID\b|\bcapability_snapshot_id\b|\bsnapshotId\b|\bCAPABILITY_SNAPSHOT_ID\b)\s*(?:!==?|===?|==?|:)\s*["'`]?\s*(?<uuid>[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})/i;

/**
 * A GAN contract is authored before Generator/Evaluator/Judge Attempts exist.
 * UUID literals assigned to those mutable fields therefore can only name an
 * authoring Attempt (Planner/Proposer/Reviewer) or stale evidence. Validation
 * identity must be read from the executing role's server-issued runtime values.
 */
export function evaluateValidationIdentityPolicy(contractContent) {
  const violations = [];
  for (const [index, line] of String(contractContent ?? '').split('\n').entries()) {
    const binding = line.match(MUTABLE_IDENTITY_BINDING);
    if (!binding?.groups) continue;
    violations.push(Object.freeze({
      code: 'premature_validation_identity_binding',
      line: index + 1,
      field: binding.groups.field,
      value: binding.groups.uuid,
    }));
  }
  return Object.freeze({
    ok: violations.length === 0,
    violations: Object.freeze(violations),
  });
}

/**
 * Harness merge handler 的唯一合并权威判据（fail-closed，法源 decision e4e37f10）。
 *
 * gates.mergeGate 覆盖「缺 receipt / 旧 SHA / not-pass / review 未批」，但只接 verdict
 * 对象，无法表达「Brain 查询本身出错必须拒绝」这一 fail-closed 输入——查询异常时会 fail-open。
 * evaluateMergeAuthority 把「Brain 查询错误 → 拒绝」并入同一权威判据：只有同一 PR head_sha
 * 上独立 Evaluator PASS/FIXED receipt + 独立 Judge PASS receipt，且 Brain 查询成功时才 allow；
 * 缺角色 / 旧 SHA / 被拒 callback（非 PASS/FIXED）/ Brain 查询错误 → 一律拒绝，绝不 fail-open。
 *
 * 判定顺序（fail-closed）：brainQueryOk===false → brain_query_error；再 evaluate
 * （缺 → 旧 SHA → 非 PASS/FIXED）；再 judge（缺 → 旧 SHA → 非 PASS）；全过 → all_roles_pass。
 *
 * @param {{evaluateReceipt:{verdict,pr_head_sha}|null, judgeReceipt:{verdict,pr_head_sha}|null,
 *          prHeadSha:string, brainQueryOk:boolean}} input
 * @returns {{allow:boolean, reason:string}}
 */
export function evaluateMergeAuthority({ evaluateReceipt, judgeReceipt, prHeadSha, brainQueryOk }) {
  if (brainQueryOk === false) {
    return Object.freeze({ allow: false, reason: 'brain_query_error' });
  }
  if (!evaluateReceipt) {
    return Object.freeze({ allow: false, reason: 'evaluate_receipt_missing' });
  }
  if (evaluateReceipt.pr_head_sha !== prHeadSha) {
    return Object.freeze({ allow: false, reason: 'stale_evaluate_sha' });
  }
  if (!isPassVerdict(evaluateReceipt.verdict)) {
    return Object.freeze({ allow: false, reason: 'evaluate_not_pass' });
  }
  if (!judgeReceipt) {
    return Object.freeze({ allow: false, reason: 'judge_receipt_missing' });
  }
  if (judgeReceipt.pr_head_sha !== prHeadSha) {
    return Object.freeze({ allow: false, reason: 'stale_judge_sha' });
  }
  if (!isPassVerdict(judgeReceipt.verdict)) {
    return Object.freeze({ allow: false, reason: 'judge_not_pass' });
  }
  return Object.freeze({ allow: true, reason: 'all_roles_pass' });
}
