/**
 * 实际 executor 提示回归：首次无项目创建、显式已有项目复用、完成棒后的继续推进。
 * Project 归属来自 projects 真身，Task 直接挂 Project 与 KR；保留永久场景保障。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '../db.js';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '')
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn()
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0')
}));

vi.mock('../task-router.js', () => ({
  getInternalTaskHandler: vi.fn(() => null),
  getTaskLocation: vi.fn(() => 'us')
}));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn()
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { EXECUTOR: 'executor' },
  STATUS: { START: 'start', SUCCESS: 'success' },
  EXECUTOR_HOSTS: { US: 'us', HK: 'hk' }
}));

describe('executor OKR 拆解 PRD — projects 四层真身', () => {
  let preparePrompt;
  beforeEach(async () => {
    vi.clearAllMocks();
    pool.query.mockImplementation(async sql => {
      if (sql.includes('FROM objectives')) return { rows: [{ title: 'KR 自动派发', target_date: new Date(Date.now() + 21 * 86400000) }] };
      if (sql.includes('FROM projects')) return { rows: [{
        id: 'old-project', name: '既有真身项目', status: 'completed', sequence_order: 1, time_budget_days: 4,
        created_at: new Date(Date.now() - 6 * 86400000), completed_at: new Date(Date.now() - 3 * 86400000),
      }] };
      return { rows: [] };
    });
    preparePrompt = (await import('../executor.js')).preparePrompt;
  });

  const makeOkrTask = (overrides = {}) => ({
    id: 'task-001', title: 'OKR 拆解: KR1 自动派发跑通', task_type: 'dev', status: 'queued',
    goal_id: 'kr-001', project_id: null,
    description: 'Tick 自动启动，任务成功率 ≥ 70%，24h 不需人工介入',
    ...overrides,
    payload: { decomposition: 'true', kr_id: 'kr-001', ...overrides.payload },
  });

  describe('首次拆解：无显式 Project', () => {
    it('独立交付创建 Project 并通过真实 API 参数绑定当前 KR', async () => {
      const prompt = await preparePrompt(makeOkrTask());
      expect(prompt).toContain('POST /api/brain/action/create-project');
      expect(prompt).toContain('"kr_ids": ["kr-001"]');
      expect(prompt).toContain('"repo_path": "<任务上下文中的真实仓库路径>"');
    });

    it('时间上下文从 projects 查询真实名称、预算与直接任务完成时间', async () => {
      const prompt = await preparePrompt(makeOkrTask());
      expect(prompt).toContain('既有真身项目');
      expect(prompt).toContain('预算 4 天');
      expect(prompt).toContain('实际 3 天');
      const projectRead = pool.query.mock.calls.find(([sql]) => sql.includes('FROM projects'));
      expect(projectRead[1]).toEqual(['kr-001']);
      expect(projectRead[0]).toContain('t.project_id = op.id');
      expect(projectRead[0]).not.toMatch(/okr_(projects|scopes|initiatives)/);
    });

    it('选择复用或新建项目后显式保存本棒归属，避免最新项目猜选', async () => {
      const prompt = await preparePrompt(makeOkrTask());
      expect(prompt).toContain('已有项目覆盖本次目标时继续该项目');
      expect(prompt).toContain('PATCH /api/brain/tasks/task-001');
      expect(prompt).toContain('"decomposition_project_id": "<选定 Project ID>"');
    });

    it('Task 直接挂 Project，goal_id 绑定当前 KR', async () => {
      const prompt = await preparePrompt(makeOkrTask());
      expect(prompt).toContain('"project_id": "<Project ID>"');
      expect(prompt).toContain('"goal_id": "kr-001"');
      expect(prompt).toContain('Project.kr_id = 当前 KR');
    });

    it('实际模板保持四层结构与送审状态，退役层无法重新创建', async () => {
      const prompt = await preparePrompt(makeOkrTask());
      expect(prompt).toContain('Objective → Key Result → Project → Task');
      expect(prompt).toContain('保持 KR 的 decomposing 状态');
      expect(prompt).not.toMatch(/create-initiative|okr_projects|必须指向 Initiative/);
    });
  });

  describe('显式已有 Project：复用原归属', () => {
    it('已有项目复用并直接登记 Task，不新建 Project 或使用旧子层 ID', async () => {
      const prompt = await preparePrompt(makeOkrTask({ project_id: 'proj-001', payload: { initiative_id: 'retired-001' } }));
      expect(prompt).toContain('GET /api/brain/projects/proj-001');
      expect(prompt).toContain('"project_id": "proj-001"');
      expect(prompt).toContain('"goal_id": "kr-001"');
      expect(prompt).not.toContain('POST /api/brain/action/create-project');
      expect(prompt).not.toContain('retired-001');
    });

    it('审查修正结果再送审，不因已有项目直接标完成', async () => {
      const prompt = await preparePrompt(makeOkrTask({ task_type: 'project_plan', project_id: 'proj-001', payload: { revision: true } }));
      expect(prompt).toContain('根据审查意见修正拆解');
      expect(prompt).toContain('设置 {"status":"decomposing"}');
      expect(prompt).not.toContain('状态为 completed');
    });
  });

  describe('继续推进：读取前棒事实', () => {
    it('继续棒携带前棒结果与 KR 目标，只在同一 Project 登记下一步', async () => {
      const prompt = await preparePrompt(makeOkrTask({ project_id: 'proj-001', payload: {
        decomposition: 'continue', initiative_id: 'retired-001', previous_result: '探索完成，发现 3 个实现方向', kr_goal: 'Tick 成功率 ≥ 70%',
      } }));
      expect(prompt).toContain('/decomp');
      expect(prompt).toContain('探索完成，发现 3 个实现方向');
      expect(prompt).toContain('Tick 成功率 ≥ 70%');
      expect(prompt).toContain('"project_id": "proj-001"');
      expect(prompt).not.toContain('retired-001');
      expect(prompt).not.toContain('POST /api/brain/action/create-project');
    });

    it('成功标准已有证据时允许收口原 Project，否则只登记下一步任务', async () => {
      const prompt = await preparePrompt(makeOkrTask({ project_id: 'proj-001', payload: { decomposition: 'continue', previous_result: '实现完成并通过验证' } }));
      expect(prompt).toContain('PATCH /api/brain/projects/proj-001 状态为 completed');
      expect(prompt).toContain('未达成时只登记下一步可执行任务');
      expect(prompt).toContain('避免重复已完成任务');
      expect(prompt).not.toContain('设置 {"status":"decomposing"}');
    });
  });
});
