/**
 * 运行定义回读的紧凑视图。
 * 完整回读会把整个 release（全部 Workflow/Activity、CI 证据、断言计划）带回去，生产实测约 669KB，
 * 跨境执行端 curl 超时拒跑（10-09）。执行端只需绑定本身 + 本次要跑的 Workflow/Activity/Step 身份与校验 hash；
 * 大字段按需取：?view=full 取旧形状，GET /api/brain/releases/:id 取完整 release。
 */
export const RUN_DEFINITION_COMPACT_LIMIT_BYTES = 64 * 1024;
const RELEASE_FIELDS = ['id', 'release_key', 'manifest_sha256', 'request_sha256', 'environment', 'target', 'actor', 'created_at'];
const VERSION_FIELDS = ['id', 'payload_sha256', 'contract_sha256', 'source_repo', 'source_path', 'source_commit', 'created_at'];
const WORKFLOW_PAYLOAD_FIELDS = ['workflow_id', 'key', 'name', 'form', 'channel', 'capability_id', 'definition_scope', 'activities'];
const STEP_CONTRACT_FIELDS = ['key', 'name', 'order', 'optional', 'required', 'condition'];
const STEP_REGISTRATION_FIELDS = ['id', 'key', 'step_order', 'mode', 'source_sha256'];

function pick(source, fields) {
  if (!source || typeof source !== 'object') return source ?? null;
  const out = {};
  for (const key of fields) if (source[key] !== undefined) out[key] = source[key];
  return out;
}
function compactStep(step) {
  if (!step || typeof step !== 'object') return step;
  return { step_id: step.step_id, locator: step.locator, contract: pick(step.contract, STEP_CONTRACT_FIELDS), registration: pick(step.registration, STEP_REGISTRATION_FIELDS) };
}
function compactActivity(activity) {
  if (!activity || typeof activity !== 'object') return activity;
  const payload = activity.payload && typeof activity.payload === 'object' ? activity.payload : {};
  return {
    ...pick(activity, [...VERSION_FIELDS, 'activity_id']),
    payload: {
      activity_id: payload.activity_id, definition_key: payload.definition_key, definition_scope: payload.definition_scope,
      optional: payload.contract?.optional, required: payload.contract?.required, condition: payload.contract?.condition,
      steps: Array.isArray(payload.steps) ? payload.steps.map(compactStep) : [],
    },
  };
}
function compactUnsafe(full) {
  const workflow = full.workflow && typeof full.workflow === 'object'
    ? { ...pick(full.workflow, [...VERSION_FIELDS, 'workflow_id']), payload: pick(full.workflow.payload || {}, WORKFLOW_PAYLOAD_FIELDS) }
    : full.workflow ?? null;
  const release = full.release && typeof full.release === 'object'
    ? { ...pick(full.release, RELEASE_FIELDS), full_href: `/api/brain/releases/${full.release.id}` }
    : full.release ?? null;
  return {
    definition_view: 'compact',
    binding: full.binding,
    release,
    workflow,
    activities: Array.isArray(full.activities) ? full.activities.map(compactActivity) : [],
    omitted: { release: ['payload'], workflow: ['payload.contract'], activities: ['payload.contract', 'payload.implementation_bindings', 'payload.verification', 'payload.resources', 'payload.steps[].contract(除key/name/order/optional/required/condition)'], full_view: '?view=full' },
  };
}
/** fail-safe：紧凑化遇到异常形状时返回完整定义，绝不让回读 500。 */
export function compactRunDefinition(full) {
  if (!full || typeof full !== 'object') return full;
  try { return compactUnsafe(full); } catch { return { definition_view: 'full', ...full }; }
}
