/**
 * Regression（2026-06-27 审计 P1）：容器内路径解析错误防护。
 *
 * getRepoRoot() 必须优先 process.env.REPO_ROOT。
 * 根因：staging-promote.getRepoRoot() = path.resolve(import.meta.url, '../../..')，
 * 容器内文件在 /app/src/ → 解析成 '/'。routes/harness.js 的 /promote/:resultId 放行
 * 接口用裸 getRepoRoot() → promote 脚本路径 '/scripts/...' 不存在、回档锚点全 null。
 * 其它 caller（staging-e2e-runner）已用 process.env.REPO_ROOT || getRepoRoot() 绕过，
 * 最干净的修法是让 getRepoRoot 自己优先 env，一处修好所有 caller。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getRepoRoot } from '../staging-promote.js';

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
