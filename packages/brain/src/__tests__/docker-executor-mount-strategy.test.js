/**
 * docker-executor-mount-strategy.test.js
 *
 * 验证 buildDockerArgs 的挂载策略：
 *  - CLAUDE_CONFIG_DIR 对应的宿主路径 → /host-claude-config:rw（而非原宿主路径）
 *  - 容器内 env.CLAUDE_CONFIG_DIR → /home/cecelia/.claude（可写副本）
 *  - accountN 凭据名解析正确
 *
 * issue 2bf0f8ea（凭据单链）：账号目录曾以 :ro 挂载，entrypoint 只能把
 * .credentials.json 复印成容器私有副本 → 同一账号裂成多条独立演化的 OAuth 链，
 * 任一副本刷新 token 即作废其余全部（宿主交互窗口一起被踢下线）。单链的前提是
 * 容器内对凭据文件的刷新能落回宿主原件，所以这个挂载必须可写。隔离性不变：
 * 容器写的仍然只是 entrypoint 建的 LOCAL_CFG 副本 + 那一个凭据软链，
 * projects/ 等会话目录照旧被排除在复制之外。
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

  it('CECELIA_CREDENTIALS=account1 → 挂 /host-claude-config:rw + env CLAUDE_CONFIG_DIR=/home/cecelia/.claude', () => {
    const { args, envFinal } = buildDockerArgs(
      { ...baseOpts, env: { CECELIA_CREDENTIALS: 'account1' } },
      {
        homedir: '/home/fake',
        existsSyncFn: (p) => p === '/home/fake/.claude-account1',
      },
    );

    const flatArgs = args.join(' ');
    // 宿主目录挂载到 /host-claude-config:rw（不再挂到宿主原路径）
    expect(flatArgs).toContain('-v /home/fake/.claude-account1:/host-claude-config:rw');
    // :ro 会让容器内 token 刷新写不回宿主原件 → 凭据链再次分叉
    expect(flatArgs).not.toContain(':/host-claude-config:ro');
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
    expect(flatArgs).toContain('-v /home/fake/.claude-account2:/host-claude-config:rw');
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
    expect(flatArgs).toContain('-v /some/host/path:/host-claude-config:rw');
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
    expect(flatArgs).not.toContain(':/host-claude-config:');
  });

  it('opts.extraMounts → 原样透传为 -v 参数（codex relay 凭据挂载接线，demo task a150998c）', () => {
    const { args } = buildDockerArgs(
      { ...baseOpts, env: {}, extraMounts: ['/tmp/fake-codex-home:/home/cecelia/.codex:rw'] },
      {
        homedir: '/home/fake',
        existsSyncFn: () => false,
      },
    );
    const flatArgs = args.join(' ');
    expect(flatArgs).toContain('-v /tmp/fake-codex-home:/home/cecelia/.codex:rw');
  });

  it('无 opts.extraMounts → 不受影响，无多余 -v', () => {
    const { args } = buildDockerArgs(
      { ...baseOpts, env: {} },
      {
        homedir: '/home/fake',
        existsSyncFn: () => false,
      },
    );
    const flatArgs = args.join(' ');
    expect(flatArgs).not.toContain('/home/cecelia/.codex');
  });
});
