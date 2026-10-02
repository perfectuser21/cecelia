import { describe, it, expect } from 'vitest';
import { validateDefinition, validateReferences } from './registration.js';

const ID = '11111111-1111-4111-8111-111111111111';
const definition = () => ({
  key: 'weekly_analysis', name: '每周分析', capability_id: ID, channel: 'internal',
  form: 'openclaw_skill', version: '1.0.0',
  source: { ref: 'cecelia:packages/workflows/skills/weekly-analysis/SKILL.md', revision: 'a'.repeat(40) },
  runtime: { skill_id: ID, entrypoint: 'weekly-analysis' },
  activities: [{ key: 'analyze', name: '分析', executor_kind: 'agent',
    implementation: { kind: 'skill', skill_id: ID, ref: 'weekly-analysis', version: '1.0.0' },
    acceptance: ['分析结果引用真实输入'] }],
});

describe('工作流登记定义', () => {
  it('接受完整、有固定来源的可调用定义', () => expect(validateDefinition(definition())).toBeTruthy());
  it.each([
    d => { d.activities = []; },
    d => { d.activities.push(structuredClone(d.activities[0])); },
    d => { d.source.revision = 'main'; },
    d => { delete d.runtime; },
    d => { d.activities[0].acceptance = []; },
    d => { d.activities[0].implementation.skill_id = '虚构ID'; },
  ])('拒绝无法追溯或缺少验收的定义', mutate => {
    const d = definition(); mutate(d); expect(() => validateDefinition(d)).toThrow();
  });
  it('共享活动引用必须是稳定ID', () => {
    const d = definition(); d.activities[0].reuse_activity_id = '同名活动';
    expect(() => validateDefinition(d)).toThrow();
  });
});

describe('引用就绪检查', () => {
  const db = (status = 'active', parent = ID) => ({ query: async sql => {
    if (sql.includes('FROM journeys')) return { rows: [{ id: ID, parent_journey_id: parent, status: 'active' }] };
    if (sql.includes('FROM skill_registry')) return { rows: [{ id: ID, name: 'weekly-analysis', status, location: '/skills/weekly-analysis/SKILL.md' }] };
    throw new Error(`意外查询: ${sql}`);
  } });
  it('能力必须有父价值流，不能把顶层价值流当能力', async () => {
    await expect(validateReferences(db('active', null), definition())).rejects.toThrow();
  });
  it('草案可以引用planned skill，发布必须就绪', async () => {
    await expect(validateReferences(db('planned'), definition(), { requireActive: false })).resolves.toBeTruthy();
    await expect(validateReferences(db('planned'), definition(), { requireActive: true })).rejects.toThrow();
  });
  it('不把未核实位置当作已部署入口', async () => {
    const client = db(); const query = client.query;
    client.query = async sql => {
      const r = await query(sql);
      if (sql.includes('FROM skill_registry')) r.rows[0].location = 'unverified';
      return r;
    };
    await expect(validateReferences(client, definition(), { requireActive: true })).rejects.toThrow();
  });
});
