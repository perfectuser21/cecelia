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

// ============================================================
// Configuration (defaults, overridable via brain_config table)
// ============================================================

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 默认 30 分钟
const DEFAULT_MAX_TASKS = 3;

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
    // 1. Gather inputs
    const probeResults = await getLatestProbeResults();
    const scanResults = await getLatestScanResults();
    const existingTasks = await getExistingAutoTasks();

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
    const analysis = await analyzeSituation(probeResults, scanResults, existingTasks);

    if (!analysis || !analysis.actions || analysis.actions.length === 0) {
      console.log('[SelfDrive] LLM analysis returned no actions');
      await recordEvent('no_action', { reason: 'llm_returned_empty', probeResults, scanResults });
      return { actions: [], reason: 'no_action_needed' };
    }

    // 4. Create tasks (with dedup)
    const created = [];
    for (const action of analysis.actions.slice(0, _currentMaxTasks)) {
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
      tasks: created,
      reasoning: analysis.reasoning || '',
    });

    console.log(`[SelfDrive] Cycle complete: ${created.length} tasks created`);
    return { actions: created, reason: 'ok' };

  } catch (err) {
    console.error(`[SelfDrive] Cycle failed: ${err.message}`);
    await recordEvent('cycle_error', { error: err.message });
    return { actions: [], reason: 'error', error: err.message };
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
    const result = await pool.query(
      `SELECT id FROM goals
       WHERE domain = $1 AND status IN ('ready', 'in_progress', 'decomposing')
       ORDER BY created_at DESC LIMIT 1`,
      [area]
    );
    return result.rows.length > 0 ? result.rows[0].id : null;
  } catch {
    return null;
  }
}

// ============================================================
// LLM analysis
// ============================================================

async function analyzeSituation(probeResults, scanResults, existingTasks) {
  const prompt = buildAnalysisPrompt(probeResults, scanResults, existingTasks);

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

function buildAnalysisPrompt(probeResults, scanResults, existingTasks) {
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

  return `你是 Cecelia 的自驱引擎。你的职责是根据体检报告决定 Cecelia 下一步应该做什么。

## 当前体检报告

### 链路探针（Probe）
${probeSummary}

### 能力健康地图（Scanner）
${scanSummary}

${islandList ? `### 孤岛能力列表\n${islandList}` : ''}

### 已有待办任务
${tasksSummary}

## 你的任务

分析上述数据，决定 Cecelia 最应该做的 1-3 件事。优先级规则：
1. **链路故障**（Probe 失败的） > 一切其他事（修不好就什么都干不了）
2. **Scanner 误判修正** > 孤岛激活（先让 Scanner 看得准，再决定激活什么）
3. **高价值孤岛激活** > 低价值孤岛（stage 高的 > stage 低的，cecelia scope > external）
4. **不要重复创建已有的任务**

注意：
- 有些"孤岛"实际上是在运行的（如熔断器、看门狗、情绪感知），它们不通过 tasks 表工作，而是内嵌在 Brain 进程中。对这类能力，正确做法是"修改 Scanner 让它能识别这些内嵌能力"，而不是"激活它们"。
- 只输出真正有价值、可执行的任务。不要为了输出而输出。
- 如果当前状态良好且没有紧急事项，可以返回空 actions。

## 输出格式（严格 JSON）

{
  "reasoning": "简短分析（2-3句）",
  "actions": [
    {
      "title": "任务标题（简明扼要）",
      "description": "任务描述（包含具体要做什么、为什么做）",
      "task_type": "dev",
      "priority": "P1 或 P2",
      "area": "cecelia 或 zenithjoy 或 investment（任务归属的业务线：cecelia=Cecelia系统自身改进，zenithjoy=ZenithJoy业务，investment=投资相关）"
    }
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
