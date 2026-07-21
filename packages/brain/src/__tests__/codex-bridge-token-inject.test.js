/**
 * codex-bridge token 注入模式测试
 * 验证 setupInjectedAccounts / cleanupTmpDir / loadRawAuth / injectLocalAccount 逻辑
 *
 * 2026-07-21：codex-bridge.cjs 加了 require.main===module 守卫 + module.exports，
 * 现在直接 require() 真实文件测真实函数，不再内联复刻（旧注释说"避免 require CJS
 * 在 ESM 测试中的问题"已不成立——用 createRequire 从 ESM 测试文件里 require CJS
 * 完全没问题，之前是文件本身顶层直接 listen 端口/可能 process.exit 导致不敢 require）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { setupInjectedAccounts, cleanupTmpDir, loadRawAuth, injectLocalAccount } =
  require('../../scripts/codex-bridge/codex-bridge.cjs');

const MOCK_AUTH = {
  auth_mode: 'chatgpt',
  tokens: {
    access_token: 'mock_access_token_for_testing',
    id_token: 'mock_id',
    refresh_token: 'mock_refresh',
    account_id: 'org-test123',
  },
  last_refresh: '2026-03-26T00:00:00Z',
};

describe('setupInjectedAccounts', () => {
  let tmpDir = null;

  afterEach(() => {
    cleanupTmpDir(tmpDir);
    tmpDir = null;
  });

  it('有 accounts 时写临时目录，primaryHome 为第一个账号', () => {
    const accounts = [
      { id: 'team1', auth: MOCK_AUTH },
      { id: 'team2', auth: MOCK_AUTH },
    ];
    const result = setupInjectedAccounts('task-abc123', accounts);
    tmpDir = result.tmpDir;

    expect(result.primaryHome).toContain('team1');
    expect(result.allHomes).toContain('team1');
    expect(result.allHomes).toContain('team2');
    expect(result.allHomes).toContain(':');
    expect(fs.existsSync(result.tmpDir)).toBe(true);
  });

  it('auth.json 写入正确内容', () => {
    const accounts = [{ id: 'team1', auth: MOCK_AUTH }];
    const result = setupInjectedAccounts('task-write-test', accounts);
    tmpDir = result.tmpDir;

    const authFile = path.join(result.primaryHome, 'auth.json');
    expect(fs.existsSync(authFile)).toBe(true);
    const written = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    expect(written.auth_mode).toBe('chatgpt');
    expect(written.tokens.account_id).toBe('org-test123');
  });

  it('目录权限为 700', () => {
    const accounts = [{ id: 'team3', auth: MOCK_AUTH }];
    const result = setupInjectedAccounts('task-perm-test', accounts);
    tmpDir = result.tmpDir;

    const stat = fs.statSync(result.primaryHome);
    const mode = stat.mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('单账号时 allHomes 无冒号', () => {
    const accounts = [{ id: 'team1', auth: MOCK_AUTH }];
    const result = setupInjectedAccounts('task-single', accounts);
    tmpDir = result.tmpDir;

    expect(result.allHomes).not.toContain(':');
    expect(result.primaryHome).toBe(result.allHomes);
  });
});

describe('cleanupTmpDir', () => {
  it('执行后目录不存在', () => {
    const accounts = [{ id: 'team1', auth: MOCK_AUTH }];
    const { tmpDir: dir } = setupInjectedAccounts('task-cleanup', accounts);
    expect(fs.existsSync(dir)).toBe(true);

    cleanupTmpDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('null 时不报错', () => {
    expect(() => cleanupTmpDir(null)).not.toThrow();
  });

  it('不存在的目录不报错', () => {
    expect(() => cleanupTmpDir('/tmp/nonexistent-codex-dir-xyz')).not.toThrow();
  });
});

describe('降级模式改走注入（loadRawAuth + injectLocalAccount，2026-07-21）', () => {
  let fakeHome = null;
  let tmpDir = null;

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bridge-fakehome-'));
  });

  afterEach(() => {
    cleanupTmpDir(tmpDir);
    tmpDir = null;
    if (fakeHome) fs.rmSync(fakeHome, { recursive: true, force: true });
    fakeHome = null;
  });

  it('loadRawAuth 读到真实 auth.json 的完整原始内容（不是 getCodexAuth 那种精简形状）', () => {
    const dir = path.join(fakeHome, '.codex-team3');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify(MOCK_AUTH));

    const raw = loadRawAuth('team3', fakeHome);
    expect(raw.auth_mode).toBe('chatgpt');
    expect(raw.tokens.access_token).toBe('mock_access_token_for_testing');
    expect(raw.last_refresh).toBe('2026-03-26T00:00:00Z');
  });

  it('injectLocalAccount 把真实 auth.json 快照进临时目录，不是直接返回真实路径', () => {
    const realDir = path.join(fakeHome, '.codex-team3');
    fs.mkdirSync(realDir, { recursive: true });
    fs.writeFileSync(path.join(realDir, 'auth.json'), JSON.stringify(MOCK_AUTH));

    const result = injectLocalAccount('task-fallback-test', 'team3', fakeHome);
    tmpDir = result.tmpDir;

    // 返回的 primaryHome 必须是临时目录，不能等于真实持久目录
    expect(result.primaryHome).not.toBe(realDir);
    expect(result.primaryHome.startsWith(os.tmpdir())).toBe(true);
    // 但内容跟真实文件一致（快照，不是伪造数据）
    const injectedAuth = JSON.parse(fs.readFileSync(path.join(result.primaryHome, 'auth.json'), 'utf8'));
    expect(injectedAuth.tokens.access_token).toBe('mock_access_token_for_testing');
  });

  it('临时目录清理后，真实的 auth.json 原封不动（验证隔离，不是同一份文件）', () => {
    const realDir = path.join(fakeHome, '.codex-team3');
    fs.mkdirSync(realDir, { recursive: true });
    const realAuthPath = path.join(realDir, 'auth.json');
    fs.writeFileSync(realAuthPath, JSON.stringify(MOCK_AUTH));

    const result = injectLocalAccount('task-isolation-test', 'team3', fakeHome);
    // 改一下临时目录里的内容，模拟容器内 codex 自刷新写了新 token
    fs.writeFileSync(
      path.join(result.primaryHome, 'auth.json'),
      JSON.stringify({ ...MOCK_AUTH, tokens: { ...MOCK_AUTH.tokens, access_token: 'refreshed_in_container' } })
    );
    cleanupTmpDir(result.tmpDir);

    // 真实文件必须还是原始内容——容器内的"刷新"从未触达它
    const realAfter = JSON.parse(fs.readFileSync(realAuthPath, 'utf8'));
    expect(realAfter.tokens.access_token).toBe('mock_access_token_for_testing');
  });
});
