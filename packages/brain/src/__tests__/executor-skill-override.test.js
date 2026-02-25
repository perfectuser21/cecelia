/**
 * Test: executor.js skill_override support
 *
 * DoD: task.payload.skill_override 优先于 getSkillForTaskType() 默认映射
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

describe('executor preparePrompt - skill_override', () => {
  let preparePrompt;

  beforeEach(async () => {
    vi.resetModules();
    const executor = await import('../executor.js');
    preparePrompt = executor.preparePrompt;
  });

  it('uses skill_override from payload when present', async () => {
    const task = {
      id: 'task-001',
      task_type: 'dev',
      title: 'Test task',
      description: 'Some task',
      payload: {
        skill_override: '/okr',
      },
    };

    const prompt = await preparePrompt(task);
    // The prompt should start with the skill_override value
    expect(prompt).toMatch(/^\/okr/);
  });

  it('skill_override overrides default skill for task_type', async () => {
    const task = {
      id: 'task-002',
      task_type: 'dev',  // 默认应该映射到 /dev
      title: 'Override test',
      description: 'Testing override',
      payload: {
        skill_override: '/exploratory',
      },
    };

    const prompt = await preparePrompt(task);
    // skill_override=/exploratory 应优先，而不是默认的 /dev
    expect(prompt).toMatch(/^\/exploratory/);
    expect(prompt).not.toMatch(/^\/dev/);
  });

  it('uses default skill when skill_override is absent', async () => {
    const task = {
      id: 'task-003',
      task_type: 'dev',
      title: 'No override',
      description: 'No override test',
      payload: {},
    };

    const prompt = await preparePrompt(task);
    // 无 skill_override，task_type='dev' 应使用 /dev
    expect(prompt).toMatch(/^\/dev/);
  });

  it('uses default skill when payload is null/undefined', async () => {
    const task = {
      id: 'task-004',
      task_type: 'dev',
      title: 'Null payload',
      description: 'Null payload test',
      payload: null,
    };

    const prompt = await preparePrompt(task);
    expect(prompt).toMatch(/^\/dev/);
  });

  it('uses default skill when skill_override is empty string', async () => {
    const task = {
      id: 'task-005',
      task_type: 'review',
      title: 'Empty override',
      description: 'Empty string override test',
      payload: {
        skill_override: null,  // null → 使用默认
      },
    };

    const prompt = await preparePrompt(task);
    // null → ?? 触发默认映射，task_type='review' → /review
    expect(prompt).toMatch(/^\/review/);
  });
});
