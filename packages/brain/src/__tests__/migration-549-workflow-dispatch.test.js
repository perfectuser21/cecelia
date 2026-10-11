/** 迁移 549（任务 f38e7cc2）：tasks_task_type_check 纳入 workflow_dispatch（Brain 主动派 workflow 给 Commander）。 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = readFileSync(fileURLToPath(new URL('../../migrations/549_workflow_dispatch_task_type.sql', import.meta.url)), 'utf8');
const downPath = fileURLToPath(new URL('../../migrations/rollback/549_workflow_dispatch_task_type.down.sql', import.meta.url));

describe('migration 549 workflow_dispatch task_type', () => {
  it('在现有 tasks_task_type_check 上追加 workflow_dispatch（不重抄全量名单）', () => {
    expect(up).toMatch(/tasks_task_type_check/);
    expect(up).toMatch(/'workflow_dispatch'/);
    expect(up).toMatch(/pg_get_constraintdef/);
  });
  it('写 schema_version 549，事务包裹，有回滚脚本', () => {
    expect(up).toMatch(/INSERT INTO schema_version[\s\S]*'549'/);
    expect(up).toMatch(/^BEGIN;/m);
    expect(up.trim().endsWith('COMMIT;')).toBe(true);
    expect(existsSync(downPath)).toBe(true);
  });
});
