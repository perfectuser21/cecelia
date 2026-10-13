/** 同一task选择精确历史PASS的方法；无资格只记录原因，不把CI绿当业务成功。 */
import { getRelease, getReleaseGate, evaluateReleaseObservation, lockReleaseTarget } from './release-index.js';
import { getRunDefinitionBinding } from './run-definition-binding.js';
import { readSystemRunEvidence } from './capability-system-evidence.js';
import { verifiedRuntime, isCommanderVerification } from './commander-verification-transport.js';
import { readVerification } from './commander-v2-control.js';
import { digest, requireCommander, recoveryAllowed } from './commander-v2-contract.js';
import { METHOD_PROTOCOL, frozenWorkflow, methodManifest, compatibilityDigest, expectedPath, validateMethodSupport } from './commander-method-contract.js';
const metaKey = 'workflow_commander.internal';
const host = 'mmv';
const rejectedFacts = value => value !== undefined && (!Array.isArray(value) || value.length > 0);
export function qualifiedMethod({ run, task, verificationTask, frozen, evidence }) {
  const c = task?.result?.workflow_control, e = c?.envelope, b = frozen?.binding, w = frozen?.workflow;
  if (rejectedFacts(c?.rejected_activity_facts) || rejectedFacts(run?.result?.rejected_activity_facts)
      || c?.delivery?.failure?.code === 'invalid_activity_fact' || run?.result?.delivery?.failure?.code === 'invalid_activity_fact' || !e || !b || !w || !run || run.run_id !== e.run_id || run.task_id !== task.id || run.status !== 'success' || !run.ended_at
      || !['completed', 'completed_no_pr'].includes(task.status) || c.phase !== 'final' || c.verdict !== 'PASS'
      || c.delivery?.status !== 'completed' || !c.delivery?.cleanup?.completed || !c.delivery.cleanup.evidence?.length
      || !isCommanderVerification(verificationTask) || !verifiedRuntime(verificationTask) || verificationTask.id !== c.verify_task_id || verificationTask.parent_task_id !== task.id
      || evidence?.evidence_status !== 'verified' || evidence.business_outcome !== 'pass' || evidence.gaps?.length !== 0) return false;
  if (b.task_run_id !== run.id || b.payload?.runtime_snapshot_sha256 !== e.definition.runtime_snapshot_sha256 || b.run_id !== run.run_id || w.id !== e.definition.workflow_definition_version_id || w.workflow_id !== e.definition.workflow_id || w.payload_sha256 !== e.definition.snapshot_sha256) return false;
  for (const key of ['release_id', 'workflow_id', 'workflow_definition_version_id', 'snapshot_sha256']) if (b[key] !== e.definition[key]) return false;
  if (digest(run.context?.commander_envelope ?? null) !== digest(e)) return false;
  return readVerification(verificationTask, task, c)?.verdict === 'PASS';
}
async function currentGate(db, definition) {
  const release = await getRelease(db, definition.release_id), gate = await getReleaseGate(db, release.id);
  requireCommander(gate.deployed && gate.actual_matches && gate.verification.status === 'verified' && gate.current_observation_id === definition.observation_id, '方法当前正式部署未验证', 409);
  const observation = (await db.query('SELECT * FROM release_observations WHERE id=$1 AND release_id=$2', [definition.observation_id, release.id])).rows[0];
  requireCommander(evaluateReleaseObservation(release, observation).deployed, '方法实测组件不匹配', 409);
  const w = frozenWorkflow(release, definition.workflow_definition_version_id);
  requireCommander(w.workflow_id === definition.workflow_id && w.payload_sha256 === definition.snapshot_sha256, '方法固定定义不匹配');
  return { release, observation, workflow: w };
}
function definition(release, observation, workflow) {
  return { release_id: release.id, observation_id: observation.id, workflow_id: workflow.workflow_id, workflow_definition_version_id: workflow.id, snapshot_sha256: workflow.payload_sha256 };
}
async function supervisor(db, originRelease, ready) {
  const original = originRelease.payload.workflows.filter(w => w.payload.contract?.key === metaKey);
  requireCommander(original.length === 1 && originRelease.target === host, '原部署缺唯一当前监督器身份');
  const obs = (await db.query(`SELECT * FROM release_observations WHERE payload->>'environment'=$1 AND payload->>'target'=$2 ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1`, [originRelease.environment, host])).rows[0];
  requireCommander(obs, '监督器缺当前观测');
  const release = await getRelease(db, obs.release_id), current = release.payload.workflows.filter(w => w.workflow_id === original[0].workflow_id && w.payload.contract?.key === metaKey);
  requireCommander(current.length === 1, '当前监督器定义身份不匹配');
  const d = definition(release, obs, current[0]); await currentGate(db, d);
  const measured = await ready({ definition: d, workflow_key: metaKey });
  requireCommander(measured?.protocol === 'commander-v2' && measured.ready === true && measured.release_id === d.release_id && measured.snapshot_sha256 === d.snapshot_sha256 && /^[a-f0-9]{64}$/.test(measured.runtime_snapshot_sha256), '当前监督器实包未ready');
  return { definition: { ...d, runtime_snapshot_sha256: measured.runtime_snapshot_sha256 }, release };
}
function instance(release, observation, manifest) {
  const hash = digest(manifest), root = `/Users/administrator/.local/share/zenithjoy/commander-methods/${hash}`;
  requireCommander(release.target === `${host}--method--${hash}` && release.payload.workflows.length === 1, '方法实例target或Workflow闭包不符');
  requireCommander(digest(release.payload.components.filter(c => c.kind !== 'repo').sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))) === digest([...manifest.bindings].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))), '方法release含额外或缺失组件');
  const bindings = manifest.bindings.map(b => ({ ...b, absolute_path: `${root}/${b.path}` }));
  requireCommander(observation.evidence_ref.startsWith(`${METHOD_PROTOCOL}:`), '方法安装缺正式collector读回');
  let proof; try { proof = JSON.parse(observation.evidence_ref.slice(METHOD_PROTOCOL.length + 1)); } catch { requireCommander(false, '方法安装读回格式不符'); }
  requireCommander(proof.physical_host === host && proof.method_root === root && proof.manifest_sha256 === hash && proof.resolved_bindings_sha256 === digest(bindings) && /^[a-f0-9]{64}$/.test(proof.installation_sha256), '方法安装读回与冻结闭包不符');
  return { target: release.target, physical_host: host, method_root: root, manifest_sha256: hash, resolved_bindings: bindings };
}
/** 起跑事务与launch均锁定两个target，检查的是current observation，不能ever_deployed。 */
export async function validateMethodGates(db, e) {
  const m = e.method_selection; if (!m) return;
  const definitions = [m.supervisor_definition, e.definition];
  const releases = await Promise.all(definitions.map(d => getRelease(db, d.release_id)));
  for (const r of [...releases].sort((a,b)=>`${a.environment}:${a.target}`.localeCompare(`${b.environment}:${b.target}`))) await lockReleaseTarget(db, r.environment, r.target);
  const [supervised, selected] = await Promise.all(definitions.map(d => currentGate(db, d)));
  validateMethodSupport(selected.release, selected.workflow.id, methodManifest(supervised.release, supervised.workflow.id).bindings);
  requireCommander(supervised.workflow.payload.contract.key === metaKey && supervised.release.target === host, '监督器身份不符');
  const origin = await getRunDefinitionBinding(db, m.original_goal_definition.original_run_id);
  requireCommander(origin && origin.release.id === m.original_goal_definition.release_id && origin.workflow.id === m.original_goal_definition.workflow_definition_version_id && origin.workflow.workflow_id === e.definition.workflow_id && origin.workflow.payload_sha256 === m.original_goal_definition.snapshot_sha256 && digest(origin.workflow.payload.contract) === digest(m.original_goal_definition.contract), '原目标冻结来源不匹配');
  const sourceRun = (await db.query('SELECT task_id,context FROM task_runs WHERE id=$1', [origin.binding.task_run_id])).rows[0];
  const initial = sourceRun?.context?.commander_envelope;
  requireCommander(sourceRun?.task_id === e.task_id && initial?.input_sha256 === e.input_sha256 && initial.deadline_at === e.deadline_at && initial.cleanup_deadline_at === e.cleanup_deadline_at, '原目标所属任务或预算不匹配');
  requireCommander(compatibilityDigest(origin.release, origin.workflow.id, selected.release, selected.workflow.id) === m.selection_receipt.compatibility_sha256, '历史方法兼容收据不匹配');
  const historicalRun = (await db.query('SELECT * FROM task_runs WHERE run_id=$1', [m.selection_receipt.business_run_id])).rows[0];
  const historicalTask = historicalRun ? (await db.query('SELECT * FROM tasks WHERE id=$1', [historicalRun.task_id])).rows[0] : null;
  const historicalVerification = (await db.query('SELECT * FROM tasks WHERE id=$1', [m.selection_receipt.verification_task_id])).rows[0];
  const historical = await getRunDefinitionBinding(db, m.selection_receipt.business_run_id);
  const historicalEvidence = await readSystemRunEvidence(db, m.selection_receipt.business_run_id);
  requireCommander(qualifiedMethod({ run: historicalRun, task: historicalTask, verificationTask: historicalVerification, frozen: historical, evidence: historicalEvidence })
    && historical.workflow.id === selected.workflow.id && historical.workflow.payload_sha256 === selected.workflow.payload_sha256
    && digest(methodManifest(historical.release, historical.workflow.id)) === m.method_instance.manifest_sha256, '历史方法业务PASS资格已失效', 409);
  const { previous_attempt: _initialPrevious, ...initialPolicy } = initial.recovery;
  requireCommander(digest(initialPolicy) === digest(m.original_goal_definition.recovery), '原目标恢复策略不匹配');
  const expected = instance(selected.release, selected.observation, methodManifest(selected.release, e.definition.workflow_definition_version_id));
  requireCommander(digest(expected) === digest(m.method_instance), '方法安装映射漂移');
  requireCommander(m.original_goal_definition.input_sha256 === e.input_sha256 && m.original_goal_definition.deadline_at === e.deadline_at && m.original_goal_definition.cleanup_deadline_at === e.cleanup_deadline_at, '原目标输入或预算漂移');
  const { previous_attempt: _previous, ...policy } = e.recovery;
  requireCommander(digest(policy) === digest(m.original_goal_definition.recovery) && m.selection_receipt.previous_run_id === e.recovery.previous_attempt?.run_id, '原恢复策略或前序身份漂移');
}
export async function selectHistoricalMethod(db, task, control, { ready, now = () => new Date() } = {}) {
  requireCommander(recoveryAllowed(control, control.failure?.reason, now()), '历史方法恢复安全条件不满足', 409);
  const previous = control.envelope, first = previous.method_selection?.original_goal_definition;
  const original = await getRunDefinitionBinding(db, first?.original_run_id ?? previous.run_id);
  requireCommander(original && original.workflow.workflow_id === previous.definition.workflow_id, '原目标固定运行缺失');
  const originVersion = original.workflow.id, gaps = [];
  const rows = (await db.query(`SELECT r.*,row_to_json(t) AS task FROM task_runs r JOIN tasks t ON t.id=r.task_id
    JOIN run_definition_bindings b ON b.run_id=r.run_id JOIN workflow_definition_versions w ON w.id=b.workflow_definition_version_id
    WHERE b.workflow_id=$1 AND w.created_at<$2 AND b.workflow_definition_version_id<>$3 AND r.status='success'
    ORDER BY w.created_at DESC,r.ended_at DESC,r.run_id LIMIT 100`, [original.workflow.workflow_id, original.workflow.created_at, previous.definition.workflow_definition_version_id])).rows;
  for (const run of rows) {
    try {
      const candidate = await getRunDefinitionBinding(db, run.run_id), c = run.task.result?.workflow_control;
      const verificationTask = c?.verify_task_id ? (await db.query('SELECT * FROM tasks WHERE id=$1', [c.verify_task_id])).rows[0] : null;
      const evidence = await readSystemRunEvidence(db, run.run_id);
      requireCommander(qualifiedMethod({ run, task: run.task, verificationTask, frozen: candidate, evidence }), '历史业务缺精确独立官方PASS');
      const compatibility = compatibilityDigest(original.release, originVersion, candidate.release, candidate.workflow.id);
      const manifest = methodManifest(candidate.release, candidate.workflow.id), target = `${host}--method--${digest(manifest)}`;
      const installed = (await db.query('SELECT * FROM release_versions WHERE environment=$1 AND target=$2 ORDER BY created_at DESC,id DESC', [original.release.environment, target])).rows;
      let chosen;
      for (const release of installed) {
        const gate = await getReleaseGate(db, release.id); if (!gate.deployed) continue;
        const d = { ...definition(release, { id: gate.current_observation_id }, frozenWorkflow(release, candidate.workflow.id)), expected_path: expectedPath(release, candidate.workflow.id) };
        const current = await currentGate(db, d); chosen = { definition: d, method_instance: instance(release, current.observation, manifest) }; break;
      }
      requireCommander(chosen, '合格历史方法尚无当前正式安装实例');
      const sup = await supervisor(db, original.release, ready);
      // 任何与监督器共用的依赖只能执行当前相同字节，不能借业务包回退安全底座。
      const supervisorBindings = methodManifest(sup.release, sup.definition.workflow_definition_version_id).bindings;
      validateMethodSupport(candidate.release, candidate.workflow.id, supervisorBindings);
      for (const b of manifest.bindings) for (const live of supervisorBindings.filter(c => c.kind === b.kind && c.repo === b.repo && c.path === b.path)) requireCommander(live.digest === b.digest, '历史方法共享安全底座字节已过时');
      const { previous_attempt: _prior, ...policy } = previous.recovery;
      const selection = { protocol: METHOD_PROTOCOL, original_goal_definition: first ?? { original_run_id: previous.run_id, release_id: original.release.id, workflow_id: original.workflow.workflow_id, workflow_definition_version_id: originVersion,
        snapshot_sha256: original.workflow.payload_sha256, contract: previous.contract, recovery: policy, deadline_at: previous.deadline_at, cleanup_deadline_at: previous.cleanup_deadline_at, input_sha256: previous.input_sha256 },
      supervisor_definition: sup.definition, method_instance: chosen.method_instance,
      selection_receipt: { previous_run_id: previous.run_id, business_run_id: run.run_id, verification_task_id: verificationTask.id, compatibility_sha256: compatibility } };
      chosen.definition.runtime_snapshot_sha256 = digest({ protocol: 'commander-composition-v1', supervisor_runtime_sha256: sup.definition.runtime_snapshot_sha256, method_manifest_sha256: chosen.method_instance.manifest_sha256, resolved_bindings_sha256: digest(chosen.method_instance.resolved_bindings) });
      return { definition: chosen.definition, contract: candidate.workflow.payload.contract, method_selection: selection, gaps };
    } catch (error) {
      if (!['COMMANDER_CONTRACT'].includes(error.code) && !error.code?.startsWith('RELEASE_')) throw error;
      gaps.push({ run_id: run.run_id, reason: error.message });
    }
  }
  return { gaps: gaps.length ? gaps : [{ reason: '没有同workflow更早版本的完整业务运行证据' }] };
}
