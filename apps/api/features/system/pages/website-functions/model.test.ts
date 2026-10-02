import { describe, expect, it } from 'vitest';
import { buildInventory, filterOperations, summarize } from './model';

const row = (id: string, category: string | null, status: string, name = id) => ({
  审计编号: id, 功能: name, 功能分类: category, 当前核查: status,
  页面名称: '测试页面', 网站入口: 'http://perfect21:5211/brain-models',
  请求方式: 'GET', 后台接口: '/api/example', 处理效果: '读取或保存',
  当前证据: '原始审计证据', 整理建议: '保留', 本人验收: '未找到确认记录', url: 'https://app.notion.com/example',
});

describe('网站操作盘点的数量与验收边界', () => {
  it('导航占位不计为操作，读取抽查和未验证不冒充已验收', () => {
    const items = buildInventory([
      row('read', '查询 EQ', '读取抽查通过'), row('broken', '输出 EO', '发现明确断点'),
      row('unknown', '输入/变更 EI', '执行未验收'), row('navigation', null, '本地展示或导航'),
    ], [], new Set(['/brain-models']));
    expect(summarize(items)).toMatchObject({ total: 3, verified: 0, readChecked: 1, broken: 1, pending: 1 });
  });

  it('只给有针对性验收的操作标可用，不因共用接口给另一个页面盖章', () => {
    const items = buildInventory([
      row('BrainModelsPage:03', '输入/变更 EI', '执行未验收'),
      row('SystemTabbed:04', '输入/变更 EI', '执行未验收'),
    ], [{ operationId: 'BrainModelsPage:03', date: '2026-10-02', evidence: '数据库回执 2954031', kind: 'change' }], new Set());
    expect(items[0].status).toBe('verified');
    expect(items[1].status).toBe('pending');
    expect(summarize(items).verified).toBe(1);
  });

  it('输入和变更按用途区分，复合操作不拆成虚增的多条记录', () => {
    const items = buildInventory([
      row('Tasks:01', '输入/变更 EI', '执行未验收', '创建个人任务'),
      row('BrainModelsPage:03', '输入/变更 EI', '执行未验收', '保存单Agent模型'),
      row('ProfileFacts:02', '输入/变更 EI', '执行未验收', '新增、编辑、删除事实'),
    ], [], new Set());
    expect(items.map(x => x.category)).toEqual(['input', 'change', 'input']);
    expect(items[2].combined).toBe(true);
    expect(summarize(items).total).toBe(3);
  });

  it('分类、状态、主导航和搜索条件取交集，非主导航不判为坏功能', () => {
    const items = buildInventory([
      row('BrainModelsPage:03', '输入/变更 EI', '执行未验收', '保存单Agent模型'),
      { ...row('legacy', '查询 EQ', '发现明确断点'), 网站入口: 'http://perfect21:5211/old' },
    ], [], new Set(['/brain-models']));
    expect(filterOperations(items, { category: 'change', status: 'pending', navigationOnly: true, search: 'Agent' })).toHaveLength(1);
    expect(filterOperations(items, { category: 'output', status: 'all', navigationOnly: false, search: '' })).toHaveLength(0);
    expect(items[0].humanAcceptance).toBe('未找到确认记录');
  });
});
