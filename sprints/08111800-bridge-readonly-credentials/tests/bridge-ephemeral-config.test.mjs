// bridge-ephemeral-config.test.mjs — TDD 红：宿主 bridge 临时 config dir helper 规格
//
// 依赖尚未存在的 helper：packages/brain/scripts/ephemeral-claude-config.cjs
// 现阶段 import 即失败（模块不存在）→ RED。generator 实现 helper 后转绿。
// 该 helper 是 bridge 只读消费凭据的单写入者隔离核心（禁 mock 被改的边：真 fs）。
//
// 契约（CONTRACT IS LAW）：
//   module.exports.prepareEphemeralClaudeConfig(accountId, opts?) →
//     { configDir: string, authoritativeDir: string, cleanup: () => void }
//   - configDir 是 fs.mkdtempSync 在 os.tmpdir() 下新建的独立目录，!== authoritativeDir
//   - 把 authoritativeDir 内容复制进 configDir，.credentials.json 是真实副本（非 symlink 回权威）
//   - 源目录缺失或临时目录创建失败 → throw（不得回退到权威目录）
//   - cleanup() 删除 configDir；删除失败只吞错记日志，不抛
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const HELPER = path.resolve(__dirname, '../../../packages/brain/scripts/ephemeral-claude-config.cjs');

function loadHelper() {
  return require(HELPER).prepareEphemeralClaudeConfig;
}

describe('prepareEphemeralClaudeConfig [BEHAVIOR]', () => {
  let home;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-home-'));
    process.env.HOME = home;
  });
  afterEach(() => {
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  });

  function makeAuth(accountId) {
    const dir = path.join(home, '.claude-' + accountId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.credentials.json'), '{"accessToken":"ORIGINAL"}');
    fs.writeFileSync(path.join(dir, 'settings.json'), '{"theme":"dark"}');
    return dir;
  }

  it('创建独立临时目录且复制凭据，权威目录零写入', () => {
    const prep = loadHelper();
    const auth = makeAuth('account1');
    const before = fs.readFileSync(path.join(auth, '.credentials.json'), 'utf8');
    const r = prep('account1');
    expect(r.configDir).toBeTruthy();
    expect(r.configDir).not.toBe(auth);
    expect(fs.existsSync(path.join(r.configDir, '.credentials.json'))).toBe(true);
    // 复制是真实副本：改临时副本不回写权威
    fs.writeFileSync(path.join(r.configDir, '.credentials.json'), '{"accessToken":"REFRESHED"}');
    expect(fs.readFileSync(path.join(auth, '.credentials.json'), 'utf8')).toBe(before);
    r.cleanup();
  });

  it('cleanup 删除临时目录', () => {
    const prep = loadHelper();
    makeAuth('account1');
    const r = prep('account1');
    expect(fs.existsSync(r.configDir)).toBe(true);
    r.cleanup();
    expect(fs.existsSync(r.configDir)).toBe(false);
  });

  it('权威源目录缺失时抛错，不回退', () => {
    const prep = loadHelper();
    expect(() => prep('accountMissing')).toThrow();
  });

  it('临时目录创建失败时抛错（TMPDIR 破坏）', () => {
    const prep = loadHelper();
    makeAuth('account1');
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = path.join(home, 'nonexistent-tmp-xyz');
    try {
      expect(() => prep('account1')).toThrow();
    } finally {
      if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved;
    }
  });

  it('cleanup 在目标已被外部删除时不抛错', () => {
    const prep = loadHelper();
    makeAuth('account1');
    const r = prep('account1');
    fs.rmSync(r.configDir, { recursive: true, force: true });
    expect(() => r.cleanup()).not.toThrow();
  });
});
