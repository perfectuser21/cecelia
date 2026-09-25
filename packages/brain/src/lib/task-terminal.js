/**
 * task-terminal.js — 任务终态写入的唯一收口（链 bf5088a3 第 2 棒，决策 105a5868 / ec7bf540）。
 *
 * 为什么要有这一层：09-22 七层审计查实，接棒（completed → 按 handoff.next_steps 登记下一棒）
 * 只挂在 `PATCH /tasks` 一条路径上；executor / monitor-loop / crystallize / attempt-run 等
 * 直接 `UPDATE tasks SET status='completed'` 全部绕过；openclaw-agent 收割写 completed_no_pr
 * 而 relay-baton 只认 completed → 秋米任务 100% 不接棒。
 *
 * 两个入口，仓库内所有把任务写成终态的路径必经其一（__tests__/task-terminal-write-guard.test.js 机械守住）：
 *   finalizeTask(db, taskId, status, opts)         —— 常规形状：本函数构造 UPDATE，写完自动跑钩子
 *   afterTerminalTransition(pool, taskId, status)  —— 动态 SET 的写入者（PATCH 路由 / 回调事务）写完后调
 *
 * 钩子只对 RELAY_TERMINAL_STATUSES（completed / completed_no_pr）接棒；failed / archived 走同一出口但不接棒。
 * 接棒任何异常吞成 warn——终态已经落库，接棒失败不能把调用方变成 500 或让 tick 崩掉。
 */
import { TERMINAL_STATUSES, RELAY_TERMINAL_STATUSES } from './task-status-transitions.js';

/** 守卫用：唯一允许出现字面量终态 UPDATE 的模块（相对 src/）。 */
export const TERMINAL_WRITE_HUB_MODULE = 'lib/task-terminal.js';

/**
 * 参数化 `status = $N` 写入者登记表。守卫要求：扫描到的参数化写入者全部在此登记；
 * may_write_terminal=true 的模块源码必须调用 afterTerminalTransition( 或 finalizeTask(。
 */
export const TASK_STATUS_WRITER_REGISTRY = Object.freeze([
  { module: 'routes/tasks.js', may_write_terminal: true, reason: 'PATCH /api/brain/tasks/:id 动态 SET；终态写完调 afterTerminalTransition（含已 completed 补写 handoff）' },
  { module: 'routes/task-task-patch.js', may_write_terminal: true, reason: 'PATCH /:id 动态 SET；终态写完调 afterTerminalTransition' },
  { module: 'callback-processor.js', may_write_terminal: true, reason: '执行回调事务内 CAS 写 newStatus；COMMIT 后调 afterTerminalTransition' },
  { module: 'routes/execution.js', may_write_terminal: true, reason: '执行回调路由事务内 CAS 写 newStatus；COMMIT 后调 afterTerminalTransition' },
  { module: 'task-updater.js', may_write_terminal: true, reason: 'updateTaskStatus 终态分支委托 finalizeTask；参数化 SQL 只服务非终态' },
  { module: 'actions.js', may_write_terminal: true, reason: 'update_task / bulk 动作可写任意状态；终态后调 afterTerminalTransition' },
  { module: 'orchestrator/kernel-run-store.js', may_write_terminal: true, reason: 'Kernel run 权威终态化事务内写 taskOutcome（completed/failed）；COMMIT 后调 afterTerminalTransition' },
  { module: 'decision.js', may_write_terminal: false, reason: 'retry → queued / skip → cancelled（等待态），不写终态' },
  { module: 'proposal.js', may_write_terminal: false, reason: '快照回滚恢复原状态，是撤销不是迁移，不接棒' },
  { module: 'dep-cascade.js', may_write_terminal: false, reason: 'dep_failed 恢复回 queued / 原非终态' },
  { module: 'quarantine.js', may_write_terminal: false, reason: 'release → queued / cancelled（等待态）' },
]);

const SET_COLUMNS = Object.freeze({
  error_message: 'text',
  summary: 'text',
  assigned_to: 'text',
  priority: 'text',
  pr_url: 'text',
  pr_status: 'text',
  pr_merged_at: 'timestamptz',
  completed_at: 'timestamptz',
  result: 'jsonb',
  blocked_detail: 'jsonb',
});
const MERGE_COLUMNS = Object.freeze({ mergeResult: 'result', mergePayload: 'payload', mergeMetadata: 'metadata', mergeCustomProps: 'custom_props' });
const SAFE_KEY = /^[A-Za-z0-9_]+$/;

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

