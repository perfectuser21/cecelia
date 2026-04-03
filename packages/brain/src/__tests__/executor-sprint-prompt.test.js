/**
 * Test: executor.js preparePrompt 对 sprint 类型任务的处理
 *
 * 验证 Harness v2.0 三种 sprint 任务类型：
 * - sprint_generate → /dev --task-id 模式
 * - sprint_fix → /dev --task-id 模式（含修复轮次）
 * - sprint_evaluate → /sprint-evaluator 模式
 */

import { describe, it, expect, vi } from 'vitest';

// Mock executor.js 的外部依赖
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn().mockResolvedValue({ rows: [] })
  }
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
  readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0'),
  readdirSync: vi.fn(() => []),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn()
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

describe('preparePrompt: sprint 任务类型', () => {
  let preparePrompt;

  beforeEach(async () => {
    const executor = await import('../executor.js');
    preparePrompt = executor.preparePrompt;
  });

  it('sprint_generate 返回 /dev harness 模式 prompt', async () => {
    const task = {
      id: 'task-gen-001',
      task_type: 'sprint_generate',
      title: '实现用户登录功能',
      description: '实现基于 JWT 的用户登录',
      project_id: 'initiative-abc',
      payload: {
        sprint_dir: 'sprints/sprint-3',
        dev_task_id: 'dev-task-xyz',
        eval_round: 0
      }
    };

    const result = await preparePrompt(task);

    expect(result).toContain('/dev --task-id task-gen-001');
    expect(result).toContain('Sprint Generate');
    expect(result).toContain('harness_mode');
    expect(result).toContain('sprints/sprint-3');
    expect(result).toContain('dev-task-xyz');
    expect(result).toContain('initiative-abc');
    expect(result).toContain('实现基于 JWT 的用户登录');
    // generate 不应包含修复轮次
    expect(result).not.toContain('修复轮次');
  });

  it('sprint_fix 返回 /dev harness 模式 prompt（含修复轮次）', async () => {
    const task = {
      id: 'task-fix-002',
      task_type: 'sprint_fix',
      title: '修复登录验证逻辑',
      description: '修复 JWT 过期检查',
      project_id: 'initiative-abc',
      payload: {
        sprint_dir: 'sprints/sprint-3',
        dev_task_id: 'dev-task-xyz',
        eval_round: 2
      }
    };

    const result = await preparePrompt(task);

    expect(result).toContain('/dev --task-id task-fix-002');
    expect(result).toContain('Sprint Fix (R2)');
    expect(result).toContain('harness_mode');
    expect(result).toContain('sprints/sprint-3');
    expect(result).toContain('修复轮次');
    expect(result).toContain('R2');
    expect(result).toContain('evaluation.md');
    expect(result).toContain('修复 JWT 过期检查');
  });

  it('sprint_evaluate 返回 /sprint-evaluator prompt', async () => {
    const task = {
      id: 'task-eval-003',
      task_type: 'sprint_evaluate',
      title: '评估登录功能实现',
      description: '验证 sprint-3 的实现',
      project_id: 'initiative-abc',
      payload: {
        sprint_dir: 'sprints/sprint-3',
        dev_task_id: 'dev-task-xyz',
        eval_round: 1
      }
    };

    const result = await preparePrompt(task);

    expect(result).toContain('/sprint-evaluator');
    expect(result).toContain('Sprint Evaluator (R1)');
    expect(result).toContain('task-eval-003');
    expect(result).toContain('sprints/sprint-3');
    expect(result).toContain('dev-task-xyz');
    expect(result).toContain('sprint-contract.md');
    expect(result).toContain('evaluation.md');
    expect(result).toContain('PASS');
    // evaluate 不应包含 /dev
    expect(result).not.toContain('/dev --task-id');
  });

  it('sprint_generate 无 payload 时使用默认值', async () => {
    const task = {
      id: 'task-gen-004',
      task_type: 'sprint_generate',
      title: '默认 sprint 任务',
      payload: {}
    };

    const result = await preparePrompt(task);

    expect(result).toContain('/dev --task-id task-gen-004');
    expect(result).toContain('sprints/sprint-1'); // 默认目录
    expect(result).toContain('Sprint Generate');
  });
});
