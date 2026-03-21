/**
 * Capability Scanner — 能力孤岛扫描器
 *
 * 持续扫描 Cecelia 所有已注册能力，对比实际使用数据，
 * 找出孤岛（从未调用或连续失败的能力）。
 *
 * 类比：定期体检——不只看"某条腿能不能动"（Probe 的活），
 * 而是看"你所有的器官都在被使用吗？有没有退化的？"
 */

import pool from './db.js';

// ============================================================
// Configuration
// ============================================================

const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 每 6 小时扫描一次
const ISLAND_THRESHOLD_DAYS = 30; // 30 天未使用 → 标记为孤岛

// Brain 内嵌能力 → cecelia_events source 名称映射
// 这些能力直接运行在 Brain 进程中，不通过 run_events/skills，
// 而是向 cecelia_events 写入特定 source 的事件。
const BRAIN_EMBEDDED_SOURCES = {
  'circuit-breaker-protection': ['circuit_breaker'],
  'self-healing-immunity': ['healing', 'immune'],
  'self-healing': ['healing'],
  'three-layer-brain': ['thalamus', 'cortex'],
};

// Brain 进程运行即视为 active 的能力（架构性/意识性能力）
// 这些能力是 Brain 的固有组成部分，没有独立的 skill 或 event source，
// 只要 Brain 在运行，它们就在运行。
const BRAIN_ALWAYS_ACTIVE = new Set([
  'three-pool-slot-allocation',   // 槽位分配器，每次 tick 运行
  'autonomous-task-scheduling',   // Brain 核心调度
  'autonomous-scheduling',        // migration-094 consciousness 版本
  'three-layer-consciousness',    // Brain 三层架构本身
  'watchdog-resource-monitor',    // 看门狗，嵌入 tick 循环
  'quarantine-review-system',     // 隔离区，嵌入任务处理
  'emotion-perception',           // 情绪感知，嵌入 tick 循环
  'curiosity-exploration',        // 好奇心探索，意识层固有
  'desire-formation',             // 欲望涌现，意识层固有
  'rumination',                   // 反刍，意识层固有
  'memory-working',               // 工作记忆，Brain 上下文
  'memory-episodic',              // 情节记忆，memory_stream 支撑
  'memory-semantic',              // 语义记忆，learnings 支撑
  'learning-absorption',          // 学习吸收，嵌入 tick 循环
  'narrative-expression',         // 叙事表达，意识层固有
  'branch-protection-hooks',      // 分支保护 hooks，嵌入开发工作流
]);

// ============================================================
// Core scanner
// ============================================================

/**
 * Scan all capabilities and produce a health map.
 *
 * For each capability:
 * - Check if its related_skills / key_tables / task_types have been used
 * - Cross-reference with tasks table (completed vs failed)
 * - Cross-reference with run_events (recent activity)
 * - Check BRAIN_ALWAYS_ACTIVE whitelist (Brain-embedded, always active)
 * - Check BRAIN_EMBEDDED_SOURCES via cecelia_events (Brain-internal event sources)
 * - Assign status: active | dormant | island | failing
 *
 * @returns {Promise<Object>} { capabilities: [...], summary: {...} }
 */
