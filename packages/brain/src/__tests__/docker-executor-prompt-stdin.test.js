/**
 * docker-executor-prompt-stdin.test.js — 验证 prompt 不再走 argv，避免 E2BIG
 *
 * 背景：harness GAN Round N 的 Reviewer prompt 含完整合同 + 历史反馈，容易
 * 超过 OS argv 长度限制（macOS ~256 KB，Linux ~128 KB），触发 spawn E2BIG
 * 导致 GAN 崩溃。修法：prompt 写临时文件（writePromptFile 已做），
 * entrypoint.sh 从文件读并通过 stdin 喂给 claude。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

const { buildDockerArgs } = (await import('../docker-executor.js')).__test__;

describe('buildDockerArgs — prompt 不走 argv（防 E2BIG）', () => {
  const task = { id: 'bbbb-1', task_type: 'harness_contract_review' };

  it('args 里不含 opts.prompt 文本', () => {
    const shortPrompt = 'hello';
    const { args } = buildDockerArgs({
      task,
      prompt: shortPrompt,
      worktreePath: '/tmp/wt',
    });
    expect(args.join('\n')).not.toContain(shortPrompt);
  });

  it('args 里不含超长 prompt（模拟 GAN Reviewer 200KB prompt）', () => {
    const hugePrompt = 'x'.repeat(200_000);
    const { args } = buildDockerArgs({
      task,
      prompt: hugePrompt,
      worktreePath: '/tmp/wt',
    });
    // argv 总长度应远小于 200KB（仅挂载/环境变量/镜像名）
    const totalLen = args.reduce((sum, a) => sum + String(a).length, 0);
    expect(totalLen).toBeLessThan(50_000);
  });

  it('args 最后一个元素是 image 名（不是 prompt）', () => {
    const { args } = buildDockerArgs({
      task,
      prompt: 'any prompt content',
      worktreePath: '/tmp/wt',
      image: 'cecelia/runner:test-tag',
    });
    expect(args[args.length - 1]).toBe('cecelia/runner:test-tag');
  });

  it('prompt dir 仍挂载到容器 /tmp/cecelia-prompts:ro（entrypoint 从这里读）', () => {
    const { args } = buildDockerArgs({
      task,
      prompt: 'hi',
      worktreePath: '/tmp/wt',
    });
    const flat = args.join(' ');
    expect(flat).toMatch(/-v [^ ]+:\/tmp\/cecelia-prompts:ro/);
  });
});
