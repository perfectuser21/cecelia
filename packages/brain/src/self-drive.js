/**
 * Self-Drive Engine — 自驱引擎
 *
 * Cecelia 看到自己的体检报告后，自主分析、自主决策、自主行动。
 *
 * 闭环：
 *   Probe（链路通不通）+ Scanner（能力用没用）
 *     ↓
 *   Self-Drive（分析 → 优先级排序 → 创建任务）
 *     ↓
 *   Tick Loop（派发任务 → /dev 执行 → CI 验证）
 *     ↓
 *   下次 Probe/Scan 验证效果
 *
 * 这是 Cecelia "自我意识 → 自我行动" 的最后一环。
 */

import pool from './db.js';
import { createTask } from './actions.js';
import { callLLM } from './llm-caller.js';
import { getRewardScore } from './dopamine.js';

// ============================================================
// Configuration (defaults, overridable via brain_config table)
// ============================================================

const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000; // 默认 4 小时 (14400000ms)
const DEFAULT_MAX_TASKS = 3;

// 安全保护：每次 SelfDrive 最多执行的调整类 action 数量
const MAX_ADJUSTMENT_ACTIONS = 2;
const ADJUSTMENT_TYPES = ['adjust_priority', 'pause_kr', 'activate_kr', 'update_roadmap'];

/**
 * Read config from brain_config table, fallback to defaults.
 * Keys: self_drive_interval_ms, self_drive_max_tasks
 */
async function getConfig() {
  try {
    const result = await pool.query(
      `SELECT key, value FROM brain_config WHERE key IN ('self_drive_interval_ms', 'self_drive_max_tasks')`
    );
    const config = {};
    for (const row of result.rows) {
      config[row.key] = JSON.parse(row.value);
    }
    return {
      intervalMs: config.self_drive_interval_ms || DEFAULT_INTERVAL_MS,
      maxTasks: config.self_drive_max_tasks || DEFAULT_MAX_TASKS,
    };
  } catch {
    return { intervalMs: DEFAULT_INTERVAL_MS, maxTasks: DEFAULT_MAX_TASKS };
  }
}

let _currentIntervalMs = DEFAULT_INTERVAL_MS;
let _currentMaxTasks = DEFAULT_MAX_TASKS;

// ============================================================
// Core
// ============================================================

/**
 * Run one self-drive cycle:
 * 1. Read latest probe + scan results
 * 2. Call LLM to analyze and prioritize
 * 3. Create tasks for the top priorities
 */
