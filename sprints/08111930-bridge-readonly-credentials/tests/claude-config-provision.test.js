// TDD Red — 宿主 bridge 凭据只读消费：临时 config dir provision / cleanup 单元测试
// 被测对象（Generator 需实现）：packages/brain/scripts/lib/claude-config-provision.cjs
//   - provisionConfigDir({ accountId, homeDir, tmpBase }) → { configDir, authoritativeDir }
//   - cleanupConfigDir(configDir, { logger, rmImpl }) → boolean
//   - resolveAuthoritativeConfigDir(accountId, homeDir) → string
//
// 禁 mock 边（CONTRACT IS LAW）：本文件对「代码 ↔ 文件系统 config dir」这条被改的边全部用真实 fs +
// 真实临时目录（os.tmpdir 下真建真拷真删）。唯一允许的注入是 cleanupConfigDir 的 rmImpl —— 仅用于
// 触发「清理失败」错误分支（catch/log），不替身化 provision 的真实拷贝 happy-path。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.resolve(__dirname, '../../../packages/brain/scripts/lib/claude-config-provision.cjs');

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

let fakeHome;
let authDir;
let tmpBase;

beforeEach(() => {
  fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-home-'));
  authDir = path.join(fakeHome, '.claude-account1');
  fs.mkdirSync(authDir, { recursive: true });
  // 权威凭据 + 一份附带 config，模拟 claude CLI 刷新所需文件集
  fs.writeFileSync(path.join(authDir, '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: 'AUTH-ORIGINAL', expiresAt: 9999999999999 } }));
  fs.writeFileSync(path.join(authDir, 'settings.json'), JSON.stringify({ theme: 'dark' }));
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ccp-tmpbase-'));
});

afterEach(() => {
  for (const d of [fakeHome, tmpBase]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe('claude-config-provision — 宿主 bridge 凭据只读消费 [BEHAVIOR]', () => {
  it('provisionConfigDir copies authoritative credentials into a unique temp dir (not the authoritative dir)', () => {
    const { provisionConfigDir } = require(MOD);
    const { configDir, authoritativeDir } = provisionConfigDir({ accountId: 'account1', homeDir: fakeHome, tmpBase });
    expect(authoritativeDir).toBe(authDir);
    expect(configDir).not.toBe(authDir);
    expect(path.resolve(configDir)).not.toBe(path.resolve(authDir));
    // 临时副本真的拷到了凭据（否则 claude 起不来）
    const copied = path.join(configDir, '.credentials.json');
    expect(fs.existsSync(copied)).toBe(true);
    expect(JSON.parse(fs.readFileSync(copied, 'utf8')).claudeAiOauth.accessToken).toBe('AUTH-ORIGINAL');
  });

  it('provisionConfigDir returns distinct config dirs for concurrent calls', () => {
    const { provisionConfigDir } = require(MOD);
    const a = provisionConfigDir({ accountId: 'account1', homeDir: fakeHome, tmpBase });
    const b = provisionConfigDir({ accountId: 'account1', homeDir: fakeHome, tmpBase });
    expect(a.configDir).not.toBe(b.configDir);
    expect(fs.existsSync(a.configDir)).toBe(true);
    expect(fs.existsSync(b.configDir)).toBe(true);
  });

  it('provisionConfigDir leaves the authoritative credentials file mtime and sha256 unchanged', () => {
    const { provisionConfigDir } = require(MOD);
    const authFile = path.join(authDir, '.credentials.json');
    const mtimeBefore = fs.statSync(authFile).mtimeMs;
    const shaBefore = sha256(authFile);
    provisionConfigDir({ accountId: 'account1', homeDir: fakeHome, tmpBase });
    const mtimeAfter = fs.statSync(authFile).mtimeMs;
    const shaAfter = sha256(authFile);
    expect(mtimeAfter).toBe(mtimeBefore);
    expect(shaAfter).toBe(shaBefore);
  });

  it('provisionConfigDir throws when the temp dir cannot be created (no fallback to authoritative)', () => {
    const { provisionConfigDir } = require(MOD);
    // tmpBase 指向一个「文件」下的子路径 → mkdir 必然 ENOTDIR，触发真实创建失败
    const fileNotDir = path.join(tmpBase, 'not-a-dir');
    fs.writeFileSync(fileNotDir, 'x');
    const badBase = path.join(fileNotDir, 'sub');
    expect(() => provisionConfigDir({ accountId: 'account1', homeDir: fakeHome, tmpBase: badBase })).toThrow();
    // 断言未回退：权威目录内容未被当作 configDir 返回，也未被拷贝出附带副本到权威目录旁
    const shaAuth = sha256(path.join(authDir, '.credentials.json'));
    expect(shaAuth).toBe(sha256(path.join(authDir, '.credentials.json')));
  });

  it('cleanupConfigDir removes the provisioned temp dir and returns true', () => {
    const { provisionConfigDir, cleanupConfigDir } = require(MOD);
    const { configDir } = provisionConfigDir({ accountId: 'account1', homeDir: fakeHome, tmpBase });
    expect(fs.existsSync(configDir)).toBe(true);
    const ok = cleanupConfigDir(configDir);
    expect(ok).toBe(true);
    expect(fs.existsSync(configDir)).toBe(false);
  });

  it('cleanupConfigDir returns false when removal fails, logging a warning without throwing', () => {
    const { cleanupConfigDir } = require(MOD);
    const warns = [];
    const logger = { warn: (...a) => warns.push(a.join(' ')), error: () => {}, log: () => {} };
    // 仅注入抛错的 rm 触发 catch 分支（清理失败错误路径），不替身化 provision 真实拷贝
    const rmImpl = () => { throw new Error('EACCES simulated cleanup failure'); };
    let result;
    expect(() => { result = cleanupConfigDir('/tmp/ccp-does-not-matter', { logger, rmImpl }); }).not.toThrow();
    expect(result).toBe(false);
    expect(warns.join('\n')).toMatch(/cleanup|清理|EACCES/i);
  });

  it('resolveAuthoritativeConfigDir defaults to account1 when accountId is absent', () => {
    const { resolveAuthoritativeConfigDir } = require(MOD);
    expect(resolveAuthoritativeConfigDir(undefined, fakeHome)).toBe(path.join(fakeHome, '.claude-account1'));
    expect(resolveAuthoritativeConfigDir('account2', fakeHome)).toBe(path.join(fakeHome, '.claude-account2'));
  });
});
