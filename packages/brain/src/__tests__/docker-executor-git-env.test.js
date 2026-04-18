/**
 * docker-executor-git-env.test.js
 *
 * 验证 buildDockerArgs 为 Generator 容器注入 git 凭据能力：
 *  - 默认 GIT_AUTHOR_NAME/EMAIL 和 GIT_COMMITTER_NAME/EMAIL
 *  - 宿主 ~/.gitconfig 和 ~/.config/gh 的 :ro 挂载
 *  - Caller 传入的 git env 优先于默认值
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

const { buildDockerArgs } = (await import('../docker-executor.js')).__test__;

describe('buildDockerArgs — git/gh 凭据注入', () => {
  const task = { id: 'bbbb-1', task_type: 'harness_generator' };
  const baseOpts = {
    task,
    prompt: 'hi',
    worktreePath: '/tmp/worktree-x',
  };

  it('默认注入 Cecelia Bot 的 GIT_AUTHOR/COMMITTER', () => {
    const { envFinal } = buildDockerArgs(
      baseOpts,
      {
        homedir: '/home/fake',
        existsSyncFn: () => false,
      },
    );
    expect(envFinal.GIT_AUTHOR_NAME).toBe('Cecelia Bot');
    expect(envFinal.GIT_AUTHOR_EMAIL).toBe('cecelia-bot@noreply.github.com');
    expect(envFinal.GIT_COMMITTER_NAME).toBe('Cecelia Bot');
    expect(envFinal.GIT_COMMITTER_EMAIL).toBe('cecelia-bot@noreply.github.com');
  });

  it('caller env 覆盖默认 GIT_AUTHOR_NAME', () => {
    const { envFinal } = buildDockerArgs(
      { ...baseOpts, env: { GIT_AUTHOR_NAME: 'Alice' } },
      { homedir: '/home/fake', existsSyncFn: () => false },
    );
    expect(envFinal.GIT_AUTHOR_NAME).toBe('Alice');
    // 未覆盖的仍为默认
    expect(envFinal.GIT_COMMITTER_NAME).toBe('Cecelia Bot');
  });

  it('宿主 ~/.gitconfig 存在 → 挂载到 /home/cecelia/.gitconfig:ro', () => {
    const existing = new Set(['/home/fake/.gitconfig']);
    const { args } = buildDockerArgs(
      baseOpts,
      {
        homedir: '/home/fake',
        existsSyncFn: (p) => existing.has(p),
      },
    );
    const flatArgs = args.join(' ');
    expect(flatArgs).toContain('-v /home/fake/.gitconfig:/home/cecelia/.gitconfig:ro');
  });

  it('宿主 ~/.config/gh 存在 → 挂载到 /home/cecelia/.config/gh:ro', () => {
    const existing = new Set(['/home/fake/.config/gh']);
    const { args } = buildDockerArgs(
      baseOpts,
      {
        homedir: '/home/fake',
        existsSyncFn: (p) => existing.has(p),
      },
    );
    const flatArgs = args.join(' ');
    expect(flatArgs).toContain('-v /home/fake/.config/gh:/home/cecelia/.config/gh:ro');
  });

  it('宿主文件不存在 → 不挂载对应路径', () => {
    const { args } = buildDockerArgs(
      baseOpts,
      {
        homedir: '/home/fake',
        existsSyncFn: () => false,
      },
    );
    const flatArgs = args.join(' ');
    expect(flatArgs).not.toContain('/.gitconfig:ro');
    expect(flatArgs).not.toContain('/.config/gh:ro');
  });

  it('env 里 git 变量被 envToArgs 转成 -e 参数', () => {
    const { args } = buildDockerArgs(
      baseOpts,
      { homedir: '/home/fake', existsSyncFn: () => false },
    );
    expect(args).toContain('-e');
    expect(args).toContain('GIT_AUTHOR_NAME=Cecelia Bot');
    expect(args).toContain('GIT_AUTHOR_EMAIL=cecelia-bot@noreply.github.com');
    expect(args).toContain('GIT_COMMITTER_NAME=Cecelia Bot');
    expect(args).toContain('GIT_COMMITTER_EMAIL=cecelia-bot@noreply.github.com');
  });
});
