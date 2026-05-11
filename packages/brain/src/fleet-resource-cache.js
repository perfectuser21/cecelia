/**
 * Fleet Resource Cache — 全局多机器资源感知
 *
 * 每 30 秒采集所有编程机器（Mac mini）的 CPU/内存，
 * 为 slot-allocator 提供远程资源数据。
 *
 * 只采集 COMPUTE_SERVERS（能跑编程任务的机器），不采集 VPS/PC/NAS。
 *
 * v2: 心跳可信度增强
 *   - HEARTBEAT_OFFLINE_GRACE_MIN env 控制 offline 判定阈值（默认 10 分钟）
 *   - last_ping_at: 最后一次成功采集的时间戳
 *   - offline_reason: 'no_ping_grace_exceeded' | 'fetch_failed' | null
 */

import { SERVERS, COMPUTE_SERVERS, collectLocalStats, collectRemoteUnixStats } from './routes/infra-status.js';
import { calculatePhysicalCapacity } from './platform-utils.js';

const REFRESH_INTERVAL_MS = 30_000; // 30 秒
const STALE_THRESHOLD_MS = 90_000;  // 90 秒后数据视为过期（不影响 offline_reason 判定）

/**
 * offline 判定宽限期（分钟）
 * 超过此时间无成功 ping → offline_reason='no_ping_grace_exceeded'
 */
function getOfflineGraceMs() {
  const envVal = parseInt(process.env.HEARTBEAT_OFFLINE_GRACE_MIN, 10);
  const minutes = (!Number.isNaN(envVal) && envVal > 0) ? envVal : 10;
  return minutes * 60 * 1000;
}

// 内存缓存: serverId → {
//   online, stats, physicalCapacity, effectiveSlots, pressure,
//   lastUpdated,   — 每次 refresh 尝试（无论成功失败）的时间戳
//   last_ping_at,  — 最后一次成功采集的时间戳（null 表示从未成功）
//   offline_reason — null | 'fetch_failed' | 'no_ping_grace_exceeded'
// }
const _cache = new Map();

let _refreshTimer = null;

/**
 * 采集一台机器的资源状态
 * @param {object} server
 * @param {number|null} prevLastPingAt — 上次成功 ping 的时间戳（来自缓存）
 */
async function collectServerStats(server, prevLastPingAt) {
  try {
    const stats = server.isLocal
      ? collectLocalStats()
      : await collectRemoteUnixStats(server);

    const totalMemMB = Math.round(stats.memory.totalGB * 1024);
    const cpuCores = stats.cpu.cores;
    const physicalCapacity = calculatePhysicalCapacity(totalMemMB, cpuCores, 400, 0.5);

    const cpuPressure = stats.cpu.usagePercent / 100;
    const memPressure = stats.memory.usagePercent / 100;
    const maxPressure = Math.max(cpuPressure, memPressure);
    const effectiveSlots = Math.max(0, Math.floor(physicalCapacity * (1 - maxPressure)));

    return {
      online: true,
      stats,
      physicalCapacity,
      effectiveSlots,
      pressure: maxPressure,
      lastUpdated: Date.now(),
      last_ping_at: Date.now(),    // 成功采集 → 更新 ping 时间
      offline_reason: null,
    };
  } catch {
    const now = Date.now();
    const graceMs = getOfflineGraceMs();
    // 从未成功 → fetch_failed；曾经成功但超出宽限 → no_ping_grace_exceeded
    const offline_reason = (prevLastPingAt === null || prevLastPingAt === undefined)
      ? 'fetch_failed'
      : (now - prevLastPingAt > graceMs ? 'no_ping_grace_exceeded' : 'fetch_failed');

    return {
      online: false,
      stats: null,
      physicalCapacity: 0,
      effectiveSlots: 0,
      pressure: 1,
      lastUpdated: now,
      last_ping_at: prevLastPingAt ?? null,   // 保留上次成功时间戳（如有）
      offline_reason,
    };
  }
}

/**
 * 刷新所有编程机器的缓存
 */
