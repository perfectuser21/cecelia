import {projectGpuObservation} from './fleet-gpu-observation.js';
// 与 node-admission 的报告有效期及最大时钟偏差保持一致。
const MAX_SAMPLE_AGE_MS = 90_000;
const MAX_FUTURE_SKEW_MS = 30_000;

export function sampleTimeReason(observedAt, now = Date.now()) {
  if (!Number.isFinite(observedAt)) return 'worker_health_timestamp_invalid';
  if (observedAt - now > MAX_FUTURE_SKEW_MS) return 'worker_health_future';
  if (now - observedAt >= MAX_SAMPLE_AGE_MS) return 'worker_health_stale';
  return null;
}

/** 只接受 worker 原始采样合同；缺失值不能充当零压力。 */
export function parseWorkerResources(health, machineId, now = Date.now()) {
  if (health?.schema_version !== 'fleet-node-health/v1') {
    throw new Error('worker_health_schema_invalid');
  }
  if (health.machine_id !== machineId) throw new Error('worker_health_machine_mismatch');
  const observedAt = typeof health.observed_at === 'string' ? Date.parse(health.observed_at) : NaN;
  const timeReason = sampleTimeReason(observedAt, now);
  if (timeReason) throw new Error(timeReason);
  const r = health.resources;
  const positive = value => Number.isFinite(value) && value > 0;
  const percentage = value => Number.isFinite(value) && value >= 0 && value <= 100;
  if (!r || !positive(r.cpu_cores) || !positive(r.memory_bytes)
    || !percentage(r.cpu_pressure_percent) || !percentage(r.memory_pressure_percent)
    || !Number.isFinite(r.disk_free_bytes) || r.disk_free_bytes < 0
    || !percentage(r.disk_used_percent)) {
    throw new Error('worker_health_resources_invalid');
  }
  return {
    status: 'online',
    gpu: projectGpuObservation(health.gpu,now),
    observedAt,
    cpu: { cores: r.cpu_cores, usagePercent: r.cpu_pressure_percent },
    memory: { totalGB: r.memory_bytes / (1024 ** 3), usagePercent: r.memory_pressure_percent },
    disk: { freeBytes: r.disk_free_bytes, usagePercent: r.disk_used_percent },
  };
}

export function cachedResourceReason(entry, now = Date.now()) {
  if (!entry.online) return entry.admission_reason || 'worker_health_unavailable';
  return sampleTimeReason(entry.stats?.observedAt, now)
    || (now - entry.lastUpdated >= MAX_SAMPLE_AGE_MS ? 'worker_health_stale' : null);
}
