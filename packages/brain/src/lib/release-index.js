/** 发布版本、实测记录只追加；green仅由冻结定义、CI证据和实际组件共同派生。 */
import { createHash } from 'node:crypto';
import defaultPool from '../db.js';
import { assertImplementationReport } from './implementation-report.js';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export class ReleaseEvidenceError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = `RELEASE_${code}`; this.status = status; }
}
export function requireEvidence(ok, message, code = 'INPUT_INVALID', status = 422) {
  if (!ok) throw new ReleaseEvidenceError(code, message, status);
}
export function evidenceText(value, name, pattern) {
  requireEvidence(typeof value === 'string' && value.length > 0 && value.length <= 2000 && value.trim() === value && (!pattern || pattern.test(value)), `${name}格式无效`);
  return value;
}
export function evidenceObject(value, allowed) {
  requireEvidence(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k)), '请求对象含未知字段或类型无效');
}
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const evidenceHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const same = (a, b) => a !== undefined && b !== undefined && evidenceHash(a) === evidenceHash(b);
export async function evidenceTransaction(pool, key, fn) {
  const client = await (pool || defaultPool).connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
    const result = await fn(client); await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
function componentKey(c) { return `${c.kind}:${c.repo}:${c.path || ''}`; }
function validateComponents(components, allowEmpty = false) {
  requireEvidence(Array.isArray(components) && (allowEmpty || components.length > 0) && components.length <= 10000, 'components必须为组件数组');
  const keys = new Set();
  for (const c of components) {
    evidenceObject(c, ['kind', 'repo', 'revision', 'path', 'digest']);
    requireEvidence(['repo', 'code', 'skill'].includes(c.kind), '组件类型无效');
    evidenceText(c.repo, 'repo', REPO); evidenceText(c.revision, 'revision', SHA);
    if (c.kind === 'repo') requireEvidence(c.path === undefined && c.digest === undefined, 'repo组件只登记SHA');
    else {
      evidenceText(c.path, 'path');
      requireEvidence(!c.path.startsWith('/') && !c.path.split('/').some(p => ['..', '.', ''].includes(p)) && !c.path.includes('\\'), '组件路径须为仓库相对路径');
      evidenceText(c.digest, 'digest', /^sha256:[0-9a-f]{64}$/);
    }
    const key = componentKey(c); requireEvidence(!keys.has(key), '组件身份重复'); keys.add(key);
  }
}
function validateRelease(input) {
  evidenceObject(input, ['release_key', 'environment', 'target', 'actor', 'workflows', 'components', 'ci_evidence']);
  for (const key of ['release_key', 'environment', 'target', 'actor']) evidenceText(input[key], key);
  requireEvidence(Array.isArray(input.workflows) && input.workflows.length > 0 && input.workflows.length <= 1000, 'workflows必须明确固定版本');
  const ids = new Set();
  for (const w of input.workflows) {
    evidenceObject(w, ['workflow_definition_version_id', 'payload_sha256']);
    evidenceText(w.workflow_definition_version_id, 'workflow version', UUID); evidenceText(w.payload_sha256, 'payload sha256', HASH);
    requireEvidence(!ids.has(w.workflow_definition_version_id), 'Workflow版本重复'); ids.add(w.workflow_definition_version_id);
  }
  validateComponents(input.components);
  requireEvidence(Array.isArray(input.ci_evidence) && input.ci_evidence.length <= 100, 'ci_evidence必须为数组');
  for (const item of input.ci_evidence) { evidenceObject(item, ['report', 'receipt', 'evidence_ref']); evidenceText(item.evidence_ref, 'CI evidence_ref'); }
}
async function readDefinitions(db, input) {
  const workflows = (await db.query('SELECT * FROM workflow_definition_versions WHERE id=ANY($1::uuid[]) ORDER BY id', [input.workflows.map(w => w.workflow_definition_version_id)])).rows;
  requireEvidence(workflows.length === input.workflows.length, '固定Workflow版本不存在');
  requireEvidence(new Set(workflows.map(w => w.workflow_id)).size === workflows.length, '同一release不能包含一个Workflow的多个版本');
  const ids = [...new Set(workflows.flatMap(w => w.payload.activities.map(r => r.activity_version_id)))];
  const activities = (await db.query('SELECT * FROM activity_definition_versions WHERE id=ANY($1::uuid[]) ORDER BY id', [ids])).rows;
  requireEvidence(activities.length === ids.length, '固定Activity版本不存在');
  for (const w of workflows) requireEvidence(input.workflows.find(i => i.workflow_definition_version_id === w.id)?.payload_sha256 === w.payload_sha256, 'Workflow摘要不符');
  for (const row of [...workflows, ...activities]) requireEvidence(input.components.some(c => c.kind === 'repo' && c.repo === row.source_repo && c.revision === row.source_commit), '定义来源repo/SHA与release不符');
  for (const a of activities) for (const binding of a.payload.implementation_bindings || []) {
    requireEvidence(['code', 'skill'].includes(binding.kind) && binding.status === 'verified', '定义实现绑定未验证');
    requireEvidence(input.components.some(c => c.kind === binding.kind && c.repo === binding.repo && c.revision === binding.revision && c.path === binding.path && c.digest === binding.digest), '定义Code/Skill绑定与release组件不符');
  }
  for (const c of input.components.filter(c => c.kind !== 'repo')) {
    requireEvidence(input.components.some(repo => repo.kind === 'repo' && repo.repo === c.repo && repo.revision === c.revision), '组件SHA缺少对应repoSHA');
    requireEvidence(activities.some(a => (a.payload.implementation_bindings || []).some(b => b.kind === c.kind && b.repo === c.repo && b.path === c.path && b.revision === c.revision && b.digest === c.digest)), '额外组件没有固定定义绑定证据');
  }
  return { workflows, activities };
}
async function readEnablerCalls(db, activities, components) {
  const activityIds = activities.map(a => a.activity_id), steps = activities.flatMap(a => a.payload.steps || []);
  const calls = (await db.query(`SELECT c.id,c.caller_type,c.caller_id,c.enabler_id,e.key enabler_key,e.impl_ref,e.active
    FROM enabler_calls c JOIN enablers e ON e.id=c.enabler_id
    WHERE (c.caller_type='activity' AND c.caller_id=ANY($1::uuid[]))
      OR (c.caller_type='step' AND c.caller_id=ANY($2::uuid[])) ORDER BY c.id`, [activityIds, steps.map(s => s.step_id).filter(Boolean)])).rows;
  return calls.map(call => {
    const step = call.caller_type === 'step' ? steps.find(s => s.step_id === call.caller_id) : null;
    const activity_id = step?.locator?.activity_id || (call.caller_type === 'activity' ? call.caller_id : null);
    const match = /^([^/@]+\/[^/@]+)@([0-9a-f]{40}):(.+)$/.exec(call.impl_ref || '');
    const component = match && components.find(c => c.kind !== 'repo' && c.repo === match[1] && c.revision === match[2] && c.path === match[3]);
    const verified = Boolean(call.active && activityIds.includes(activity_id) && component);
    return { ...call, activity_id, step_id: step?.step_id || null, source_status: verified ? 'verified' : 'unknown', source_evidence: component || null };
  });
}
function governanceChecksMatch(expected,observed){
  if(!Array.isArray(expected)||!Array.isArray(observed)||expected.length!==observed.length)return false;
  const key=c=>JSON.stringify([c?.id,c?.path,c?.script_sha256]);
  if(new Set(expected.map(key)).size!==expected.length||new Set(observed.map(key)).size!==observed.length)return false;
  return expected.every(c=>observed.some(r=>r&&r.exit_code===0&&!r.error&&key(r)===key(c)));
}
function validateCiEvidence(items, definitions, components) {
  const valid = [], gaps = [];
  for (const [index, { report, receipt }] of items.entries()) {
    const repo = report?.source?.repo, revision = report?.source?.head_revision;
    if(receipt?.purpose==='admission_only'||report?.ci_context?.purpose==='admission_only'){gaps.push({code:'ci_admission_only',index});continue;}
    try { assertImplementationReport(report); } catch (error) { gaps.push({code:'ci_report_unverified',index,reason:error.code || 'IMPACT_REPORT_INVALID'}); continue; }
    let ok = report?.mapping_status === 'verified' && report?.truncated === false && Array.isArray(report?.gaps) && !report.gaps.length
      && components.some(c => c.kind === 'repo' && c.repo === repo && c.revision === revision)
      && receipt?.actor === 'implementation_ci_gate' && receipt?.verdict === 'PASS' && receipt?.scope === 'regression_tests'
      && same(receipt?.source, report?.source)
      && receipt?.report_sha256 === createHash('sha256').update(JSON.stringify(report)).digest('hex');
    if(report.governance_evidence)ok &&= same(receipt?.governance_evidence?.files,report.governance_evidence.files)
      && receipt?.governance_evidence?.policy_sha256===report.governance_evidence.policy_sha256
      && governanceChecksMatch(report.governance_evidence.checks,receipt?.governance_evidence?.checks);
    const assertions = report?.required_assertions;
    ok &&= Array.isArray(assertions) && assertions.length > 0 && Array.isArray(receipt?.assertions)
      && assertions.every(a => a && a.source_repo === repo && receipt.assertions.some(r => r && r.assertion_ref === a.assertion_ref && r.source_repo === repo && r.source_revision === revision
        && r.exit_code === 0 && !r.error && !r.signal && typeof r.test_sha256 === 'string' && HASH.test(r.test_sha256) && same(r.source_bindings, a.source_bindings)));
    for (const kind of ['workflows', 'activities']) {
      const evidence = report?.head?.definition_versions?.[kind];
      const expected = definitions[kind].filter(row => row.source_repo === repo);
      ok &&= Array.isArray(evidence) && expected.every(row => evidence.some(e => e && e.id === row.id && e.payload_sha256 === row.payload_sha256 && e.source_commit === row.source_commit && e.source_repo === row.source_repo));
    }
    if (ok) valid.push(repo); else gaps.push({ code: 'ci_evidence_unverified', index });
  }
  for (const repo of new Set(components.filter(c => c.kind === 'repo').map(c => c.repo))) if (!valid.includes(repo)) gaps.push({ code: 'ci_repo_evidence_missing', repo });
  return { status: gaps.length ? 'unknown' : 'verified', gaps };
}
export async function createRelease(pool, input) {
  validateRelease(input); const requestHash = evidenceHash(input);
  return evidenceTransaction(pool, `release:${input.release_key}`, async db => {
    const existing = (await db.query('SELECT * FROM release_versions WHERE release_key=$1', [input.release_key])).rows[0];
    if (existing) { requireEvidence(existing.request_sha256 === requestHash, 'release_key已绑定其他内容', 'CONFLICT', 409); return { release: existing, created: false }; }
    await db.query('LOCK TABLE journey_steps,steps,enablers,enabler_calls IN SHARE MODE');
    const definitions = await readDefinitions(db, input);
    const allowed_enabler_calls = await readEnablerCalls(db, definitions.activities, input.components);
    const ci = validateCiEvidence(input.ci_evidence, definitions, input.components);
    const stepGaps = definitions.activities.flatMap(a => (a.payload.steps || []).filter(s => !s.step_id || !UUID.test(s.step_id) || s.locator?.activity_id !== a.activity_id).map(s => ({code:'step_identity_missing',activity_definition_version_id:a.id,step_key:s.locator?.step_key || null})));
    const gaps = [...stepGaps, ...ci.gaps, ...allowed_enabler_calls.filter(c => c.source_status !== 'verified').map(c => ({ code: 'enabler_source_unknown', enabler_call_id: c.id }))];
    const payload = { schema_version: 1, ...definitions, components: input.components, ci_evidence: input.ci_evidence, allowed_enabler_calls,
      verification: { definition_status: stepGaps.length ? 'unknown' : 'verified', step_coverage_status: stepGaps.length ? 'unknown' : 'verified', ci_status: ci.status, status: gaps.length ? 'unknown' : 'verified', gaps } };
    const manifestHash = evidenceHash({ environment: input.environment, target: input.target, payload });
    const release = (await db.query(`INSERT INTO release_versions(release_key,manifest_sha256,request_sha256,environment,target,actor,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [input.release_key, manifestHash, requestHash, input.environment, input.target, input.actor, payload])).rows[0];
    return { release, created: true };
  });
}
export async function getRelease(db, id) {
  evidenceText(id, 'release_id', UUID);
  const release = (await (db || defaultPool).query('SELECT * FROM release_versions WHERE id=$1', [id])).rows[0];
  requireEvidence(release, 'release不存在', 'NOT_FOUND', 404); return release;
}
export function evaluateReleaseObservation(release, observation) {
  const payload = observation?.payload;
  const actual = payload?.components;
  const gaps = [];
  if (!payload) gaps.push({ code: 'observation_missing' });
  else {
    if (observation.release_id !== release.id) gaps.push({ code: 'current_release_mismatch' });
    if (release.environment !== payload.environment || release.target !== payload.target) gaps.push({ code: 'deployment_target_mismatch' });
    if (!observation.collector || !observation.evidence_ref) gaps.push({ code: 'observation_evidence_missing' });
    if (!Array.isArray(actual) || !same([...release.payload.components].sort((a,b) => componentKey(a).localeCompare(componentKey(b))), [...actual].sort((a,b) => componentKey(a).localeCompare(componentKey(b))))) gaps.push({ code: 'component_mismatch' });
  }
  const matched = !gaps.length;
  if (release.payload.verification.status !== 'verified') gaps.push({ code: 'release_unverified' });
  return { deployed: !gaps.length, actual_matches: matched, gaps };
}
export async function lockReleaseTarget(db,environment,target) {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`release-target:${JSON.stringify([environment,target])}`]);
}
export async function recordReleaseObservation(pool, releaseId, input, { trustedCollector } = {}) {
  evidenceText(releaseId, 'release_id', UUID);
  evidenceObject(input, ['event_key', 'attempt_key', 'environment', 'target', 'components', 'collector', 'observed_at', 'evidence_ref']);
  for (const key of ['event_key', 'attempt_key', 'environment', 'target', 'collector', 'observed_at', 'evidence_ref']) evidenceText(input[key], key);
  requireEvidence(typeof trustedCollector === 'string' && trustedCollector === input.collector, 'collector未受信', 'COLLECTOR_UNTRUSTED', 403);
  requireEvidence(/^\d{4}-\d\d-\d\dT/.test(input.observed_at) && Number.isFinite(Date.parse(input.observed_at)), 'observed_at须为明确时间');
  validateComponents(input.components, true); const hash = evidenceHash(input);
  return evidenceTransaction(pool, `release-observation:${releaseId}:${input.event_key}`, async db => {
    const release = await getRelease(db, releaseId);
    // 锁住声明目标和实际目标；稳定排序避免错目标交叉观测死锁。
    const targets = [...new Set([JSON.stringify([release.environment,release.target]),JSON.stringify([input.environment,input.target])])].sort();
    for (const value of targets) await lockReleaseTarget(db,...JSON.parse(value));
    const existing = (await db.query('SELECT * FROM release_observations WHERE release_id=$1 AND event_key=$2', [releaseId, input.event_key])).rows[0];
    if (existing) { requireEvidence(existing.payload_sha256 === hash, '观测事件已绑定其他实测内容', 'CONFLICT', 409); return { observation: existing, created: false }; }
    const observation = (await db.query(`INSERT INTO release_observations(release_id,event_key,attempt_key,payload_sha256,payload,collector,evidence_ref,observed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [releaseId, input.event_key, input.attempt_key, hash, input, trustedCollector, input.evidence_ref, input.observed_at])).rows[0];
    return { observation, created: true, verification: evaluateReleaseObservation(release, observation) };
  });
}
export async function getReleaseGate(db, id) {
  db ||= defaultPool; const release = await getRelease(db, id);
  // 按collector事件时间回看同一部署目标；不同release也能证明回滚或漂移。
  const observations = (await db.query(`SELECT * FROM release_observations WHERE release_id=$3 OR (payload->>'environment'=$1 AND payload->>'target'=$2)
    ORDER BY observed_at DESC,created_at DESC,id DESC`, [release.environment, release.target, id])).rows;
  const latest = observations[0], current = evaluateReleaseObservation(release, latest);
  const successful = observations.find(row => evaluateReleaseObservation(release, row).deployed);
  return { release_id: id, manifest_sha256: release.manifest_sha256, ...current,
    current_status: current.deployed ? 'deployed' : latest && !current.actual_matches ? 'drift' : 'unknown',
    ever_deployed: Boolean(successful), last_verified_observation_id: successful?.id || null,
    current_observation_id: latest?.id || null, verification: release.payload.verification };
}