export function isRelayTerminalStatus(status) {
  return RELAY_TERMINAL_STATUSES.includes(status);
}

function toList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function castParam(idx, type) {
  return type === 'text' ? `$${idx}` : `$${idx}::${type}`;
}

function encodeValue(value, type) {
  if (type === 'jsonb') return JSON.stringify(value);
  if (type === 'timestamptz' && value instanceof Date) return value.toISOString();
  return value;
}

const STATUS_NAME = /^[a-z_]+$/;
function assertStatusName(s) {
  if (!STATUS_NAME.test(String(s))) throw new Error(`buildTerminalUpdate: 非法状态名 "${s}"`);
  return String(s);
}

/** 把 where.sql 里的 $1..$n 重编号到 $offset+1..。 */
function renumber(sql, offset) {
  return sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
}

/**
 * 纯函数：构造终态 UPDATE。
 *
 * @param {string|null} taskId  任务 id；为 null 时必须给 where 定位
 * @param {string} status       TERMINAL_STATUSES 之一
 * @param {object} [opts]
 *   set            白名单列（SET_COLUMNS）；completed_at 可给 'now'；值 null → 写 NULL
 *   setIfNull      col = COALESCE(col, $n)（同白名单）
 *   mergeResult / mergePayload / mergeMetadata / mergeCustomProps   jsonb `||` 合并
 *   dropPayloadKeys payload 合并后剔除的键
 *   onlyIfStatus / onlyIfStatusNot   CAS：AND status IN (...) / NOT IN (...)
 *   where          { sql, params }：额外 AND 条件，$1.. 相对编号
 *   idCast         'text' → WHERE id::text = $n
 *   returning      额外 RETURNING 列（id, status 恒有）
 * @returns {{ sql: string, params: any[] }}
 */
export function buildTerminalUpdate(taskId, status, opts = {}) {
  if (!isTerminalStatus(status)) {
    throw new Error(`buildTerminalUpdate: "${status}" 不是终态（terminal），只接受 ${TERMINAL_STATUSES.join('/')}`);
  }
  if (taskId == null && !opts.where?.sql) {
    throw new Error('buildTerminalUpdate: 没有 taskId 时必须给 where 定位');
  }
  const params = [];
  const push = (value) => { params.push(value); return params.length; };
  // 约定：给了 taskId 时它永远是 $1（与历史各站点 [id, ...] 的参数形状一致，调用方/测试按位取值不翻车）
  const idParam = taskId != null ? push(taskId) : null;
  const sets = [`status = '${status}'`, 'updated_at = NOW()', 'claimed_by = NULL', 'claimed_at = NULL'];

  const set = { ...(opts.set || {}) };
  if (set.completed_at === 'now') {
    sets.push('completed_at = NOW()');
    delete set.completed_at;
  } else if (set.completed_at === undefined && isRelayTerminalStatus(status)) {
    sets.push('completed_at = COALESCE(completed_at, NOW())');
  }
  for (const [col, value] of Object.entries(set)) {
    const type = SET_COLUMNS[col];
    if (!type) throw new Error(`buildTerminalUpdate: 列 "${col}" 不在白名单（column whitelist）内`);
    if (value === null || value === undefined) { sets.push(`${col} = NULL`); continue; }
    sets.push(`${col} = ${castParam(push(encodeValue(value, type)), type)}`);
  }
  for (const [col, value] of Object.entries(opts.setIfNull || {})) {
    const type = SET_COLUMNS[col];
    if (!type) throw new Error(`buildTerminalUpdate: 列 "${col}" 不在白名单（column whitelist）内`);
    if (value === null || value === undefined) continue;
    sets.push(`${col} = COALESCE(${col}, ${castParam(push(encodeValue(value, type)), type)})`);
  }
  const dropKeys = toList(opts.dropPayloadKeys);
  for (const key of dropKeys) {
    if (!SAFE_KEY.test(String(key))) throw new Error(`buildTerminalUpdate: dropPayloadKeys 含非法键 "${key}"`);
  }
  for (const [optKey, col] of Object.entries(MERGE_COLUMNS)) {
    const value = opts[optKey];
    const isPayload = col === 'payload';
    if (value == null && !(isPayload && dropKeys.length)) continue;
    let expr = `COALESCE(${col}, '{}'::jsonb)`;
    if (value != null) expr = `${expr} || $${push(JSON.stringify(value))}::jsonb`;
    if (isPayload && dropKeys.length) expr = `(${expr})${dropKeys.map((k) => ` - '${k}'`).join('')}`;
    sets.push(`${col} = ${expr}`);
  }

  const where = [];
  if (idParam !== null) {
    where.push(`${opts.idCast === 'text' ? 'id::text' : 'id'} = $${idParam}`);
  }
  // CAS 状态名走字面量（校验过的 [a-z_] 标识符）：SQL 里能直接读出 "AND status = 'blocked'"，
  // 参数形状也与历史站点一致（不多占位）。
  const only = toList(opts.onlyIfStatus).map(assertStatusName);
  if (only.length === 1) where.push(`status = '${only[0]}'`);
  else if (only.length) where.push(`status IN (${only.map((s) => `'${s}'`).join(', ')})`);
  const not = toList(opts.onlyIfStatusNot).map(assertStatusName);
  if (not.length === 1) where.push(`status <> '${not[0]}'`);
  else if (not.length) where.push(`status NOT IN (${not.map((s) => `'${s}'`).join(', ')})`);
  if (opts.where?.sql) {
    const offset = params.length;
    where.push(`(${renumber(opts.where.sql, offset)})`);
    params.push(...(opts.where.params || []));
  }

  const returning = ['id', 'status', ...toList(opts.returning).filter((c) => c !== 'id' && c !== 'status')];
  const sql = `UPDATE tasks SET ${sets.join(', ')} WHERE ${where.join(' AND ')} RETURNING ${returning.join(', ')}`;
  return { sql, params };
}

