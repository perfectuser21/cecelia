/** 历史业务方法只消费冻结闭包；当前监督器与资源安全实现不回退。 */
import { digest, requireCommander, validateReady } from './commander-v2-contract.js';
export const METHOD_PROTOCOL = 'commander-method-v1';
const same = (a, b) => digest(a) === digest(b);
const omit = (value, keys) => Object.fromEntries(Object.entries(value ?? {}).filter(([k]) => !keys.includes(k)));
export function frozenWorkflow(release, version) {
  const workflow = release.payload.workflows.find(w => w.id === version);
  requireCommander(workflow && workflow.payload.definition_scope !== 'consumer_evidence', '方法缺完整冻结Workflow');
  return workflow;
}
function activities(release, workflow) {
  return workflow.payload.activities.map(ref => {
    const row = release.payload.activities.find(a => a.id === ref.activity_version_id && a.activity_id === ref.activity_id);
    requireCommander(row && row.payload.definition_scope !== 'consumer_evidence', '方法缺完整冻结Activity');
    return { ref, row };
  });
}
export function methodManifest(release, version) {
  const w = frozenWorkflow(release, version), bindings = new Map();
  for (const { row } of activities(release, w)) for (const b of row.payload.implementation_bindings ?? []) {
    requireCommander(['code', 'skill'].includes(b.kind) && b.status === 'verified', '方法实现来源未验证');
    const item = { kind: b.kind, repo: b.repo ?? b.raw?.repo ?? row.source_repo, path: b.path, revision: b.revision, digest: b.digest };
    requireCommander(item.repo === w.source_repo && item.revision === w.source_commit, '方法闭包含多来源或版本');
    requireCommander(typeof item.path === 'string' && !item.path.startsWith('/') && !item.path.includes('\\') && !item.path.split('/').some(p => ['', '.', '..'].includes(p)), '方法路径非法');
    requireCommander(release.payload.components.some(c => same(c, item)), '方法组件摘要不匹配');
    const key = `${item.kind}:${item.repo}:${item.path}`;
    requireCommander(!bindings.has(key) || same(bindings.get(key), item), '方法来源冲突'); bindings.set(key, item);
  }
  requireCommander(bindings.size > 0 && release.payload.components.some(c => c.kind === 'repo' && c.repo === w.source_repo && c.revision === w.source_commit), '方法闭包为空或缺来源');
  const sorted = [...bindings.values()].sort((a, b) => {
    for (const key of ['kind', 'repo', 'path', 'revision', 'digest']) { const order = Buffer.compare(Buffer.from(a[key]), Buffer.from(b[key])); if (order) return order; } return 0;
  });
  return { protocol: METHOD_PROTOCOL, workflow: { key: w.payload.contract.key, workflow_id: w.workflow_id, workflow_definition_version_id: w.id, snapshot_sha256: w.payload_sha256 }, source: { repo: w.source_repo, revision: w.source_commit }, bindings: sorted };
}
function contractShape(contract) {
  const shape = omit(contract, ['version', 'source', 'description', 'implementation', 'implementation_bindings']);
  if (Array.isArray(shape.activities)) shape.activities = shape.activities.map(contractShape);
  if (Array.isArray(shape.steps)) shape.steps = shape.steps.map(contractShape);
  return shape;
}
function compatibilityShape(release, version) {
  const w = frozenWorkflow(release, version);
  const capability = w.payload.capability_id ?? w.payload.contract.capability_id;
  requireCommander(typeof capability === 'string' && capability.length > 0, '方法缺固定能力身份');
  return { workflow_id: w.workflow_id, capability_id: capability, contract: contractShape(w.payload.contract), activities: activities(release, w).map(({ ref, row }) => ({
    reference_id: ref.reference_id, activity_id: ref.activity_id, slot_key: ref.slot_key, contract: contractShape(row.payload.contract),
    steps: (row.payload.steps ?? []).map(s => ({ step_id: s.step_id, locator: s.locator, contract: contractShape(s.contract) }))
  })) };
}
export function compatibilityDigest(original, originalVersion, candidate, candidateVersion) {
  const a = compatibilityShape(original, originalVersion), b = compatibilityShape(candidate, candidateVersion);
  requireCommander(same(a, b), '历史方法I/O、资源、验收、副作用或路径身份不兼容');
  const originalActivities = activities(original, frozenWorkflow(original, originalVersion));
  for (const { ref, row } of activities(candidate, frozenWorkflow(candidate, candidateVersion))) {
    const c = row.payload.contract;
    if (c.by !== 'shell' && !['preflight', 'cleanup'].includes(ref.slot_key) && c.executor_kind !== 'code') continue;
    const current = originalActivities.find(a => a.ref.reference_id === ref.reference_id).row;
    const safety = activity => (activity.payload.implementation_bindings ?? []).map(b => ({ kind: b.kind, repo: b.repo ?? b.raw?.repo ?? activity.source_repo, path: b.path, digest: b.digest })).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    requireCommander(same(safety(current), safety(row)), '历史方法不得回退安全shell或controller字节');
  }
  return digest(a);
}
export function expectedPath(release, version) {
  return activities(release, frozenWorkflow(release, version)).flatMap(({ ref, row }) => {
    const base = { reference_id: ref.reference_id, activity_id: row.activity_id, activity_definition_version_id: row.id, required: true };
    return [base, ...(row.payload.steps ?? []).map(s => ({ ...base, step_id: s.step_id }))];
  });
}
export function validateMethodReady(ready, e) {
  validateReady(ready, e.definition);
  const m = e.method_selection;
  if (!m) return;
  const parts = { protocol: 'commander-composition-v1', supervisor_runtime_sha256: m.supervisor_definition.runtime_snapshot_sha256,
    method_manifest_sha256: m.method_instance.manifest_sha256, resolved_bindings_sha256: digest(m.method_instance.resolved_bindings) };
  for (const k of ['supervisor_runtime_sha256', 'method_manifest_sha256', 'resolved_bindings_sha256']) requireCommander(ready[k] === parts[k], `方法组合部署漂移:${k}`, 409);
  requireCommander(digest(parts) === e.definition.runtime_snapshot_sha256, '方法组合摘要不符', 409);
}
export function methodVerificationValid(v, e) {
  if (!e.method_selection) return true;
  return [['original_goal', e.method_selection.original_goal_definition.snapshot_sha256], ['selected_method', e.definition.snapshot_sha256]].every(([name, hash]) =>
    v.assertions.some(a => a.name === name && a.pass === true && a.definition_sha256 === hash && Array.isArray(a.evidence) && a.evidence.length > 0));
}
