// 02-spec.md 自检：spec 活动生成后与 spec_review 改写后共用同一规则。
// 02 = 开发方的实现规格（### S-n）+ 用户视角 QA 场景（### Q-n，evaluator 真人 QA 按它在真实环境里黑盒验收）。
import { reportErrors, parseFrontmatter, extractAnchors } from './md-chain.mjs';

export const SPEC_FILE = '02-spec.md';
export const INTENT_FILE = '01-intent.md';
const SPEC_ID_RE = /^S-\d+$/;
const QA_RE = /^### (Q-\d+)(?:[\s:：].*)?$/;
const HEADING_RE = /^#{1,3}(?:\s|$)/;
const FIELD_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?(对应|前提|操作|期望)(?:\*\*)?\s*[:：]\s*(.*)$/;
const KEYS = { 对应: 'covers', 前提: 'pre', 操作: 'steps', 期望: 'expect' };

const bodyOf = (text) => parseFrontmatter(text)?.body ?? String(text ?? '');

/** 02 正文中按出现顺序的 `### S-n` 锚点。 */
export function specIds(text) {
  return extractAnchors(bodyOf(text)).filter((id) => SPEC_ID_RE.test(id));
}

/** QA 场景 `### Q-n`：对应（I-n 列表）/前提/操作/期望；字段可跨行（续行接到上一个字段）。 */
export function qaScenarios(text) {
  const out = [];
  let cur = null;
  let field = null;
  for (const line of bodyOf(text).split(/\r?\n/)) {
    const q = QA_RE.exec(line);
    if (q) {
      cur = { id: q[1], covers: [], pre: '', steps: '', expect: '' };
      out.push(cur);
      field = null;
      continue;
    }
    if (HEADING_RE.test(line)) {
      cur = null;
      continue;
    }
    if (!cur) continue;
    const f = FIELD_RE.exec(line);
    if (f) {
      field = KEYS[f[1]];
      const value = f[2].replace(/\*\*/g, '').trim();
      if (field === 'covers') cur.covers = value.split(/[,，、\s]+/).filter(Boolean);
      else cur[field] = value;
      continue;
    }
    if (field && field !== 'covers' && line.trim()) cur[field] = cur[field] ? `${cur[field]}\n${line.trim()}` : line.trim();
  }
  return out;
}

/** QA 场景自检：至少一条、每条有对应/操作/期望且对应的是已知 I-n、每个 I-n 至少被一条覆盖。 */
function qaErrors(text, intentIds) {
  const scenarios = qaScenarios(text);
  if (scenarios.length === 0) return ['qa_missing'];
  const errors = [];
  const known = new Set(intentIds);
  const covered = new Set();
  for (const q of scenarios) {
    if (q.covers.length === 0) errors.push(`${q.id}:covers_missing`);
    if (!q.steps) errors.push(`${q.id}:steps_missing`);
    if (!q.expect) errors.push(`${q.id}:expect_missing`);
    for (const c of q.covers) {
      if (known.has(c)) covered.add(c);
      else errors.push(`${q.id}:covers_unknown:${c}`);
    }
  }
  for (const id of intentIds) if (!covered.has(id)) errors.push(`qa_not_covered:${id}`);
  return errors;
}

/** 02 自检：frontmatter/upstream 覆盖全部 I-n（reportErrors）、至少一条 `### S-n`、QA 场景合格。返回错误码数组。 */
export function specErrors(text, taskId, intentIds) {
  const errors = reportErrors(text, { taskId, step: 'spec', coversFile: INTENT_FILE, ids: intentIds });
  if (specIds(text).length === 0) errors.push('spec_ids_missing');
  return [...errors, ...qaErrors(text, intentIds)];
}
