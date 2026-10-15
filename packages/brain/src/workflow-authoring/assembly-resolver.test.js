import { describe, expect, it, vi } from 'vitest';
import { resolveAuthoringAssembly } from './assembly-resolver.js';

const taskId = '11111111-1111-4111-8111-111111111111';
const activityId = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
const skillId = '44444444-4444-4444-8444-444444444444';
const itemId = '55555555-5555-4555-8555-555555555555';
const schema = field => ({ type: 'object', properties: { [field]: { type: 'string' } }, required: [field] });
const source = { repo: 'perfectuser21/cecelia', ref: 'contracts/report.json', revision: 'a'.repeat(40) };

function setup() {
  const definition = { key: 'report', source, input_schema: schema('topic'), output_schema: schema('report'),
    activities: [{ key: 'draft', reuse_activity_id: activityId, reuse_activity_definition_version_id: versionId }] };
  const task = { id: taskId, payload: { tenant_id: 'company-a', workflow_authoring: true },
    result: { workflow_authoring: { outputs: { compose: { definition } } } } };
  const contract = { executor_kind: 'agent', input_schema: schema('topic'), output_schema: schema('report'),
    implementation: { kind: 'skill', skill_id: skillId, repo: source.repo, path: 'report/SKILL.md', revision: 'contract' },
    runtime: { transport: 'openclaw-agent' }, acceptance: ['报告可读'], warehouse_dependencies: [{ key: 'renderer' }] };
  const client = { query: vi.fn(async sql => {
    if (sql.includes('FROM tasks')) return { rows: [task] };
    if (sql.includes('FROM activity_definition_versions')) return { rows: [{ id: versionId, activity_id: activityId,
      payload: { activity_id: activityId, contract }, source_repo: source.repo, source_path: source.ref, source_commit: source.revision }] };
    if (sql.includes('FROM skill_registry')) return { rows: [{ id: skillId, status: 'active' }] };
    if (sql.includes('FROM warehouse_items')) return { rows: [{ id: itemId, key: 'renderer', active: true }] };
    return { rows: [] };
  }), release: vi.fn() };
  return { definition, task, client, pool: { connect: vi.fn(async () => client) } };
}

describe('服务器保存定义的装配解析', () => {
  it('读取共享固定版本及其Skill与用料，真实编译结果不授予调用资格', async () => {
    const { pool, client } = setup();
    const { task_id, plan } = await resolveAuthoringAssembly(pool, taskId, 'company-a');
    expect(task_id).toBe(taskId);
    expect(plan).toMatchObject({ structurally_complete: true, readiness: 'unverified', callable: false });
    expect(plan.activities[0]).toMatchObject({ activity_id: activityId, definition_version_id: versionId,
      input_mapping: { topic: '$input.topic' }, implementation: { skill_id: skillId, revision: source.revision },
      warehouse_dependencies: [{ item_id: itemId, key: 'renderer', role: 'uses' }] });
    expect(client.query.mock.calls.find(([sql]) => sql.includes('FROM activity_definition_versions'))[1]).toEqual([[versionId]]);
    expect(client.query.mock.calls.find(([sql]) => sql.includes('FROM skill_registry'))[1]).toEqual([[skillId]]);
    expect(client.query.mock.calls.find(([sql]) => sql.includes('FROM warehouse_items'))[1]).toEqual([['renderer']]);
    expect(client.query.mock.calls.at(-1)[0]).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('跨租户任务拒绝后不读取目录，并回滚释放连接', async () => {
    const { pool, client } = setup();
    await expect(resolveAuthoringAssembly(pool, taskId, 'company-b')).rejects.toMatchObject({ status: 404 });
    expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
      'BEGIN READ ONLY', 'SELECT id,payload,result FROM tasks WHERE id=$1', 'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('非法固定版本身份在任何目录查询前拒绝', async () => {
    const { pool, client, definition } = setup();
    definition.activities[0].reuse_activity_definition_version_id = 'current';
    await expect(resolveAuthoringAssembly(pool, taskId, 'company-a')).rejects.toMatchObject({ status: 422 });
    expect(client.query.mock.calls.some(([sql]) => sql.includes('FROM activity_definition_versions'))).toBe(false);
    expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('目录读取失败保留原错误，回滚失败也必须释放连接', async () => {
    const { pool, client } = setup();
    const query = client.query.getMockImplementation(), failure = new Error('catalog unavailable');
    client.query.mockImplementation(async (...args) => {
      if (args[0].includes('FROM warehouse_items') || args[0] === 'ROLLBACK') throw failure;
      return query(...args);
    });
    await expect(resolveAuthoringAssembly(pool, taskId, 'company-a')).rejects.toBe(failure);
    expect(client.query.mock.calls.at(-1)[0]).toBe('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
