/**
 * routes/tick.js 路径完整性测试
 * 防止 routes/ 子目录引用 src/ 文件时路径层级写错（./executor.js vs ../executor.js）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../tick.js'), 'utf-8');

describe('routes/tick.js — import 路径正确性', () => {
  it('executor.js 引用应使用 ../executor.js 而非 ./executor.js', () => {
    expect(src).not.toContain("'./executor.js'");
    expect(src).not.toContain('"./executor.js"');
  });

  it('alertness/index.js 引用应使用 ./alertness/index.js（同级）', () => {
    expect(src).toContain("'./alertness/index.js'");
  });
});
