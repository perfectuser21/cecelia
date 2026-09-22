import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('migration 458 接力棒脊柱', () => {
  it('加 parent_task_id / sequence_no 真列 + 自引用 FK + 回填 payload + task_type 放开 project', async () => {
    const sql = await readFile(new URL('../../migrations/458_relay_spine.sql', import.meta.url), 'utf8');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS parent_task_id UUID');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS sequence_no INTEGER');
    expect(sql).toContain('tasks_parent_task_id_fkey');
    expect(sql).toContain('ON DELETE SET NULL');
    expect(sql).toContain("payload->>'parent_task_id'");
    expect(sql).toContain("'project'");
    // 不重抄 82 个 task_type（457 教训）：靠读现有约束定义动态插入
    expect(sql).toContain('pg_get_constraintdef');
    expect(sql).not.toContain("'device_job',");
  });
});
