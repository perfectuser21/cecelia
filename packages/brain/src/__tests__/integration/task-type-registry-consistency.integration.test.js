/**
 * task-type-registry-consistency Integration Test（真实 PostgreSQL）
 *
 * 根因守卫：task-router.js 的 VALID_TASK_TYPES（JS 层白名单）与
 * tasks_task_type_check（DB 层白名单）是两份独立维护的清单，此前
 * strategist_decision 在 JS 层登记但 DB 层漏登记，导致生产环境
 * INSERT 静默失败到暴露为止无人发现。
 *
 * 本测试直接从真实 DB 的 pg_constraint 解析 tasks_task_type_check
 * 当前允许的值集合，断言 VALID_TASK_TYPES 是它的子集——任何以后
 * 再次出现"JS 登记、DB 未登记"的新 task_type，本测试立即失败，
 * 不必等生产环境真实 INSERT 失败才发现。
 *
 * 运行环境：CI brain-unit job（含真实 PostgreSQL 服务），不 mock db.js。
 */

import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { VALID_TASK_TYPES } from '../../task-router.js';

const testPool = new pg.Pool({ ...DB_DEFAULTS, max: 3 });

afterAll(async () => {
  await testPool.end();
});

async function getDbAllowedTaskTypes() {
  const result = await testPool.query(
    `SELECT pg_get_constraintdef(oid) AS def
     FROM pg_constraint
     WHERE conname = 'tasks_task_type_check'`
  );
  if (result.rows.length === 0) {
    throw new Error('tasks_task_type_check 约束不存在——DB 未跑到位或约束被重命名');
  }
  const def = result.rows[0].def;
  // pg_get_constraintdef 输出形如:
  // CHECK (((task_type)::text = ANY ((ARRAY['dev'::character varying, 'review'::character varying, ...])::text[])))
  // task_type 列实际类型是 character varying(20)，Postgres 打印字面量时用列的原始类型转型
  // （历史上曾是 text 列，故同时兼容 ::text 转型，双写正则以防列类型再变化）。
  const matches = [...def.matchAll(/'([^']+)'::(?:character varying|text)/g)];
  return new Set(matches.map(m => m[1]));
}

describe('task-type-registry-consistency Integration Test（真实 PostgreSQL）', () => {
  it('VALID_TASK_TYPES（JS 层白名单）必须是 tasks_task_type_check（DB 层白名单）的子集', async () => {
    const dbAllowed = await getDbAllowedTaskTypes();
    expect(dbAllowed.size).toBeGreaterThan(0);

    const missingFromDb = VALID_TASK_TYPES.filter(t => !dbAllowed.has(t));

    expect(
      missingFromDb,
      `以下 task_type 在 task-router.js VALID_TASK_TYPES 登记但 tasks_task_type_check 约束未登记，` +
      `真实 INSERT 会被 DB 拒绝：${missingFromDb.join(', ')}。` +
      `修法：仿 packages/brain/migrations/336_strategist_decision_task_type.sql 加一条新 migration。`
    ).toEqual([]);
  });
});
