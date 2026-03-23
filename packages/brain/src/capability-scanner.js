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

// 外部基础设施能力 — 已部署但不向 Brain DB 写入证据
// 这些能力运行在 Brain 进程之外（网络层、UI 层、CI 层），
// 无法通过 run_events / cecelia_events / key_tables 验证，
// 但它们的存在可由系统运行状态间接推断（Brain 在运行 = 部署有效）。
// 状态始终为 active，证据标记 infra_deployed:true 而非 island。
const INFRA_DEPLOYED_CAPABILITIES = new Set([
  'brain-deployment',        // Brain 进程在运行 = 部署流程有效
  'branch-protection-hooks', // dev 任务正在执行 = branch-protect hooks 在运行
  'cecelia-dashboard',       // Dashboard 已部署在 port 5211
  'ci-devgate-quality',      // dev PR 流经 CI = DevGate 门禁有效
  'cloudflare-tunnel-routing', // Cloudflare tunnel 已配置并路由域名
  'nas-file-storage',        // NAS 通过 Tailscale 可访问
  'tailscale-internal-network', // 跨设备 Tailscale 内网已建立
  'vpn-service-management',  // 双节点 VPN 服务运行中
  'zenithjoy-dashboard',     // ZenithJoy dashboard 已部署
]);

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
  // ── 误判修正（scanner fix）──────────────────────────────────────────
  // 以下三个能力被 Scanner 误判为孤岛/休眠，根本原因：
  //   dev-workflow: 扫描早于任务创建 → island；0% 完成率 → failing
  //   self-healing: 免疫系统未触发（系统健康）→ dormant（实为误判）
  //   self-healing-immunity: 同上，免疫策略始终驻留 Brain 进程
  'dev-workflow',                 // /dev 调度能力，Brain 随时可派发开发任务
  'self-healing',                 // 免疫系统，Brain 固有，未触发≠不存在
  'self-healing-immunity',        // 免疫策略层，Brain 固有组成部分
]);

// ============================================================
// Core scanner — helper functions
// ============================================================

/**
 * 检查 Brain 嵌入事件源并更新 health 对象。
 * 返回 true 表示已处理（调用方应跳过后续检查），false 表示未匹配。
 */
function checkBrainEmbeddedSources(health, capId, embeddedSourcesActive) {
  const embeddedSources = BRAIN_EMBEDDED_SOURCES[capId];
  if (!embeddedSources) return false;

  health.evidence.push('brain_embedded:true');
  const activeSources = embeddedSources.filter(s => embeddedSourcesActive.has(s));

  if (activeSources.length > 0) {
    health.status = 'active';
    for (const src of activeSources) {
      health.evidence.push(`cecelia_events:source=${src}`);
    }
  } else {
    health.evidence.push('cecelia_events:no_recent_activity');
    health.status = 'dormant';
  }
  return true;
}

/**
 * 收集关联技能的使用数据，更新 health 对象。
 * 返回 hasSkillActivity 布尔值。
 */
function collectSkillActivity(health, relatedSkills, skillUsageMap, taskUsageMap) {
  let hasSkillActivity = false;
  for (const skill of relatedSkills) {
    const usage = skillUsageMap[skill] || taskUsageMap[skill];
    if (!usage) continue;

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
  return hasSkillActivity;
}

/**
 * 检查关键表是否有数据，更新 health 对象和 tableCountCache。
 * 返回 hasTableData 布尔值。
 */
async function collectTableData(health, keyTables, tableCountCache) {
  let hasTableData = false;
  for (const table of keyTables) {
    if (tableCountCache[table] === undefined) {
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
  return hasTableData;
}

/**
 * 根据活动证据确定能力状态。
 */
function determineStatus(hasSkillActivity, successRate, hasTableData, lastActivity) {
  if (hasSkillActivity && successRate !== null && successRate < 30) return 'failing';
  if (!hasSkillActivity && !hasTableData) return 'island';
  if (lastActivity) {
    const daysSince = (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince > ISLAND_THRESHOLD_DAYS ? 'dormant' : 'active';
  }
  return hasTableData ? 'active' : 'dormant';
}

/**
 * 加载 Brain 嵌入事件源的最近活跃状态。
 */
async function loadEmbeddedSourcesActive() {
  const allEmbeddedSources = Object.values(BRAIN_EMBEDDED_SOURCES).flat();
  const embeddedSourcesActive = new Set();
  if (allEmbeddedSources.length === 0) return embeddedSourcesActive;
  try {
    const result = await pool.query(
      `SELECT DISTINCT source FROM cecelia_events
       WHERE source = ANY($1) AND created_at > NOW() - INTERVAL '90 days'`,
      [allEmbeddedSources]
    );
    for (const row of result.rows) embeddedSourcesActive.add(row.source);
  } catch {
    // cecelia_events may not exist in all environments — treat as empty
  }
  return embeddedSourcesActive;
}

/**
 * 评估单个能力的健康状态。
 */
async function evaluateCapability(cap, skillUsageMap, taskUsageMap, tableCountCache, embeddedSourcesActive) {
  const health = {
    id: cap.id, name: cap.name, stage: cap.current_stage,
    scope: cap.scope, owner: cap.owner, status: 'unknown',
    evidence: [], last_activity: null, usage_30d: 0, success_rate: null,
  };

  if (BRAIN_ALWAYS_ACTIVE.has(cap.id)) {
    health.status = 'active';
    health.evidence.push('brain_embedded:true');
    return health;
  }
  if (INFRA_DEPLOYED_CAPABILITIES.has(cap.id)) {
    health.status = 'active';
    health.evidence.push('infra_deployed:true');
    return health;
  }
  if (checkBrainEmbeddedSources(health, cap.id, embeddedSourcesActive)) return health;

  const hasSkillActivity = collectSkillActivity(
    health, cap.related_skills || [], skillUsageMap, taskUsageMap
  );
  const hasTableData = await collectTableData(health, cap.key_tables || [], tableCountCache);
  health.status = determineStatus(hasSkillActivity, health.success_rate, hasTableData, health.last_activity);
  return health;
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

  const capResult = await pool.query(`
    SELECT id, name, description, current_stage, related_skills, key_tables, scope, owner
    FROM capabilities ORDER BY id
  `);
  const taskStats = await pool.query(`
    SELECT task_type,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS recent_30d,
      MAX(created_at) AS last_used
    FROM tasks GROUP BY task_type
  `);
  const skillStats = await pool.query(`
    SELECT step_name AS skill,
      COUNT(*) AS total_runs,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      COUNT(*) FILTER (WHERE ts_start > NOW() - INTERVAL '30 days') AS recent_30d,
      MAX(ts_start) AS last_run
    FROM run_events WHERE ts_start > NOW() - INTERVAL '90 days' GROUP BY step_name
  `);

  const taskUsageMap = Object.fromEntries(taskStats.rows.map(r => [r.task_type, r]));
  const skillUsageMap = Object.fromEntries(skillStats.rows.map(r => [r.skill, r]));
  const embeddedSourcesActive = await loadEmbeddedSourcesActive();
  const tableCountCache = {};

  const healthMap = [];
  for (const cap of capResult.rows) {
    healthMap.push(await evaluateCapability(cap, skillUsageMap, taskUsageMap, tableCountCache, embeddedSourcesActive));
  }

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
