/**
 * codex-test-gen.test.js — 单元测试（lint-test-pairing 配套）
 *
 * 测试 codex-test-gen.js 纯逻辑部分（无 DB 依赖）：
 *   - scanMissingTestFiles：黑名单过滤、测试文件自身过滤
 *   - checkDedup：去重判断逻辑（注入 recentFiles 集合）
 */

import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scanMissingTestFiles, checkDedup } from '../codex-test-gen.js';

const __dirname_test = dirname(fileURLToPath(import.meta.url));
const BRAIN_SRC = join(__dirname_test, '..');

describe('scanMissingTestFiles — 黑名单过滤', () => {
  it('注入真实 srcDir 后结果不含 dispatcher 路径', async () => {
    const result = await scanMissingTestFiles({ srcDir: BRAIN_SRC });
    const hasForbidden = result.some((f) =>
      ['dispatcher', 'slot-allocator', 'migration'].some((p) => f.includes(p))
    );
    expect(hasForbidden, `结果含禁止路径: ${result.filter((f) => f.includes('dispatcher')).join(', ')}`).toBe(false);
  });

  it('注入真实 srcDir 后结果不含 .test.js 文件本身', async () => {
    const result = await scanMissingTestFiles({ srcDir: BRAIN_SRC });
    const hasTestFile = result.some((f) => f.includes('.test.'));
    expect(hasTestFile, '扫描结果含 .test.js 文件，不应出现').toBe(false);
  });

  it('注入空目录或不存在路径时返回空数组', async () => {
    const result = await scanMissingTestFiles({ srcDir: '/nonexistent/path/abc' });
    expect(result).toEqual([]);
  });
});

describe('checkDedup — 去重判断', () => {
  it('目标文件在 recentFiles 集合中时返回 skipped:true', async () => {
    const recentFiles = new Set(['packages/brain/src/some-module.js']);
    const result = await checkDedup({
      targetFile: 'packages/brain/src/some-module.js',
      recentFiles,
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('dedup_7_days');
  });

  it('目标文件不在 recentFiles 集合中时返回 skipped:false', async () => {
    const recentFiles = new Set(['packages/brain/src/other-module.js']);
    const result = await checkDedup({
      targetFile: 'packages/brain/src/some-module.js',
      recentFiles,
    });
    expect(result.skipped).toBe(false);
  });

  it('recentFiles 为空集合时返回 skipped:false', async () => {
    const result = await checkDedup({
      targetFile: 'packages/brain/src/any-module.js',
      recentFiles: new Set(),
    });
    expect(result.skipped).toBe(false);
  });
});
