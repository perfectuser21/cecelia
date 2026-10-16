import {
  STAGES, requireCondition, object, text, uuid, stringArray,
  definitionDigest, validateRequest, validateSubmission, validateStageOutput,
} from './contracts.js';
import {validateRevalidationRequest} from './revalidation.js';
import {readAuthoringExecutionProof,readAuthoringReadiness} from './execution-proof.js';
import {loadAssemblyCatalog} from '../lib/workflow-assembly-store.js';
import { FREEZE_PROTOCOL, prepareDefinitionFreeze } from './freeze.js';
import {EXECUTION_PROTOCOL,prepareAuthoringCandidate,requireCandidateEnvironment} from './assembly-orchestration.js';

async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function task(client, taskId, { lock = false, writable = true } = {}) {
  uuid(taskId, 'taskId');
  const { rows } = await client.query(`SELECT id, tenant_id, status, claimed_by, payload, result FROM tasks WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [taskId]);
  requireCondition(rows.length > 0, '任务不存在', 404);
  const row = rows[0];
  requireCondition(row.payload?.workflow_authoring === true, '任务未声明 workflow_authoring', 409);
  requireCondition(!row.tenant_id||row.tenant_id===(row.payload?.tenant_id??'default'),'readiness_identity_mismatch',409);
  if (writable) requireWritable(row);
  return row;
}

function requireWritable(row) {
  requireCondition(row.status === 'in_progress', '任务必须处于 in_progress', 409);
  requireCondition(typeof row.claimed_by === 'string' && row.claimed_by.trim().length > 0, '任务必须先认领', 409);
}

async function save(client, taskId, state) {
  await client.query(`UPDATE tasks
    SET result = jsonb_set(COALESCE(result, '{}'::jsonb), '{workflow_authoring}', $2::jsonb, true), updated_at = NOW()
    WHERE id = $1`, [taskId, JSON.stringify(state)]);
}

export async function initializeAuthoring(pool, taskId, request) {
  validateRequest(request);
  return transaction(pool, async client => {
    const row = await task(client, taskId, { lock: true });
    if (row.result?.workflow_authoring) {
      requireCondition(definitionDigest(row.result.workflow_authoring.request) === definitionDigest(request), '任务已使用其他请求初始化', 409);
      return row.result.workflow_authoring;
    }
    const state = { schema_version: 1, revision: 0, stage: 'intake', request, outputs: {}, receipts: [] };
    await save(client, taskId, state);
    return state;
  });
}

export async function getAuthoring(pool, taskId) {
  const row = await task(pool, taskId, { writable: false });
  requireCondition(row.result?.workflow_authoring, '任务尚未初始化 authoring', 404);
  return row.result.workflow_authoring;
}

async function validate(dependency, ...args) {
  requireCondition(typeof dependency === 'function', '缺少阶段验证器', 500);
  const result = await dependency(...args);
  requireCondition(result !== false && result?.valid !== false, '流程定义或引用验证失败');
}

async function completedTask(client, id, tenantId) {
  const { rows } = await client.query("SELECT id, status, result FROM tasks WHERE id = $1 AND COALESCE(tenant_id, 'default') = $2 AND COALESCE(payload->>'tenant_id','default')=$2 FOR SHARE", [id,tenantId]);
  requireCondition(rows[0]?.status === 'completed', `证据任务 ${id} 尚未完成`);
  return rows[0];
}

async function processStage(client, taskId, state, body, deps) {
  const { stage, output } = body;
  validateStageOutput(stage, output);
  if (stage === 'intake') {
    if (state.request.operation === 'update') {
      uuid(output.workflow_id ?? state.request.workflow_id, 'workflow_id');
      if (state.request.workflow_id) requireCondition(!output.workflow_id || output.workflow_id === state.request.workflow_id, '更新目标与请求不一致');
    }
    requireCondition(typeof deps.loadCatalog === 'function', '缺少目录读取器', 500);
    state.catalog = await deps.loadCatalog(client);
    object(state.catalog, 'catalog');
  } else if (stage === 'reuse') {
    const keys = { skill: 'skills', activity: 'activities', workflow: 'workflows' };
    for (const candidate of output.candidates) {
      requireCondition(state.catalog[keys[candidate.kind]]?.some(entry => entry.id === candidate.id), '复用候选不在本次目录中');
    }
  } else if (stage === 'compose') {
    await validate(deps.validateDefinition, output.definition);
    requireCondition(output.definition.capability_id === state.outputs.intake.capability_id, '定义能力与 intake 不一致');
    await validate(deps.validateReferences, client, output.definition, { requireActive: false });
    return { ...output, definition_sha256: definitionDigest(output.definition) };
  } else if (stage === 'build') {
    for (const id of new Set(output.implementation_task_ids)) {
      requireCondition(id !== taskId, '实施任务不能引用管理任务自身');
      await completedTask(client, id,deps.tenantId);
    }
    await validate(deps.validateReferences, client, state.outputs.compose.definition, { requireActive: true });
    if(state.request.execution_protocol===EXECUTION_PROTOCOL){
      const owner=await prepareAuthoringCandidate(client,taskId,state,{freezeProof:deps.freezeProof,tenantId:deps.tenantId});
      return {...output,candidate_owner:owner};
    }
  } else if (stage === 'verify'&&state.request.execution_protocol===EXECUTION_PROTOCOL) {
    const proof=await readAuthoringExecutionProof(client,{authoringTaskId:taskId,tenantId:deps.tenantId},{transactionClient:client});
    requireCondition(proof.status==='verified','execution_evidence_unverified',409);
    const execution=(await client.query('SELECT result FROM tasks WHERE id=$1',[taskId])).rows[0].result.workflow_authoring_execution;
    requireCondition(execution.invocations.some(v=>v.kind==='workflow'&&v.task_id===output.validation_task_id),'candidate_execution_identity_mismatch',409);
    return {...output,proof_sha256:proof.proof_sha256,evidence_refs:proof.evidence.tasks.map(id=>`task:${id}`)};
  } else if (stage === 'verify') {
    requireCondition(output.validation_task_id !== taskId, '验证任务不能引用管理任务自身');
    const row = await completedTask(client, output.validation_task_id,deps.tenantId);
    const result = row.result?.workflow_validation;
    object(result, 'workflow_validation');
    requireCondition(result.verdict === 'PASS', '验证回执必须为 PASS');
    requireCondition(result.definition_sha256 === state.outputs.compose.definition_sha256, '验证定义指纹不匹配');
    text(result.actor, 'validation.actor', 128);
    stringArray(result.evidence_refs, 'validation.evidence_refs');
    stringArray(result.activity_keys, 'validation.activity_keys');
    requireCondition(state.outputs.compose.definition.activities.every(activity => result.activity_keys.includes(activity.key)), '验证未覆盖全部活动');
    return { ...output, validation: result, evidence_refs: result.evidence_refs };
  } else if (stage === 'register'&&state.request.execution_protocol===EXECUTION_PROTOCOL) {
    const proof=await readAuthoringExecutionProof(client,{authoringTaskId:taskId,tenantId:deps.tenantId},{transactionClient:client});
    requireCondition(proof.status==='verified'&&deps.readiness?.status==='verified'&&proof.proof_sha256===deps.readiness.proof_sha256,'implementation_or_authority_changed',409);
    return {test_qualification:{protocol:EXECUTION_PROTOCOL,status:'verified',formal_release:false,tenant_id:deps.tenantId,
      candidate_owner:proof.candidate_owner,definition_sha256:proof.definition_sha256,proof_sha256:proof.proof_sha256,
      input_sha256:definitionDigest(state.request.validation_input),verification_at:proof.verification_at},evidence_refs:proof.evidence.tasks.map(id=>`task:${id}`)};
  } else if (stage === 'register') {
    await validate(deps.validateReferences, client, state.outputs.compose.definition, { requireActive: true });
    requireCondition(typeof deps.registerWorkflow === 'function', '缺少登记器', 500);
    const receipt = await deps.registerWorkflow(client, state.outputs.compose.definition, {
      taskId, expectedVersion: state.request.expected_version,
      definitionSha256: state.outputs.compose.definition_sha256,
      operation: state.request.operation,
      workflowId: state.outputs.intake.workflow_id ?? state.request.workflow_id,
      registrationProtocol: state.request.registration_protocol,
      freezeProof: deps.freezeProof,
      assemblyMode: state.request.assembly_mode,
      tenantId: deps.tenantId,
    });
    object(receipt, '登记回执');
    return receipt;
  }
  return output;
}

export async function submitAuthoring(pool, taskId, body, deps = {}) {
  validateSubmission(body);
  if(body.stage==='build'){
    const state=await getAuthoring(pool,taskId);
    if(state.request.execution_protocol===EXECUTION_PROTOCOL&&!state.receipts.some(r=>r.submission_id===body.submission_id)){
      await requireCandidateEnvironment(pool);
      requireCondition(state.stage===body.stage&&state.revision===body.revision,'build阶段或revision已变化',409);
      deps={...deps,freezeProof:await prepareDefinitionFreeze(state.outputs.compose.definition,{...deps.freezeOptions,
        sharedVersions:(await loadAssemblyCatalog(pool,state.outputs.compose.definition)).activity_versions})};
    }
  }
  // 先只读状态及固定Git来源；进入事务后仍重新校验revision和定义digest，防慢网络期间的并发推进。
  if (body.stage === 'register') {
    const state = await getAuthoring(pool, taskId);
    if(state.request.execution_protocol===EXECUTION_PROTOCOL&&!state.receipts.some(r=>r.submission_id===body.submission_id)){
      const row=await task(pool,taskId,{writable:false});
      const readiness=await readAuthoringReadiness(pool,taskId,{...deps.invocationOptions,tenantId:row.payload?.tenant_id??'default'});
      requireCondition(readiness.status==='verified','execution_readiness_blocked',409);deps={...deps,readiness};
    }
    if (state.request.execution_protocol!==EXECUTION_PROTOCOL&&state.request.registration_protocol === FREEZE_PROTOCOL
      && !state.receipts.some(receipt => receipt.submission_id === body.submission_id)) {
      requireCondition(state.stage === body.stage && state.revision === body.revision, 'register阶段或revision已变化', 409);
      deps = { ...deps, freezeProof: await prepareDefinitionFreeze(state.outputs.compose.definition, {...deps.freezeOptions,sharedVersions:(await loadAssemblyCatalog(pool,state.outputs.compose.definition)).activity_versions}) };
    }
  }
  return transaction(pool, async client => {
    const row = await task(client, taskId, { lock: true, writable: false });
    const state = row.result?.workflow_authoring;
    requireCondition(state, '任务尚未初始化 authoring', 409);
    const digest = definitionDigest(body);
    const previous = state.receipts.find(receipt => receipt.submission_id === body.submission_id);
    if (previous) {
      requireCondition(previous.input_sha256 === digest, 'submission_id 已被不同请求占用', 409);
      return { state, receipt: previous, replayed: true };
    }
    if(deps.internalRevalidation&&row.status==='completed'){
      const owner=await (await import('./assembly-orchestration.js')).readCandidateOwner(client,taskId,state.outputs.compose.definition,row.payload?.tenant_id??'default');
      const request=validateRevalidationRequest(row,owner,row.payload?.tenant_id??'default');
      requireCondition(request&&request.attempt_id===row.result.workflow_authoring_execution?.attempt_id,'revalidation_authority_mismatch',409);
    }else requireWritable(row);
    requireCondition(body.stage === state.stage, `当前阶段是 ${state.stage}`, 409);
    requireCondition(body.revision === state.revision, 'revision 已过期', 409);
    const output = await processStage(client, taskId, state, body, {...deps,tenantId:row.payload?.tenant_id??'default'});
    const receipt = {
      stage: body.stage, revision: state.revision + 1, submission_id: body.submission_id,
      input_sha256: digest, actor: state.request.actor, output,
      evidence_refs: output.evidence_refs ?? [], created_at: new Date().toISOString(),
    };
    state.outputs[body.stage] = output;
    state.receipts.push(receipt);
    state.revision += 1;
    state.stage = STAGES[STAGES.indexOf(body.stage) + 1] ?? 'completed';
    await save(client, taskId, state);
    return { state, receipt, replayed: false };
  });
}
