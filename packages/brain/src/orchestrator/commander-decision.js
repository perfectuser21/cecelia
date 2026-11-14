import {createHash} from 'node:crypto';
import {parseActivityContract, object} from './activity-contract.js';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const fail = message => {throw Error(message);};
export function canonical(value, seen = new Set(), depth = 0) {
  if (depth > 40) fail('commander_json_invalid');
  if (value === null || ['string','boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!object(value) && !Array.isArray(value) || seen.has(value)
    || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) fail('commander_json_invalid');
  seen.add(value);
  const result = Array.isArray(value) ? value.map(x => canonical(x, seen, depth + 1))
    : Object.fromEntries(Object.keys(value).sort().map(k => {
      if (['__proto__','constructor','prototype'].includes(k)) fail('commander_json_invalid');
      return [k, canonical(value[k], seen, depth + 1)];
    }));
  seen.delete(value); return result;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function normalizeCommanderRun(value) {
  if (!object(value) || Object.keys(value).some(k => !['schema_version','task_id','run_id','contract','input','runtime_revision','deadline_ms','cleanup_deadline_ms','commander_timeout_ms','definition_sha256'].includes(k))
    || value.schema_version !== 1 || !UUID.test(value.task_id ?? '') || !UUID.test(value.run_id ?? '')
    || !HASH.test(value.runtime_revision ?? '') || !object(value.input)
    || typeof value.input.run_tag !== 'string' || !value.input.run_tag.trim()
    || !Number.isSafeInteger(value.deadline_ms) || value.deadline_ms <= 0) fail('commander_run_invalid');
  const normalized = canonical(value), contract = parseActivityContract(normalized.contract);
  if (contract.activities.length > 100 || contract.activities.some(a => !['source','finalize'].includes(a.runtime.phase)
    || a.runtime.interactive || a.runtime.detached || (a.runtime.max_attempts ?? 1) !== 1 || a.runtime.recovery_safe)) fail('commander_activity_unsupported');
  const finalizers = contract.activities.filter(a => a.runtime.phase === 'finalize');
  if (finalizers.length > 1 || finalizers.length && contract.activities.at(-1) !== finalizers[0]) fail('commander_activity_unsupported');
  if (finalizers.length && (!Number.isSafeInteger(value.cleanup_deadline_ms) || value.cleanup_deadline_ms <= value.deadline_ms)) fail('commander_cleanup_deadline_invalid');
  if (value.cleanup_deadline_ms !== undefined && (!Number.isSafeInteger(value.cleanup_deadline_ms) || value.cleanup_deadline_ms <= value.deadline_ms)) fail('commander_cleanup_deadline_invalid');
  const timeout = value.commander_timeout_ms ?? 60000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 600000) fail('commander_timeout_invalid');
  const request = {...normalized, contract, commander_timeout_ms:timeout}; delete request.definition_sha256;
  if (Buffer.byteLength(JSON.stringify(request)) > 1024 * 1024) fail('commander_run_oversized');
  const definition_sha256 = digest(request);
  if (value.definition_sha256 !== undefined && value.definition_sha256 !== definition_sha256) fail('commander_identity_conflict');
  return {...request, definition_sha256};
}
export function decisionRequest(run, receipts, next = run.contract.activities[receipts.length]) {
  return {protocol:'commander-decision/v1',run_id:run.run_id,definition_sha256:run.definition_sha256,
    sequence:receipts.length + 1,state_sha256:digest(receipts),workflow:run.contract.workflow,
    contract:structuredClone(run.contract),input:structuredClone(run.input),
    accepted:receipts.map(r => ({activity_key:r.activity_key,outputs:r.outputs,evidence:r.evidence})),
    allowed_actions:[...(next ? [{action:'dispatch',activity_key:next.key}] : [{action:'complete'}]), {action:'pause'}]};
}
export function parseCommanderDecision(value, request) {
  if (!object(value) || Object.keys(value).some(k => !['protocol','run_id','definition_sha256','sequence','state_sha256','action','activity_key','reason'].includes(k))
    || ['protocol','run_id','definition_sha256','sequence','state_sha256'].some(k => value[k] !== request[k])
    || typeof value.reason !== 'string' || value.reason.length > 2000
    || !request.allowed_actions.some(a => a.action === value.action && a.activity_key === value.activity_key)) fail('commander_decision_rejected');
  return canonical(value);
}
export function actionIdentity(run, key, context) {
  return {task_id:run.task_id,run_id:run.run_id,activity_key:key,definition_sha256:run.definition_sha256,
    action_id:digest({run_id:run.run_id,activity_key:key}),input_sha256:digest({input:run.input,context})};
}

/** 只给模型的展示投影；调用者保留原始run/input用于身份、执行和独立检查。 */
export function projectModelInput(input, {sourceFile,sourceField} = {}) {
  const projected=structuredClone(input), hashes=projected?.verification?.runtime_sha256;
  if(typeof sourceFile==='string' && sourceFile && object(hashes)) {
    projected.verification.runtime_sha256={prompt_projection:'runtime_sha256_not_inlined',
      source_file:sourceFile,source_field:sourceField,entries:Object.keys(hashes).length};
  }
  return projected;
}
