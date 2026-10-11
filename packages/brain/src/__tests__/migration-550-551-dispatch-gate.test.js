/**
 * 迁移 550 / 551（派发总闸 F，任务 0a70684f）：
 *  550 tasks_task_type_check 纳入 skill_factory_run / coding_workflow，并把在途借壳单迁到新类型（每条写 task_events）；
 *  551 清理生产里无人领的卡死单：先列清单再动，按 id + 状态守卫逐条处置，每条写 task_events。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const up550 = read('../../migrations/550_skill_factory_coding_workflow_task_types.sql');
const up551 = read('../../migrations/551_dispatch_gate_stuck_task_cleanup.sql');
const down = (n) => existsSync(fileURLToPath(new URL(`../../migrations/rollback/${n}.down.sql`, import.meta.url)));

describe('migration 550 skill_factory_run / coding_workflow', () => {
  it('在现有 tasks_task_type_check 上追加两个新类型（pg_get_constraintdef，不重抄全量名单）', () => {
    expect(up550).toMatch(/pg_get_constraintdef/);
    expect(up550).toMatch(/'skill_factory_run'/);
    expect(up550).toMatch(/'coding_workflow'/);
  });

  it('在途借壳单迁新类型：只动 queued/in_progress，工厂按 factory_dispatch、编码按 coding_workflow 开关', () => {
    expect(up550).toMatch(/SET task_type\s*=\s*'skill_factory_run'[\s\S]*task_type\s*=\s*'research'[\s\S]*factory_dispatch[\s\S]*status IN \('queued',\s*'in_progress'\)/);
    expect(up550).toMatch(/SET task_type\s*=\s*'coding_workflow'[\s\S]*task_type\s*=\s*'data'[\s\S]*coding_workflow[\s\S]*status IN \('queued',\s*'in_progress'\)/);
    expect(up550).toMatch(/kind\s*=\s*'workflow'/);
  });

  it('每条迁移都写 task_events（task_type_migrated）', () => {
    expect((up550.match(/INSERT INTO task_events/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(up550).toMatch(/task_type_migrated/);
  });

  it('写 schema_version 550，事务包裹，有回滚脚本', () => {
    expect(up550).toMatch(/INSERT INTO schema_version[\s\S]*'550'/);
    expect(up550).toMatch(/^BEGIN;/m);
    expect(up550.trim().endsWith('COMMIT;')).toBe(true);
    expect(down('550_skill_factory_coding_workflow_task_types')).toBe(true);
  });
});

describe('migration 551 卡死单清理', () => {
  it('a55c7664（trigger_backup 无执行者）→ cancelled，守卫 status=queued', () => {
    expect(up551).toMatch(/a55c7664-befc-4083-b4a1-690fed30e7f6/);
    expect(up551).toMatch(/'cancelled'/);
    expect(up551).toMatch(/status\s*=\s*'queued'/);
  });

  it('02383d3f（派发器守望中断、会话已交付的工厂执行单）→ failed 并写 fail_reason，守卫 in_progress + 已有 delivery', () => {
    expect(up551).toMatch(/02383d3f-f77b-41b9-97e5-686bcc1e125d/);
    expect(up551).toMatch(/status\s*=\s*'in_progress'/);
    expect(up551).toMatch(/result \? 'delivery'/);
    expect(up551).toMatch(/fail_reason/);
  });

  it('每条处置写 task_events（dispatch_gate_cleanup），带原因', () => {
    expect((up551.match(/INSERT INTO task_events/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(up551).toMatch(/dispatch_gate_cleanup/);
    expect(up551).toMatch(/reason/);
  });

  it('写 schema_version 551，事务包裹，有回滚说明', () => {
    expect(up551).toMatch(/INSERT INTO schema_version[\s\S]*'551'/);
    expect(up551).toMatch(/^BEGIN;/m);
    expect(up551.trim().endsWith('COMMIT;')).toBe(true);
    expect(down('551_dispatch_gate_stuck_task_cleanup')).toBe(true);
  });
});
