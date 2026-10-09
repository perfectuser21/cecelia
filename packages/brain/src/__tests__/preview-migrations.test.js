// 回归：PR 预览实例（BRAIN_PREVIEW=1）被当成被动实例跳过迁移，克隆库停在旧 schema，
// GET /api/brain/tasks/:id/chain 报 500 `column "parent_task_id" does not exist`（PR#6139 QA T-7）。
// preview-env-start.sh 显式传 SKIP_MIGRATIONS=false，这个显式意图必须让预览库迁到 PR 代码的 schema。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { shouldRunMigrations } from '../runtime-safety.js';

describe('shouldRunMigrations', () => {
  it('预览实例显式 SKIP_MIGRATIONS=false 时执行迁移', () => {
    expect(shouldRunMigrations({
      BRAIN_PREVIEW: '1',
      DB_NAME: 'cecelia_preview_6139',
      DATABASE_URL: 'postgresql://cecelia:cecelia@localhost/cecelia_preview_6139',
      SKIP_MIGRATIONS: 'false',
    })).toBe(true);
  });

  it('隔离实例未显式要求时仍跳过迁移', () => {
    expect(shouldRunMigrations({ BRAIN_PREVIEW: '1' })).toBe(false);
    expect(shouldRunMigrations({ NODE_ENV: 'test', DB_NAME: 'cecelia_scratch' })).toBe(false);
  });

  it('SKIP_MIGRATIONS=true 任何实例都跳过', () => {
    expect(shouldRunMigrations({ SKIP_MIGRATIONS: 'true' })).toBe(false);
    expect(shouldRunMigrations({ NODE_ENV: 'test', SKIP_MIGRATIONS: 'true' })).toBe(false);
  });

  it('生产实例默认执行迁移', () => {
    expect(shouldRunMigrations({ NODE_ENV: 'production', DB_NAME: 'cecelia' })).toBe(true);
  });

  it('server.js 用 shouldRunMigrations 决定是否迁移', () => {
    const source = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    expect(source).toMatch(/if \(!shouldRunMigrations\(\)\)/);
    expect(source).not.toMatch(/isIsolatedRuntime\(\) \|\| process\.env\.SKIP_MIGRATIONS/);
  });
});
