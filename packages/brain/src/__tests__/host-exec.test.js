import { describe, it, expect } from 'vitest';
import { discoverSshKey, buildHostCmd, EXEC_TIMEOUT_MS } from '../host-exec.js';

describe('discoverSshKey', () => {
  it('优先 id_ed25519（存在时）', () => {
    const key = discoverSshKey((p) => p.endsWith('id_ed25519'));
    expect(key).toMatch(/id_ed25519$/);
  });
  it('无 ed25519 回退 id_rsa（宿主实际只有 id_rsa 的先例）', () => {
    const key = discoverSshKey((p) => p.endsWith('id_rsa'));
    expect(key).toMatch(/id_rsa$/);
  });
  it('都不存在时回退 id_ed25519 默认路径', () => {
    const key = discoverSshKey(() => false);
    expect(key).toMatch(/id_ed25519$/);
  });
});

describe('buildHostCmd', () => {
  it('宿主直跑（非容器）原样返回，不包 ssh', () => {
    expect(buildHostCmd('launchctl list', false)).toBe('launchctl list');
  });
  it('容器内包 ssh 逃逸宿主，带 BatchMode + ConnectTimeout', () => {
    const wrapped = buildHostCmd('launchctl list', true, () => true);
    expect(wrapped).toContain('ssh -i');
    expect(wrapped).toContain('BatchMode=yes');
    expect(wrapped).toContain('ConnectTimeout=10');
    expect(wrapped).toContain("'launchctl list'");
  });
  it('单引号转义防命令拼接破损', () => {
    const wrapped = buildHostCmd("echo 'x'", true, () => true);
    // 原始单引号被转义为 '\'' 形式，包裹后仍是单条合法命令
    expect(wrapped).toContain(`'\\''`);
  });
});

describe('EXEC_TIMEOUT_MS', () => {
  it('导出为正数（供 defaultExec 与调用方共享）', () => {
    expect(EXEC_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
