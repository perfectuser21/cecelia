/**
 * Heartbeat Inspector — HEARTBEAT.md 灵活巡检
 *
 * 读取用户定义的 HEARTBEAT.md 检查清单，结合系统快照，
 * 发给 L1 丘脑判断，结果走 Decision 流程。
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { callThalamLLM } from './thalamus.js';
import { executeDecision } from './decision-executor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HEARTBEAT_PATH = resolve(__dirname, '../../HEARTBEAT.md');

/** V1 硬约束白名单：巡检只允许这些 action，禁止直接执行危险动作 */
const HEARTBEAT_ALLOWED_ACTIONS = [
  'no_action',
  'log_event',
  'propose_priority_change',
  'propose_weekly_plan',
  'heartbeat_finding',
  'request_human_review',
];

/** 30 分钟巡检间隔 */
const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000;

/**
 * 读取 HEARTBEAT.md 内容
 * @param {string} [filePath] - 可选自定义路径（测试用）
 * @returns {string|null} 文件内容，文件不存在返回 null
 */
function readHeartbeatFile(filePath) {
  try {
    return readFileSync(filePath || HEARTBEAT_PATH, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 收集当前系统快照（给 L1 丘脑参考数据）
 * 4 个并行 SQL 查询：tasks / events / proposals / focus
 */
async function collectSystemSnapshot(pool) {
  const [tasks, events, proposals, focus] = await Promise.all([
    pool.query(`
      SELECT status, COUNT(*)::int as count
      FROM tasks WHERE status IN ('in_progress', 'queued', 'failed')
      GROUP BY status
    `),
    pool.query(`
      SELECT event_type, COUNT(*)::int as count
      FROM cecelia_events
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY event_type
      ORDER BY count DESC LIMIT 5
    `),
    pool.query(`
      SELECT COUNT(*)::int as count FROM pending_actions
      WHERE status = 'pending_approval'
        AND (expires_at IS NULL OR expires_at > NOW())
    `),
    pool.query(`
      SELECT title, progress FROM goals
      WHERE status = 'in_progress'
      ORDER BY priority ASC LIMIT 3
    `),
  ]);

  return {
    tasks_in_progress: parseInt(tasks.rows.find(r => r.status === 'in_progress')?.count || 0),
    tasks_queued: parseInt(tasks.rows.find(r => r.status === 'queued')?.count || 0),
    tasks_failed: parseInt(tasks.rows.find(r => r.status === 'failed')?.count || 0),
    top_events_24h: events.rows,
    pending_proposals: parseInt(proposals.rows[0]?.count || 0),
    active_okrs: focus.rows,
    current_hour: new Date().getHours(),
    day_of_week: new Date().getDay(), // 0=周日, 1=周一
  };
}

/**
 * 构建巡检 prompt
 */
function buildHeartbeatPrompt(heartbeatMd, snapshot) {
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  return `你是 Cecelia 的巡检模块。根据用户定义的检查清单和当前系统状态，判断需要采取什么行动。

## 用户定义的检查清单

${heartbeatMd}

## 当前系统状态

- 进行中任务: ${snapshot.tasks_in_progress}
- 排队任务: ${snapshot.tasks_queued}
- 失败任务: ${snapshot.tasks_failed}
- 待处理提案: ${snapshot.pending_proposals}
- 当前时间: ${snapshot.current_hour}:00, 星期${dayNames[snapshot.day_of_week]}
- 活跃 OKR: ${snapshot.active_okrs.map(g => `${g.title}(${g.progress}%)`).join(', ') || '无'}
- 24h 事件 TOP5: ${snapshot.top_events_24h.map(e => `${e.event_type}:${e.count}`).join(', ') || '无'}

## 输出格式

如果一切正常，输出：
\`\`\`json
{"action": "no_action", "rationale": "一切正常"}
\`\`\`

如果需要行动，输出标准 Decision 格式：
\`\`\`json
{
  "actions": [
    {"type": "action_type", "params": {...}}
  ],
  "rationale": "原因说明",
  "confidence": 0.8
}
\`\`\`

可用的 action type（仅限以下白名单）：
- log_event: 记录日志
- propose_priority_change: 创建优先级调整提案
- propose_weekly_plan: 创建本周计划提案
- heartbeat_finding: 巡检发现异常（通用提案）
- request_human_review: 请求人工审核
- no_action: 不需要行动

严格遵守"自主权边界"章节的规则：标记为"必须问我的"事项，必须创建提案（propose_* 或 heartbeat_finding），不要自行决定。`;
}

/**
 * 对 L1 丘脑返回的 actions 应用硬约束白名单
 * 非白名单 action 被转换为 heartbeat_finding
 */
function enforceWhitelist(actions) {
  return actions.map(act => {
    const actionType = act.type || act.action;
    if (HEARTBEAT_ALLOWED_ACTIONS.includes(actionType)) {
      return act;
    }
    console.warn(`[heartbeat] BLOCKED action "${actionType}" — not in whitelist, converting to heartbeat_finding`);
    return {
      type: 'heartbeat_finding',
      params: {
        ...(act.params || {}),
        original_action: actionType,
        blocked_reason: 'heartbeat_whitelist',
      },
    };
  });
}

/**
 * 解析 L1 丘脑返回的 JSON 响应
 * @returns {object|null} 解析后的 decision，解析失败返回 null
 */
function parseHeartbeatResponse(responseText) {
  // 优先匹配 markdown code block
  const codeBlockMatch = responseText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : responseText.trim();

  try {
    return JSON.parse(jsonStr);
  } catch {
    console.warn('[heartbeat] Failed to parse LLM response as JSON');
    return null;
  }
}

/**
 * 执行巡检主流程
 *
 * 1. 读取 HEARTBEAT.md
 * 2. 收集系统快照
 * 3. 构建 prompt 发给 L1 丘脑
 * 4. 应用硬约束白名单
 * 5. 通过 executeDecision 走 Decision 流程
 * 6. 记录巡检事件
 *
 * @param {object} pool - PostgreSQL pool
 * @param {object} [options] - 可选配置
 * @param {string} [options.heartbeatPath] - 自定义 HEARTBEAT.md 路径（测试用）
 * @returns {object} { skipped, actions_count, rationale }
 */
async function runHeartbeatInspection(pool, options = {}) {
  // 1. 读取 HEARTBEAT.md
  const heartbeatContent = readHeartbeatFile(options.heartbeatPath);
  if (!heartbeatContent) {
    console.log('[heartbeat] HEARTBEAT.md not found, skipping');
    return { skipped: true, reason: 'file_not_found' };
  }

  // 2. 收集系统快照
  const snapshot = await collectSystemSnapshot(pool);

  // 3. 构建 prompt，调用 L1 丘脑
  const prompt = buildHeartbeatPrompt(heartbeatContent, snapshot);
  const { text: responseText } = await callThalamLLM(prompt, { timeoutMs: 60000 });

  // 4. 解析响应
  const decision = parseHeartbeatResponse(responseText);
  if (!decision) {
    console.warn('[heartbeat] Could not parse LLM response, skipping');
    return { skipped: true, reason: 'parse_error' };
  }

  // 5. no_action → 静默返回
  if (decision.action === 'no_action') {
    return { skipped: false, actions_count: 0, rationale: decision.rationale || '' };
  }

  // 6. 应用硬约束白名单
  const rawActions = decision.actions || [decision];
  const safeActions = enforceWhitelist(rawActions);

  // 7. 通过 decision-executor 执行每个 action
  for (const action of safeActions) {
    const actionType = action.type || action.action;
    if (actionType === 'no_action' || actionType === 'log_event') continue;

    await executeDecision(
      { action: actionType, params: action.params || {} },
      { source: 'heartbeat_inspection', timestamp: new Date().toISOString() },
    );
  }

  // 8. 记录巡检事件
  await pool.query(`
    INSERT INTO cecelia_events (event_type, payload)
    VALUES ('heartbeat_inspection', $1)
  `, [JSON.stringify({
    actions_count: safeActions.length,
    rationale: (decision.rationale || '').substring(0, 200),
  })]);

  return {
    skipped: false,
    actions_count: safeActions.length,
    rationale: decision.rationale || '',
  };
}

export {
  runHeartbeatInspection,
  collectSystemSnapshot,
  buildHeartbeatPrompt,
  enforceWhitelist,
  parseHeartbeatResponse,
  readHeartbeatFile,
  HEARTBEAT_ALLOWED_ACTIONS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_PATH,
};
