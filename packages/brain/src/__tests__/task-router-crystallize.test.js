import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import * as taskRouter from '../task-router.js';

const { getTaskLocation, isValidTaskType, LOCATION_MAP, TASK_REQUIREMENTS } = taskRouter;

describe('task-router crystallize', () => {
  it('D1: LOCATION_MAP 所有 crystallize 子类型均路由到 xian', () => {
    const types = ['crystallize', 'crystallize_scope', 'crystallize_forge', 'crystallize_verify', 'crystallize_register'];
    for (const t of types) {
      expect(getTaskLocation(t), `${t} should route to xian`).toBe('xian');
    }
  });

  it('D2: isValidTaskType 接受所有 crystallize 子类型', () => {
    const types = ['crystallize', 'crystallize_scope', 'crystallize_forge', 'crystallize_verify', 'crystallize_register'];
    for (const t of types) {
      expect(isValidTaskType(t), `${t} should be valid`).toBe(true);
    }
  });

  it('D3: codex_playwright 已从 LOCATION_MAP 移除', () => {
    expect(LOCATION_MAP['codex_playwright']).toBeUndefined();
    expect(isValidTaskType('codex_playwright')).toBe(false);
  });

  it('D4: migration 184 文件存在并包含 crystallize 约束', () => {
    const cwd = process.cwd();
    const fromPackage = resolve(cwd, 'migrations/184_add_crystallize_task_type.sql');
    const fromRoot = resolve(cwd, 'packages/brain/migrations/184_add_crystallize_task_type.sql');
    const migrationPath = existsSync(fromPackage) ? fromPackage : fromRoot;
    expect(existsSync(migrationPath)).toBe(true);
    const content = readFileSync(migrationPath, 'utf-8');
    expect(content).toContain('crystallize');
    expect(content).not.toContain('codex_playwright');
  });

  it('D5: TASK_REQUIREMENTS 中 crystallize 类型有 has_browser 标签', () => {
    const types = ['crystallize', 'crystallize_scope', 'crystallize_forge', 'crystallize_verify', 'crystallize_register'];
    for (const t of types) {
      const reqs = TASK_REQUIREMENTS[t] || [];
      expect(reqs, `${t} should have has_browser`).toContain('has_browser');
    }
  });
});