async function refreshFleetCache() {
  const computeServers = SERVERS.filter(s => COMPUTE_SERVERS.includes(s.id));

  const _results = await Promise.allSettled(
    computeServers.map(async (server) => {
      const prevEntry = _cache.get(server.id);
      const prevLastPingAt = prevEntry?.last_ping_at ?? null;
      const entry = await collectServerStats(server, prevLastPingAt);
      _cache.set(server.id, { ...entry, id: server.id, role: server.role });
    })
  );

  const online = [..._cache.values()].filter(e => e.online).length;
  const total = computeServers.length;
  console.log(`[fleet-cache] 刷新完成: ${online}/${total} 在线, 总 effectiveSlots=${[..._cache.values()].reduce((s, e) => s + e.effectiveSlots, 0)}`);
}

/**
 * 启动定时刷新（在 tick loop 启动时调用）
 */
export function startFleetRefresh() {
  if (_refreshTimer) return;
  console.log(`[fleet-cache] 启动定时刷新 (${REFRESH_INTERVAL_MS / 1000}s, grace=${getOfflineGraceMs() / 60000}min)`);
  refreshFleetCache(); // 立即采集一次
  _refreshTimer = setInterval(refreshFleetCache, REFRESH_INTERVAL_MS);
}

/**
 * 停止定时刷新
 */
export function stopFleetRefresh() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = null;
  }
}

/**
 * 获取所有编程机器的资源状态
 * @returns {Array<{id, role, online, physicalCapacity, effectiveSlots, pressure, stats, lastUpdated, last_ping_at, offline_reason}>}
 */
export function getFleetStatus() {
  return [..._cache.values()].map(entry => {
    const stale = Date.now() - entry.lastUpdated >= STALE_THRESHOLD_MS;
    // 数据过期时整体降级为 offline，但保留原始 offline_reason（或标 no_ping_grace_exceeded）
    const online = entry.online && !stale;
    const offline_reason = online
      ? null
      : (entry.offline_reason || (stale ? 'no_ping_grace_exceeded' : null));

    return {
      id: entry.id,
      role: entry.role,
      online,
      physicalCapacity: entry.physicalCapacity,
      effectiveSlots: online ? entry.effectiveSlots : 0,
      pressure: online ? entry.pressure : 1,
      cpu: entry.stats?.cpu || null,
      memory: entry.stats?.memory || null,
      lastUpdated: entry.lastUpdated,
      last_ping_at: entry.last_ping_at ?? null,
      offline_reason,
    };
  });
}

/**
 * 获取指定机器的可用 slot 数
 * @param {string} serverId
 * @returns {{online, effectiveSlots, physicalCapacity, pressure, last_ping_at, offline_reason} | null}
 */
export function getRemoteCapacity(serverId) {
  const entry = _cache.get(serverId);
  if (!entry) return null;
  const fresh = Date.now() - entry.lastUpdated < STALE_THRESHOLD_MS;
  const online = entry.online && fresh;
  return {
    online,
    effectiveSlots: online ? entry.effectiveSlots : 0,
    physicalCapacity: entry.physicalCapacity,
    pressure: entry.pressure,
    last_ping_at: entry.last_ping_at ?? null,
    offline_reason: online ? null : (entry.offline_reason || null),
  };
}

/**
 * 检查指定机器是否在线且数据新鲜
 * @param {string} serverId
 * @returns {boolean}
 */
export function isServerOnline(serverId) {
  const entry = _cache.get(serverId);
  if (!entry) return false;
  return entry.online && (Date.now() - entry.lastUpdated < STALE_THRESHOLD_MS);
}

/**
 * 获取所有在线编程机器的总 effectiveSlots
 * @returns {number}
 */
export function getTotalEffectiveSlots() {
  return [..._cache.values()]
    .filter(e => e.online && (Date.now() - e.lastUpdated < STALE_THRESHOLD_MS))
    .reduce((sum, e) => sum + e.effectiveSlots, 0);
}
