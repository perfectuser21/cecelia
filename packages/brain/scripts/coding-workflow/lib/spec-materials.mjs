// 02 中的单一材料计划；确定性检查只证明覆盖与批准引用，不替代独立语义审查。
const TITLE = '## 旧规则与材料计划';
const text = value => typeof value === 'string' && value.trim().length > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const materialPath = value => text(value) && value.length <= 512 && !/[\x00-\x1f\\]/.test(value)
  && !value.startsWith('/') && !/^[a-z]:/i.test(value)
  && value.split('/').every(p => p && !['.', '..', '.git'].includes(p));

export function parseMaterialPlan(source) {
  const lines = String(source).split(/\r?\n/); const positions = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const mark = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (mark) { if (!fence) fence = mark[1][0]; else if (fence === mark[1][0]) fence = null; }
    if (!fence && lines[i] === TITLE) positions.push(i);
  }
  if (!positions.length) return null;
  if (positions.length !== 1) throw Error('material_plan_duplicate');
  const tail = lines.slice(positions[0] + 1); const end = tail.findIndex(line => /^#{1,2}\s/.test(line));
  const section = (end < 0 ? tail : tail.slice(0, end)).join('\n').trim();
  if (Buffer.byteLength(section, 'utf8') > 256 * 1024) throw Error('material_plan_too_large');
  const match = /^```json\s*\n([\s\S]*?)\n```$/.exec(section);
  if (!match) throw Error('material_plan_format');
  let plan; try { plan = JSON.parse(match[1]); } catch { throw Error('material_plan_json'); }
  const pending = [[plan, 0]]; let nodes = 0;
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (++nodes > 10000 || depth > 12) throw Error('material_plan_too_deep');
    if (value && typeof value === 'object') for (const child of Object.values(value)) pending.push([child, depth + 1]);
  }
  if (!object(plan) || plan.version !== 1 || !Array.isArray(plan.rules) || !Array.isArray(plan.materials)
    || plan.rules.length > 1000 || plan.materials.length > 32) throw Error('material_plan_shape');
  return plan;
}

export function materialPlanErrors(source, { baseline, intentIds = [], specIds = [], qaIds = [] } = {}) {
  if (baseline?.status !== 'managed') return [];
  if (!Array.isArray(baseline.rules) || !baseline.rules.length) return ['baseline_rules_unconfigured'];
  let plan; try { plan = parseMaterialPlan(source); } catch (error) { return [error.message]; }
  if (!plan) return ['material_plan_missing'];
  const errors = [], refs = new Map(baseline.refs.map(r => [r.ref_id, r]));
  const rules = new Set(baseline.rules.map(r => `${r.ref_id}#${r.rule_id}`));
  const seenRules = new Set(), seenMaterials = new Set(), seenPaths = new Set();
  function links(row, key) {
    if (!text(row.reason)) errors.push(`reason_missing:${key}`);
    for (const [field, known, prefix] of [['intent_ids', intentIds, 'intent'], ['spec_ids', specIds, 'spec'], ['qa_ids', qaIds, 'qa']]) {
      if (!Array.isArray(row[field]) || !row[field].length) { errors.push(`${prefix}_links_missing:${key}`); continue; }
      if (new Set(row[field]).size !== row[field].length) errors.push(`${prefix}_links_duplicate:${key}`);
      for (const id of row[field]) if (!known.includes(id)) errors.push(`${prefix}_unknown:${id}`);
    }
    if (!Array.isArray(row.approval_refs)) errors.push(`approval_refs_invalid:${key}`);
    else for (const id of row.approval_refs) if (!intentIds.includes(id)) errors.push(`approval_unknown:${id}`);
  }
  function approved(row, key, action, ruleId = undefined) {
    if (!baseline.approvals?.some(a => a.ref_id === row.ref_id && a.rule_id === ruleId && a.action === action && row.approval_refs?.includes(a.intent_id))) errors.push(`approval_missing:${key}`);
  }
  for (const row of plan.rules) {
    if (!object(row)) { errors.push('rule_invalid'); continue; }
    const key = `${row.ref_id}#${row.rule_id}`;
    if (!rules.has(key)) errors.push(`rule_unknown:${key}`);
    if (seenRules.has(key)) errors.push(`rule_duplicate:${key}`); seenRules.add(key);
    links(row, key);
    if (!['keep', 'modify', 'retire', 'conflict', 'not_applicable'].includes(row.action)) errors.push(`rule_action_invalid:${key}`);
    if (row.action === 'conflict') errors.push(`rule_conflict:${key}`);
    if (['modify', 'retire'].includes(row.action)) approved(row, key, row.action, row.rule_id);
  }
  for (const key of rules) if (!seenRules.has(key)) errors.push(`rule_missing:${key}`);
  for (const row of plan.materials) {
    if (!object(row)) { errors.push('material_invalid'); continue; }
    const key = row.ref_id, ref = refs.get(key);
    if (Object.hasOwn(row, 'rule_id')) errors.push(`material_rule_id_forbidden:${key}`);
    if (!ref) errors.push(`material_unknown:${key}`);
    if (seenMaterials.has(key)) errors.push(`material_duplicate:${key}`); seenMaterials.add(key);
    if (!materialPath(row.path) || row.path !== ref?.path) errors.push(`material_path_mismatch:${key}`);
    // 别名ref允许共享原件；额外路径不能重复登记同一目标。
    seenPaths.add(row.path); links(row, key);
    if (!text(row.verification)) errors.push(`material_verification_missing:${key}`);
    if (!['keep', 'update'].includes(row.action)) errors.push(`material_action_invalid:${key}`);
    if (row.action === 'conflict') errors.push(`material_conflict:${key}`);
    if (row.action === 'retire' || ref?.kind === 'sample' && row.action === 'update') approved(row, key, row.action);
    if (row.additional_changes !== undefined && !Array.isArray(row.additional_changes)) errors.push(`material_extra_invalid:${key}`);
    for (const extra of Array.isArray(row.additional_changes) ? row.additional_changes : []) {
      if (!object(extra) || !materialPath(extra.path)) { errors.push(`material_extra_path_invalid:${key}`); continue; }
      if (seenPaths.has(extra.path) || baseline.refs.some(r => r.path === extra.path)) errors.push(`material_extra_duplicate:${extra.path}`);
      seenPaths.add(extra.path);
      if (!['keep', 'update', 'retire'].includes(extra.action) || !text(extra.reason) || !text(extra.verification)) errors.push(`material_extra_invalid:${key}`);
      if (extra.action === 'retire' || ref?.kind === 'sample' && extra.action === 'update') approved(row, key, extra.action);
    }
  }
  for (const key of refs.keys()) if (!seenMaterials.has(key)) errors.push(`material_missing:${key}`);
  return [...new Set(errors)];
}
