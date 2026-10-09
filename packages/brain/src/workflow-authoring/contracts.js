import { createHash } from 'node:crypto';

export const STAGES = ['intake', 'reuse', 'compose', 'build', 'verify', 'register'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authoringError(message, status = 422, code = 'WORKFLOW_AUTHORING_INVALID') {
  return Object.assign(new Error(message), { status, statusCode: status, code });
}

export function requireCondition(condition, message, status = 422) {
  if (!condition) throw authoringError(message, status);
}

export function object(value, label) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} 必须是对象`);
}

export function text(value, label, max = 8000) {
  requireCondition(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${label} 必须是非空文本且不超过 ${max} 字符`);
}

export function uuid(value, label) {
  requireCondition(typeof value === 'string' && UUID.test(value), `${label} 必须是 UUID`);
}

export function stringArray(value, label, { allowEmpty = false, max = 200 } = {}) {
  requireCondition(Array.isArray(value) && (allowEmpty || value.length > 0) && value.length <= max, `${label} 必须是有界文本数组`);
  value.forEach(entry => text(entry, label));
}

function canonical(value, depth = 0) {
  requireCondition(depth <= 40, 'JSON 嵌套过深');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(entry => canonical(entry, depth + 1)).join(',')}]`;
  object(value, 'JSON');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(',')}}`;
}

export function definitionDigest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function bounded(value, limit) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { throw authoringError('输入必须是 JSON'); }
  requireCondition(typeof encoded === 'string' && Buffer.byteLength(encoded, 'utf8') <= limit, '输入超过大小限制', 413);
  canonical(value);
}

export function validateRequest(request) {
  object(request, 'request');
  bounded(request, 16384);
  requireCondition(['create', 'update'].includes(request.operation), 'operation 必须是 create 或 update');
  text(request.goal, 'goal');
  text(request.actor, 'actor', 128);
  if (request.workflow_id !== undefined) uuid(request.workflow_id, 'workflow_id');
  if (request.operation === 'update') {
    requireCondition(typeof request.expected_version === 'string'
      && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(request.expected_version), '更新必须提供语义版本 expected_version');
  }
  return request;
}

export function validateSubmission(body) {
  object(body, 'submission');
  bounded(body, 262144);
  requireCondition(STAGES.includes(body.stage), '未知 authoring 阶段');
  requireCondition(Number.isSafeInteger(body.revision) && body.revision >= 0, 'revision 必须是非负整数');
  requireCondition(typeof body.submission_id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(body.submission_id), 'submission_id 格式错误');
  object(body.output, 'output');
  return body;
}

export function validateStageOutput(stage, output) {
  const fields = {
    intake: ['goal', 'inputs', 'outputs', 'acceptance', 'capability_id', 'workflow_id'],
    reuse: ['search_terms', 'candidates', 'no_match_reason'], compose: ['definition'],
    build: ['implementation_task_ids', 'reuse_only', 'evidence_refs'], verify: ['validation_task_id'], register: [],
  };
  requireCondition(Object.keys(output).every(key => fields[stage].includes(key)), `${stage} 含不支持的字段`);
  if (stage === 'intake') {
    text(output.goal, 'goal');
    for (const key of ['inputs', 'outputs', 'acceptance']) stringArray(output[key], key);
    uuid(output.capability_id, 'capability_id');
    if (output.workflow_id !== undefined) uuid(output.workflow_id, 'workflow_id');
  } else if (stage === 'reuse') {
    stringArray(output.search_terms, 'search_terms');
    requireCondition(Array.isArray(output.candidates) && output.candidates.length <= 200, 'candidates 必须是有界数组');
    if (output.candidates.length === 0) text(output.no_match_reason, 'no_match_reason');
    for (const candidate of output.candidates) {
      object(candidate, 'candidate');
      requireCondition(['skill', 'activity', 'workflow'].includes(candidate.kind), '候选 kind 无效');
      uuid(candidate.id, 'candidate.id');
      requireCondition(['reuse', 'adapt', 'reject'].includes(candidate.decision), '候选 decision 无效');
      text(candidate.reason, 'candidate.reason');
    }
  } else if (stage === 'compose') {
    object(output.definition, 'definition');
  } else if (stage === 'build') {
    requireCondition(typeof output.reuse_only === 'boolean', 'reuse_only 必须是布尔值');
    requireCondition(Array.isArray(output.implementation_task_ids) && output.implementation_task_ids.length <= 100, 'implementation_task_ids 必须是有界数组');
    requireCondition(output.reuse_only || output.implementation_task_ids.length > 0, '非纯复用必须提供实施任务');
    output.implementation_task_ids.forEach(id => uuid(id, 'implementation_task_id'));
    stringArray(output.evidence_refs, 'evidence_refs');
  } else if (stage === 'verify') {
    uuid(output.validation_task_id, 'validation_task_id');
  }
}
