import { describe, expect, it } from 'vitest';
import { compileAssemblyPlan } from './assembly-plan.js';

const id = '11111111-1111-4111-8111-111111111111';
const versionId = '22222222-2222-4222-8222-222222222222';
const schema = (...fields) => ({ type: 'object', properties: Object.fromEntries(fields.map(f => [f, { type: 'string' }])), required: fields });
const source = { repo: 'perfectuser21/cecelia', ref: 'contracts/report.json', revision: 'a'.repeat(40) };
const definition = () => ({ key: 'report', source, input_schema: schema('topic'), output_schema: schema('report'), activities: [
  { key: 'draft', executor_kind: 'agent', input_schema: schema('topic'), output_schema: schema('report'),
    implementation: { kind: 'skill', skill_id: id, repo: source.repo, path: 'report/SKILL.md', revision: 'contract' },
    runtime: { transport: 'openclaw-agent' }, acceptance: ['报告可读'] },
] });
const catalog = () => ({ skills: [{ id, status: 'active' }], warehouse_items: [], activity_versions: [] });
const compile = (d = definition(), c = catalog()) => compileAssemblyPlan(d, c, { tenantId: 'company-a' });
const codes = plan => plan.gaps.map(g => g.code);

describe('定义装配计划与独立调用缺口', () => {
  it('同定义摘要稳定，但静态计划绝不冒充运行就绪', () => {
    const a = compile(), b = compile(JSON.parse(JSON.stringify(definition())));
    expect(a.definition_sha256).toBe(b.definition_sha256);
    expect(a.structurally_complete).toBe(true);
    expect(a.callable).toBe(false);
    expect(a.readiness).toBe('unverified');
    expect(a.activities[0].input_mapping).toEqual({ topic: '$input.topic' });
    expect(a.activities[0].implementation.revision).toBe(source.revision);
    expect(codes(a)).toContain('runtime_admission_unverified');
    expect(codes(a)).toContain('implementation_reference_unverified');
  });
  it('缺合同的旧定义保留具体缺口，不因目录active放行', () => {
    const d = definition(); delete d.activities[0].input_schema; delete d.activities[0].output_schema;
    delete d.activities[0].runtime;
    expect(codes(compile(d))).toEqual(expect.arrayContaining(['input_contract_missing', 'output_contract_missing', 'transport_missing']));
    expect(compile(d).structurally_complete).toBe(false);
  });
  it('没有活动时提供可修复缺口；无输入活动和空结果合同允许显式声明', () => {
    expect(codes(compile({ key: 'empty', activities: [] }))).toContain('activities_missing');
    const d = definition(); d.input_schema = schema(); d.output_schema = schema();
    d.activities[0].input_schema = schema(); d.activities[0].output_schema = schema();
    expect(compile(d).structurally_complete).toBe(true);
  });
  it('引用文件不自动登记用料，只有显式仓库依赖进入计划', () => {
    const d = definition(), c = catalog();
    d.activities[0].implementation_bindings = [{ kind: 'code', path: 'helper.js' }];
    expect(compile(d, c).activities[0].warehouse_dependencies).toEqual([]);
    d.activities[0].warehouse_dependencies = [{ key: 'renderer', role: 'uses' }];
    expect(codes(compile(d, c))).toContain('warehouse_item_missing');
    c.warehouse_items.push({ id, key: 'renderer', active: true, shelf: 'service' });
    expect(compile(d, c).activities[0].warehouse_dependencies).toEqual([{ item_id: id, key: 'renderer', role: 'uses' }]);
  });
  it('不接受危险路径、浮动版本、停用Skill或human作为独立执行入口', () => {
    for (const patch of [{ path: '../secret' }, { revision: 'main' }]) {
      const d = definition(); Object.assign(d.activities[0].implementation, patch);
      expect(codes(compile(d))).toContain('implementation_source_invalid');
    }
    const c = catalog(); c.skills[0].status = 'deprecated';
    expect(codes(compile(definition(), c))).toContain('skill_not_active');
    const d = definition(); d.activities[0].executor_kind = 'human';
    expect(codes(compile(d))).toContain('executor_unsupported');
  });
  it('同名输出歧义要求显式映射，映射引用缺字段拒绝', () => {
    const d = definition();
    d.activities.push({ ...structuredClone(d.activities[0]), key: 'send', input_schema: schema('report'), input_mapping: { report: '$activity.draft.missing' } });
    expect(codes(compile(d))).toContain('input_mapping_invalid');
  });
  it('先检查循环引用，再拒绝前向依赖和跨租户上下文', () => {
    const d = definition();
    d.activities.push({ ...structuredClone(d.activities[0]), key: 'send' });
    d.activities[0].input_mapping = { topic: '$activity.send.report' };
    d.activities[1].input_mapping = { topic: '$activity.draft.report' };
    expect(codes(compile(d))).toContain('activity_dependency_cycle');
    d.tenant_id = 'company-b';
    expect(codes(compile(d))).toContain('tenant_mismatch');
  });
  it('共享Activity解析固定版本，不复制消费者声明、不追随current版本', () => {
    const d = definition(), original = structuredClone(d.activities[0]), c = catalog();
    d.activities = [{ key: 'shared', reuse_activity_id: id, reuse_activity_definition_version_id: versionId }];
    c.activity_versions.push({ id: versionId, activity_id: id, source_repo: source.repo, source_path: source.ref,
      source_commit: source.revision, payload: { activity_id: id, contract: original } });
    const plan = compile(d, c);
    expect(plan.structurally_complete).toBe(true);
    expect(plan.activities[0]).toMatchObject({ key: 'shared', activity_id: id, definition_version_id: versionId });
    expect(plan.activities[0].implementation.path).toBe('report/SKILL.md');
    c.activity_versions[0].activity_id = versionId;
    expect(codes(compile(d, c))).toContain('shared_activity_version_invalid');
  });
  it('不采信调用方声称的ready或verified，也不回传仓库中的秘密实现位置', () => {
    const d = definition(), c = catalog(); d.runtime = { ready: true, verified: true };
    c.warehouse_items.push({ id, key: 'renderer', active: true, impl_ref: 'secret-value' });
    d.activities[0].warehouse_dependencies = [{ key: 'renderer' }];
    expect(compile(d, c).callable).toBe(false);
    expect(JSON.stringify(compile(d, c))).not.toContain('secret-value');
  });
  it('共享Activity的接入参数属于消费Workflow，不修改共享合同', () => {
    const d = definition(), original = structuredClone(d.activities[0]), c = catalog();
    d.input_schema = schema('prompt');
    d.activities = [{ key: 'shared', reuse_activity_id: id, reuse_activity_definition_version_id: versionId,
      input_mapping: { topic: '$input.prompt' } }];
    c.activity_versions.push({ id: versionId, activity_id: id, source_repo: source.repo, source_path: source.ref,
      source_commit: source.revision, payload: { activity_id: id, contract: original } });
    expect(compile(d, c).structurally_complete).toBe(true);
    expect(compile(d, c).activities[0].input_mapping).toEqual({ topic: '$input.prompt' });
    expect(original).not.toHaveProperty('input_mapping');
  });
  it('消费Workflow可显式选择同名输出，非法选择不能消除缺口', () => {
    const d = definition();
    d.activities.push({ ...structuredClone(d.activities[0]), key: 'final' });
    d.output_mapping = { report: '$activity.final.report' };
    expect(compile(d).structurally_complete).toBe(true);
    expect(compile(d).output_mapping).toEqual(d.output_mapping);
    d.output_mapping.report = '$activity.final.missing';
    expect(codes(compile(d))).toContain('output_mapping_invalid');
  });
  it('必填下游参数不能自动连接到未保证存在的可选输出', () => {
    const d = definition();
    d.activities[0].output_schema.required = [];
    d.activities.push({ ...structuredClone(d.activities[0]), key: 'final', input_schema: schema('report'),
      output_schema: schema('report'), input_mapping: { report: '$activity.draft.report' } });
    d.output_mapping = { report: '$activity.final.report' };
    expect(codes(compile(d))).toContain('input_source_optional');
  });
});
