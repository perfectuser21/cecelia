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
  'postgresql-database-service',  // Brain 数据层，每次 tick/API 调用都通过 pool 访问 PostgreSQL
]);

// ============================================================
// Data fetching helpers
// ============================================================

/**
 * Fetch all scan data from DB.
 * @returns {{ capabilities, taskUsageMap, skillUsageMap, embeddedSourcesActive }}
 */
async function fetchScanData(dbPool) {
  const [capResult, taskStats, skillStats] = await Promise.all([
    dbPool.query(`
      SELECT id, name, description, current_stage, related_skills, key_tables, scope, owner
      FROM capabilities
      ORDER BY id
    `),
    dbPool.query(`
      SELECT
        task_type,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS recent_30d,
        MAX(created_at) AS last_used
      FROM tasks
      GROUP BY task_type
    `),
    dbPool.query(`
      SELECT
        step_name AS skill,
        COUNT(*) AS total_runs,
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        MAX(ts_start) AS last_run
      FROM run_events
      WHERE ts_start > NOW() - INTERVAL '90 days'
      GROUP BY step_name
    `),
  ]);

  const taskUsageMap = Object.fromEntries(taskStats.rows.map(r => [r.task_type, r]));
  const skillUsageMap = Object.fromEntries(skillStats.rows.map(r => [r.skill, r]));
  const embeddedSourcesActive = await fetchEmbeddedSourcesActive(dbPool);

  return { capabilities: capResult.rows, taskUsageMap, skillUsageMap, embeddedSourcesActive };
}

/**
 * Query cecelia_events to find which Brain-embedded sources are active.
 * @returns {Set<string>}
 */
async function fetchEmbeddedSourcesActive(dbPool) {
  const allEmbeddedSources = Object.values(BRAIN_EMBEDDED_SOURCES).flat();
  const active = new Set();
  if (allEmbeddedSources.length === 0) return active;

  try {
    const result = await dbPool.query(
      `SELECT DISTINCT source FROM cecelia_events
       WHERE source = ANY($1) AND created_at > NOW() - INTERVAL '90 days'`,
      [allEmbeddedSources]
    );
    for (const row of result.rows) {
      active.add(row.source);
    }
  } catch {
    // cecelia_events may not exist in all environments — treat as empty
  }
  return active;
}

// ============================================================
// Per-capability evaluation helpers
// ============================================================

/**
 * Check if a single table has data, using a shared cache to avoid duplicate queries.
 * @returns {Promise<boolean>}
 */
async function checkTableHasData(table, tableCountCache, dbPool) {
  if (tableCountCache[table] !== undefined) return tableCountCache[table];

  try {
    const result = await dbPool.query(
      `SELECT EXISTS (SELECT 1 FROM "${table}" LIMIT 1) AS has_data`
    );
    tableCountCache[table] = result.rows[0]?.has_data || false;
  } catch {
    tableCountCache[table] = false;
  }
  return tableCountCache[table];
}

/**
 * Evaluate skill usage for a capability.
 * @returns {{ hasSkillActivity, evidence, last_activity, usage_30d, success_rate }}
 */
function checkSkillUsage(relatedSkills, skillUsageMap, taskUsageMap) {
  let hasSkillActivity = false;
  let last_activity = null;
  let usage_30d = 0;
  let success_rate = null;
  const evidence = [];

  for (const skill of relatedSkills) {
    const usage = skillUsageMap[skill] || taskUsageMap[skill];
    if (!usage) continue;

    hasSkillActivity = true;
    evidence.push(`skill:${skill} total=${usage.total || usage.total_runs} completed=${usage.completed}`);

    const lastDate = usage.last_used || usage.last_run;
    if (lastDate && (!last_activity || new Date(lastDate) > new Date(last_activity))) {
      last_activity = lastDate;
    }
    usage_30d += parseInt(usage.recent_30d || 0);

    const total = parseInt(usage.total || usage.total_runs || 0);
    const completed = parseInt(usage.completed || 0);
    if (total > 0) {
      success_rate = Math.round((completed / total) * 100);
    }
  }

  return { hasSkillActivity, evidence, last_activity, usage_30d, success_rate };
}

