import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migPath = resolve(__dirname, '../../migrations/314_tasks_custom_props_column.sql');

// harness_initiative 的 markInitiativeTerminalFailed（executor.js）执行
//   UPDATE tasks SET status='failed', ...
//     custom_props = jsonb_set(COALESCE(custom_props,'{}'::jsonb), '{failure_class}', $2::jsonb)
// 但 tasks 表此前从未有 custom_props 列，导致该 UPDATE 在真实 Postgres 里整句报错，
// 被函数自身 try/catch 静默吞掉（non-fatal warn），status/failure_class 从未真正落库。
// 由 harness-orchestrator-lockdown-smoke.sh 在 real-env-smoke 首次暴露（真实 Postgres）。
describe('migration 314：tasks.custom_props 列', () => {
  it('314 文件存在', () => {
    expect(existsSync(migPath)).toBe(true);
  });

  it('additive（IF NOT EXISTS），加 custom_props jsonb 到 tasks 表', () => {
    const c = readFileSync(migPath, 'utf8');
    expect(c).toMatch(/ALTER TABLE tasks ADD COLUMN IF NOT EXISTS custom_props jsonb/);
  });
});