export async function runSelfDrive() {
  console.log('[SelfDrive] Starting self-drive cycle...');

  try {
    // 1. Gather inputs — 系统健康
    const probeResults = await getLatestProbeResults();
    const scanResults = await getLatestScanResults();
    const existingTasks = await getExistingAutoTasks();

    // 1b. Gather inputs — 业务感知（KR 进度、任务效率、满足感、Roadmap）
    const krProgress = await getKRProgress();
    const taskStats = await getTaskStats24h();
    const dopamineScore = await getDopamineScore();
    const activeProjects = await getActiveProjects();

    if (!probeResults && !scanResults) {
      console.log('[SelfDrive] No probe/scan data yet, skipping');
      return { actions: [], reason: 'no_data' };
    }

    // 2. Build dedup set (prevent creating duplicate tasks)
    const dedupSet = new Set();
    for (const t of existingTasks) {
      // Use title prefix as dedup key
      const key = (t.title || '').toLowerCase().slice(0, 60);
      dedupSet.add(key);
    }

    // 3. Call LLM to analyze
    const analysis = await analyzeSituation(
      probeResults, scanResults, existingTasks,
      { krProgress, taskStats, dopamineScore, activeProjects }
    );

    if (!analysis || !analysis.actions || analysis.actions.length === 0) {
      console.log('[SelfDrive] LLM analysis returned no actions');
      await recordEvent('no_action', { reason: 'llm_returned_empty', probeResults, scanResults });
      return { actions: [], reason: 'no_action_needed' };
    }

    // 4. Process actions (create tasks + adjustment actions)
    const created = [];
    const adjustments = [];
    let adjustmentCount = 0;

    for (const action of analysis.actions.slice(0, _currentMaxTasks + MAX_ADJUSTMENT_ACTIONS)) {
      const actionType = action.type || 'create_task';

      // 调整类 action 受数量限制保护
      if (ADJUSTMENT_TYPES.includes(actionType)) {
        if (adjustmentCount >= MAX_ADJUSTMENT_ACTIONS) {
          console.log(`[SelfDrive] Skip adjustment (limit ${MAX_ADJUSTMENT_ACTIONS} reached): ${actionType}`);
          continue;
        }

        try {
          const result = await executeAdjustmentAction(action);
          adjustmentCount++;
          adjustments.push({ type: actionType, ...result });
          console.log(`[SelfDrive] Executed ${actionType}: ${action.reason || ''}`);
        } catch (err) {
          console.warn(`[SelfDrive] Failed ${actionType}: ${err.message}`);
        }
        continue;
      }

      // create_task: 原有逻辑（含去重）
      const dedupKey = (action.title || '').toLowerCase().slice(0, 60);
      if (dedupSet.has(dedupKey)) {
        console.log(`[SelfDrive] Skip dedup: "${action.title}"`);
        continue;
      }

      // Check queued/in_progress tasks for similar titles
      const similar = await pool.query(
        `SELECT id FROM tasks
         WHERE status IN ('queued', 'in_progress')
           AND LOWER(title) LIKE $1
         LIMIT 1`,
        [`%${dedupKey.slice(0, 30)}%`]
      );
      if (similar.rows.length > 0) {
        console.log(`[SelfDrive] Skip dedup (DB): "${action.title}" similar to task ${similar.rows[0].id}`);
        continue;
      }

      try {
        const goalId = await getGoalIdForArea(action.area);
        const taskId = await createTask({
          title: `[SelfDrive] ${action.title}`,
          description: action.description || action.title,
          task_type: action.task_type || 'dev',
          priority: action.priority || 'P2',
          trigger_source: 'self_drive',
          tags: ['self-drive', 'auto-generated'],
          goal_id: goalId || null,
        });
        console.log(`[SelfDrive] Created task: ${taskId} — "${action.title}"`);
        created.push({ taskId, title: action.title });
      } catch (err) {
        console.warn(`[SelfDrive] Failed to create task "${action.title}": ${err.message}`);
      }
    }

    // 5. Record event
    await recordEvent('cycle_complete', {
      probe_summary: probeResults?.summary || null,
      scan_summary: scanResults?.summary || null,
      analysis_actions: analysis.actions.length,
      tasks_created: created.length,
      adjustments_executed: adjustments.length,
      tasks: created,
      adjustments,
      reasoning: analysis.reasoning || '',
    });

    // 6. SelfDrive 思考结果推送飞书（有 action 才推，避免骚扰）
    if (analysis.reasoning && (created.length > 0 || adjustments.length > 0)) {
      try {
        const { sendProactiveMessage } = await import('./proactive-mouth.js');
        const { callLLM: callLLMForNotify } = await import('./llm-caller.js');

        // 构建汇报内容
        const reportParts = [`定期战略思考完成\n\n${analysis.reasoning}`];
        if (created.length > 0) {
          reportParts.push(`\n创建了 ${created.length} 个任务：\n${created.map(t => `- ${t.title}`).join('\n')}`);
        }
        if (adjustments.length > 0) {
          reportParts.push(`\n做了 ${adjustments.length} 个调整：\n${adjustments.map(a => `- ${a.type}: ${a.reason || a.title || ''}`).join('\n')}`);
        }

        await sendProactiveMessage(pool, callLLMForNotify, {
          reason: reportParts.join(''),
          contextType: 'proactive',
          importance: 0.7,
        });
        console.log('[SelfDrive] 飞书推送已发送');
      } catch (notifyErr) {
        console.warn('[SelfDrive] 飞书推送失败（non-fatal）:', notifyErr.message);
      }
    }

    console.log(`[SelfDrive] Cycle complete: ${created.length} tasks created, ${adjustments.length} adjustments executed`);
    return { actions: created, adjustments, reason: 'ok' };

  } catch (err) {
    console.error(`[SelfDrive] Cycle failed: ${err.message}`);
    await recordEvent('cycle_error', { error: err.message });
    return { actions: [], reason: 'error', error: err.message };
  }
}

