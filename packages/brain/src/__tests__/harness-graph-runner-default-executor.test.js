/**
 * harness-graph-runner.js — dockerExecutor 默认值切换测试 (ws3 / spawn-v2 P2)
 *
 * 验证：
 *   1. 默认 dockerExecutor 是 spawn()（不再是 executeInDocker）
 *   2. opts.dockerExecutor 注入仍然优先（保持原测试注入语义）
 *   3. 顶部 import 含 spawn
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { mockSpawn, mockExecuteInDocker } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecuteInDocker: vi.fn(),
}));

vi.mock('../spawn/index.js', () => ({ spawn: mockSpawn }));
vi.mock('../docker-executor.js', () => ({ executeInDocker: mockExecuteInDocker }));

const { runHarnessPipeline } = await import('../harness-graph-runner.js');

const dockerOk = () =>
  Promise.resolve({ exit_code: 0, stdout: 'ok', stderr: '', timed_out: false });

const placeholderOverrides = {
  proposer: async (s) => ({ ...s, trace: 'proposer', acceptance_criteria: 'c' }),
  reviewer: async (s) => ({ ...s, trace: 'reviewer', review_verdict: 'APPROVED' }),
  generator: async (s) => ({ ...s, trace: 'generator', pr_url: 'https://x/1', pr_branch: 'cp-x' }),
  ci_gate: async (s) => ({ ...s, trace: 'ci_gate', ci_status: 'pass' }),
  evaluator: async (s) => ({ ...s, trace: 'evaluator', evaluator_verdict: 'PASS' }),
  report: async (s) => ({ ...s, trace: 'report', report: 'done' }),
  // 不 override planner → 使用 createDockerNodes 出来的 docker 节点 → 调 dockerExecutor
};

beforeEach(() => {
  mockSpawn.mockReset().mockImplementation(dockerOk);
  mockExecuteInDocker.mockReset().mockImplementation(dockerOk);
});

describe('runHarnessPipeline — default dockerExecutor', () => {
  it('未传 opts.dockerExecutor 时调用 spawn()，不调用 executeInDocker', async () => {
    await runHarnessPipeline(
      { id: 'task-default', description: 'demo' },
      { overrides: placeholderOverrides },
    );

    expect(mockSpawn).toHaveBeenCalled();
    expect(mockExecuteInDocker).not.toHaveBeenCalled();
  });

  it('opts.dockerExecutor 注入时优先（不调用 spawn / executeInDocker）', async () => {
    const injected = vi.fn().mockImplementation(dockerOk);

    await runHarnessPipeline(
      { id: 'task-injected', description: 'demo' },
      { overrides: placeholderOverrides, dockerExecutor: injected },
    );

    expect(injected).toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockExecuteInDocker).not.toHaveBeenCalled();
  });
});

describe('harness-graph-runner.js — 顶部 import 静态检查', () => {
  it('import 来源是 ../spawn (不再是 ../docker-executor)', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.resolve(here, '..', 'harness-graph-runner.js'),
      'utf8',
    );

    // 顶部必须 import spawn
    expect(src).toMatch(/import\s*\{[^}]*\bspawn\b[^}]*\}\s*from\s*['"]\.\/spawn[^'"]*['"]/);
    // 不再 import executeInDocker
    expect(src).not.toMatch(/import\s*\{[^}]*\bexecuteInDocker\b[^}]*\}\s*from\s*['"]\.\/docker-executor[^'"]*['"]/);
  });
});