export async function scanCapabilities() {
  console.log('[Scanner] Starting capability scan...');

  // 1. Get all registered capabilities
  const capResult = await pool.query(`
    SELECT id, name, description, current_stage, related_skills, key_tables, scope, owner
    FROM capabilities
    ORDER BY id
  `);
  const capabilities = capResult.rows;

  // 2. Get task usage stats (last 30 days + all time)
  const taskStats = await pool.query(`
    SELECT
      task_type,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS recent_30d,
      MAX(created_at) AS last_used
    FROM tasks
    GROUP BY task_type
  `);
  const taskUsageMap = {};
  for (const row of taskStats.rows) {
    taskUsageMap[row.task_type] = row;
  }

  // 3. Get skill usage from run_events (last 90 days)
  const skillStats = await pool.query(`
    SELECT
      step_name AS skill,
      COUNT(*) AS total_runs,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      MAX(ts_start) AS last_run
    FROM run_events
    WHERE ts_start > NOW() - INTERVAL '90 days'
    GROUP BY step_name
  `);
  const skillUsageMap = {};
  for (const row of skillStats.rows) {
    skillUsageMap[row.skill] = row;
  }

  // 4. Get table access evidence (check if key_tables have data)
  const tableCountCache = {};

  // 4.5 Get Brain-embedded event sources active in last 90 days
  const allEmbeddedSources = Object.values(BRAIN_EMBEDDED_SOURCES).flat();
  const embeddedSourcesActive = new Set();
  if (allEmbeddedSources.length > 0) {
    try {
      const embeddedResult = await pool.query(
        `SELECT DISTINCT source FROM cecelia_events
         WHERE source = ANY($1) AND created_at > NOW() - INTERVAL '90 days'`,
        [allEmbeddedSources]
      );
      for (const row of embeddedResult.rows) {
        embeddedSourcesActive.add(row.source);
      }
    } catch {
      // cecelia_events may not exist in all environments — treat as empty
    }
  }

  // 5. Evaluate each capability
  const healthMap = [];

  for (const cap of capabilities) {
    const health = {
      id: cap.id,
      name: cap.name,
      stage: cap.current_stage,
      scope: cap.scope,
      owner: cap.owner,
      status: 'unknown', // will be set below
      evidence: [],
      last_activity: null,
      usage_30d: 0,
      success_rate: null,
    };

    // 5.0 Check Brain always-active whitelist first
    if (BRAIN_ALWAYS_ACTIVE.has(cap.id)) {
      health.status = 'active';
      health.evidence.push('brain_embedded:true');
      healthMap.push(health);
      continue;
    }

    // 5.1 Check Brain embedded sources (cecelia_events)
    const embeddedSources = BRAIN_EMBEDDED_SOURCES[cap.id];
    if (embeddedSources) {
      const activeSources = embeddedSources.filter(s => embeddedSourcesActive.has(s));
      if (activeSources.length > 0) {
        health.status = 'active';
        health.evidence.push('brain_embedded:true');
        for (const src of activeSources) {
          health.evidence.push(`cecelia_events:source=${src}`);
        }
        healthMap.push(health);
        continue;
      }
      // Sources configured but no recent events → dormant (not island)
      health.evidence.push('brain_embedded:true');
      health.evidence.push('cecelia_events:no_recent_activity');
      health.status = 'dormant';
      healthMap.push(health);
      continue;
    }

    // 5.2 Check related_skills usage
    const relatedSkills = cap.related_skills || [];
    let hasSkillActivity = false;
    for (const skill of relatedSkills) {
      const usage = skillUsageMap[skill] || taskUsageMap[skill];
      if (usage) {
        hasSkillActivity = true;
        health.evidence.push(`skill:${skill} total=${usage.total || usage.total_runs} completed=${usage.completed}`);
        const lastDate = usage.last_used || usage.last_run;
        if (lastDate && (!health.last_activity || new Date(lastDate) > new Date(health.last_activity))) {
          health.last_activity = lastDate;
        }
        health.usage_30d += parseInt(usage.recent_30d || 0);
        const total = parseInt(usage.total || usage.total_runs || 0);
        const completed = parseInt(usage.completed || 0);
        if (total > 0) {
          health.success_rate = Math.round((completed / total) * 100);
        }
      }
    }

    // 5.3 Check key_tables have data
    const keyTables = cap.key_tables || [];
    let hasTableData = false;
    for (const table of keyTables) {
      if (!tableCountCache[table]) {
        try {
          const countResult = await pool.query(
            `SELECT EXISTS (SELECT 1 FROM "${table}" LIMIT 1) AS has_data`
          );
          tableCountCache[table] = countResult.rows[0]?.has_data || false;
        } catch {
          tableCountCache[table] = false;
        }
      }
      if (tableCountCache[table]) {
        hasTableData = true;
        health.evidence.push(`table:${table}=has_data`);
      } else {
        health.evidence.push(`table:${table}=empty`);
      }
    }

    // 5.4 Determine status
    if (hasSkillActivity && health.success_rate !== null && health.success_rate < 30) {
      health.status = 'failing';
    } else if (hasSkillActivity || hasTableData) {
      // Check if last activity is within threshold
      if (health.last_activity) {
        const daysSinceActivity = (Date.now() - new Date(health.last_activity).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceActivity > ISLAND_THRESHOLD_DAYS) {
          health.status = 'dormant';
        } else {
          health.status = 'active';
        }
      } else if (hasTableData) {
        health.status = 'active';
      } else {
        health.status = 'dormant';
      }
    } else {
      // No skill usage, no table data, not brain-embedded → island
      health.status = 'island';
    }

    healthMap.push(health);
  }

  // 6. Summary
  const summary = {
    total: healthMap.length,
    active: healthMap.filter(h => h.status === 'active').length,
    dormant: healthMap.filter(h => h.status === 'dormant').length,
    island: healthMap.filter(h => h.status === 'island').length,
    failing: healthMap.filter(h => h.status === 'failing').length,
    scanned_at: new Date().toISOString(),
  };

  console.log(`[Scanner] Scan complete: ${summary.active} active, ${summary.dormant} dormant, ${summary.island} island, ${summary.failing} failing`);

  return { capabilities: healthMap, summary };
}

/**
 * Get latest scan results from cecelia_events.
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getCapabilityHealth(limit = 1) {
  const result = await pool.query(
    `SELECT payload, created_at
     FROM cecelia_events
     WHERE event_type = 'capability_scan'
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  if (result.rows.length === 0) {
    // No cached scan — run one now
    const scanResult = await runScanCycle();
    return [{ payload: scanResult, created_at: new Date().toISOString() }];
  }

  return result.rows;
}

// ============================================================
// Scheduled scan cycle
// ============================================================

let _scanTimer = null;

/**
 * Run scan, persist results.
 */
async function runScanCycle() {
  try {
    const result = await scanCapabilities();

    // Persist to cecelia_events
    await pool.query(
      `INSERT INTO cecelia_events (event_type, source, payload)
       VALUES ('capability_scan', 'capability-scanner', $1)`,
      [JSON.stringify(result)]
    );

    return result;
  } catch (err) {
    console.error(`[Scanner] Scan cycle failed: ${err.message}`);
    return null;
  }
}

/**
 * Start periodic scan cycle.
 */
export function startScanLoop() {
  if (_scanTimer) {
    console.log('[Scanner] Loop already running');
    return;
  }

  console.log(`[Scanner] Starting capability scan loop (interval: ${SCAN_INTERVAL_MS / 1000 / 60}min)`);

  // First scan after 2 minutes (let Brain fully start)
  setTimeout(() => {
    runScanCycle();
    _scanTimer = setInterval(runScanCycle, SCAN_INTERVAL_MS);
  }, 2 * 60 * 1000);
}

/**
 * Get scanner status.
 */
export function getScannerStatus() {
  return {
    running: _scanTimer !== null,
    interval_ms: SCAN_INTERVAL_MS,
    island_threshold_days: ISLAND_THRESHOLD_DAYS,
  };
}

export { runScanCycle };
