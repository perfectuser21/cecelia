import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {callActivityProcess} from './activity-process.js';
const unknown = reason => ({verdict: 'unknown', evidence: [], reason});

async function validateScope(profile, scope, definition, receipt, {signal, result, phase, evaluateScope} = {}) {
  const acceptance = definition?.acceptance;
  if (!acceptance?.ref) return unknown('acceptance_missing');
  let verdict, transport;
  const started_at = new Date().toISOString();
  try {
    const bytes = fs.readFileSync(path.resolve(profile.cwd, definition.entry));
    if (createHash('sha256').update(bytes).digest('hex') !== profile.files[definition.entry]) throw Error('validator_source_mismatch');
    const activity = {budget: {max_duration_s: definition.timeout_s ?? 30, heartbeat_s: 5},
      runtime: {entry: definition.entry, argv: definition.argv ?? [], cleanup_grace_s: 2}};
    let value;
    if (evaluateScope) {
      value = await evaluateScope({scope, definition, receipt: structuredClone(receipt),
        result: result === undefined ? undefined : structuredClone(result), phase, signal: scope === 'cleanup' ? undefined : signal});
    } else {
      transport = await callActivityProcess(activity, {receipt: structuredClone(receipt), acceptance, scope,
      ...(result === undefined ? {} : {result: structuredClone(result)}), ...(phase ? {phase} : {})},
    {cwd: profile.cwd, signal: scope === 'cleanup' ? undefined : signal});
      value = JSON.parse(transport.stdout);
    }
    if ((transport && (transport.reason_code || transport.exit_code !== 0)) || !['pass', 'fail', 'unknown'].includes(value.verdict)
      || value.acceptance_ref !== acceptance.ref || !Array.isArray(value.evidence)
      || (value.verdict === 'pass' && !value.evidence.length)) throw Error('validator_result_invalid');
    verdict = value;
  } catch { verdict = unknown('validator_unconfirmed'); }
  return {...verdict, executor: {kind: 'code', entry: definition.entry, sha256: profile.files[definition.entry]},
    started_at, ended_at: new Date().toISOString(), transport: transport ? {exit_code: transport.exit_code,
      exit_signal: transport.exit_signal, reason_code: transport.reason_code, duration_s: transport.duration_s} : null};
}

/** 每次Activity开始/结束由Runner调用；执行者和Commander都没有判定入口。 */
export async function validateActivity(profile, activity, result, {receipt = {}, signal, phase = 'end', evaluateScope} = {}) {
  const definitions = phase === 'start' ? profile.preconditions : profile.validators;
  const definition = definitions?.[activity.key], question = phase === 'start' ? 'A2' : 'A4';
  if (!definition?.acceptance?.ref) return unknown(phase === 'start' ? 'activity_precondition_missing' : 'activity_acceptance_missing');
  if (profile.metadata[activity.key]?.questions?.[question]?.ref !== definition.acceptance.ref) return unknown('activity_acceptance_reference_mismatch');
  return validateScope(profile, activity.key, definition, receipt, {signal, result, phase, evaluateScope});
}

/** 独立判定读取收据；固定进程或受保护domain通道均须匹配原acceptance。 */
export async function validateWorkflow(profile, receipt, {signal, cancelled = false, skipActivities = false, evaluateScope} = {}) {
  const validation = {workflow: unknown(cancelled ? 'run_cancelled' : 'acceptance_missing'), activities: {}, cleanup: unknown('cleanup_not_verified')};
  for (const a of profile.contract.activities) {
    const prior = receipt.activities?.filter(row => row.key === a.key).map(row => row.validator_verdict);
    const accepted = row => row?.verdict === 'pass' && row.unchecked !== true
      && row.acceptance_ref === profile.validators?.[a.key]?.acceptance?.ref;
    validation.activities[a.key] = skipActivities && prior?.length && prior.every(accepted)
      ? prior.at(-1) : skipActivities && prior?.some(row => row?.verdict === 'fail')
        ? prior.find(row => row?.verdict === 'fail') : unknown('activity_acceptance_missing');
  }
  for (const [scope, definition] of Object.entries(profile.validators ?? {})) {
    if (scope !== 'workflow' && scope !== 'cleanup' && !Object.hasOwn(validation.activities, scope)) throw Error('workflow_validator_scope_invalid');
    if ((cancelled && scope !== 'cleanup') || (skipActivities && !['workflow', 'cleanup'].includes(scope))) continue;
    if (!definition.acceptance?.ref) continue;
    if (!['workflow', 'cleanup'].includes(scope) && profile.metadata[scope]?.questions?.A4?.ref !== definition.acceptance.ref) continue;
    const verdict = await validateScope(profile, scope, definition, receipt, {signal, evaluateScope});
    if (scope === 'workflow') validation.workflow = verdict;
    else if (scope === 'cleanup') validation.cleanup = verdict;
    else validation.activities[scope] = verdict;
  }
  return validation;
}
