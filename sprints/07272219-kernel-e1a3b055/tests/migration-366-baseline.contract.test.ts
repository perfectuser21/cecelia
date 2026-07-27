import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const migrationPath = path.join(
  repoRoot,
  'packages/brain/migrations/366_pr4372_recovery_baseline.sql'
);

describe('migration 366 baseline contract [BEHAVIOR]', () => {
  it('migration 366 SQL 文件存在且 schema_version 只写 366', () => {
    expect(
      fs.existsSync(migrationPath),
      'RED: packages/brain/migrations/366_pr4372_recovery_baseline.sql 尚未实现'
    ).toBe(true);

    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('366');
    expect(sql).toMatch(/schema_version/i);
    expect(sql).not.toMatch(/\b363\b|\b364\b|\b365\b|\b367\b/);
  });

  it('migration 366 contract 口径只允许 366 且测试文件名带 366', () => {
    const sprintDir = path.join(repoRoot, 'sprints/07272219-kernel-e1a3b055');
    const files = fs.readdirSync(path.join(sprintDir, 'tests'));
    expect(
      files.some((name) => name.includes('366')),
      'RED: sprint tests 尚未以 366 为唯一 migration 基线命名'
    ).toBe(true);

    const draft = fs.readFileSync(path.join(sprintDir, 'contract-draft.md'), 'utf8');
    const dod = fs.readFileSync(path.join(sprintDir, 'contract-dod.md'), 'utf8');
    const taskPlan = fs.readFileSync(path.join(sprintDir, 'task-plan.json'), 'utf8');
    expect(draft).toContain('migration baseline 锁定为 366');
    expect(dod).toContain('migration 366 SQL 文件存在且 schema_version 只写 366');
    expect(taskPlan).toContain('migration 366');
    expect(taskPlan).not.toMatch(/migration 363|migration 364|migration 365|migration 367/);
  });
});
