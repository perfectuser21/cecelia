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

// PRD 需求 3（健康检查红线）：/api/brain/alertness 必须能看见「静默停摆」——
// 存在活跃阻断状态位时返回 blocking_states（非空）+ 不再报 healthy。
describe('routes/tick.js — /alertness 阻断位可见性', () => {
  it('引用 getBlockingStates 并在响应里带 blocking_states 字段', () => {
    expect(src).toContain('getBlockingStates');
    expect(src).toContain('blocking_states');
  });
});
