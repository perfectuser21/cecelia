/**
 * Insight → Constraint：把 cortex_insight 转换成 dispatch 阶段的硬规则
 *
 * 设计动机（learning_id d4405cc0）：
 *   洞察 ≠ 约束。self_model / learnings 里只是记录，不进 dispatch gate 等于每次重新踩坑。
 *   本模块提供两件事：
 *     1. loadActiveConstraints(pool)  — 从 learnings 表读出所有 dispatch_constraint 非空记录
 *     2. evaluateConstraints(task, c) — 在 pre-flight 阶段对当前 task 求值，返回 issues/suggestions
 *
 * DSL v1（migrations/263 注释里有完整 schema）：
 *   { rule: 'deny_keyword',    field, patterns[], reason, severity }
 *   { rule: 'require_field',   field, min_length, reason, severity }
 *   { rule: 'require_payload', key,                reason, severity }
 *   { rule: 'deny_payload',    key, values[],     reason, severity }
 *
 * deny_payload —— 基于 payload 值的分类拒绝。失败语义路由必备：
 *   把 dev-failure-classifier 的 TRANSIENT/PERMANENT_DEPENDENCY/STRUCTURAL 三类
 *   失败信号转化成 dispatch gate 硬规则。例如 retry 任务的
 *   payload.previous_failure.class ∈ {auth, resource, env_broken, unknown} 时
 *   阻止 pre-flight 通过——这些类别本身就不该被 retry，统一 retry 路由是浪费根源
 *   (learning_id 6a569a1e)。
 *
 * severity:
 *   block — 进 issues，pre-flight 拒绝派发
 *   warn  — 进 suggestions，仅作提示
 */

import pool from './db.js';

const VALID_RULES = new Set(['deny_keyword', 'require_field', 'require_payload', 'deny_payload']);
const VALID_FIELDS = new Set(['title', 'description']);

// 去重 warn —— pre-flight 在 dispatch 热路径上会被频繁调用，
// 如果 db 不可用或列不存在，每次失败都打 warn 会污染日志。
const _warnedKeys = new Set();
function warnOnce(key, msg) {
  if (_warnedKeys.has(key)) return;
  _warnedKeys.add(key);
  console.warn(msg);
}

/**
 * 加载所有激活态约束（dispatch_constraint IS NOT NULL）。
 * @param {object} [dbPool]
 * @returns {Promise<Array<{learning_id:string, title:string, constraint:object}>>}
 */
export async function loadActiveConstraints(dbPool) {
  const db = dbPool || pool;
  try {
    const { rows } = await db.query(
      `SELECT id, title, dispatch_constraint
         FROM learnings
        WHERE dispatch_constraint IS NOT NULL
          AND is_latest = true
        ORDER BY created_at DESC`
    );
    return rows
      .map(r => ({ learning_id: r.id, title: r.title, constraint: r.dispatch_constraint }))
      .filter(r => isValidConstraint(r.constraint));
  } catch (err) {
    // 表/列不存在或 db 不可达时静默降级，pre-flight 不应反向阻塞。
    // 同一种错误只 warn 一次，避免热路径日志污染。
    warnOnce(err.message, `[insight-constraints] loadActiveConstraints failed: ${err.message}`);
    return [];
  }
}

/**
 * 校验约束 schema —— 防止脏数据让 evaluator 抛异常。
 * @param {*} c
 * @returns {boolean}
 */
export function isValidConstraint(c) {
  if (!c || typeof c !== 'object') return false;
  if (!VALID_RULES.has(c.rule)) return false;
  if (c.severity && c.severity !== 'block' && c.severity !== 'warn') return false;
  if (c.rule === 'deny_keyword') {
    return VALID_FIELDS.has(c.field) && Array.isArray(c.patterns) && c.patterns.length > 0;
  }
  if (c.rule === 'require_field') {
    return VALID_FIELDS.has(c.field) && Number.isFinite(c.min_length) && c.min_length > 0;
  }
  if (c.rule === 'require_payload') {
    return typeof c.key === 'string' && c.key.length > 0;
  }
  if (c.rule === 'deny_payload') {
    return typeof c.key === 'string'
      && c.key.length > 0
      && Array.isArray(c.values)
      && c.values.length > 0;
  }
  return false;
}

/**
 * 在 task 上求值一组约束。
 * @param {object} task    - 与 pre-flight 同结构
 * @param {Array}  entries - loadActiveConstraints 的返回
 * @returns {{issues:string[], suggestions:string[]}}
 */
export function evaluateConstraints(task, entries) {
  const issues = [];
  const suggestions = [];
  if (!Array.isArray(entries) || entries.length === 0) return { issues, suggestions };

  for (const entry of entries) {
    const violation = evaluateSingle(task, entry.constraint);
    if (!violation) continue;
    const severity = entry.constraint.severity || 'block';
    const reason = entry.constraint.reason || violation.defaultReason;
    const tag = `[insight ${entry.learning_id.slice(0, 8)}] ${reason}`;
    if (severity === 'block') issues.push(tag);
    else suggestions.push(tag);
  }
  return { issues, suggestions };
}

/**
 * 求值单条约束。返回 null=通过，对象=违反。
 * @param {object} task
 * @param {object} c
 * @returns {{defaultReason:string}|null}
 */
function evaluateSingle(task, c) {
  if (c.rule === 'deny_keyword') {
    const text = String(task[c.field] || '').toLowerCase();
    if (!text) return null;
    const hit = c.patterns.find(p => text.includes(String(p).toLowerCase()));
    return hit ? { defaultReason: `${c.field} 命中禁用关键词: ${hit}` } : null;
  }
  if (c.rule === 'require_field') {
    const text = String(task[c.field] || '').trim();
    return text.length < c.min_length
      ? { defaultReason: `${c.field} 长度 ${text.length} 不足 ${c.min_length}` }
      : null;
  }
  if (c.rule === 'require_payload') {
    const value = readPath(task.payload, c.key);
    return value === undefined || value === null || value === ''
      ? { defaultReason: `payload.${c.key} 缺失` }
      : null;
  }
  if (c.rule === 'deny_payload') {
    // payload 缺该 key → 通过：约束只针对持有该字段的任务（典型即 retry 任务）
    const value = readPath(task.payload, c.key);
    if (value === undefined || value === null || value === '') return null;
    return c.values.includes(value)
      ? { defaultReason: `payload.${c.key}=${value} 命中禁止值` }
      : null;
  }
  return null;
}

function readPath(obj, dotPath) {
  if (!obj || typeof obj !== 'object') return undefined;
  return dotPath.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}
