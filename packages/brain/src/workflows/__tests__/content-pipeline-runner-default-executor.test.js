/**
 * content-pipeline-runner.js — dockerExecutor 默认值切换测试 (ws3 / spawn-v2 P2)
 *
 * 验证：
 *   1. 默认 dockerExecutor 是 spawn()（不再是 executeInDocker）
 *   2. opts.dockerExecutor 注入仍然优先（保持原测试注入语义）
 *   3. 顶部 import 含 spawn
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemorySaver } from '@langchain/langgraph';

const { mockSpawn, mockExecuteInDocker } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecuteInDocker: vi.fn(),
}));

vi.mock('../../spawn/index.js', () => ({ spawn: mockSpawn }));
vi.mock('../../docker-executor.js', () => ({ executeInDocker: mockExecuteInDocker }));

// 防真连 pg：默认 checkpointer 走 PgCheckpointer，单测里替成 MemorySaver
vi.mock('../../orchestrator/pg-checkpointer.js', () => ({
  getPgCheckpointer: vi.fn().mockResolvedValue(new MemorySaver()),
}));

const { runContentPipeline } = await import('../content-pipeline-runner.js');

const dockerOk = () =>
  Promise.resolve({ exit_code: 0, stdout: 'ok', stderr: '', timed_out: false });

// 6 节点中 5 个 override，留 research 用 docker 节点 → 调 dockerExecutor
const placeholderOverrides = {
  copywrite: async (s) => ({ ...s, trace: 'copywrite', copy_path: '/c.md' }),
  copy_review: async (s) => ({ ...s, trace: 'copy_review', copy_review_verdict: 'APPROVED' }),
  generate: async (s) => ({ ...s, trace: 'generate', cards_dir: '/cards' }),
  image_review: async (s) => ({ ...s, trace: 'image_review', image_review_verdict: 'PASS' }),
  export: async (s) => ({ ...s, trace: 'export', nas_url: 'nas://p/' }),
};

beforeEach(() => {
  mockSpawn.mockReset().mockImplementation(dockerOk);
  mockExecuteInDocker.mockReset().mockImplementation(dockerOk);
  process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = 'true';
  // 跳过 selectBestAccount 动态 import：显式给一个 credential
  process.env.CONTENT_PIPELINE_CREDENTIALS = 'account-test';
});

afterEach(() => {
  delete process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED;
  delete process.env.CONTENT_PIPELINE_CREDENTIALS;
});

describe('runContentPipeline — default dockerExecutor', () => {
  it('未传 opts.dockerExecutor 时调用 spawn()，不调用 executeInDocker', async () => {
    await runContentPipeline(
      { id: 'pipe-default', keyword: 'demo' },
      { overrides: placeholderOverrides },
    );

    expect(mockSpawn).toHaveBeenCalled();
    expect(mockExecuteInDocker).not.toHaveBeenCalled();
  });

  it('opts.dockerExecutor 注入时优先（不调用 spawn / executeInDocker）', async () => {
    const injected = vi.fn().mockImplementation(dockerOk);

    await runContentPipeline(
      { id: 'pipe-injected', keyword: 'demo' },
      { overrides: placeholderOverrides, dockerExecutor: injected },
    );

    expect(injected).toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockExecuteInDocker).not.toHaveBeenCalled();
  });
});

describe('content-pipeline-runner.js — 顶部 import 静态检查', () => {
  it('import 来源是 ../../spawn (不再是 ../docker-executor)', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.resolve(here, '..', 'content-pipeline-runner.js'),
      'utf8',
    );

    // 顶部必须 import spawn
    expect(src).toMatch(/import\s*\{[^}]*\bspawn\b[^}]*\}\s*from\s*['"]\.\.\/spawn[^'"]*['"]/);
    // 不再 import executeInDocker
    expect(src).not.toMatch(/import\s*\{[^}]*\bexecuteInDocker\b[^}]*\}\s*from\s*['"]\.\.\/docker-executor[^'"]*['"]/);
  });
});
