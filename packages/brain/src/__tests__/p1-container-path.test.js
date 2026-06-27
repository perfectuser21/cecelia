/**
 * Regression（2026-06-27 审计 P1）：两处"容器内路径解析错误"防护。
 *
 * 1) getRepoRoot() 必须优先 process.env.REPO_ROOT。
 *    根因：staging-promote.getRepoRoot() = path.resolve(import.meta.url, '../../..')，
 *    容器内文件在 /app/src/ → 解析成 '/'。routes/harness.js 的 /promote/:resultId 放行
 *    接口用裸 getRepoRoot() → promote 脚本路径 '/scripts/...' 不存在、回档锚点全 null。
 *    其它 caller（staging-e2e-runner）已用 process.env.REPO_ROOT || getRepoRoot() 绕过，
 *    最干净的修法是让 getRepoRoot 自己优先 env，一处修好所有 caller。
 *
 * 2) harness-initiative.graph.js 必须显式 import crypto。
 *    根因：line226 用 crypto.randomUUID() 但顶部无 import crypto，靠 Node 全局侥幸不崩；
 *    lint 收紧 / Node 移除全局即 ReferenceError 挂整条 initiative。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRepoRoot } from '../staging-promote.js';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('P1#3 getRepoRoot 优先 process.env.REPO_ROOT', () => {
  const orig = process.env.REPO_ROOT;
  afterEach(() => {
    if (orig === undefined) delete process.env.REPO_ROOT;
    else process.env.REPO_ROOT = orig;
  });

  it('REPO_ROOT 已设 → 直接返回它（容器内 bind-mount 路径）', () => {
    process.env.REPO_ROOT = '/Users/administrator/perfect21/cecelia';
    expect(getRepoRoot()).toBe('/Users/administrator/perfect21/cecelia');
  });

  it('REPO_ROOT 未设 → 回退 import.meta.url 相对解析（裸机直跑）', () => {
    delete process.env.REPO_ROOT;
    const r = getRepoRoot();
    expect(typeof r).toBe('string');
    expect(r).not.toBe('');
    expect(r).not.toBe('/'); // 裸机解析不应得到根
  });
});

describe('P1#6 harness-initiative.graph.js 显式 import crypto', () => {
  it('用了 crypto.* 就必须有 import crypto（防 ReferenceError 挂整条 initiative）', () => {
    const src = readFileSync(path.join(SRC_DIR, 'workflows/harness-initiative.graph.js'), 'utf8');
    if (/\bcrypto\.\w/.test(src)) {
      expect(src).toMatch(/import\s+crypto\s+from\s+['"]node:crypto['"]/);
    }
  });
});
