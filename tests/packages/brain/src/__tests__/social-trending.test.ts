/**
 * social-trending contract test
 *
 * 验证 social-trending 路由文件结构与内容
 * 行为测试见 packages/brain/src/__tests__/social-trending.test.ts
 */

import { describe, it, expect } from 'vitest';
import { accessSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAIN_SRC = resolve(__dirname, '../../../../../packages/brain/src');

describe('GET /api/brain/social/trending', () => {
  it('路由文件存在', () => {
    expect(() =>
      accessSync(resolve(BRAIN_SRC, 'routes/social-trending.js'))
    ).not.toThrow();
  });

  it('路由已注册到 routes.js', () => {
    const content = readFileSync(resolve(BRAIN_SRC, 'routes.js'), 'utf8');
    expect(content).toContain('social-trending');
    expect(content).toContain('/social');
  });

  it('端点实现含 platform 过滤和 limit 参数', () => {
    const content = readFileSync(
      resolve(BRAIN_SRC, 'routes/social-trending.js'),
      'utf8'
    );
    expect(content).toContain('platform');
    expect(content).toContain('limit');
    expect(content).toContain('v_all_platforms');
  });

  it('降级处理：连接失败返回空数组', () => {
    const content = readFileSync(
      resolve(BRAIN_SRC, 'routes/social-trending.js'),
      'utf8'
    );
    expect(content).toContain('res.json([])');
  });
});
