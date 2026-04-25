/**
 * Tests for tick.js step 6.5 梯度 requeue
 *
 * 验证：
 * 1. MAX_REQUEUE_PER_TICK 常量存在且默认为 2
 * 2. UPDATE 使用子查询 + ORDER BY priority + LIMIT 形式（P0 优先）
 * 3. 执行后查询剩余 remaining 数量
 *
 * 采用文件静态分析方式，避免启动整个 tick() 依赖链。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// D1.7b 后 executeTick body（含 step 6.5）和 MAX_REQUEUE_PER_TICK 常量都搬到 tick-runner.js；
// tick.js 不再 declare/use 该常量
const runnerSrc = readFileSync(join(__dirname, '../tick-runner.js'), 'utf-8');

describe('MAX_REQUEUE_PER_TICK 常量', () => {
  it('常量声明存在且默认为 2（在 tick-runner.js）', () => {
    expect(runnerSrc).toContain('MAX_REQUEUE_PER_TICK = 2');
  });

  it('常量在 step 6.5 UPDATE 中作为参数传入', () => {
    expect(runnerSrc).toContain('[MAX_REQUEUE_PER_TICK]');
  });
});

describe('step 6.5 UPDATE SQL 结构（在 tick-runner.js）', () => {
  it('UPDATE 使用子查询 WHERE id IN (SELECT ...)', () => {
    expect(runnerSrc).toMatch(/UPDATE tasks SET status = 'queued'[\s\S]*?WHERE id IN\s*\(/);
  });

  it('子查询按 priority 排序（P0=0, P1=1 CASE 表达式）', () => {
    expect(runnerSrc).toContain("WHEN 'P0' THEN 0 WHEN 'P1' THEN 1");
  });

  it('子查询按 created_at ASC 二级排序', () => {
    expect(runnerSrc).toMatch(/ORDER BY CASE priority[\s\S]*?created_at ASC/);
  });

  it('子查询使用 LIMIT $1 参数化', () => {
    expect(runnerSrc).toContain('LIMIT $1');
  });
});

describe('step 6.5 剩余数量统计', () => {
  it('requeue 后查询剩余 quota_exhausted 数量', () => {
    // 验证存在对 remaining 的 COUNT 查询
    expect(runnerSrc).toMatch(/SELECT COUNT\(\*\)[\s\S]*?status = 'quota_exhausted'/);
  });

  it('log 中包含 remaining 字段', () => {
    expect(runnerSrc).toMatch(/remaining=\$\{remaining\}/);
  });
});

describe('6 个 quota_exhausted 任务：第一 tick 只 requeue 2 个（SQL LIMIT 保证）', () => {
  it('LIMIT 值由 MAX_REQUEUE_PER_TICK=2 决定，不是硬编码', () => {
    // 确保没有 "LIMIT 2" 硬编码，而是 LIMIT $1 + [MAX_REQUEUE_PER_TICK]
    const hardcoded = /LIMIT\s+2\b/.test(runnerSrc);
    const parameterized = runnerSrc.includes('LIMIT $1') && runnerSrc.includes('[MAX_REQUEUE_PER_TICK]');
    // 要么没有硬编码，要么使用了参数化
    expect(parameterized).toBe(true);
    if (hardcoded) {
      // 硬编码只允许在 MAX_REQUEUE_PER_TICK 的常量定义行
      const hardcodedLines = runnerSrc.split('\n').filter(l => /LIMIT\s+2\b/.test(l));
      // 所有 LIMIT 2 必须是在注释或字符串中（非 SQL 子查询）
      hardcodedLines.forEach(line => {
        // 允许：MAX_REQUEUE_PER_TICK = 2 这种常量定义行
        // 不允许：在 SQL 里直接 LIMIT 2
        expect(line).not.toMatch(/^\s*LIMIT\s+2\b/);
      });
    }
  });
});
