/**
 * B44 — harness-gan.graph.js 改回同步 executor（WS3 async 已回退）
 *
 * Regression test（源码级断言，不实际运行 executor 避免 CI shard timeout）：
 * 1. proposer 节点不含 interrupt() 调用（已改回阻塞 executor）
 * 2. runGanContractGraph 返回包含 propose_branch 的完整结果（不是 {kickoff:true}）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', 'harness-gan.graph.js');

describe('B44 — GAN proposer 使用阻塞 executor [BEHAVIOR]', () => {
  it('harness-gan.graph.js 不含 kickoff:true 返回（WS3 async 回退）', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).not.toMatch(/kickoff:\s*true/);
  });

  it('runGanContractGraph 返回 propose_branch 字段', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/propose_branch:\s*finalState\.proposeBranch/);
  });

  it('proposer 节点使用 await executor(\{\}) 而非 spawnDockerDetached', () => {
    const src = readFileSync(SRC, 'utf8');
    // B44 fix: 阻塞 executor 模式
    expect(src).toMatch(/const result = await executor\(\{/);
    // 不含 WS3 async 的 spawnDockerDetached 调用
    expect(src).not.toMatch(/spawnDockerDetached/);
  });

  it('reviewer 节点使用 await executor(\{\}) 而非 spawnDockerDetached', () => {
    const src = readFileSync(SRC, 'utf8');
    // reviewer 也改回阻塞模式，executor 被调用 2 次（proposer + reviewer）
    const execCalls = (src.match(/const result = await executor\(\{/g) || []).length;
    expect(execCalls).toBeGreaterThanOrEqual(2);
  });
});
