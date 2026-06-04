import { describe, it, expect } from 'vitest';
import { setupGitCredentials } from './git-credentials-setup.js';

describe('setupGitCredentials', () => {
  it('有 token 时写 url.insteadOf 配置 + 设 GIT_CONFIG_GLOBAL', () => {
    const writes = [];
    const env = {};
    const ok = setupGitCredentials({
      token: 'ghp_secret',
      configPath: '/tmp/test-gitconfig',
      env,
      writeFileFn: (p, c, o) => writes.push({ p, c, o }),
    });

    expect(ok).toBe(true);
    expect(writes).toHaveLength(1);
    expect(writes[0].p).toBe('/tmp/test-gitconfig');
    // 含 token 注入的 insteadOf
    expect(writes[0].c).toContain('https://x-access-token:ghp_secret@github.com/');
    expect(writes[0].c).toContain('insteadOf = https://github.com/');
    // 文件权限 600（含 token 不可读给他人）
    expect(writes[0].o?.mode).toBe(0o600);
    // env 指向配置文件
    expect(env.GIT_CONFIG_GLOBAL).toBe('/tmp/test-gitconfig');
  });

  it('无 token 时 no-op，不写文件不设 env', () => {
    const writes = [];
    const env = {};
    const ok = setupGitCredentials({
      token: '',
      configPath: '/tmp/test-gitconfig',
      env,
      writeFileFn: (p, c, o) => writes.push({ p, c, o }),
    });

    expect(ok).toBe(false);
    expect(writes).toHaveLength(0);
    expect(env.GIT_CONFIG_GLOBAL).toBeUndefined();
  });

  it('token 含特殊字符也原样写入（github_pat_ 形式）', () => {
    const writes = [];
    setupGitCredentials({
      token: 'github_pat_11ABC_xyz-123',
      configPath: '/tmp/c',
      env: {},
      writeFileFn: (p, c) => writes.push(c),
    });
    expect(writes[0]).toContain('x-access-token:github_pat_11ABC_xyz-123@github.com');
  });
});
