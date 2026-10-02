import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeAuthoring, getAuthoring, submitAuthoring } from './store.js';
import { definitionDigest } from './contracts.js';

const ID = '11111111-1111-4111-8111-111111111111';
const CAP = '22222222-2222-4222-8222-222222222222';
const WORK = '33333333-3333-4333-8333-333333333333';
const VALID = '44444444-4444-4444-8444-444444444444';
const request = { operation: 'create', goal: '生成可复用流程', actor: 'openclaw' };
const definition = { name: '示例', capability_id: CAP, activities: [{ key: 'collect' }, { key: 'publish' }] };
const intake = { goal: '生成可复用流程', inputs: ['素材'], outputs: ['成品'], acceptance: ['成品可查'], capability_id: CAP };

// SQL 边界替身保留事务快照；真实 PostgreSQL 的隔离/SQL 由集成测试覆盖。
function database() {
  let rows = new Map([[ID, { id: ID, status: 'in_progress', claimed_by: 'openclaw', payload: { workflow_authoring: true }, result: { unrelated: 42 } }]]);
  let snapshot;
  const queries = [];
  const query = vi.fn(async (sql, args = []) => {
    queries.push(sql);
    if (sql === 'BEGIN') { snapshot = structuredClone(rows); return { rows: [] }; }
    if (sql === 'ROLLBACK') { rows = snapshot; return { rows: [] }; }
    if (sql === 'COMMIT') return { rows: [] };
    if (/^SELECT/i.test(sql.trim())) return { rows: rows.has(args[0]) ? [structuredClone(rows.get(args[0]))] : [] };
    if (/UPDATE tasks/i.test(sql)) {
      const id = args.find(value => rows.has(value));
      const encoded = args.find(value => typeof value === 'string' && value.startsWith('{'));
      const value = JSON.parse(encoded);
      const row = rows.get(id);
      row.result = /jsonb_set/.test(sql) ? { ...row.result, workflow_authoring: value } : value;
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    throw new Error(`未识别测试 SQL：${sql}`);
  });
  const release = vi.fn();
  return { query, queries, connect: async () => ({ query, release }),
    row: id => rows.get(id), add: row => rows.set(row.id, row), release };
}

describe('workflow authoring 六阶段事务状态机', () => {
  let pool, deps;
  beforeEach(() => {
    pool = database();
    deps = {
      loadCatalog: vi.fn(async () => ({ skills: [{ id: CAP }], activities: [], workflows: [] })),
      validateDefinition: vi.fn(() => ({ valid: true })),
      validateReferences: vi.fn(async () => ({ valid: true })),
      registerWorkflow: vi.fn(async () => ({ workflow_id: WORK, version: 1 })),
    };
  });
  async function submit(stage, revision, output, submission_id = `${stage}-1`) {
    return submitAuthoring(pool, ID, { stage, revision, output, submission_id }, deps);
  }
  async function through(stage = 'compose') {
    await initializeAuthoring(pool, ID, request);
    await submit('intake', 0, intake);
    if (stage === 'intake') return;
    await submit('reuse', 1, { search_terms: ['收集'], candidates: [], no_match_reason: '未找到匹配实现' });
    if (stage === 'reuse') return;
    await submit('compose', 2, { definition });
    if (stage === 'compose') return;
    await submit('build', 3, { implementation_task_ids: [], reuse_only: true, evidence_refs: ['git:abc'] });
  }
  function validation(patch = {}, status = 'completed') {
    pool.add({ id: VALID, status, result: { workflow_validation: {
      verdict: 'PASS', definition_sha256: definitionDigest(definition),
      evidence_refs: ['artifact:passed'], activity_keys: ['collect', 'publish'], actor: 'validator', ...patch,
    } } });
  }
  it('初始化幂等、行锁事务，并保留 result 其他键', async () => {
    const state = await initializeAuthoring(pool, ID, request);
    expect(state).toMatchObject({ schema_version: 1, revision: 0, stage: 'intake', request, outputs: {}, receipts: [] });
    expect(await initializeAuthoring(pool, ID, request)).toEqual(state);
    await expect(initializeAuthoring(pool, ID, { ...request, goal: '另一目标' })).rejects.toMatchObject({ status: 409 });
    expect(pool.row(ID).result.unrelated).toBe(42);
    expect(pool.queries.some(sql => /FOR UPDATE/.test(sql))).toBe(true);
    expect(await getAuthoring(pool, ID)).toEqual(state);
  });
  it.each([{ payload: {} }, { status: 'queued' }, { status: 'completed' }, { claimed_by: null }, { claimed_by: '' }, { claimed_by: '  ' }])('拒绝非受管执行任务 %j', async patch => {
    Object.assign(pool.row(ID), patch);
    await expect(initializeAuthoring(pool, ID, request)).rejects.toThrow();
    expect(pool.row(ID).result.workflow_authoring).toBeUndefined();
  });
  it('拒绝错阶段与过期版本且不推进', async () => {
    await initializeAuthoring(pool, ID, request);
    await expect(submit('build', 0, {})).rejects.toMatchObject({ status: 409 });
    await expect(submit('intake', 1, intake)).rejects.toMatchObject({ status: 409 });
    expect((await getAuthoring(pool, ID)).revision).toBe(0);
  });
  it('相同提交返回原回执，篡改同名提交冲突', async () => {
    await initializeAuthoring(pool, ID, request);
    const first = await submit('intake', 0, intake);
    const retry = await submit('intake', 0, intake);
    expect(retry.receipt).toEqual(first.receipt);
    expect(retry.replayed).toBe(true);
    expect(first.receipt).toMatchObject({ actor: 'openclaw', stage: 'intake', submission_id: 'intake-1' });
    await expect(submit('intake', 0, { ...intake, goal: '新目标' })).rejects.toMatchObject({ status: 409 });
    expect(deps.loadCatalog).toHaveBeenCalledTimes(1);
  });
  it('intake 缺少验收证据不推进，成功后固化能力目录', async () => {
    await initializeAuthoring(pool, ID, request);
    await expect(submit('intake', 0, { ...intake, acceptance: [] })).rejects.toThrow();
    expect((await getAuthoring(pool, ID)).revision).toBe(0);
    await submit('intake', 0, intake);
    expect((await getAuthoring(pool, ID)).catalog.skills).toEqual([{ id: CAP }]);
  });
  it('reuse 候选必须来自真实目录，无候选必须写明原因', async () => {
    await through('intake');
    await expect(submit('reuse', 1, { search_terms: ['a'], candidates: [] })).rejects.toThrow();
    await expect(submit('reuse', 1, { search_terms: ['a'], candidates: [{ kind: 'skill', id: WORK, decision: 'reuse', reason: '匹配' }] })).rejects.toThrow();
    await submit('reuse', 1, { search_terms: ['a'], candidates: [{ kind: 'skill', id: CAP, decision: 'reuse', reason: '匹配' }] });
    expect((await getAuthoring(pool, ID)).stage).toBe('compose');
  });
  it('compose 拒绝定义和引用验证失败', async () => {
    await through('reuse');
    deps.validateDefinition.mockReturnValueOnce({ valid: false, errors: ['缺活动'] });
    await expect(submit('compose', 2, { definition })).rejects.toThrow();
    deps.validateReferences.mockResolvedValueOnce(false);
    await expect(submit('compose', 2, { definition })).rejects.toThrow();
    expect((await getAuthoring(pool, ID)).stage).toBe('compose');
  });
  it('compose 固化定义指纹并拒绝跨 capability 组合', async () => {
    await through('reuse');
    await expect(submit('compose', 2, { definition: { ...definition, capability_id: WORK } })).rejects.toThrow();
    const result = await submit('compose', 2, { definition });
    expect(result.state.outputs.compose.definition_sha256).toBe(definitionDigest(definition));
    expect(deps.validateReferences).toHaveBeenLastCalledWith(expect.anything(), definition, { requireActive: false });
  });
  it('build 再查引用有效性，planned 实现不算已完成', async () => {
    await through();
    deps.validateReferences.mockRejectedValueOnce(new Error('skill 尚未 active'));
    await expect(submit('build', 3, { implementation_task_ids: [], reuse_only: true, evidence_refs: ['ref:a'] })).rejects.toThrow('skill 尚未 active');
    expect(deps.validateReferences).toHaveBeenLastCalledWith(expect.anything(), definition, { requireActive: true });
    expect((await getAuthoring(pool, ID)).stage).toBe('build');
  });
  it('update 必须定位原流程，并把乐观版本与目标交给登记器', async () => {
    await initializeAuthoring(pool, ID, { ...request, operation: 'update', expected_version: '1.0.0' });
    await expect(submit('intake', 0, intake)).rejects.toThrow();
    await submit('intake', 0, { ...intake, workflow_id: WORK });
    await submit('reuse', 1, { search_terms: ['a'], candidates: [], no_match_reason: '无匹配' });
    await submit('compose', 2, { definition });
    await submit('build', 3, { implementation_task_ids: [], reuse_only: true, evidence_refs: ['ref:a'] });
    validation();
    await submit('verify', 4, { validation_task_id: VALID });
    await submit('register', 5, {});
    expect(deps.registerWorkflow).toHaveBeenLastCalledWith(expect.anything(), definition, expect.objectContaining({ operation: 'update', workflowId: WORK, expectedVersion: '1.0.0' }));
  });
  it('build 要求完成的实施任务和证据，不能修改已组合定义', async () => {
    await through();
    const build = { implementation_task_ids: [WORK], reuse_only: false, evidence_refs: ['git:a'] };
    pool.add({ id: WORK, status: 'failed' });
    await expect(submit('build', 3, build)).rejects.toThrow();
    pool.row(WORK).status = 'completed';
    await expect(submit('build', 3, { ...build, evidence_refs: [] })).rejects.toThrow();
    await expect(submit('build', 3, { ...build, definition })).rejects.toThrow();
    await submit('build', 3, build);
    expect((await getAuthoring(pool, ID)).stage).toBe('verify');
  });
  it.each([
    { definition_sha256: 'wrong' }, { activity_keys: ['collect'] },
    { evidence_refs: [] }, { actor: '' }, { verdict: 'FAIL' },
  ])('verify 拒绝不完整或不匹配的验证回执 %j', async patch => {
    await through('build');
    validation(patch);
    await expect(submit('verify', 4, { validation_task_id: VALID })).rejects.toThrow();
    expect((await getAuthoring(pool, ID)).stage).toBe('verify');
  });
  it('verify 拒绝未完成任务及自身任务', async () => {
    await through('build');
    validation({}, 'in_progress');
    await expect(submit('verify', 4, { validation_task_id: VALID })).rejects.toThrow();
    await expect(submit('verify', 4, { validation_task_id: ID })).rejects.toThrow();
  });
  it('登记失败事务回滚；成功以真实回执结束且不改变 tasks 终态', async () => {
    await through('build');
    validation();
    await submit('verify', 4, { validation_task_id: VALID });
    deps.registerWorkflow.mockRejectedValueOnce(new Error('登记写入失败'));
    await expect(submit('register', 5, {})).rejects.toThrow('登记写入失败');
    expect((await getAuthoring(pool, ID)).stage).toBe('register');
    const done = await submit('register', 5, {});
    expect(done.state).toMatchObject({ stage: 'completed', revision: 6, outputs: { register: { workflow_id: WORK, version: 1 } } });
    expect(pool.row(ID).status).toBe('in_progress');
    expect(pool.row(ID).result.unrelated).toBe(42);
    expect((await submit('register', 5, {})).replayed).toBe(true);
    expect(deps.registerWorkflow).toHaveBeenCalledTimes(2);
  });
  it('已完成管理任务允许相同提交回读，但拒绝新提交且 result 不变', async () => {
    await initializeAuthoring(pool, ID, request);
    const first = await submit('intake', 0, intake);
    pool.row(ID).status = 'completed';
    const before = structuredClone(pool.row(ID));
    const retry = await submit('intake', 0, intake);
    expect(retry.receipt).toEqual(first.receipt);
    expect(retry.replayed).toBe(true);
    await expect(submit('reuse', 1, { search_terms: ['a'], candidates: [], no_match_reason: '无' })).rejects.toMatchObject({ status: 409 });
    expect(pool.row(ID)).toEqual(before);
  });
  it('完成初始化后失去认领的任务不能推进，回滚不修改 result', async () => {
    await initializeAuthoring(pool, ID, request);
    pool.row(ID).claimed_by = null;
    const before = structuredClone(pool.row(ID));
    await expect(submit('intake', 0, intake)).rejects.toMatchObject({ status: 409 });
    expect(pool.row(ID)).toEqual(before);
    expect(pool.queries.at(-1)).toBe('ROLLBACK');
  });
});
