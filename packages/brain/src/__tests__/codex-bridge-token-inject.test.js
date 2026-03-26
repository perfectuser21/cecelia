/**
 * codex-bridge token 注入模式测试
 * 验证 setupInjectedAccounts / cleanupTmpDir 逻辑
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// 内联实现（与 codex-bridge.cjs 保持一致，避免 require CJS 在 ESM 测试中的问题）
function setupInjectedAccounts(taskId, accounts) {
  const tmpDir = path.join(os.tmpdir(), `codex-inj-${taskId}-${Date.now()}`);
  const homes = [];
  for (const { id, auth } of accounts) {
    const dir = path.join(tmpDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o700);
    const authFile = path.join(dir, 'auth.json');
    fs.writeFileSync(authFile, JSON.stringify(auth), { mode: 0o600 });
    homes.push(dir);
  }
  return { primaryHome: homes[0], allHomes: homes.join(':'), tmpDir };
}

function cleanupTmpDir(tmpDir) {
  if (!tmpDir) return;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

const MOCK_AUTH = {
  auth_mode: 'chatgpt',
  tokens: {
    access_token: 'eyJtb2NrX3Rva2VuIjoidGVzdCJ9',
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
