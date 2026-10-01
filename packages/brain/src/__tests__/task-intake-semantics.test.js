import { describe, expect, it, vi } from 'vitest';
import { createTaskIntake } from '../task-intake.js';

function fixture(text, patch = {}) {
  const candidate = { intent: 'research', title: '交办事项', objective: text,
    mutation_intent: 'read_only', change_kind: null, repo: null, map_scope: [],
    confidence: 0.99, evidence: [text], questions: [], ...patch };
  const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
  const createRoutedTask = vi.fn(async (_db, req) => ({ task_id: 'task', routing_receipt_id: 'receipt',
    task: { id: 'task', title: req.title, status: 'queued', payload: req.task.payload } }));
  const intake = createTaskIntake({ db: { query: client.query, connect: async () => client },
    callLLM: async () => ({ text: JSON.stringify(candidate) }), createRoutedTask,
    loadFacts: async () => ({ repositories: [{ repo: 'cecelia', aliases: [] }],
      mapNodes: [{ repo: 'cecelia', node_key: 'F1' }] }) });
  return { intake, createRoutedTask };
}
const coding = { intent: 'coding_change', mutation_intent: 'write', change_kind: 'bugfix', repo: 'cecelia', map_scope: ['F1'] };

describe('口语授权与澄清恢复', () => {
  it.each([
    '调研如何修复接单', '研究如何修改生产防火墙的原理（不执行）',
    '讨论删除生产数据库数据的风险，不要执行',
  ])('明确只读讨论可创建研究：%s', async (text) => {
    const f = fixture(text);
    expect((await f.intake({ text, source_id: 'one' })).status).toBe(201);
  });
  it('限定不要删除数据不否定修复代码授权', async () => {
    const text = '修复 Cecelia 按钮，但不要删除数据';
    const f = fixture(text, coding);
    expect((await f.intake({ text, source_id: 'one' })).status).toBe(201);
  });
  it.each(['修复 Cecelia 调研页面按钮', '修复代码审查页面的显示错误'])('页面名称不改变句首修改授权：%s', async (text) => {
    const f = fixture(text, coding);
    expect((await f.intake({ text, source_id: 'one' })).status).toBe(201);
  });
  it('用户补充只读范围后原句修复歧义能消除', async () => {
    const text = '检查并修复 Cecelia 接单问题';
    const f = fixture(text);
    expect((await f.intake({ text, source_id: 'one', answers: { goal: '只调研，不修改代码' } })).status).toBe(201);
  });
  it('原句只审查，经明确补充修改授权后能建编码任务', async () => {
    const text = '只审查 Cecelia 接单，不要修改';
    const answer = '改为修复 Cecelia 接单代码，允许修改代码';
    const f = fixture(text, { ...coding, evidence: [answer] });
    expect((await f.intake({ text, source_id: 'one', answers: { goal: answer } })).status).toBe(201);
  });
  it('模型高置信把讨论方案说成写入仍需澄清', async () => {
    const text = '调研如何修复 Cecelia 接单问题';
    const f = fixture(text, coding);
    expect(await f.intake({ text, source_id: 'one' })).toMatchObject({ status: 200, body: { outcome: 'clarification_required' } });
    expect(f.createRoutedTask).not.toHaveBeenCalled();
  });
  it('代码修改与调研复合目标仍需澄清执行范围', async () => {
    const text = '调研接单方案并修复 Cecelia 重复提交';
    const f = fixture(text, coding);
    expect(await f.intake({ text, source_id: 'one' })).toMatchObject({ status: 200, body: { outcome: 'clarification_required' } });
  });
  it('调研排在修复后面仍是复合目标', async () => {
    const text = '修复 Cecelia 重复提交，然后调研接单方案';
    const f = fixture(text, coding);
    expect(await f.intake({ text, source_id: 'one' })).toMatchObject({ status: 200, body: { outcome: 'clarification_required' } });
    expect(f.createRoutedTask).not.toHaveBeenCalled();
  });
  it.each([
    ['把生产服务器重启一下', {}],
    ['修改生产服务器的网络配置', coding],
  ])('生产操作不能被高置信候选接走：%s', async (text, patch) => {
    const f = fixture(text, patch);
    expect(await f.intake({ text, source_id: 'one' })).toMatchObject({ status: 422, body: { error: 'unsupported_execution', task_id: null } });
    expect(f.createRoutedTask).not.toHaveBeenCalled();
  });
  it('选择系统自己给出的修改代码选项能解除原先只读限制', async () => {
    const text = '只审查 Cecelia 接单代码，不要修改';
    const first = await fixture(text, coding).intake({ text, source_id: 'one' });
    expect(first.body.outcome).toBe('clarification_required');
    const selectedOption = first.body.questions[0].options[1];
    const f = fixture(text, { ...coding, evidence: [selectedOption] });
    const result = await f.intake({ text, source_id: 'one', answers: { goal: selectedOption } });
    expect(result.status).toBe(201);
  });
});
