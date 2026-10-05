import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { DB_DEFAULTS } from '../../db-config.js';
import { likeSource, useStandardNames, withLegacyNames } from '../fixtures/minimum-definition-schema.js';
import { registerWorkflow, registrationDigest } from '../../workflow-authoring/registration.js';
import { createWorkflowAuthoringRouter } from '../../routes/workflow-authoring.js';
import { listWorkflows, readActivityConsumers } from '../../lib/workflow-read-service.js';

let client, schema, definition;
beforeEach(async () => {
  if (!['cecelia_scratch', 'cecelia_test'].includes(DB_DEFAULTS.database)) throw new Error('仅允许隔离验收数据库');
  client = new pg.Client(DB_DEFAULTS); await client.connect();
  schema = `workflow_authoring_${randomUUID().replaceAll('-', '')}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  for (const table of ['journeys','workflows','journey_steps','journey_step_links','workflow_activity_refs','skill_registry','tasks']) {
    await client.query(`CREATE TABLE ${schema}.${likeSource(table)} (LIKE public.${likeSource(table)} INCLUDING ALL)`);
  }
  await client.query(`SET search_path TO ${schema},public`);
  await useStandardNames(client);
  const cap = randomUUID(), skill = randomUUID();
  await client.query(`INSERT INTO journeys(id,name,parent_journey_id,status) VALUES($1,'工作流管理',$2,'active')`, [cap, randomUUID()]);
  await client.query(`INSERT INTO skill_registry(id,name,location,status) VALUES($1,'workflow-authoring','/skills/workflow-authoring/SKILL.md','active')`, [skill]);
  definition = {
    key: 'workflow_authoring', name: '创建与更新工作流', capability_id: cap, channel: 'internal', form: 'openclaw_skill', version: '1.0.0',
    source: { ref: 'cecelia:packages/workflows/skills/workflow-authoring/SKILL.md', revision: 'a'.repeat(40) },
    runtime: { skill_id: skill, entrypoint: 'workflow-authoring' },
    activities: ['intake','reuse','compose','build','verify','register'].map(key => ({
      key, name: key, executor_kind: 'agent', implementation: { kind: 'skill', skill_id: skill, ref: `workflow-authoring#${key}`, version: '1.0.0' }, acceptance: ['有真实结果和证据'],
    })),
  };
});
afterEach(async () => {
  if (client) { await client.query('ROLLBACK'); await client.query('SET search_path TO public'); if (schema) await client.query(`DROP SCHEMA ${schema} CASCADE`); await client.end(); }
});
async function register(d = definition, options = {}) {
  await client.query('BEGIN');
  try {
    const result = await registerWorkflow(client, d, { taskId: randomUUID(), operation: 'create', definitionSha256: registrationDigest(d), ...options });
    // 模拟 store 在同一事务保存真实登记回执；全共享流程没有 owned contract。
    await client.query(`INSERT INTO tasks(id,title,status,payload,result) VALUES($1,'登记回执','completed',
      '{"workflow_authoring":true}',$2::jsonb)`, [result.task_id, JSON.stringify({ workflow_authoring: {
      stage: 'completed', outputs: { register: result },
    } })]);
    await client.query('COMMIT'); return result;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
}
describe('管理流程最终登记：真实 PostgreSQL', () => {
  it('六活动落库，重复登记返回相同ID且不增行', async () => {
    const first = await register(), replay = await register();
    expect(first.workflow_id).toBe(replay.workflow_id);
    expect(first.activity_ids).toHaveLength(6);
    expect((await client.query('SELECT count(*)::int n FROM workflows')).rows[0].n).toBe(1);
    expect((await client.query('SELECT count(*)::int n FROM journey_steps')).rows[0].n).toBe(6);
  });
  it('同版本不同定义拒绝，原定义保留', async () => {
    await register(); definition.activities[0].name = '不同定义';
    await expect(register()).rejects.toMatchObject({ code: 'workflow_version_conflict' });
    expect((await client.query('SELECT a.name FROM journey_steps a JOIN workflow_activity_refs r ON r.activity_id = a.id ORDER BY r.sequence_no')).rows[0].name).toBe('intake');
  });
  it('显式更新比较版本，保留活动身份；过期版本不能覆盖', async () => {
    const old = await register(); definition.version = '1.1.0'; definition.activities[0].name = '澄清需求';
    const opts = { operation: 'update', workflowId: old.workflow_id, expectedVersion: '1.0.0' };
    const next = await register(definition, opts);
    expect(next.activity_ids).toEqual(old.activity_ids);
    definition.version = '1.2.0';
    await expect(register(definition, opts)).rejects.toMatchObject({ code: 'workflow_version_conflict' });
  });
  it('不接管其它能力同key，登记失败零部分写入', async () => {
    const old = await register();
    await client.query('UPDATE workflows SET capability_id=$1 WHERE id=$2', [randomUUID(), old.workflow_id]);
    await expect(register()).rejects.toMatchObject({ code: 'workflow_ownership_conflict' });
    expect((await client.query('SELECT count(*)::int n FROM journey_steps')).rows[0].n).toBe(6);
  });
  it('没有引用底座（位置与顺序只存在流程引用里）一律拒绝登记，保留草案，零写入', async () => {
    await client.query('DROP TABLE workflow_activity_refs');
    await expect(register()).rejects.toMatchObject({ code: 'shared_activity_references_not_ready', status: 409 });
    expect((await client.query('SELECT count(*)::int n FROM workflows')).rows[0].n).toBe(0);
    expect((await client.query('SELECT count(*)::int n FROM journey_steps')).rows[0].n).toBe(0);
  });
  it('新登记的活动不再写 journey_id / step_number，位置全在流程引用里（顺序 = 定义顺序）', async () => {
    const owner = await register();
    const rows = (await client.query('SELECT journey_id, step_number FROM journey_steps')).rows;
    expect(rows).toHaveLength(6);
    expect(rows.every(r => r.journey_id === null && r.step_number === null)).toBe(true);
    const refs = (await client.query('SELECT activity_id, sequence_no FROM workflow_activity_refs WHERE workflow_id = $1 ORDER BY sequence_no', [owner.workflow_id])).rows;
    expect(refs.map(r => r.activity_id)).toEqual(owner.activity_ids);
    expect(refs.map(r => r.sequence_no)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('流程更新版本必须严格递增', async () => {
    const owner = await register(); const changed = structuredClone(definition); changed.version = '0.9.0';
    await expect(register(changed, { operation: 'update', workflowId: owner.workflow_id, expectedVersion: '1.0.0' }))
      .rejects.toMatchObject({ code: 'workflow_version_conflict', status: 409 });
  });
  it('发布前重新检查skill，停用后不能登记active', async () => {
    await client.query(`UPDATE skill_registry SET status='deprecated'`);
    await expect(register()).rejects.toMatchObject({ code: 'skill_not_found' });
    expect((await client.query('SELECT count(*)::int n FROM workflows')).rows[0].n).toBe(0);
  });
  it('真实HTTP逐棒执行六活动：证据缺失停住，登记后SQL回读；重发不重复', async () => {
    const id = randomUUID(), evidenceId = randomUUID();
    await client.query(`INSERT INTO tasks(id,title,status,claimed_by,payload,result) VALUES($1,'工作流创建验收','in_progress','openclaw-test','{"workflow_authoring":true}','{"preserved":true}')`, [id]);
    const db = { query: client.query.bind(client), connect: async () => ({ query: client.query.bind(client), release() {} }) };
    const app = express(); app.use(express.json()); app.use('/authoring', createWorkflowAuthoringRouter({ db }));
    const init = await request(app).post(`/authoring/runs/${id}/init`).send({ operation: 'create', goal: '建立可复用流程', actor: 'openclaw' });
    expect(init.status).toBe(200); expect(init.body.stage).toBe('intake');
    const submit = (stage, revision, output) => request(app).post(`/authoring/runs/${id}/submit`)
      .send({ stage, revision, submission_id: `${id}-${stage}`, output });
    expect((await submit('register', 0, {})).status).toBe(409);
    expect((await submit('intake', 0, { goal:'建立流程', inputs:['目标'], outputs:['工作流'], acceptance:['六阶段有证据'], capability_id:definition.capability_id })).status).toBe(200);
    expect((await submit('reuse', 1, { search_terms:['workflow'], candidates:[{ kind:'skill', id:definition.runtime.skill_id, decision:'reuse', reason:'已有完整执行入口' }] })).status).toBe(200);
    expect((await submit('compose', 2, { definition })).status).toBe(200);
    expect((await submit('build', 3, { implementation_task_ids:[], reuse_only:true, evidence_refs:['已部署skill路径已回读'] })).status).toBe(200);
    expect((await submit('verify', 4, { validation_task_id:evidenceId })).status).toBe(422);
    const validation = { verdict:'PASS', definition_sha256:registrationDigest(definition), actor:'independent-verifier',
      activity_keys:definition.activities.map(a=>a.key), evidence_refs:['scratch:真实六活动执行结果'] };
    await client.query(`INSERT INTO tasks(id,title,status,result) VALUES($1,'独立验收','completed',$2::jsonb)`,[evidenceId,JSON.stringify({workflow_validation:validation})]);
    expect((await submit('verify', 4, { validation_task_id:evidenceId })).status).toBe(200);
    const done = await submit('register', 5, {});
    expect(done.status).toBe(200); expect(done.body.state.stage).toBe('completed');
    expect(done.body.receipt.output.readback_verified).toBe(true);
    const replay = await submit('register', 5, {}); expect(replay.body.replayed).toBe(true);
    expect((await client.query('SELECT count(*)::int n FROM workflows')).rows[0].n).toBe(1);
    const state = (await client.query('SELECT result FROM tasks WHERE id=$1',[id])).rows[0].result;
    expect(state.preserved).toBe(true); expect(state.workflow_authoring.receipts).toHaveLength(6);
  });
});

async function enableSharedReferences() {
  await client.query('DROP TABLE IF EXISTS workflow_activity_refs'); // 夹具默认就带一张按真表复制的引用表；这里换成带外键的手建版
  await client.query(`CREATE TABLE workflow_activity_refs (
    workflow_id uuid NOT NULL REFERENCES workflows(id), slot_key text NOT NULL,
    activity_id uuid NOT NULL REFERENCES activities(id), sequence_no integer NOT NULL CHECK(sequence_no>0),
    source_ref text NOT NULL, source_commit text NOT NULL, active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(workflow_id,slot_key))`);
  await client.query('CREATE UNIQUE INDEX refs_active_sequence ON workflow_activity_refs(workflow_id,sequence_no) WHERE active');
}
async function consumerDefinition(owner) {
  const rows = (await client.query('SELECT id,contract_sha256 FROM journey_steps WHERE workflow_id=$1 ORDER BY step_number', [owner.workflow_id])).rows;
  return { ...structuredClone(definition), key: 'consumer', name: '共享活动消费者',
    activities: definition.activities.map((a, index) => ({ ...structuredClone(a),
      reuse_activity_id: rows[index].id, reuse_contract_sha256: rows[index].contract_sha256 })) };
}
async function registrySnapshot() {
  const result = {};
  for (const table of ['workflows', 'journey_steps', 'workflow_activity_refs']) {
    result[table] = (await client.query(`SELECT to_jsonb(t) AS value FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}
describe('authoring 与真实共享关系和版本底座读模型贯通', () => {
  it('真实迁移后登记、共享复用和重排均保留真身ID及引用ID，读模型返回实际顺序', async () => {
    for (const table of ['spans', 'schema_version', 'steps', 'enablers', 'enabler_calls', 'areas']) {
      await client.query(`CREATE TABLE ${schema}.${likeSource(table)} (LIKE public.${likeSource(table)} INCLUDING ALL)`);
    }
    // 真实迁移仅落隔离 schema，避免解析到 public 的版本表或触发器。
    await client.query(`SET search_path TO ${schema}`);
    await client.query('DROP TABLE IF EXISTS workflow_activity_refs'); // 让 511 迁移自己建这张表
    await withLegacyNames(client, async () => {
      await client.query(readFileSync(new URL('../../../migrations/511_shared_activity_refs.sql', import.meta.url), 'utf8'));
      await client.query(readFileSync(new URL('../../../migrations/513_definition_versions.sql', import.meta.url), 'utf8'));
    });
    const owner = await register();
    const ownerView = (await listWorkflows(client, { id: owner.workflow_id }))[0];
    expect(ownerView.activity_count).toBe(6);
    expect(ownerView.activities.map(a => a.canonical_id)).toEqual(owner.activity_ids);
    expect(ownerView.activities.map(a => a.sequence_no)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await readActivityConsumers(client, owner.activity_ids[0])).toMatchObject([
      { workflow_id: owner.workflow_id, slot_key: 'intake', sequence_no: 1 },
    ]);

    const consumer = await consumerDefinition(owner), used = await register(consumer);
    const before = (await listWorkflows(client, { id: used.workflow_id }))[0];
    expect(before.activities.map(a => a.canonical_id)).toEqual(owner.activity_ids);
    const referenceIds = new Map(before.activities.map(a => [a.slot_key, a.usage.reference_id]));
    expect([...referenceIds.values()].every(id => /^[0-9a-f-]{36}$/.test(id))).toBe(true);
    expect(before.activities.every(a => a.source_ref === definition.source.ref
      && a.source.commit === definition.source.revision && Object.hasOwn(a.source, 'repo')
      && Object.hasOwn(a.source, 'path'))).toBe(true);
    consumer.version = '1.1.0'; consumer.activities.reverse();
    const reordered = await register(consumer, { operation: 'update', workflowId: used.workflow_id, expectedVersion: '1.0.0' });
    const after = (await listWorkflows(client, { id: used.workflow_id }))[0];
    expect(reordered.activity_ids).toEqual([...owner.activity_ids].reverse());
    expect(after.activities.map(a => a.canonical_id)).toEqual(reordered.activity_ids);
    expect(after.activities.map(a => a.sequence_no)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(after.activities.every(a => a.usage.reference_id === referenceIds.get(a.slot_key))).toBe(true);
    const consumers = await readActivityConsumers(client, owner.activity_ids[0]);
    expect(consumers).toHaveLength(2);
    expect(consumers.find(c => c.workflow_id === used.workflow_id)).toMatchObject({ slot_key: 'intake', sequence_no: 6 });
    expect(consumers.find(c => c.workflow_id === owner.workflow_id)).toMatchObject({ slot_key: 'intake', sequence_no: 1 });
    expect((await listWorkflows(client, { id: owner.workflow_id }))[0].activities.map(a => a.canonical_id)).toEqual(owner.activity_ids);
    expect((await client.query('SELECT count(*)::int n FROM journey_steps')).rows[0].n).toBe(6);
  });
});
describe('共享引用真身与消费者合同保护：真实 PostgreSQL', () => {
  beforeEach(enableSharedReferences);
  it('复用只建引用不复制真身；全共享定义重复登记稳定且零改写', async () => {
    const owner = await register(), consumer = await consumerDefinition(owner);
    const first = await register(consumer), before = await registrySnapshot();
    expect(first.activity_ids).toEqual(owner.activity_ids);
    expect((await client.query('SELECT count(*)::int n FROM journey_steps')).rows[0].n).toBe(6);
    const replay = await register(consumer);
    expect(replay).toMatchObject({ workflow_id: first.workflow_id, replayed: true });
    expect(await registrySnapshot()).toEqual(before);
  });
  it('共享合同hash变化后拒绝旧验收，登记全事务零变化', async () => {
    const owner = await register(), consumer = await consumerDefinition(owner);
    await client.query('UPDATE journey_steps SET contract_sha256=$1 WHERE id=$2', ['b'.repeat(64), owner.activity_ids[0]]);
    const before = await registrySnapshot();
    await expect(register(consumer)).rejects.toMatchObject({ code: 'activity_revision_conflict', status: 409 });
    expect(await registrySnapshot()).toEqual(before);
  });
  it('共享活动非active时拒绝复用', async () => {
    const owner = await register(), consumer = await consumerDefinition(owner);
    await client.query("UPDATE journey_steps SET status='pending' WHERE id=$1", [owner.activity_ids[0]]);
    await expect(register(consumer)).rejects.toMatchObject({ code: 'activity_not_ready', status: 409 });
  });
  it('回读验证有序ID，等量错序也拒绝且不修写真身', async () => {
    const owner = await register();
    await client.query('UPDATE workflow_activity_refs SET active=false WHERE workflow_id=$1', [owner.workflow_id]);
    await client.query('UPDATE workflow_activity_refs SET sequence_no=7-sequence_no,active=true WHERE workflow_id=$1', [owner.workflow_id]);
    const before = await registrySnapshot();
    await expect(register()).rejects.toMatchObject({ code: 'registration_readback_failed', status: 409 });
    expect(await registrySnapshot()).toEqual(before);
  });
  it.each(['change', 'remove'])('owner %s 已被其它workflow引用活动时拒绝且零变化', async mode => {
    const owner = await register(); await register(await consumerDefinition(owner));
    const before = await registrySnapshot();
    const changed = structuredClone(definition); changed.version = '1.1.0';
    if (mode === 'change') changed.activities[0].acceptance = ['不同合同'];
    else changed.activities.shift();
    await expect(register(changed, { operation: 'update', workflowId: owner.workflow_id, expectedVersion: '1.0.0' }))
      .rejects.toMatchObject({ code: 'activity_consumers_require_validation', status: 409 });
    expect(await registrySnapshot()).toEqual(before);
  });
  it('owner 同定义重登记不修改合同；重排仅更新引用顺序', async () => {
    const owner = await register(); await register(await consumerDefinition(owner));
    const before = await registrySnapshot();
    await register(); expect(await registrySnapshot()).toEqual(before);
    const changed = structuredClone(definition); changed.version = '1.1.0'; changed.activities.reverse();
    const next = await register(changed, { operation: 'update', workflowId: owner.workflow_id, expectedVersion: '1.0.0' });
    expect(next.activity_ids).toEqual([...owner.activity_ids].reverse());
    const ordered = (await client.query('SELECT activity_id FROM workflow_activity_refs WHERE workflow_id=$1 AND active ORDER BY sequence_no', [owner.workflow_id])).rows;
    expect(ordered.map(row => row.activity_id)).toEqual(next.activity_ids);
    expect((await registrySnapshot()).journey_steps).toEqual(before.journey_steps);
  });
  it('跨能力消费者登记持有共享锁，owner必须看到提交后的consumer再拒绝修改', async () => {
    const owner = await register(), consumer = await consumerDefinition(owner);
    consumer.capability_id = randomUUID();
    await client.query(`INSERT INTO journeys(id,name,parent_journey_id,status) VALUES($1,'另一个能力',$2,'active')`, [consumer.capability_id, randomUUID()]);
    const concurrent = new pg.Client(DB_DEFAULTS); await concurrent.connect();
    let pending;
    try {
      await concurrent.query(`SET search_path TO ${schema},public`);
      const pid = (await concurrent.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await client.query('BEGIN');
      await registerWorkflow(client, consumer, { taskId: randomUUID(), operation: 'create', definitionSha256: registrationDigest(consumer) });
      await concurrent.query('BEGIN');
      const changed = structuredClone(definition); changed.version = '1.1.0'; changed.activities[0].acceptance = ['变更'];
      pending = registerWorkflow(concurrent, changed, { taskId: randomUUID(), operation: 'update',
        workflowId: owner.workflow_id, expectedVersion: '1.0.0', definitionSha256: registrationDigest(changed) }).then(
        value => ({ value }), error => ({ error }));
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const state = (await client.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])).rows[0];
        if (state?.wait_event_type === 'Lock') { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await client.query('COMMIT');
      expect((await pending).error).toMatchObject({ code: 'activity_consumers_require_validation', status: 409 });
      expect((await client.query('SELECT version FROM workflows WHERE id=$1', [owner.workflow_id])).rows[0].version).toBe('1.0.0');
    } finally {
      await client.query('ROLLBACK');
      if (pending) await pending;
      await concurrent.query('ROLLBACK'); await concurrent.end();
    }
  });
});
