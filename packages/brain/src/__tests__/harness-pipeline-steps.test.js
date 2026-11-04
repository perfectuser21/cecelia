// 真实历史流水线读面合同：只读展示，不恢复旧prompt执行。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
const owned = vi.hoisted(() => ({ query: vi.fn(), read: vi.fn(), effect: vi.fn(), process: vi.fn(), network: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: owned.query } }));
vi.mock('child_process', () => Object.fromEntries(['execSync', 'execFile', 'spawn'].map(name => [name, (...args) => { owned.process(name, ...args); throw Error('禁止真实命令'); }])));
vi.mock('fs/promises', async original => ({ ...await original(), readFile: owned.read }));
vi.mock('fs', async original => ({ ...await original(), existsSync: () => false, readFileSync: (...args) => { owned.effect('sync-read', ...args); throw Error('禁止隐式文件读取'); } }));
vi.mock('../actions.js', () => ({ createTask: owned.effect }));
vi.mock('../lib/task-terminal.js', () => ({ finalizeTask: owned.effect }));
vi.mock('../harness-judge.js', () => ({ runJudgeGate: owned.effect, runMechanicalPreflightChecks: owned.effect, checkJudgmentsWritten: owned.effect }));
vi.mock('../orchestrator/ground-truth.js', () => ({ collectGroundTruth: owned.effect }));
vi.mock('../orchestrator/one-session-judge-receipt.js', () => ({ persistOneSessionJudgeReceipt: owned.effect }));
vi.mock('../orchestrator/one-session-merge.js', () => ({ executeOneSessionMerge: owned.effect }));
import router from '../routes/harness.js';
const app = express(); app.use('/api/brain/harness', router);
const task = (type, n, extra = {}) => ({ task_id: `owned-${n}`, task_type: type, title: `历史-${n}`,
  description: `历史描述-${n}`, status: 'completed', payload: {}, result: {}, ...extra });
beforeEach(() => {
  vi.clearAllMocks();
  owned.query.mockResolvedValue({ rows: [] });
  owned.read.mockRejectedValue(new Error('owned file unavailable'));
  vi.stubGlobal('fetch', (...args) => { owned.network(...args); throw Error('禁止外联'); });
});
afterEach(() => {
  expect(owned.effect).not.toHaveBeenCalled();
  expect(owned.process).not.toHaveBeenCalled();
  expect(owned.network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
async function detail(tasks) {
  // 非UUID ID不进入checkpoint读路；此套只审真实steps构建消费者。
  owned.query.mockResolvedValueOnce({ rows: tasks });
  const response = await request(app).get('/api/brain/harness/pipeline-detail?planner_task_id=owned-history');
  expect(response.status).toBe(200);
  expect(owned.query).toHaveBeenCalledTimes(1);
  expect(owned.query.mock.calls[0][1]).toEqual(['owned-history']);
  expect(response.body.steps).toHaveLength(tasks.length);
  return response.body.steps;
}
describe('GET pipeline-detail → 真实buildSteps/rebuildPrompt（历史展示）', () => {
  it('真实有序任务序列生成轮次，未知类型回退，输出身份保留', async () => {
    const rows = [task('harness_contract_propose', 1), task('harness_contract_review', 2),
      task('harness_contract_propose', 3), task('harness_generate', 4), task('unknown_type', 5)];
    const steps = await detail(rows);
    expect(steps.map(step => step.label)).toEqual(['Propose R1', 'Review R1', 'Propose R2', 'Generate', 'unknown_type']);
    expect(steps.map(step => step.task_id)).toEqual(rows.map(row => row.task_id));
    expect(steps.map(step => step.step)).toEqual([1, 2, 3, 4, 5]);
    expect(steps[4].prompt_content).toBe('历史描述-5');
  });
  it('proposer展示当前真实重建字段及sprint别名，不冒称已执行提示词', async () => {
    const rows = [task('harness_contract_propose', 1, { payload: { propose_round: 2, sprint_dir: 'sprints/owned-history' } }),
      task('sprint_contract_propose', 2, { payload: { propose_round: 3 } })];
    const steps = await detail(rows);
    for (const [i, step] of steps.entries()) {
      expect(step.prompt_content).toContain('/harness-contract-proposer');
      expect(step.prompt_content).toContain(`task_id: owned-${i + 1}`);
      expect(step.prompt_content).toContain(`propose_round: ${i + 2}`);
      expect(step.prompt_content).toContain('sprint_dir: sprints/owned-history');
    }
    expect(steps.map(step => step.label)).toEqual(['Propose R1', 'Propose R1']);
    expect(owned.read).toHaveBeenCalled();
  });
  it('缺必填query直接400，零DB/文件读取', async () => {
    const response = await request(app).get('/api/brain/harness/pipeline-detail');
    expect(response.status).toBe(400);
    expect(owned.query).not.toHaveBeenCalled(); expect(owned.read).not.toHaveBeenCalled();
  });
  it('真实DB边界抛错诚实500，不合成空成功', async () => {
    owned.query.mockRejectedValueOnce(new Error('owned unavailable'));
    const response = await request(app).get('/api/brain/harness/pipeline-detail?planner_task_id=owned-history');
    expect(response.status).toBe(500); expect(response.body.error).toBe('owned unavailable');
    expect(owned.read).not.toHaveBeenCalled();
  });
});
