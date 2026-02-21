/**
 * exploratory-prompt.test.js
 *
 * D1: executor.js preparePrompt 对 exploratory 任务注入 BRAIN_TASK_ID/BRAIN_GOAL_ID/BRAIN_PROJECT_ID
 * D2: exploratory prompt 包含 Output Loop 指令（调 Brain API 创建 dev 任务）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../db.js', () => ({
  default: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock('../actions.js', () => ({
  createTask: vi.fn(), updateTask: vi.fn(), createGoal: vi.fn(),
  updateGoal: vi.fn(), triggerN8n: vi.fn(), setMemory: vi.fn(),
  batchUpdateTasks: vi.fn(),
}));
vi.mock('../tick.js', () => ({
  getTickStatus: vi.fn(), enableTick: vi.fn(), disableTick: vi.fn(),
  executeTick: vi.fn(), runTickSafe: vi.fn(async () => ({ actions_taken: [] })),
  routeTask: vi.fn(), dispatchNextTask: vi.fn(), TASK_TYPE_AGENT_MAP: {},
}));
vi.mock('../task-router.js', () => ({
  identifyWorkType: vi.fn(), getTaskLocation: vi.fn(), routeTaskCreate: vi.fn(),
  getValidTaskTypes: vi.fn(), LOCATION_MAP: {},
}));
vi.mock('../circuit-breaker.js', () => ({
  getState: vi.fn(), reset: vi.fn(), getAllStates: vi.fn(),
  recordSuccess: vi.fn(), recordFailure: vi.fn(),
}));
vi.mock('../thalamus.js', () => ({
  processEvent: vi.fn(async () => ({ level: 0, actions: [] })),
  initThalamus: vi.fn(),
}));
vi.mock('../alertness.js', () => ({
  evaluateAlertness: vi.fn(), getAlertnessLevel: vi.fn(() => 1),
  getAlertnessSummary: vi.fn(() => ({})), ALERTNESS_LEVELS: {},
}));
vi.mock('../health-monitor.js', () => ({
  runLayer2HealthCheck: vi.fn(async () => ({ level: 'healthy' })),
  _resetLastHealthCheckTime: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────────────────────────────────────

const { preparePrompt } = await import('../executor.js');

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('preparePrompt - exploratory 任务注入 Brain 上下文 (D1/D2)', () => {
  const exploratoryTask = {
    id: 'task-uuid-1234',
    title: '探索: 调研现有数据结构',
    description: '调研现有任务数据结构，评估改造可行性',
    task_type: 'exploratory',
    goal_id: 'goal-uuid-5678',
    project_id: 'proj-uuid-9012',
    payload: {},
  };

  it('D1-1: exploratory prompt 包含 BRAIN_TASK_ID', () => {
    const prompt = preparePrompt(exploratoryTask);
    expect(prompt).toContain('BRAIN_TASK_ID: task-uuid-1234');
  });

  it('D1-2: exploratory prompt 包含 BRAIN_GOAL_ID', () => {
    const prompt = preparePrompt(exploratoryTask);
    expect(prompt).toContain('BRAIN_GOAL_ID: goal-uuid-5678');
  });

  it('D1-3: exploratory prompt 包含 BRAIN_PROJECT_ID', () => {
    const prompt = preparePrompt(exploratoryTask);
    expect(prompt).toContain('BRAIN_PROJECT_ID: proj-uuid-9012');
  });

  it('D1-4: exploratory prompt 包含 BRAIN_API', () => {
    const prompt = preparePrompt(exploratoryTask);
    expect(prompt).toContain('BRAIN_API: http://localhost:5221');
  });

  it('D2-1: exploratory prompt 包含 Brain API 创建任务的指令', () => {
    const prompt = preparePrompt(exploratoryTask);
    expect(prompt).toContain('/api/brain/tasks');
  });

  it('D2-2: exploratory prompt 包含 execution-callback 回传指令', () => {
    const prompt = preparePrompt(exploratoryTask);
    expect(prompt).toContain('execution-callback');
  });

  it('D2-3: exploratory prompt 包含 Output Loop 章节', () => {
    const prompt = preparePrompt(exploratoryTask);
    expect(prompt).toContain('Output Loop');
  });

  it('D2-4: exploratory prompt 包含探索目标（task description）', () => {
    const prompt = preparePrompt(exploratoryTask);
    expect(prompt).toContain('调研现有任务数据结构，评估改造可行性');
  });

  it('D1-5: goal_id 为空时注入空字符串（不崩溃）', () => {
    const taskNoGoal = { ...exploratoryTask, goal_id: null, project_id: null };
    const prompt = preparePrompt(taskNoGoal);
    expect(prompt).toContain('BRAIN_TASK_ID: task-uuid-1234');
    expect(prompt).toContain('BRAIN_GOAL_ID: ');
    expect(prompt).toContain('BRAIN_PROJECT_ID: ');
  });

  it('D1-6: prompt 以 /exploratory 开头', () => {
    const prompt = preparePrompt(exploratoryTask);
    expect(prompt.trimStart()).toMatch(/^\/exploratory/);
  });

  it('D2-5: non-exploratory 任务不注入 BRAIN_TASK_ID（其他类型不受影响）', () => {
    const devTask = { ...exploratoryTask, task_type: 'dev' };
    const prompt = preparePrompt(devTask);
    expect(prompt).not.toContain('BRAIN_TASK_ID');
  });
});