// ============================================================
// Adjustment action handlers
// ============================================================

/**
 * 执行调整类 action 并记录到 decision_log。
 * 支持：adjust_priority / pause_kr / activate_kr / update_roadmap
 * 安全保护：不允许删除（只能暂停），每条都写审计日志。
 */
async function executeAdjustmentAction(action) {
  const actionType = action.type;

  switch (actionType) {
    case 'adjust_priority': {
      if (!action.project_id || action.new_sequence == null) {
        throw new Error('adjust_priority 需要 project_id 和 new_sequence');
      }
      await pool.query(
        `UPDATE okr_projects SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('sequence_order', $1::int), updated_at = NOW() WHERE id = $2`,
        [action.new_sequence, action.project_id]
      );
      await recordDecision('self_drive', action.reason || 'adjust_priority', action);
      return { project_id: action.project_id, new_sequence: action.new_sequence };
    }

    case 'pause_kr': {
      if (!action.kr_id) {
        throw new Error('pause_kr 需要 kr_id');
      }
      // Try objectives → key_results
      let pauseResult = await pool.query(
        "UPDATE objectives SET status = 'paused', updated_at = NOW() WHERE id = $1",
        [action.kr_id]
      );
      if (pauseResult.rowCount === 0) {
        await pool.query(
          "UPDATE key_results SET status = 'paused', updated_at = NOW() WHERE id = $1",
          [action.kr_id]
        );
      }
      await recordDecision('self_drive', action.reason || 'pause_kr', action);
      return { kr_id: action.kr_id, new_status: 'paused' };
    }

    case 'activate_kr': {
      if (!action.kr_id) {
        throw new Error('activate_kr 需要 kr_id');
      }
      // Try objectives → key_results
      let activateResult = await pool.query(
        "UPDATE objectives SET status = 'in_progress', updated_at = NOW() WHERE id = $1",
        [action.kr_id]
      );
      if (activateResult.rowCount === 0) {
        await pool.query(
          "UPDATE key_results SET status = 'in_progress', updated_at = NOW() WHERE id = $1",
          [action.kr_id]
        );
      }
      await recordDecision('self_drive', action.reason || 'activate_kr', action);
      return { kr_id: action.kr_id, new_status: 'in_progress' };
    }

    case 'update_roadmap': {
      if (!action.project_id || !action.phase) {
        throw new Error('update_roadmap 需要 project_id 和 phase');
      }
      const validPhases = ['now', 'next', 'later'];
      if (!validPhases.includes(action.phase)) {
        throw new Error(`update_roadmap phase 必须是 ${validPhases.join('/')}，收到: ${action.phase}`);
      }
      await pool.query(
        `UPDATE okr_projects SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('current_phase', $1), updated_at = NOW() WHERE id = $2`,
        [action.phase, action.project_id]
      );
      await recordDecision('self_drive', action.reason || 'update_roadmap', action);
      return { project_id: action.project_id, phase: action.phase };
    }

    default:
      throw new Error(`未知的调整类型: ${actionType}`);
  }
}

/**
 * 记录调整决策到 decision_log 表（审计追踪）
 */
async function recordDecision(trigger, inputSummary, actionData) {
  try {
    await pool.query(
      `INSERT INTO decision_log (trigger, input_summary, llm_output_json, status)
       VALUES ($1, $2, $3, 'executed')`,
      [trigger, inputSummary, JSON.stringify(actionData)]
    );
  } catch (err) {
    console.warn(`[SelfDrive] Failed to record decision: ${err.message}`);
  }
}

// ============================================================
// Data gathering
// ============================================================

