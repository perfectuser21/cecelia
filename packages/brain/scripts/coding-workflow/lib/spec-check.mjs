// 02-spec.md 自检：spec 活动生成后与 spec_review 改写后共用同一规则。
import { reportErrors, parseFrontmatter, extractAnchors } from './md-chain.mjs';

export const SPEC_FILE = '02-spec.md';
export const INTENT_FILE = '01-intent.md';
const SPEC_ID_RE = /^S-\d+$/;

/** 02 正文中按出现顺序的 `### S-n` 锚点。 */
export function specIds(text) {
  const body = parseFrontmatter(text)?.body ?? text;
  return extractAnchors(body).filter((id) => SPEC_ID_RE.test(id));
}

/** 02 自检：frontmatter/upstream 覆盖全部 I-n（reportErrors），且至少一条 `### S-n`。返回错误码数组。 */
export function specErrors(text, taskId, intentIds) {
  const errors = reportErrors(text, { taskId, step: 'spec', coversFile: INTENT_FILE, ids: intentIds });
  if (specIds(text).length === 0) errors.push('spec_ids_missing');
  return errors;
}
