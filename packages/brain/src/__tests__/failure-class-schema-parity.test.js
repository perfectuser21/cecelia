/**
 * 回归守卫：harness_attempts.failure_class DB 约束 ↔ execution-contract.js 枚举奇偶性
 *
 * 防止未来有人在代码端添加新 failure_class 值但忘记写迁移（或反过来），
 * 导致 callback UPDATE 再次撞约束（issue d8463e4b，已烧掉 11 次重试）。
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// 从最新的 failure_class 迁移 SQL 中提取允许的枚举值
// migration 406: DROP + ADD CONSTRAINT … CHECK (failure_class IS NULL OR failure_class IN (…))
function extractMigrationClasses() {
  const sql = readFileSync(
    new URL('../../migrations/406_harness_attempt_account_exhausted.sql', import.meta.url),
    'utf8',
  );
  // 匹配 ADD CONSTRAINT … IN ('a', 'b', 'c') 块
  const match = sql.match(
    /ADD CONSTRAINT harness_attempts_failure_class_check[\s\S]*?failure_class IN \(([\s\S]*?)\)/i,
  );
  if (!match) throw new Error('Could not locate failure_class IN (...) block in migration 406');
  return match[1]
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
    .sort();
}

// 从 execution-contract.js 中提取 failure_class z.enum([…]) 的值列表
function extractCodeClasses() {
  const src = readFileSync(
    new URL('../orchestrator/execution-contract.js', import.meta.url),
    'utf8',
  );
  // 找到 failure_class: z.enum([ ... ]) 块
  const match = src.match(
    /failure_class:\s*z\.enum\(\s*\[([\s\S]*?)\]\s*\)/,
  );
  if (!match) throw new Error('Could not locate failure_class z.enum([...]) in execution-contract.js');
  return match[1]
    .split(',')
    .map((s) => s.trim().replace(/^'|'$|^"|"$/g, ''))
    .filter(Boolean)
    .sort();
}

describe('failure_class schema↔code parity (regression guard for issue d8463e4b)', () => {
  it('migration 406 SQL constraint values match execution-contract.js enum — exact set, no drift', () => {
    const dbClasses = extractMigrationClasses();
    const codeClasses = extractCodeClasses();

    expect(dbClasses).toEqual(codeClasses);
  });

  it('both sides include account_exhausted (the class that triggered 11 failed attempts)', () => {
    expect(extractMigrationClasses()).toContain('account_exhausted');
    expect(extractCodeClasses()).toContain('account_exhausted');
  });

  it('no side has a class the other does not know about', () => {
    const dbSet = new Set(extractMigrationClasses());
    const codeSet = new Set(extractCodeClasses());

    const dbOnly = [...dbSet].filter((c) => !codeSet.has(c));
    const codeOnly = [...codeSet].filter((c) => !dbSet.has(c));

    expect(dbOnly).toEqual([]);
    expect(codeOnly).toEqual([]);
  });
});