/**
 * 终态钩子：终态落库之后必经。completed / completed_no_pr → 接棒；其余终态只留统一出口。
 * pool 必须是能 `connect()` 的池（createRoutedTask 自己开事务），事务内 client 不行——
 * 事务路径先 COMMIT 再用 pool 调本函数。
 */
export async function afterTerminalTransition(pool, taskId, status, { sessionId = null, deps = {} } = {}) {
  if (!isTerminalStatus(status)) return { relayed: false, reason: 'not_terminal' };
  if (!isRelayTerminalStatus(status)) return { relayed: false, reason: 'non_relay_terminal' };
  try {
    const relayOnComplete = deps.relayOnComplete ?? (await import('./relay-baton.js')).relayOnComplete;
    const relay = await relayOnComplete(pool, taskId, { sessionId });
    return { relayed: relay !== null, relay };
  } catch (err) {
    console.warn(`[task-terminal] task=${taskId} status=${status} 接棒钩子失败（不阻塞）: ${err.message}`);
    return { relayed: false, reason: 'relay_error', error: err.message };
  }
}

/**
 * 把任务写成终态并跑钩子。db 可以是 pool 或事务内 client；事务内写时给 relayDb=pool 让接棒在池上跑
 * （或 relay:false 自己在 COMMIT 后调 afterTerminalTransition）。
 *
 * @returns {Promise<{ rowCount: number, task: object|null, tasks: object[], relay: object|null, relays: object[] }>}
 */
export async function finalizeTask(db, taskId, status, opts = {}) {
  const { sql, params } = buildTerminalUpdate(taskId, status, opts);
  const res = await db.query(sql, params);
  const rows = res?.rows ?? [];
  const out = { rowCount: res?.rowCount ?? rows.length, task: rows[0] ?? null, tasks: rows, relay: null, relays: [] };
  if (opts.relay === false || !isRelayTerminalStatus(status)) return out;
  for (const row of rows) {
    out.relays.push(await afterTerminalTransition(opts.relayDb ?? db, row.id, status, { sessionId: opts.sessionId ?? null, deps: opts.deps ?? {} }));
  }
  out.relay = out.relays[0] ?? null;
  return out;
}
