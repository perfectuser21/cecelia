/**
 * GET /api/brain/ops-panorama — 执行全景面板聚合端点
 * Task: 28e7c41a-9384-405b-9e82-aa5b9871293f
 *
 * 并行聚合（Promise.all）：
 *   - tasks: DB 查 in_progress 任务 + vendor_dist
 *   - host: os.loadavg / os.cpus / os.freemem / os.totalmem
 *   - processes: ps aux 计数 claude/codex 进程
 *   - relay: docker ps --filter name=cecelia-relay 计数（失败→null）
 *   - llm_capacity: getLlmCapacitySnapshot()
 *   - sessions: 异步ps快照 → headed/headless 分类
 *
 * 单个数据源超时 5s 降级 null，整体请求仍返回 HTTP 200。
 */

import { Router } from 'express';
import os from 'os';
import { getLlmCapacitySnapshot } from '../llm-capacity.js';
import { probeProcesses, probeRelayContainers } from '../lib/ops-panorama-probes.js';

const router = Router();

const SOURCE_TIMEOUT_MS = 5000;

/**
 * 带超时包裹的 Promise，超时后 resolve null（fail-soft）。
 */
function withTimeout(promise, ms = SOURCE_TIMEOUT_MS) {
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * 计算 host 指标（CPU/内存）。
 * cpu_usage_pct = loadavg[0] / cpu_count * 100，clip 100。
 * mem_used_pct  = (1 - freemem/totalmem) * 100。
 */
function getHostMetrics() {
  const cpuCount = os.cpus().length || 1;
  const loadAvg1 = os.loadavg()[0] ?? 0;
  const cpu_usage_pct = Math.min(100, (loadAvg1 / cpuCount) * 100);

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const mem_used_pct = totalMem > 0 ? (1 - freeMem / totalMem) * 100 : 0;

  return {
    cpu_usage_pct: Math.round(cpu_usage_pct * 10) / 10,
    mem_used_pct: Math.round(mem_used_pct * 10) / 10,
  };
}

/**
 * 查询 DB: in_progress 任务数 + vendor_dist（按 selected_executor 分桶）。
 */
async function fetchTasksData(db) {
  const rows = await db.query(
    `SELECT payload->'allocation'->>'selected_executor' AS executor
     FROM tasks WHERE status = 'in_progress'`,
  );

  const in_progress_count = rows.rows.length;
  const vendor_dist = { claude: 0, codex: 0, grok: 0, unknown: 0 };

  for (const row of rows.rows) {
    const v = row.executor ?? 'unknown';
    if (['claude', 'codex', 'grok'].includes(v)) {
      vendor_dist[v] = (vendor_dist[v] ?? 0) + 1;
    } else {
      vendor_dist.unknown = (vendor_dist.unknown ?? 0) + 1;
    }
  }

  return { in_progress_count, vendor_dist };
}

/**
 * 将 llm_capacity snapshot 裁剪为响应安全格式（去掉 token/key 等敏感字段）。
 */
function sanitizeLlmCapacity(snapshot) {
  if (!snapshot) return null;

  const vendors = {};
  for (const [vendorName, ledger] of Object.entries(snapshot.vendors ?? {})) {
    const accounts = (ledger.accounts ?? []).map((acc) => {
      // 仅保留安全字段，移除 token/key/secret 等凭据字段
      const safe = {};
      const SAFE_FIELDS = ['id', 'name', 'vendor', 'available', 'used_percent', 'five_hour_pct', 'source'];
      for (const key of SAFE_FIELDS) {
        if (acc[key] !== undefined) safe[key] = acc[key];
      }
      return safe;
    });

    vendors[vendorName] = {
      available_count: ledger.available_count ?? 0,
      total_count: ledger.total_count ?? 0,
      accounts,
    };
  }

  return {
    sentinel: snapshot.sentinel,
    vendors,
  };
}

// GET /ops-panorama
router.get('/', async (req, res) => {
  const db = req.app.locals.pool;
  const sampled_at = new Date().toISOString();

  // 并行聚合所有数据源，单源超时 5s 降级 null
  const [tasksResult, hostMetrics, processResult, relayCount, llmCapacityRaw] = await Promise.all([
    withTimeout(fetchTasksData(db).catch(() => null)),
    Promise.resolve(getHostMetrics()),
    withTimeout(probeProcesses()),
    withTimeout(probeRelayContainers()),
    withTimeout(getLlmCapacitySnapshot().catch(() => null)),
  ]);

  const tasks = tasksResult ?? { in_progress_count: 0, vendor_dist: { claude: 0, codex: 0, grok: 0, unknown: 0 } };

  const processes = processResult ?? { claude_total: 0, codex_total: 0, sessions: { headed: 0, headless: 0 } };
  const sessions = processes.sessions;

  const llm_capacity = sanitizeLlmCapacity(llmCapacityRaw);

  console.log(`[ops-panorama] sampled_at=${sampled_at} tasks=${tasks.in_progress_count} cpu=${hostMetrics.cpu_usage_pct}% mem=${hostMetrics.mem_used_pct}%`);

  res.json({
    sampled_at,
    tasks,
    relay: { container_count: relayCount },
    sessions,
    host: hostMetrics,
    processes: {
      claude_total: processes.claude_total,
      codex_total: processes.codex_total,
    },
    llm_capacity,
  });
});

export default router;
