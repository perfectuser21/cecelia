/**
 * docker-executor-mount-strategy.test.js
 *
 * 验证 buildDockerArgs 的挂载策略：
 *  - CLAUDE_CONFIG_DIR 对应的宿主路径 → /host-claude-config:ro（而非原宿主路径）
 *  - 容器内 env.CLAUDE_CONFIG_DIR → /home/cecelia/.claude（可写副本）
 *  - accountN 凭据名解析正确
 */

import { describe, it, expect, vi } from 'vitest';

// mock db（buildDockerArgs 不会用，防止 import 链）
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

const { buildDockerArgs } = (await import('../docker-executor.js')).__test__;

describe('buildDockerArgs — CLAUDE_CONFIG_DIR 挂载策略', () => {
  const task = { id: 'aaaa-1', task_type: 'harness_generator' };
  const baseOpts = {
    task,
    prompt: 'hi',
    worktreePath: '/tmp/worktree-x',
  };

  it('CECELIA_CREDENTIALS=account1 → 挂 /host-claude-config:ro + env CLAUDE_CONFIG_DIR=/home/cecelia/.claude', () => {
    const { args, envFinal } = buildDockerArgs(
      { ...baseOpts, env: { CECELIA_CREDENTIALS: 'account1' } },
      {
        homedir: '/home/fake',
        existsSyncFn: (p) => p === '/home/fake/.claude-account1',
      },
    );

    const flatArgs = args.join(' ');
    // 宿主目录挂载到 /host-claude-config:ro（不再挂到宿主原路径）
    expect(flatArgs).toContain('-v /home/fake/.claude-account1:/host-claude-config:ro');
    // 不应再挂到宿主原路径自身
    expect(flatArgs).not.toContain('/home/fake/.claude-account1:/home/fake/.claude-account1');
    // env 指向容器内副本
    expect(envFinal.CLAUDE_CONFIG_DIR).toBe('/home/cecelia/.claude');
  });

  it('CECELIA_CREDENTIALS=account2 → accountN 解析正确', () => {
    const { args, envFinal } = buildDockerArgs(
      { ...baseOpts, env: { CECELIA_CREDENTIALS: 'account2' } },
      {
        homedir: '/home/fake',
        existsSyncFn: (p) => p === '/home/fake/.claude-account2',
      },
    );
    const flatArgs = args.join(' ');
    expect(flatArgs).toContain('-v /home/fake/.claude-account2:/host-claude-config:ro');
    expect(envFinal.CLAUDE_CONFIG_DIR).toBe('/home/cecelia/.claude');
  });

  it('显式传入宿主 CLAUDE_CONFIG_DIR → 也会重写为容器内副本', () => {
    const { args, envFinal } = buildDockerArgs(
      { ...baseOpts, env: { CLAUDE_CONFIG_DIR: '/some/host/path' } },
      {
        homedir: '/home/fake',
        existsSyncFn: () => false,
      },
    );
    const flatArgs = args.join(' ');
    expect(flatArgs).toContain('-v /some/host/path:/host-claude-config:ro');
    expect(envFinal.CLAUDE_CONFIG_DIR).toBe('/home/cecelia/.claude');
  });

  it('无 CECELIA_CREDENTIALS 且无 CLAUDE_CONFIG_DIR → 不挂 /host-claude-config', () => {
    const { args } = buildDockerArgs(
      { ...baseOpts, env: {} },
      {
        homedir: '/home/fake',
        existsSyncFn: () => false,
      },
    );
    const flatArgs = args.join(' ');
    expect(flatArgs).not.toContain(':/host-claude-config:ro');
  });
});
