/**
 * executor-domain-prompt.test.js
 *
 * 测试 preparePrompt() 在自动生成 PRD 时正确注入 domain 和 owner_role 上下文。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => ''),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0'),
}));

vi.mock('../task-router.js', () => ({
  getTaskLocation: vi.fn(() => 'us'),
}));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn(),
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { L0_ORCHESTRATOR: 'l0' },
  STATUS: { SUCCESS: 'success', FAILED: 'failed' },
  EXECUTOR_HOSTS: { US_VPS: 'us' },
}));

describe('preparePrompt - domain/owner_role 上下文注入', () => {
  let preparePrompt;

  beforeEach(async () => {
    vi.resetModules();
    const executor = await import('../executor.js');
    preparePrompt = executor.preparePrompt;
  });

  it('task.domain=coding, task.owner_role=cto → prompt 包含领域上下文', async () => {
    const task = {
      title: 'Test coding task',
      task_type: 'dev',
      description: 'Implement feature X',
      domain: 'coding',
      owner_role: 'cto',
    };
    const prompt = await preparePrompt(task);
    expect(prompt).toContain('coding');
    expect(prompt).toContain('cto');
    expect(prompt).toContain('业务领域上下文');
  });

  it('task.domain=product, task.owner_role=cpo → prompt 包含 product/cpo', async () => {
    const task = {
      title: 'Product roadmap task',
      task_type: 'dev',
      description: 'Plan next quarter',
      domain: 'product',
      owner_role: 'cpo',
    };
    const prompt = await preparePrompt(task);
    expect(prompt).toContain('product');
    expect(prompt).toContain('cpo');
  });

  it('task.domain=null, task.owner_role=null → prompt 不含领域上下文块', async () => {
    const task = {
      title: 'Legacy task',
      task_type: 'dev',
      description: 'Do something',
      domain: null,
      owner_role: null,
    };
    const prompt = await preparePrompt(task);
    expect(prompt).not.toContain('业务领域上下文');
  });

  it('task 无 domain/owner_role 字段 → prompt 不含领域上下文块', async () => {
    const task = {
      title: 'No domain task',
      task_type: 'dev',
      description: 'Do something',
    };
    const prompt = await preparePrompt(task);
    expect(prompt).not.toContain('业务领域上下文');
  });

  it('domain 存在但 owner_role 为 null → prompt 仍包含领域上下文', async () => {
    const task = {
      title: 'Domain only task',
      task_type: 'dev',
      description: 'Quality check',
      domain: 'quality',
      owner_role: null,
    };
    const prompt = await preparePrompt(task);
    expect(prompt).toContain('quality');
    expect(prompt).toContain('业务领域上下文');
    expect(prompt).toContain('(未指定)'); // owner_role 未指定
  });

  it('自动生成 PRD 包含功能描述', async () => {
    const task = {
      title: 'My Task',
      task_type: 'dev',
      description: 'Specific feature description here',
      domain: 'coding',
      owner_role: 'cto',
    };
    const prompt = await preparePrompt(task);
    expect(prompt).toContain('Specific feature description here');
    expect(prompt).toContain('My Task');
  });
});
