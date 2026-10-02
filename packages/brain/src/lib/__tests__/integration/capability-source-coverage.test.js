import { beforeEach, afterEach, expect, it } from 'vitest';
import { coverageDatabase } from '../../../__tests__/fixtures/capability-coverage-db.js';
const { readCapabilityCoverage } = await import('../../capability-source-coverage.js').catch(() => ({}));
let f;
beforeEach(async () => { f = await coverageDatabase(); });
afterEach(async () => { await f?.close(); });
const read = options => {
  expect(readCapabilityCoverage, '只读coverage服务必须存在').toBeTypeOf('function');
  return readCapabilityCoverage(f.db, options);
};

it('六来源各有完整分母，归档仍计入且mapped/unknown/excluded严格分割', async () => {
  const r = await read({ kind: 'skills' });
  expect(r.sources.map(s => s.kind)).toEqual(['skills', 'repositories', 'apis', 'ops_workflows', 'resources', 'legacy_features']);
  for (const source of r.sources) {
    expect(source.total).toBe(source.mapped + source.unknown + source.excluded);
    expect(source.scope_note).toBeTruthy();
  }
  expect(r.sources.find(s => s.kind === 'skills')).toMatchObject({ total: 2, mapped: 0, unknown: 2, excluded: 0, source_revision: null });
  expect(r.items.find(s => s.id === f.coverageIds.retiredSkill)).toMatchObject({ record_status: 'deprecated', coverage_status: 'unknown' });
  expect(r.items.find(s => s.id === f.coverageIds.skill)).toMatchObject({ source: null, consumers: [], reason: 'fixed_skill_identity_missing' });
  expect(r.sources.find(s => s.kind === 'resources')).toMatchObject({ total: 1, mapped: 0, unknown: 1 });
});

it('API只按登记来源+固定revision+精确实现路径找共享消费者，旧SHA或同路径别仓不匹配', async () => {
  const r = await read({ kind: 'apis' });
  const mapped = r.items.find(i => i.id === f.coverageIds.api);
  expect(mapped).toMatchObject({ coverage_status: 'mapped', source: f.coverageSource });
  expect(mapped.consumers).toHaveLength(2);
  expect(new Set(mapped.consumers.map(c => c.reference_id)).size).toBe(2);
  for (const id of [f.coverageIds.oldApi, f.coverageIds.otherApi]) expect(r.items.find(i => i.id === id)).toMatchObject({ coverage_status: 'unknown', consumers: [] });
  expect(r.sources.find(s => s.kind === 'apis').source_revision).toBeNull();
  await f.db.query('UPDATE workflow_activity_refs SET active=false WHERE workflow_id=$1 AND activity_id=$2', [mapped.consumers[0].workflow_id, mapped.consumers[0].activity_id]);
  expect((await read({ kind: 'apis' })).items.find(i => i.id === f.coverageIds.api).consumers).toHaveLength(1);
});

it('调度和Feature仅用规范FK，停用不隐藏，旧源码workflow_ref不猜Workflow身份', async () => {
  const runs = await read({ kind: 'ops_workflows' });
  expect(runs.items.find(i => i.name === 'bound schedule')).toMatchObject({ coverage_status: 'mapped', record_status: 'inactive', consumers: [{ workflow_id: f.workflows[0].workflow_id, capability_id: f.workflows[0].payload.capability_id }] });
  expect(runs.items.find(i => i.name === 'same name as workflow').coverage_status).toBe('unknown');
  await f.db.query('UPDATE journey_features SET workflow_ref=$1 WHERE id=$2', [f.workflows[0].payload.key, f.coverageIds.legacyFeature]);
  const features = await read({ kind: 'legacy_features' });
  expect(features.items.find(i => i.id === f.coverageIds.feature).consumers).toHaveLength(2);
  expect(features.items.find(i => i.id === f.coverageIds.legacyFeature)).toMatchObject({ coverage_status: 'unknown', record_status: 'deprecated', consumers: [] });
});

it('仓库必须有当前明确映射，事实revision漂移保留分母但变unknown', async () => {
  expect((await read({ kind: 'repositories' })).items[0]).toMatchObject({ coverage_status: 'mapped', consumers: expect.any(Array) });
  await f.db.query("UPDATE fact_snapshot_headers SET source_revision=$1 WHERE repo='phone-source'", ['c'.repeat(40)]);
  const r = await read({ kind: 'repositories' });
  expect(r.selection.total).toBe(1); expect(r.items[0]).toMatchObject({ coverage_status: 'unknown', consumers: [] });
});

it('分页筛选不改变来源分母且服务可在数据库READ ONLY事务内执行', async () => {
  const client = await f.db.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(readCapabilityCoverage).toBeTypeOf('function');
    const r = await readCapabilityCoverage(client, { kind: 'apis', coverage: 'unknown', limit: '1', offset: '1' });
    expect(r.selection).toEqual({ kind: 'apis', coverage: 'unknown', limit: 1, offset: 1, total: 2 });
    expect(r.items).toHaveLength(1); expect(r.sources.find(s => s.kind === 'apis').total).toBe(3);
  } finally { await client.query('ROLLBACK'); client.release(); }
});
