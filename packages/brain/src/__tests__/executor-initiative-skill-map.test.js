/**
 * executor-initiative-skill-map.test.js
 *
 * DoD:
 * - initiative_plan → /decomp（L1-001 修复验证）
 * - initiative_verify → /decomp
 * - decomp_review → /decomp-check
 * - preparePrompt(initiative_plan) 返回 `/decomp\n\n<task.description>`
 * - preparePrompt(decomp_review) 返回 `/decomp-check\n\n<task.description>`
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn()
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
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { SUCCESS: 'success', FAILED: 'failed' },
  EXECUTOR_HOSTS: { US_VPS: 'us' }
}));

describe('executor getSkillForTaskType — initiative 映射', () => {
  let getSkillForTaskType;

  beforeEach(async () => {
    vi.resetModules();
    const executor = await import('../executor.js');
    getSkillForTaskType = executor.getSkillForTaskType;
  });

  it('initiative_plan → /decomp', () => {
    expect(getSkillForTaskType('initiative_plan')).toBe('/decomp');
  });

  it('initiative_verify → /decomp', () => {
    expect(getSkillForTaskType('initiative_verify')).toBe('/decomp');
  });

  it('decomp_review → /decomp-check', () => {
    expect(getSkillForTaskType('decomp_review')).toBe('/decomp-check');
  });

  it('dev 仍然 → /dev（回归）', () => {
    expect(getSkillForTaskType('dev')).toBe('/dev');
  });

  it('未知类型 fallback → /dev（回归）', () => {
    expect(getSkillForTaskType('unknown_xyz')).toBe('/dev');
  });
});

describe('executor preparePrompt — initiative_plan / decomp_review 分支', () => {
  let preparePrompt;

  beforeEach(async () => {
    vi.resetModules();
    const executor = await import('../executor.js');
    preparePrompt = executor.preparePrompt;
  });

  it('initiative_plan 返回 /decomp + task.description', async () => {
    const task = {
      id: 'task-ip-001',
      task_type: 'initiative_plan',
      title: 'Initiative 规划: 测试 Initiative',
      description: 'Initiative ID: abc123\nKR ID: kr-456\n请规划下一个 PR。',
      payload: {},
    };

    const prompt = await preparePrompt(task);
    expect(prompt).toMatch(/^\/decomp\n\n/);
    expect(prompt).toContain('Initiative ID: abc123');
    expect(prompt).not.toMatch(/^\/dev/);
  });

  it('initiative_verify 返回 /decomp + task.description', async () => {
    const task = {
      id: 'task-iv-001',
      task_type: 'initiative_verify',
      title: 'Initiative 验证: 测试 Initiative',
      description: 'Initiative ID: abc123\n验证 Initiative 是否已完成。',
      payload: {},
    };

    const prompt = await preparePrompt(task);
    expect(prompt).toMatch(/^\/decomp\n\n/);
    expect(prompt).toContain('Initiative ID: abc123');
  });

  it('decomp_review 返回 /decomp-check + task.description', async () => {
    const task = {
      id: 'task-dr-001',
      task_type: 'decomp_review',
      title: '拆解质检: 测试 Initiative',
      description: 'Initiative ID: abc123\n请审查拆解质量。',
      payload: {},
    };

    const prompt = await preparePrompt(task);
    expect(prompt).toMatch(/^\/decomp-check\n\n/);
    expect(prompt).toContain('Initiative ID: abc123');
  });

  it('initiative_plan 无 description 时用 title', async () => {
    const task = {
      id: 'task-ip-002',
      task_type: 'initiative_plan',
      title: 'Initiative 规划: 无描述任务',
      description: '',
      payload: {},
    };

    const prompt = await preparePrompt(task);
    expect(prompt).toMatch(/^\/decomp\n\n/);
    expect(prompt).toContain('Initiative 规划: 无描述任务');
  });
});
