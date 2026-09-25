/**
 * executor 任务→技能解析接入 skill_registry（链 bf5088a3 棒7，任务 9917a588）。
 * 验收：改账本映射无需改代码，新任务即用新 skill；skill_override 优先；账本故障回落硬编码。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());

vi.mock('../db.js', () => ({ default: { query: queryMock } }));
vi.mock('child_process', () => ({ spawn: vi.fn(), execSync: vi.fn(() => '') }));
vi.mock('fs/promises', () => ({ writeFile: vi.fn(), mkdir: vi.fn() }));
vi.mock('fs', () => ({ readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0') }));
vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  getTaskLocation: vi.fn(() => 'us'),
}));
vi.mock('../task-updater.js', () => ({ updateTaskStatus: vi.fn(), updateTaskProgress: vi.fn() }));
vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { SUCCESS: 'success', FAILED: 'failed' },
  EXECUTOR_HOSTS: { US_VPS: 'us' },
}));

const bindingRows = (rows) => queryMock.mockImplementation(async (sql) => {
  if (String(sql).includes('FROM skill_registry')) return { rows };
  return { rows: [] };
});

// intent_expand 走 _prepareDefaultPrompt（skill 由 getSkillForTaskType 决定）；
// initiative_plan 等有专属 prepare 函数的类型自带硬编码 skill，不在本刀范围。
const planTask = (payload = {}) => ({
  id: 'task-sr-001',
  task_type: 'intent_expand',
  title: '意图扩展',
  description: 'Initiative ID: abc123',
  payload,
});

describe('executor 接入 skill_registry', () => {
  let executor;

  beforeEach(async () => {
    vi.resetModules();
    queryMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    executor = await import('../executor.js');
  });

  it('账本为空/读取失败：与旧行为一致（纯硬编码）', async () => {
    queryMock.mockRejectedValue(new Error('registry down'));
    const prompt = await executor.preparePrompt(planTask());
    expect(prompt).toMatch(/^\/intent-expand\b/);
    expect(executor.getSkillForTaskType('intent_expand')).toBe('/intent-expand');
  });

  it('改账本映射后（无需改代码）新任务用新 skill', async () => {
    bindingRows([{ name: 'talk', status: 'active', task_types: ['intent_expand'], dispatch_command: null }]);
    const prompt = await executor.preparePrompt(planTask());
    expect(prompt).toMatch(/^\/talk\b/);
    expect(executor.getSkillForTaskType('intent_expand')).toBe('/talk');
  });

  it('payload.skill_override 仍优先于账本，且不查库', async () => {
    bindingRows([{ name: 'talk', status: 'active', task_types: ['intent_expand'], dispatch_command: null }]);
    const prompt = await executor.preparePrompt(planTask({ skill_override: '/architect' }));
    expect(prompt).toMatch(/^\/architect\b/);
    expect(queryMock.mock.calls.some((c) => String(c[0]).includes('FROM skill_registry'))).toBe(false);
  });

  it('账本缺该 task_type 的映射：走硬编码兜底并告警', async () => {
    bindingRows([{ name: 'talk', status: 'active', task_types: ['talk'], dispatch_command: null }]);
    const prompt = await executor.preparePrompt(planTask());
    expect(prompt).toMatch(/^\/intent-expand\b/);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[skill-binding]'));
  });

  it('decomposition 特判仍先于账本（payload 路由不变）', async () => {
    bindingRows([{ name: 'talk', status: 'active', task_types: ['dev'], dispatch_command: '/talk' }]);
    await executor.preparePrompt({ id: 't', task_type: 'dev', description: 'x', payload: {} });
    expect(executor.getSkillForTaskType('dev', { decomposition: 'true' })).toBe('/decomp');
  });
});
