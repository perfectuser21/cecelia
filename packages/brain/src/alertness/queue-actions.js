import { deterministicScriptSql } from '../lib/code-script-policy.js';
import { tickTaskOwnershipSql } from '../lib/tick-task-ownership.js';
import { ESCALATION_EXEMPT_TASK_TYPES, TICK_DISPATCH_EXCLUDED } from '../lib/task-type-registry.js';

/**
 * 构造 pause_low_priority 的 UPDATE 语句（抽成纯函数以便真库 PREPARE 守卫）。
 * $3 处处显式 ::text，同 buildCancelPendingQuery——2026-08-05 修 cancel_pending
 * 时发现本函数有一模一样的裸 $3 双上下文隐患（只是尚未触发到 L1 优雅降级），
 * 一并修掉，避免留下同源哑弹。
 */
export function buildPauseLowPriorityQuery() {
  return `
      UPDATE tasks
      SET status = 'paused',
          error_message = $3::text,
          status_history = status_history || jsonb_build_array(
            jsonb_build_object('from', status, 'to', 'paused', 'changed_at', NOW(), 'source', $3::text)
          ),
          updated_at = NOW()
      WHERE status IN ('queued', 'pending')
        AND priority = ANY($1)
        AND trigger_source = ANY($2)
        AND NOT (task_type = ANY($4::text[]))
        AND NOT ${deterministicScriptSql('tasks')}
        AND ${tickTaskOwnershipSql('tasks', 5)}
      RETURNING id
    `;
}

export async function pauseLowPriorityTasks(pool, priorities, triggerSources) {
  const client = await pool.connect();
  try {
    // 保留现役注册表的暂停豁免；来源仅限调用方传入的系统白名单（SQL $2）。
    // 共享tick归属同时排除人工记账与专属消费者的任务，不扩大原优先级/代码保护。
    const result = await client.query(buildPauseLowPriorityQuery(), [priorities, triggerSources, 'escalation_graceful_degrade', [...ESCALATION_EXEMPT_TASK_TYPES], [...TICK_DISPATCH_EXCLUDED]]);

    console.log(`[Escalation] Paused ${result.rowCount} low priority tasks`);
    return result.rowCount;
  } finally {
    client.release();
  }
}

/**
 * 构造 cancel_pending 的 UPDATE 语句（抽成纯函数以便真库 PREPARE 守卫）。
 *
 * 2026-07-09 修复(Issue 9db1da44)：不再 SET status = 'canceled'（终态，
 * 一旦误伤无法恢复），改为可逆的 'paused'，并加 trigger_source 白名单
 * 过滤（只碰系统自产任务）+ error_message/status_history 留痕。
 * jsonb_build_object 里的 'status' 引用的是 UPDATE 前的旧值（Postgres
 * SET 子句求值语义），天然拿到正确的 from。
 *
 * 2026-08-05 修复：$3 必须处处显式 ::text。它同时出现在 error_message（text
 * 上下文）与 jsonb_build_object 的实参（形参声明为 "any"）——后者给不出任何
 * 类型线索，Postgres 于 PREPARE 阶段即报 could not determine data type of
 * parameter $3，导致熔断只停了派发、没能暂停待处理任务。
 * 同源事故见 autoblock-sql-integration.test.js（上次是 $2）。
 */
export function buildCancelPendingQuery(keepCritical) {
  let query = `
      UPDATE tasks
      SET status = 'paused',
          error_message = $3::text,
          status_history = status_history || jsonb_build_array(
            jsonb_build_object('from', status, 'to', 'paused', 'changed_at', NOW(), 'source', $3::text)
          ),
          updated_at = NOW()
      WHERE status IN ('queued', 'pending')
        AND NOT (task_type = ANY($1))
        AND trigger_source = ANY($2)
    `;

  if (keepCritical) {
    query += ` AND priority != 'P0'`;
  }

  return query + ` RETURNING id`;
}

export async function cancelPendingTasks(pool, keepCritical, exemptTypes, triggerSources) {
  const client = await pool.connect();
  try {
    const query = buildCancelPendingQuery(keepCritical);
    const result = await client.query(query, [exemptTypes, triggerSources, 'escalation_emergency_brake']);
    console.log(`[Escalation] Paused (was: canceled) ${result.rowCount} pending tasks`);
    return result.rowCount;
  } finally {
    client.release();
  }
}

