/**
 * 确定性守卫（spec §测试策略 §5）：
 * derive.js / gates.js / constants.js 源码禁 Date.now() / Math.random() / new Date(。
 * 时钟等非确定性输入必须从参数注入。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const PURE_FILES = ['derive.js', 'gates.js', 'constants.js'];
const FORBIDDEN = ['Date.now(', 'Math.random(', 'new Date('];

describe('确定性守卫：纯函数层禁非确定性调用', () => {
  for (const file of PURE_FILES) {
    for (const token of FORBIDDEN) {
      it(`${file} 不含 ${token}`, () => {
        const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
        expect(src.includes(token)).toBe(false);
      });
    }
  }
});
