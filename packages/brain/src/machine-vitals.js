/**
 * machine-vitals —— 本机体征采样器（beeba317 产能判定合并）
 *
 * 单一职责：采集 docker 容器数 / OrbStack VM 内存 / 磁盘水位写内存缓存。
 * 不做判定——判定在 slot-allocator.harnessSlotCheck()。
 * 由 scheduler-jobs 每 60s 驱动 sampleMachineVitals()；
 * 派发热路径只调 getMachineVitals()（同步读缓存，零命令执行）。
 */
import { execFile } from 'node:child_process';

export const STALE_MS = 180 * 1000;          // 3×采样周期(60s)，超龄=stale
const STALE_ALERT_MS = 15 * 60 * 1000;       // 持续 stale 15min → 升级告警
const RELAY_PREFIX = 'cecelia-relay-';
const CMD_TIMEOUT_MS = 10 * 1000;

let _cache = null;                            // { sampled_at, relay_containers, relay_count, vm_total_mb, vm_used_mb, host_disk_pct, docker_disk_pct, error }
let _lastGoodAt = 0;
let _staleAlerted = false;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: CMD_TIMEOUT_MS }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout));
    });
  });
}

/** "512MiB / 8GiB" → MB 数（左值） */
function parseMemUsageLine(line) {
  const m = line.trim().match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mult = { b: 1 / 1024 ** 2, kib: 1 / 1024, mib: 1, gib: 1024, tib: 1024 ** 2 }[unit] ?? 0;
  return n * mult;
}

/** df -P 输出 → 使用率百分比整数 */
function parseDfPct(out) {
  const lines = out.trim().split('\n');
  const last = lines[lines.length - 1] || '';
  const m = last.match(/(\d+)%/);
  return m ? parseInt(m[1], 10) : null;
}

export async function sampleMachineVitals() {
  const next = {
    sampled_at: Date.now(),
    relay_containers: [], relay_count: 0,
    vm_total_mb: null, vm_used_mb: null,
    host_disk_pct: null, docker_disk_pct: null,
    error: null,
  };
  try {
    const [psOut, infoOut, statsOut, dfOut] = await Promise.all([
      run('docker', ['ps', '--format', '{{.Names}}']),
      run('docker', ['info', '--format', '{{.MemTotal}}']),
      run('docker', ['stats', '--no-stream', '--format', '{{.MemUsage}}']),
      run('df', ['-P', '/']),
    ]);
    next.relay_containers = psOut.split('\n').map(s => s.trim()).filter(n => n.startsWith(RELAY_PREFIX));
    next.relay_count = next.relay_containers.length;
    next.vm_total_mb = Math.round(parseInt(infoOut.trim(), 10) / 1024 / 1024);
    next.vm_used_mb = Math.round(statsOut.split('\n').filter(Boolean).reduce((s, l) => s + parseMemUsageLine(l), 0));
    next.host_disk_pct = parseDfPct(dfOut);
    // OrbStack data 盘与宿主同卷（APFS），docker_disk_pct 并入宿主口径（spec 约定的降级路径）
    next.docker_disk_pct = next.host_disk_pct;
    _lastGoodAt = next.sampled_at;
    _staleAlerted = false;
  } catch (err) {
    next.error = err.message;
    // 持续采样失败超 15min → 升级告警（一次性，恢复后复位）
    if (_lastGoodAt && Date.now() - _lastGoodAt > STALE_ALERT_MS && !_staleAlerted) {
      _staleAlerted = true;
      console.error(`[machine-vitals] 采样持续失败超 ${STALE_ALERT_MS / 60000}min，harness 派发将保守拒发: ${err.message}`);
    }
  }
  _cache = next;
  return next;
}

export function getMachineVitals() {
  if (!_cache) return { error: 'never_sampled', stale: true, relay_count: null, relay_containers: [], vm_total_mb: null, vm_used_mb: null, host_disk_pct: null, docker_disk_pct: null, sampled_at: null };
  return { ..._cache, stale: Date.now() - _cache.sampled_at > STALE_MS };
}

export function _resetVitalsCacheForTest() { _cache = null; _lastGoodAt = 0; _staleAlerted = false; }
export function _setVitalsCacheForTest(obj) { _cache = obj; }
