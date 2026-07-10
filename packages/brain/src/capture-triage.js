/**
 * capture-triage.js — 收件箱四路分诊 tick job（九要素T10）
 *
 * 读 capture_atoms（status='pending_review'，仅三类新来源 handoff/learning/issue），
 * 便宜规则优先、LLM 兜底，四路：urgent / line_backlog / invariant / okr。
 * invariant 路必须过 invariant-gate 四查才允许写 decisions。
 * scheduler-jobs 注册，handler 内置间隔 gate（复用"模块自 gate"模型）。
 * Spec: docs/superpowers/specs/2026-07-10-capture-inbox-t10-design.md
 */

export const TRIAGE_SOURCE_TYPES = ['handoff', 'learning', 'issue'];
export const ROUTES = ['urgent', 'line_backlog', 'invariant', 'okr'];
export const LLM_CONFIDENCE_FLOOR = 0.7;

/** 便宜规则层（addendum 规则表 1:1）。命中 → {route, confidence}，不命中 → null。 */
export function applyCheapRules(atom) {
  const t = atom.target_type;
  const s = atom.target_subtype;
  if (t === 'issue' && (s === 'P0' || s === 'P1')) return { route: 'urgent', confidence: 1.0 };
  if (t === 'learning' && (atom.content || '').includes('根本原因')) return { route: 'invariant', confidence: 0.8 };
  if (t === 'handoff' && s === 'FAIL') return { route: 'line_backlog', confidence: 0.9 };
  if (t === 'handoff' && s === 'PASS+NEXT') return { route: 'line_backlog', confidence: 0.7 };
  return null;
}
