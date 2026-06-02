/**
 * 回归：GAN 同 task 每轮复用同名容器（cecelia-task-{id12}），--rm 异步删除留时间窗 →
 * 下一轮 spawn 撞 "container name already in use"（exit 125）→ proposer 没启动没 push。
 * 修复：proposer/reviewer spawn 前调 cleanupContainer 清同名残留。
 */
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { createGanContractNodes } from '../harness-gan.graph.js';

function makeExecutor(worktreePath) {
  return vi.fn(async ({ env }) => {
    writeFileSync(
      path.join(worktreePath, '.brain-result.json'),
      JSON.stringify({ propose_branch: env.PROPOSE_BRANCH, workstream_count: 1 }),
    );
    return { exit_code: 0, stdout: '', cost_usd: 0.01 };
  });
}

describe('GAN 容器名清理（防 exit 125 撞名）', () => {
  it('proposer spawn 前调用 cleanupContainer(taskId)，且在 executor 之前', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-cleanup-'));
    try {
      const order = [];
      const cleanupContainer = vi.fn(async (id) => { order.push(`cleanup:${id}`); });
      const executor = vi.fn(async (opts) => {
        order.push('executor');
        writeFileSync(path.join(tmp, '.brain-result.json'),
          JSON.stringify({ propose_branch: opts.env.PROPOSE_BRANCH }));
        return { exit_code: 0, stdout: '', cost_usd: 0 };
      });

      const { proposer } = createGanContractNodes(executor, {
        taskId: 'task-abc12345', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
        readContractFile: vi.fn().mockResolvedValue('# c'),
        verifyProposer: vi.fn(async () => undefined),
        cleanupContainer,
      });

      await proposer({ round: 0, prdContent: 'x', feedback: null, costUsd: 0 });

      expect(cleanupContainer).toHaveBeenCalledWith('task-abc12345');
      // cleanup 必须在 executor 之前（否则撞名）
      expect(order.indexOf('cleanup:task-abc12345')).toBeLessThan(order.indexOf('executor'));
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('reviewer spawn 前也清理同名容器', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-cleanup-r-'));
    try {
      const cleanupContainer = vi.fn(async () => {});
      const executor = vi.fn(async () => {
        writeFileSync(path.join(tmp, '.brain-result.json'),
          JSON.stringify({ verdict: 'APPROVED', rubric_scores: {} }));
        return { exit_code: 0, stdout: 'VERDICT: APPROVED', cost_usd: 0 };
      });
      const { reviewer } = createGanContractNodes(executor, {
        taskId: 'task-rev99', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
        readContractFile: vi.fn().mockResolvedValue('# c'),
        cleanupContainer,
      });

      await reviewer({ round: 1, prdContent: 'x', contractContent: '# c', costUsd: 0 });
      expect(cleanupContainer).toHaveBeenCalledWith('task-rev99');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('默认 cleanupContainer 不传时也不报错（用真实 docker rm，无 daemon 也兜住）', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'gan-cleanup-def-'));
    try {
      const { proposer } = createGanContractNodes(makeExecutor(tmp), {
        taskId: 'task-def', initiativeId: 'init', sprintDir: 'sprints',
        worktreePath: tmp, githubToken: 'fake',
        readContractFile: vi.fn().mockResolvedValue('# c'),
        verifyProposer: vi.fn(async () => undefined),
        // 不传 cleanupContainer → 用 defaultCleanupContainer（真实 docker rm）
      });
      // 不应抛错（docker rm 失败也 resolve）
      const r = await proposer({ round: 0, prdContent: 'x', feedback: null, costUsd: 0 });
      expect(r.proposeBranch).toBe('cp-harness-propose-r1-task-def');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('cleanup 绝不用 docker rm -f（防回归：-f 会杀正在跑的容器 → exit 137）', () => {
    // 源码级守卫：#3230 曾用 rm -f 把正在跑的 proposer/reviewer 杀了（137）。
    // 必须用 docker rm（不带 -f）——只删停止的残留，活容器安全报错跳过。
    const src = readFileSync(
      new URL('../harness-gan.graph.js', import.meta.url),
      'utf8',
    );
    expect(src).not.toMatch(/\['rm',\s*'-f'/);
    expect(src).toMatch(/\['rm',\s*name\]/);
  });
});
