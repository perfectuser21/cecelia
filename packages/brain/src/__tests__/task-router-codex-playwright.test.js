import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

describe('task-router codex_playwright', () => {
  it('D1: LOCATION_MAP 包含 codex_playwright → xian（西安 Codex Bridge）', async () => {
    const mod = await import('../task-router.js');
    const location = mod.getTaskLocation('codex_playwright');
    expect(location).toBe('xian');
  });

  it('D2: isValidTaskType 接受 codex_playwright', async () => {
    const mod = await import('../task-router.js');
    expect(mod.isValidTaskType('codex_playwright')).toBe(true);
  });

  it('D3: migration 154 文件包含 codex_playwright 约束', () => {
    // CI 在 packages/brain 目录运行；本地从 monorepo 根运行
    const cwd = process.cwd();
    const fromPackage = resolve(cwd, 'migrations/154_add_codex_playwright_task_type.sql');
    const fromRoot = resolve(cwd, 'packages/brain/migrations/154_add_codex_playwright_task_type.sql');
    const migrationPath = existsSync(fromPackage) ? fromPackage : fromRoot;
    expect(existsSync(migrationPath)).toBe(true);
    const content = readFileSync(migrationPath, 'utf-8');
    expect(content).toContain('codex_playwright');
  });
});