/**
 * Evaluate table data evidence for a capability.
 * @returns {Promise<{ hasTableData, evidence }>}
 */
async function checkTableEvidence(keyTables, tableCountCache, dbPool) {
  let hasTableData = false;
  const evidence = [];

  for (const table of keyTables) {
    const hasData = await checkTableHasData(table, tableCountCache, dbPool);
    if (hasData) {
      hasTableData = true;
      evidence.push(`table:${table}=has_data`);
    } else {
      evidence.push(`table:${table}=empty`);
    }
  }

  return { hasTableData, evidence };
}

/**
 * Determine capability status from activity signals.
 * @returns {'active'|'dormant'|'island'|'failing'}
 */
function determineStatus(hasSkillActivity, hasTableData, last_activity, success_rate) {
  if (hasSkillActivity && success_rate !== null && success_rate < 30) {
    return 'failing';
  }
  if (!hasSkillActivity && !hasTableData) {
    return 'island';
  }
  if (last_activity) {
    const daysSince = (Date.now() - new Date(last_activity).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince > ISLAND_THRESHOLD_DAYS ? 'dormant' : 'active';
  }
  return hasTableData ? 'active' : 'dormant';
}

/**
 * Evaluate a single capability and return its health record.
 */
async function evaluateCapability(cap, { taskUsageMap, skillUsageMap, embeddedSourcesActive, tableCountCache, dbPool }) {
  const health = {
    id: cap.id,
    name: cap.name,
    stage: cap.current_stage,
    scope: cap.scope,
    owner: cap.owner,
    status: 'unknown',
    evidence: [],
    last_activity: null,
    usage_30d: 0,
    success_rate: null,
  };

  // 5.0 Brain always-active whitelist — short-circuit immediately
  if (BRAIN_ALWAYS_ACTIVE.has(cap.id)) {
    health.status = 'active';
    health.evidence.push('brain_embedded:true');
    return health;
  }

  // 5.1 Brain embedded event sources
  const embeddedSources = BRAIN_EMBEDDED_SOURCES[cap.id];
  if (embeddedSources) {
    health.evidence.push('brain_embedded:true');
    const activeSources = embeddedSources.filter(s => embeddedSourcesActive.has(s));
    if (activeSources.length > 0) {
      health.status = 'active';
      for (const src of activeSources) {
        health.evidence.push(`cecelia_events:source=${src}`);
      }
    } else {
      health.status = 'dormant';
      health.evidence.push('cecelia_events:no_recent_activity');
    }
    return health;
  }

  // 5.2 Skill usage
  const skillResult = checkSkillUsage(cap.related_skills || [], skillUsageMap, taskUsageMap);
  health.evidence.push(...skillResult.evidence);
  health.last_activity = skillResult.last_activity;
  health.usage_30d = skillResult.usage_30d;
  health.success_rate = skillResult.success_rate;

  // 5.3 Table evidence
  const tableResult = await checkTableEvidence(cap.key_tables || [], tableCountCache, dbPool);
  health.evidence.push(...tableResult.evidence);

  // 5.4 Status determination
  health.status = determineStatus(
    skillResult.hasSkillActivity,
    tableResult.hasTableData,
    health.last_activity,
    health.success_rate
  );

  return health;
}

/**
 * Build summary counts from health map.
 */
function buildSummary(healthMap) {
  return {
    total: healthMap.length,
    active: healthMap.filter(h => h.status === 'active').length,
    dormant: healthMap.filter(h => h.status === 'dormant').length,
    island: healthMap.filter(h => h.status === 'island').length,
    failing: healthMap.filter(h => h.status === 'failing').length,
    scanned_at: new Date().toISOString(),
  };
}

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

  const { capabilities, taskUsageMap, skillUsageMap, embeddedSourcesActive } = await fetchScanData(pool);
  const tableCountCache = {};
  const healthMap = [];

  for (const cap of capabilities) {
    const health = await evaluateCapability(cap, {
      taskUsageMap,
      skillUsageMap,
      embeddedSourcesActive,
      tableCountCache,
      dbPool: pool,
    });
    healthMap.push(health);
  }

  const summary = buildSummary(healthMap);

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
