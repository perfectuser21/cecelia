/** 固定定义证明文件引用来源；不证明 legacy symbol 或业务执行。 */
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const fields = ['kind', 'repo', 'path', 'revision', 'digest'];
const file = b => Object.fromEntries(fields.map(k => [k, b[k]]));
function validFile(b) {
  return ['code', 'skill'].includes(b.kind) && /^[^/]+\/[^/]+$/.test(b.repo || '')
    && /^[0-9a-f]{40}$/.test(b.revision || '') && /^sha256:[0-9a-f]{64}$/.test(b.digest || '')
    && typeof b.path === 'string' && !b.path.includes('\\') && !b.path.split('/').some(p => ['', '.', '..'].includes(p));
}
export function resolveEnablerSource(call, activities, components) {
  const parents = activities.flatMap(a => call.caller_type === 'activity'
    ? a.activity_id === call.caller_id ? [{a, step: null}] : []
    : call.caller_type === 'step' ? (a.payload.steps || []).filter(s => s.step_id === call.caller_id).map(step => ({a, step})) : []);
  const parent = parents.length === 1 ? parents[0] : null;
  const result = {...call, activity_id: parent?.a.activity_id || null, step_id: parent?.step?.step_id || null,
    source_status: 'unknown', source_evidence: [], validation_scope: 'reference_only', symbol_status: 'unverified'};
  if (!call.active || !parent || parent.a.payload.activity_id !== parent.a.activity_id) return result;
  const {a, step} = parent;
  if (step && (step.locator?.activity_id !== a.activity_id || !step.locator?.step_key)) return result;
  const bindings = a.payload.implementation_bindings || [];
  // 一旦定义采用显式来源，就不从另一个父或 legacy 全局引用借证据。
  const declared = bindings.some(b => own(b, 'enabler_key'))
    || activities.some(other => (other.payload.implementation_bindings || []).some(b => b.enabler_key === call.enabler_key));
  if (declared) {
    const selected = bindings.filter(b => b.enabler_key === call.enabler_key
      && (step ? b.scope === 'step' && b.step_key === step.locator.step_key : b.scope === 'activity'));
    if (!selected.length || selected.some(b => !validFile(b) || b.status !== 'verified' || b.validation_scope !== 'reference_only'
      || b.symbol || b.repo !== a.source_repo || b.revision !== a.source_commit
      || (step ? b.scope !== 'step' || b.step_key !== step.locator.step_key : b.scope !== 'activity')
      || !components.some(c => fields.every(k => c[k] === b[k])))) return result;
    result.source_evidence = selected.map(b => ({...file(b), activity_definition_version_id: a.id,
      activity_id: a.activity_id, step_id: step?.step_id || null, validation_scope: 'reference_only'}));
  } else {
    const match = /^([^/@]+\/[^/@]+)@([0-9a-f]{40}):(.+)$/.exec(call.impl_ref || '');
    const c = match && components.find(c => validFile(c) && c.repo === match[1] && c.revision === match[2] && c.path === match[3]);
    if (!c) return result;
    result.source_evidence = [{...file(c), validation_scope: 'reference_only'}];
  }
  result.source_status = 'verified';
  return result;
}
