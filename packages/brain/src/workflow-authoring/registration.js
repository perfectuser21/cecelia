import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z][a-z0-9_.-]{0,99}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function registrationError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status, statusCode: status });
}
function requireValue(ok, message) {
  if (!ok) throw registrationError('invalid_workflow_definition', message, 400);
}
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
export function canonicalDefinition(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalDefinition).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalDefinition(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const registrationDigest = value => createHash('sha256').update(canonicalDefinition(value)).digest('hex');

export function validateDefinition(d) {
  requireValue(d && typeof d === 'object', '缺少 workflow 定义');
  requireValue(KEY.test(d.key) && text(d.name) && d.name.length <= 200, '名称或稳定 key 非法');
  requireValue(UUID.test(d.capability_id), '缺少所属能力 UUID');
  requireValue(text(d.channel) && text(d.form) && SEMVER.test(d.version), '缺少渠道、形态或语义版本');
  requireValue(text(d.source?.ref) && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(d.source?.revision), '来源必须固定到 commit 或内容 SHA256');
  requireValue(UUID.test(d.runtime?.skill_id) && text(d.runtime?.entrypoint), '缺少已登记的 OpenClaw 调用入口');
  requireValue(Array.isArray(d.activities) && d.activities.length > 0 && d.activities.length <= 100, '骨干活动数量必须为1至100');
  const keys = new Set();
  for (const a of d.activities) {
    requireValue(KEY.test(a.key) && !keys.has(a.key) && text(a.name) && a.name.length <= 200, '活动 key 重复或名称非法'); keys.add(a.key);
    requireValue(['agent', 'code', 'human'].includes(a.executor_kind), '活动执行者非法');
    requireValue(Array.isArray(a.acceptance) && a.acceptance.length > 0 && a.acceptance.every(text), '每个活动必须有验收标准');
    requireValue(['skill', 'code', 'human'].includes(a.implementation?.kind) && text(a.implementation.ref) && text(a.implementation.version), '每个活动必须绑定具体实现和版本');
    if (a.implementation.kind === 'skill') requireValue(UUID.test(a.implementation.skill_id), 'Skill 引用必须是 UUID');
    if (a.reuse_activity_id !== undefined) requireValue(UUID.test(a.reuse_activity_id), '共享活动引用必须是 UUID');
  }
  requireValue(Buffer.byteLength(JSON.stringify(d)) <= 150000, '定义过大');
  return true;
}

export async function validateReferences(client, definition, { requireActive = false } = {}) {
  validateDefinition(definition);
  const capability = (await client.query('SELECT id,parent_journey_id,status FROM journeys WHERE id=$1', [definition.capability_id])).rows[0];
  if (!capability?.parent_journey_id || capability.status !== 'active') throw registrationError('capability_not_ready', '所属能力不存在、非活动状态或缺少父价值流');
  const ids = [...new Set([definition.runtime.skill_id, ...definition.activities.filter(a => a.implementation.kind === 'skill').map(a => a.implementation.skill_id)])];
  const skills = (await client.query('SELECT id,name,status,location FROM skill_registry WHERE id=ANY($1::uuid[])', [ids])).rows;
  for (const id of ids) {
    const skill = skills.find(s => s.id === id);
    if (!skill || !['planned', 'active'].includes(skill.status)) throw registrationError('skill_not_found', `Skill 不可引用: ${id}`);
    if (requireActive && (skill.status !== 'active' || !text(skill.location) || skill.location === 'unverified')) throw registrationError('skill_not_ready', `Skill 未就绪: ${id}`);
  }
  for (const activity of definition.activities.filter(a => a.reuse_activity_id)) {
    const row = (await client.query('SELECT id,status,contract_sha256 FROM activities WHERE id=$1 FOR SHARE', [activity.reuse_activity_id])).rows[0];
    if (!row || row.status !== 'active') throw registrationError('activity_not_ready', `共享活动不可用: ${activity.reuse_activity_id}`);
    if (!activity.reuse_contract_sha256 || activity.reuse_contract_sha256 !== row.contract_sha256) throw registrationError('activity_revision_conflict', '共享活动定义已变化，需重新查找与验收');
  }
  return true;
}

async function sharedReferencesAvailable(client) {
  const result = await client.query(`SELECT EXISTS(SELECT 1 FROM information_schema.tables
    WHERE table_schema=current_schema() AND table_name='workflow_activity_refs') AS ready`);
  return result.rows[0].ready;
}

function activityContract(definition, activity) {
  return { ...activity, workflow_authoring: {
    workflow_key: definition.key,
    source: definition.source, runtime: definition.runtime,
  } };
}

function sameActivityContract(existing, proposed) {
  if (!existing) return false;
  // 兼容旧合同；流程整体版本/顺序不属于共享活动自身合同。
  const { order: _order, workflow_authoring: authoring, ...activity } = existing;
  const { definition_sha256: _digest, ...metadata } = authoring ?? {};
  return registrationDigest({ ...activity, workflow_authoring: metadata }) === registrationDigest(proposed);
}

function versionIncreases(next, previous) {
  if (!SEMVER.test(previous)) return false;
  const a = next.split('.').map(BigInt), b = previous.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

async function hasRegistrationReceipt(client, workflow, digest) {
  const result = await client.query(`SELECT 1 FROM tasks WHERE
    payload->>'workflow_authoring'='true' AND
    result->'workflow_authoring'->'outputs'->'register'->>'workflow_id'=$1 AND
    result->'workflow_authoring'->'outputs'->'register'->>'version'=$2 AND
    result->'workflow_authoring'->'outputs'->'register'->>'definition_sha256'=$3 LIMIT 1`,
  [workflow.id, workflow.version, digest]);
  return result.rows.length > 0;
}

async function guardConsumers(client, workflow, definition, existing) {
  for (const old of existing) {
    const incoming = definition.activities.find(a => !a.reuse_activity_id && `${definition.key}.${a.key}` === old.activity_key);
    if (incoming && sameActivityContract(old.contract, activityContract(definition, incoming))) continue;
    const consumers = (await client.query(`SELECT workflow_id FROM workflow_activity_refs
      WHERE activity_id=$1 AND workflow_id<>$2 AND active LIMIT 1`, [old.id, workflow.id])).rows;
    if (consumers.length) throw registrationError('activity_consumers_require_validation',
      `活动 ${old.activity_key} 被其它工作流引用，修改或弃用需要消费者重新验收`);
  }
}

async function registrationReceipt(client, workflow, definition, options, shared, activityIds, replayed) {
  const stored = (await client.query('SELECT id,key,version,status FROM workflows WHERE id=$1', [workflow.id])).rows[0];
  const actualIds = (shared
    ? (await client.query('SELECT activity_id AS id FROM workflow_activity_refs WHERE workflow_id=$1 AND active ORDER BY sequence_no', [workflow.id])).rows
    : (await client.query("SELECT id FROM activities WHERE workflow_id=$1 AND status='active' ORDER BY step_number", [workflow.id])).rows).map(row => row.id);
  if (canonicalDefinition(actualIds) !== canonicalDefinition(activityIds) || stored.version !== definition.version) {
    throw registrationError('registration_readback_failed', '登记回读的有序活动与定义不一致');
  }
  return { workflow_id: stored.id, key: stored.key, version: stored.version, status: stored.status,
    definition_sha256: registrationDigest(definition), activity_ids: actualIds, task_id: options.taskId,
    runtime: definition.runtime, readback_verified: true, replayed };
}

// 调用者必须持有事务：定义、引用和阶段回执一起提交，失败一起回滚。
export async function registerWorkflow(client, definition, options = {}) {
  validateDefinition(definition);
  const digest = registrationDigest(definition);
  if (options.definitionSha256 !== digest) throw registrationError('definition_digest_conflict', '登记定义与已验收定义不一致');
  // capability锁同时保护遗留(journey_id,step_number)唯一性；不重编号其它流程。
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`workflow-authoring:${definition.capability_id}`]);
  await validateReferences(client, definition, { requireActive: true });
  let workflow = (await client.query('SELECT * FROM workflows WHERE key=$1 FOR UPDATE', [definition.key])).rows[0];
  if (workflow && (workflow.capability_id !== definition.capability_id || workflow.channel !== definition.channel || workflow.form !== definition.form)) {
    throw registrationError('workflow_ownership_conflict', '同 key 已属于其它能力、渠道或执行形态');
  }
  if (options.operation === 'update' && (!workflow || workflow.id !== options.workflowId)) throw registrationError('workflow_ownership_conflict', '更新目标与稳定 key 不一致');
  const shared = await sharedReferencesAvailable(client);
  if (!shared && definition.activities.some(a => a.reuse_activity_id)) throw registrationError('shared_activity_references_not_ready', '共享活动引用底座尚未部署；保留草案，不复制共享真身');
  const existing = workflow ? (await client.query('SELECT * FROM activities WHERE workflow_id=$1 ORDER BY step_number FOR UPDATE', [workflow.id])).rows : [];
  const sameDefinition = workflow && (await hasRegistrationReceipt(client, workflow, digest)
    || existing.some(a => a.contract?.workflow_authoring?.definition_sha256 === digest));
  if (workflow && workflow.version === definition.version) {
    if (!sameDefinition) throw registrationError('workflow_version_conflict', '同版本对应不同定义，必须重新验收并升级版本');
  } else if (workflow) {
    if (options.operation !== 'update' || options.expectedVersion !== workflow.version) throw registrationError('workflow_version_conflict', '当前版本已变化或未声明预期版本');
    if (!versionIncreases(definition.version, workflow.version)) throw registrationError('workflow_version_conflict', '更新版本必须严格递增');
    if (existing.some(a => a.contract?.workflow_authoring?.workflow_key !== definition.key)) throw registrationError('workflow_ownership_conflict', '该工作流由其它登记源维护，不能覆盖');
    const incomingKeys = definition.activities.filter(a => !a.reuse_activity_id).map(a => `${definition.key}.${a.key}`);
    const remaining = existing.filter(a => incomingKeys.includes(a.activity_key)).map(a => a.activity_key);
    const actualOrder = [...remaining, ...incomingKeys.filter(key => !remaining.includes(key))];
    if (!shared && actualOrder.join('|') !== incomingKeys.join('|')) throw registrationError('shared_activity_references_not_ready', '活动重排或中间插入需要有序引用底座');
  }
  if (sameDefinition) {
    const ids = definition.activities.map(a => a.reuse_activity_id ?? existing.find(old => old.activity_key === `${definition.key}.${a.key}`)?.id);
    return registrationReceipt(client, workflow, definition, options, shared, ids, true);
  }
  if (workflow && shared) await guardConsumers(client, workflow, definition, existing);
  if (!workflow) {
    workflow = (await client.query(`INSERT INTO workflows(key,name,capability_id,channel,form,version,status)
      VALUES($1,$2,$3,$4,$5,$6,'active') RETURNING *`,
    [definition.key,definition.name,definition.capability_id,definition.channel,definition.form,definition.version])).rows[0];
  } else if (!sameDefinition) {
    workflow = (await client.query(`UPDATE workflows SET name=$2,version=$3,status='active',updated_at=NOW() WHERE id=$1 RETURNING *`,
      [workflow.id,definition.name,definition.version])).rows[0];
  }
  if (shared) await client.query('UPDATE workflow_activity_refs SET active=false WHERE workflow_id=$1', [workflow.id]);
  let nextNumber = Number((await client.query('SELECT COALESCE(MAX(step_number),0)+1 AS n FROM activities WHERE journey_id=$1', [definition.capability_id])).rows[0].n);
  const activityIds = [], ownedKeys = [];
  for (const [index, activity] of definition.activities.entries()) {
    let activityId = activity.reuse_activity_id;
    if (!activityId) {
      const key = `${definition.key}.${activity.key}`, contract = activityContract(definition, activity);
      ownedKeys.push(key);
      const old = existing.find(a => a.activity_key === key);
      if (old?.status === 'active' && sameActivityContract(old.contract, contract)) {
        activityId = old.id;
      } else {
        const result = await client.query(`INSERT INTO activities(journey_id,name,description,step_number,status,
        capability_key,activity_key,backbone_version,workflow_id,executor_kind,contract,contract_sha256,contract_source)
        VALUES($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
        ON CONFLICT(journey_id,activity_key) WHERE activity_key IS NOT NULL DO UPDATE SET
          name=EXCLUDED.name,description=EXCLUDED.description,status='active',backbone_version=EXCLUDED.backbone_version,
          executor_kind=EXCLUDED.executor_kind,contract=EXCLUDED.contract,contract_sha256=EXCLUDED.contract_sha256,
          contract_source=EXCLUDED.contract_source,notion_synced_at=NULL,updated_at=NOW()
        WHERE activities.workflow_id=EXCLUDED.workflow_id RETURNING id`,
      [definition.capability_id,activity.name,activity.implementation.ref,old?.step_number ?? nextNumber++,definition.key,key,
        definition.version,workflow.id,activity.executor_kind,JSON.stringify(contract),registrationDigest(contract),`${definition.source.ref}@${definition.source.revision}`]);
        if (!result.rows.length) throw registrationError('activity_ownership_conflict', '活动归属冲突');
        activityId = result.rows[0].id;
      }
    }
    activityIds.push(activityId);
    if (shared) await client.query(`INSERT INTO workflow_activity_refs(workflow_id,slot_key,activity_id,sequence_no,source_ref,source_commit,active)
      VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT(workflow_id,slot_key) DO UPDATE SET
      activity_id=EXCLUDED.activity_id,sequence_no=EXCLUDED.sequence_no,source_ref=EXCLUDED.source_ref,
      source_commit=EXCLUDED.source_commit,active=true,updated_at=NOW()`,
    [workflow.id,activity.key,activityId,index+1,definition.source.ref,definition.source.revision]);
  }
  await client.query(`UPDATE activities SET status='deprecated',notion_synced_at=NULL,updated_at=NOW()
    WHERE workflow_id=$1 AND status<>'deprecated' AND NOT(activity_key=ANY($2::text[])) AND contract->'workflow_authoring'->>'workflow_key'=$3`,
  [workflow.id,ownedKeys,definition.key]);
  return registrationReceipt(client, workflow, definition, options, shared, activityIds, false);
}