async function getLatestProbeResults() {
  try {
    const result = await pool.query(
      `SELECT payload FROM cecelia_events
       WHERE event_type = 'capability_probe'
       ORDER BY created_at DESC LIMIT 1`
    );
    if (result.rows.length === 0) return null;
    const payload = result.rows[0].payload;
    return typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch {
    return null;
  }
}

async function getLatestScanResults() {
  try {
    const result = await pool.query(
      `SELECT payload FROM cecelia_events
       WHERE event_type = 'capability_scan'
       ORDER BY created_at DESC LIMIT 1`
    );
    if (result.rows.length === 0) return null;
    const payload = result.rows[0].payload;
    return typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch {
    return null;
  }
}

async function getExistingAutoTasks() {
  try {
    const result = await pool.query(
      `SELECT id, title, status FROM tasks
       WHERE (tags::text LIKE '%self-drive%' OR tags::text LIKE '%auto-fix%')
         AND status IN ('queued', 'in_progress')
       ORDER BY created_at DESC LIMIT 20`
    );
    return result.rows;
  } catch {
    return [];
  }
}

/**
 * 获取活跃 KR/OKR 的进度数据
 */
async function getKRProgress() {
  try {
    // 迁移：goals WHERE type IN ('area_kr','area_okr') → key_results
    const result = await pool.query(
      `SELECT id, title, status, progress, 'area_okr' AS type
       FROM key_results
       WHERE status IN ('active', 'in_progress', 'ready', 'decomposing')
       ORDER BY created_at DESC`
    );
    return result.rows;
  } catch {
    return [];
  }
}

/**
 * 获取最近 24h 任务完成率统计
 */
async function getTaskStats24h() {
  try {
    const result = await pool.query(
      `SELECT
        count(*) filter (where status = 'completed') as completed,
        count(*) filter (where status = 'failed') as failed,
        count(*) as total
       FROM tasks
       WHERE updated_at > NOW() - INTERVAL '24 hours'`
    );
    const row = result.rows[0] || { completed: 0, failed: 0, total: 0 };
    return {
      completed: parseInt(row.completed) || 0,
      failed: parseInt(row.failed) || 0,
      total: parseInt(row.total) || 0,
    };
  } catch {
    return { completed: 0, failed: 0, total: 0 };
  }
}

/**
 * 获取 Dopamine 满足感分数（封装 getRewardScore）
 */
async function getDopamineScore() {
  try {
    return await getRewardScore();
  } catch {
    return { score: 0, count: 0, breakdown: { positive: 0, negative: 0 } };
  }
}

/**
 * 获取当前活跃 Projects（Roadmap）
 */
async function getActiveProjects() {
  try {
    // 迁移：projects WHERE type='project' → okr_projects
    const result = await pool.query(
      `SELECT id, title AS name, status
       FROM okr_projects
       WHERE status IN ('active', 'in_progress', 'planning')
       ORDER BY created_at DESC`
    );
    return result.rows;
  } catch {
    return [];
  }
}

// ============================================================
// Goal ID lookup
// ============================================================

/**
 * 根据业务线（area/domain）查询一个活跃 OKR 的 ID。
 * 活跃状态：ready / in_progress / decomposing
 *
 * @param {string} area - 业务线（cecelia/zenithjoy/investment 等）
 * @returns {Promise<string|null>} goal_id 或 null（找不到时）
 */
async function getGoalIdForArea(area) {
  if (!area) return null;
  try {
    // 迁移：goals WHERE domain → key_results（key_results 无 domain 列，fallback 到 area_id 匹配）
    // 先查 key_results，再查 objectives，取第一个活跃记录
    const result = await pool.query(
      `SELECT id FROM key_results
       WHERE status IN ('active', 'in_progress', 'ready', 'decomposing')
       ORDER BY created_at DESC LIMIT 1`
    );
    return result.rows.length > 0 ? result.rows[0].id : null;
  } catch {
    return null;
  }
}

// ============================================================
// LLM analysis
// ============================================================

async function analyzeSituation(probeResults, scanResults, existingTasks, perception = {}) {
  const prompt = buildAnalysisPrompt(probeResults, scanResults, existingTasks, perception);

  const { text } = await callLLM('thalamus', prompt, {
    maxTokens: 1500,
    timeout: 60000,
  });

  if (!text) return null;

  // Parse JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.warn('[SelfDrive] Failed to parse LLM response as JSON');
    return null;
  }
}

function buildAnalysisPrompt(probeResults, scanResults, existingTasks, perception = {}) {
  const { krProgress = [], taskStats = {}, dopamineScore = {}, activeProjects = [] } = perception;

  // Build probe summary
  let probeSummary = '无数据';
  if (probeResults) {
    const probes = probeResults.probes || [];
    const failed = probes.filter(p => !p.ok);
    probeSummary = failed.length === 0
      ? `全部 ${probes.length} 条链路正常`
      : `${failed.length}/${probes.length} 条链路故障: ${failed.map(f => f.name).join(', ')}`;
  }

  // Build scan summary
  let scanSummary = '无数据';
  let islandList = '';
  if (scanResults) {
    const s = scanResults.summary || {};
    scanSummary = `${s.total} 个能力: ${s.active} 活跃, ${s.island} 孤岛, ${s.dormant} 休眠, ${s.failing} 失败`;

    const islands = (scanResults.capabilities || []).filter(c => c.status === 'island');
    if (islands.length > 0) {
      islandList = islands.map(c => `- ${c.name} (stage=${c.stage})`).join('\n');
    }
  }

  // Build existing tasks summary
  const tasksSummary = existingTasks.length > 0
    ? existingTasks.map(t => `- [${t.status}] ${t.title}`).join('\n')
    : '无';

  // Build KR 进度 summary
  let krSummary = '无数据';
  if (krProgress.length > 0) {
    krSummary = krProgress.map(kr =>
      `- [${kr.type}] ${kr.title} — 状态: ${kr.status}, 进度: ${kr.progress}%`
    ).join('\n');
  }

  // Build 任务执行效率 summary
  const { completed = 0, failed = 0, total = 0 } = taskStats;
  const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const taskEfficiency = total > 0
    ? `完成: ${completed}, 失败: ${failed}, 总计: ${total}, 成功率: ${successRate}%`
    : '最近 24h 无任务数据';

  // Build Dopamine summary
  const dScore = dopamineScore.score ?? 0;
  const dCount = dopamineScore.count ?? 0;
  const dMood = dScore > 3 ? '高满足' : dScore >= 0 ? '正常' : '低迷';
  const dopamineSummary = `分数: ${dScore}（${dMood}），最近 24h 奖赏信号: ${dCount} 条`;

  // Build 活跃 Projects summary
  let projectsSummary = '无';
  if (activeProjects.length > 0) {
    projectsSummary = activeProjects.map((p, i) =>
      `- #${i + 1} [${p.status}] ${p.name}`
    ).join('\n');
  }

  return `你是 Cecelia 的自驱引擎。你的职责是根据全量感知数据决定 Cecelia 下一步应该做什么。

## 当前体检报告

### 链路探针（Probe）
${probeSummary}

### 能力健康地图（Scanner）
${scanSummary}

${islandList ? `### 孤岛能力列表\n${islandList}` : ''}

### KR 进度
${krSummary}

### 任务执行效率（最近 24h）
${taskEfficiency}

### Dopamine 满足感
${dopamineSummary}

### 当前活跃 Projects
${projectsSummary}

### 已有待办任务
${tasksSummary}

## 你的任务

分析上述数据，决定 Cecelia 最应该做的 1-3 件事。优先级规则：
1. **链路故障**（Probe 失败的） > 一切其他事（修不好就什么都干不了）
2. **Scanner 误判修正** > 孤岛激活（先让 Scanner 看得准，再决定激活什么）
3. **高价值孤岛激活** > 低价值孤岛（stage 高的 > stage 低的，cecelia scope > external）
4. **不要重复创建已有的任务**
5. **KR 进度落后** — 如果某个 KR 进度远低于预期，建议调整优先级或加速推进
6. **任务成功率下降** — 分析原因（是代码质量问题还是任务拆分问题），建议修复
7. **满足感持续低迷** — 如果 Dopamine 分数持续 < 0，可能需要换个方向或调整节奏

注意：
- 有些"孤岛"实际上是在运行的（如熔断器、看门狗、情绪感知），它们不通过 tasks 表工作，而是内嵌在 Brain 进程中。对这类能力，正确做法是"修改 Scanner 让它能识别这些内嵌能力"，而不是"激活它们"。
- 只输出真正有价值、可执行的任务。不要为了输出而输出。
- 如果当前状态良好且没有紧急事项，可以返回空 actions。

## 输出格式（严格 JSON）

actions 数组支持以下类型：

### 1. create_task — 创建开发任务
{ "type": "create_task", "title": "任务标题", "description": "任务描述", "task_type": "dev", "priority": "P1 或 P2", "area": "cecelia/zenithjoy/investment" }

### 2. adjust_priority — 调整 Project 优先级（sequence_order）
{ "type": "adjust_priority", "project_id": "uuid", "new_sequence": 1, "reason": "为什么调整" }

### 3. pause_kr — 暂停某个 KR（goals.status → paused）
{ "type": "pause_kr", "kr_id": "uuid", "reason": "为什么暂停" }

### 4. activate_kr — 激活某个 KR（goals.status → in_progress）
{ "type": "activate_kr", "kr_id": "uuid", "reason": "为什么激活" }

### 5. update_roadmap — 更新 Project 路线图阶段（now/next/later）
{ "type": "update_roadmap", "project_id": "uuid", "phase": "now|next|later", "reason": "为什么调整" }

注意：
- 调整类操作（adjust_priority/pause_kr/activate_kr/update_roadmap）每次最多执行 2 个
- 不允许删除 KR 或 Project，只能暂停
- 所有调整操作都会记录到 decision_log

示例：
{
  "reasoning": "简短分析（2-3句）",
  "actions": [
    { "type": "create_task", "title": "任务标题", "description": "描述", "task_type": "dev", "priority": "P1", "area": "cecelia" },
    { "type": "adjust_priority", "project_id": "xxx", "new_sequence": 1, "reason": "该项目优先级更高" },
    { "type": "pause_kr", "kr_id": "yyy", "reason": "资源不足暂停" }
  ]
}

如果不需要任何行动：{"reasoning": "原因", "actions": []}`;
}

// ============================================================
// Event recording
// ============================================================

async function recordEvent(subtype, payload) {
  try {
    await pool.query(
      `INSERT INTO cecelia_events (event_type, source, payload)
       VALUES ('self_drive', 'self-drive', $1)`,
      [JSON.stringify({ subtype, ...payload, timestamp: new Date().toISOString() })]
    );
  } catch (err) {
    console.warn(`[SelfDrive] Failed to record event: ${err.message}`);
  }
}

// ============================================================
// Scheduled loop
// ============================================================

let _driveTimer = null;

export async function startSelfDriveLoop() {
  if (_driveTimer) {
    console.log('[SelfDrive] Loop already running');
    return;
  }

  // Read interval from DB (can be changed via dashboard without restart)
  const config = await getConfig();
  _currentIntervalMs = config.intervalMs;
  _currentMaxTasks = config.maxTasks;

  console.log(`[SelfDrive] Starting self-drive loop (interval: ${_currentIntervalMs / 1000 / 60}min, max_tasks: ${_currentMaxTasks})`);

  // First run after 2 minutes (let probe/scan populate first)
  setTimeout(async () => {
    await runSelfDrive();
    _driveTimer = setInterval(async () => {
      // Re-read config each cycle (hot-reload from DB)
      const cfg = await getConfig();
      _currentIntervalMs = cfg.intervalMs;
      _currentMaxTasks = cfg.maxTasks;
      await runSelfDrive();
    }, _currentIntervalMs);
  }, 2 * 60 * 1000);
}

export function getSelfDriveStatus() {
  return {
    running: _driveTimer !== null,
    interval_ms: _currentIntervalMs,
    max_tasks_per_cycle: _currentMaxTasks,
  };
}
