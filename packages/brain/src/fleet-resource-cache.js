/**
 * Fleet Resource Cache — 全局多机器资源感知
 *
 * 每 30 秒采集所有编程机器（Mac mini）的 CPU/内存，
 * 为 slot-allocator 提供远程资源数据。
 *
 * 只采集 COMPUTE_SERVERS（能跑编程任务的机器），不采集 VPS/PC/NAS。
 */

import { SERVERS, COMPUTE_SERVERS, collectLocalStats, collectRemoteUnixStats } from './routes/infra-status.js';
import { calculatePhysicalCapacity } from './platform-utils.js';

const REFRESH_INTERVAL_MS = 30_000; // 30 秒
const STALE_THRESHOLD_MS = 90_000;  // 90 秒后视为过期

// 内存缓存: serverId → { stats, effectiveSlots, physicalCapacity, online, lastUpdated }
const _cache = new Map();

let _refreshTimer = null;

/**
 * 采集一台机器的资源状态
 */
async function collectServerStats(server) {
  try {
    const stats = server.isLocal
      ? collectLocalStats()
      : await collectRemoteUnixStats(server);

    const totalMemMB = Math.round(stats.memory.totalGB * 1024);
    const cpuCores = stats.cpu.cores;
    const physicalCapacity = calculatePhysicalCapacity(totalMemMB, cpuCores, 400, 0.5);

    // 根据当前负载算有效 slot
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
    };
  } catch {
    return {
      online: false,
      stats: null,
      physicalCapacity: 0,
      effectiveSlots: 0,
      pressure: 1,
      lastUpdated: Date.now(),
    };
  }
}

/**
 * 刷新所有编程机器的缓存
 */
async function refreshFleetCache() {
  const computeServers = SERVERS.filter(s => COMPUTE_SERVERS.includes(s.id));

  const results = await Promise.allSettled(
    computeServers.map(async (server) => {
      const entry = await collectServerStats(server);
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
  console.log(`[fleet-cache] 启动定时刷新 (${REFRESH_INTERVAL_MS / 1000}s)`);
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
 * @returns {Array<{id, role, online, physicalCapacity, effectiveSlots, pressure, stats, lastUpdated}>}
 */
export function getFleetStatus() {
  return [..._cache.values()].map(entry => ({
    id: entry.id,
    role: entry.role,
    online: entry.online && (Date.now() - entry.lastUpdated < STALE_THRESHOLD_MS),
    physicalCapacity: entry.physicalCapacity,
    effectiveSlots: entry.effectiveSlots,
    pressure: entry.pressure,
    cpu: entry.stats?.cpu || null,
    memory: entry.stats?.memory || null,
    lastUpdated: entry.lastUpdated,
  }));
}

/**
 * 获取指定机器的可用 slot 数
 * @param {string} serverId - 机器 ID（如 'xian-mac-m4'）
 * @returns {{online, effectiveSlots, physicalCapacity, pressure} | null}
 */
export function getRemoteCapacity(serverId) {
  const entry = _cache.get(serverId);
  if (!entry) return null;
  const fresh = Date.now() - entry.lastUpdated < STALE_THRESHOLD_MS;
  return {
    online: entry.online && fresh,
    effectiveSlots: fresh ? entry.effectiveSlots : 0,
    physicalCapacity: entry.physicalCapacity,
    pressure: entry.pressure,
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
