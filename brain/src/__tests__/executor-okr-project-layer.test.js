/**
 * Test: executor.js OKR 拆解 PRD 模板 - KR 专属 Project 创建
 *
 * DoD 映射：
 * - OKR 首次拆解 PRD：必须包含"新建 KR 专属 Project"指令
 * - OKR 首次拆解 PRD：禁止包含"找已有 Project 复用"指令
 * - OKR 首次拆解 PRD：必须包含 project_kr_links 绑定步骤
 * - OKR 首次拆解 PRD：Task 的 goal_id 必须等于 KR ID
 * - OKR 继续拆解（decomposition=continue）：不受影响
 */

import { describe, it, expect, vi } from 'vitest';

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

describe('executor OKR 拆解 PRD 模板 - KR 专属 Project', () => {
  let preparePrompt;

  beforeEach(async () => {
    const executor = await import('../executor.js');
    preparePrompt = executor.preparePrompt;
  });

  const makeOkrTask = (overrides = {}) => ({
    id: 'task-001',
    title: 'OKR 拆解: KR1 自动派发跑通',
    task_type: 'dev',
    status: 'queued',
    goal_id: 'kr-001',
    project_id: 'proj-001',
    description: 'Tick 自动启动，任务成功率 ≥ 70%，24h 不需人工介入',
    payload: {
      decomposition: 'true',
      kr_id: 'kr-001'
    },
    ...overrides
  });

  describe('首次拆解（decomposition=true）', () => {
    it('PRD 必须要求新建 KR 专属 Project', () => {
      const task = makeOkrTask();
      const prompt = preparePrompt(task);

      expect(prompt).toContain('新建 KR 专属 Project');
    });

    it('PRD 必须禁止复用已有 project', () => {
      const task = makeOkrTask();
      const prompt = preparePrompt(task);

      expect(prompt).toContain('禁止复用');
    });

    it('PRD 必须包含 project_kr_links 绑定步骤', () => {
      const task = makeOkrTask();
      const prompt = preparePrompt(task);

      expect(prompt).toContain('project_kr_links');
    });

    it('PRD 必须要求 Task goal_id = KR ID', () => {
      const task = makeOkrTask();
      const prompt = preparePrompt(task);

      expect(prompt).toContain('goal_id');
      // goal_id 必须用 krId（即 task.goal_id）
      expect(prompt).toContain('kr-001');
    });

    it('PRD 不应包含"找到 type=\'project\' 且 repo_path 不为空"等复用指令', () => {
      const task = makeOkrTask();
      const prompt = preparePrompt(task);

      expect(prompt).not.toContain("找到 type='project' 且 repo_path 不为空");
      expect(prompt).not.toContain('找到 type=\'project\' 且 repo_path 不为空');
    });

    it('PRD 应包含从 cecelia-core 获取 repo_path 的说明', () => {
      const task = makeOkrTask();
      const prompt = preparePrompt(task);

      expect(prompt).toContain('cecelia-core');
      expect(prompt).toContain('repo_path');
    });

    it('PRD 应包含 Initiative parent_id 指向新建 Project 的说明', () => {
      const task = makeOkrTask();
      const prompt = preparePrompt(task);

      expect(prompt).toContain('parent_id');
      // parent_id 应指向新建的 KR 专属 Project，而不是通用的 cecelia-core
      expect(prompt).toContain('Step 1 新建的 Project ID');
    });
  });

  describe('继续拆解（decomposition=continue）- 不受影响', () => {
    it('继续拆解分支应正常生成 prompt', () => {
      const task = makeOkrTask({
        payload: {
          decomposition: 'continue',
          initiative_id: 'init-001',
          previous_result: '探索完成，发现 3 个实现方向',
          kr_goal: 'Tick 成功率 ≥ 70%'
        }
      });
      const prompt = preparePrompt(task);

      expect(prompt).toContain('/okr');
      expect(prompt).toContain('继续拆解');
      expect(prompt).toContain('init-001');
    });

    it('继续拆解 prompt 不应包含"新建 KR 专属 Project"指令', () => {
      const task = makeOkrTask({
        payload: {
          decomposition: 'continue',
          initiative_id: 'init-001',
          previous_result: '探索完成',
          kr_goal: 'Tick 成功率 ≥ 70%'
        }
      });
      const prompt = preparePrompt(task);

      // 继续拆解分支不应触发 project 创建
      expect(prompt).not.toContain('新建 KR 专属 Project');
    });
  });
});
