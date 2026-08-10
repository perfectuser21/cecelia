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

const SENTINEL_KEY = 'machine_vitals_stale_alert';

let _cache = null;                            // { sampled_at, relay_containers, relay_count, vm_total_mb, vm_used_mb, host_disk_pct, docker_disk_pct, error }
let _lastGoodAt = 0;
let _firstAttemptAt = 0;                      // never-good 基线：模块首次采样尝试时间
let _staleAlerted = false;
let _peakState = null;                        // { date:'YYYY-MM-DD', peak:number } 当日容器数峰值内存镜像（de6d3582 T1）

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

/**
 * @param {import('pg').Pool} [pool] 可选：传入时把 stale 告警/恢复写入 working_memory 哨兵键；
 *   不传时跳过 DB 写（纯采样，不抛错——供无 pool 场景如测试/独立调用）。
 */
export async function sampleMachineVitals(pool) {
  if (!_firstAttemptAt) _firstAttemptAt = Date.now();
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
    // 采样恢复即自愈哨兵——无条件幂等清除（PRD 需求 2 / 事故实证②：卡 2 天的根因是
    // 旧代码只在「本进程内 _staleAlerted=true」时才清；Brain 重启后内存 flag 归零，
    // 哨兵行却留在 working_memory，采样恢复也永不清除，持续误导排障方向）。
    if (pool) {
      await clearVitalsSentinelOnRecovery(pool);
    }
    // 当日容器数峰值滚动（日报 admission 吞吐段数据源，de6d3582）
    if (pool) {
      try {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
        if (!_peakState || _peakState.date !== today) {
          // 内存镜像缺失/跨日（含 Brain 重启）：回读 DB 同日已存峰值取 max，防止重启后低容器数把当日峰值抹低
          let dbPeak = 0;
          const r = await pool.query(
            `SELECT value_json FROM working_memory WHERE key = 'machine_vitals_daily_peak'`
          );
          const v = r.rows?.[0]?.value_json;
          const parsed = typeof v === 'string' ? JSON.parse(v) : v;
          if (parsed && parsed.date === today) dbPeak = parsed.peak || 0;
          _peakState = { date: today, peak: Math.max(dbPeak, next.relay_count) };
          await pool.query(
            `INSERT INTO working_memory (key, value_json, updated_at) VALUES ('machine_vitals_daily_peak', $1, NOW())
             ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()`,
            [JSON.stringify(_peakState)]
          );
        } else if (next.relay_count > _peakState.peak) {
          _peakState = { date: today, peak: next.relay_count };
          await pool.query(
            `INSERT INTO working_memory (key, value_json, updated_at) VALUES ('machine_vitals_daily_peak', $1, NOW())
             ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()`,
            [JSON.stringify(_peakState)]
          );
        }
      } catch (err) {
        console.warn(`[machine-vitals] 峰值写入失败(不影响采样): ${err.message}`);
      }
    }
  } catch (err) {
    next.error = err.message;
    // 持续采样失败超 15min → 升级告警（一次性，恢复后复位）。
    // never-good（_lastGoodAt 仍为 0，冷启动 docker 坏时）用首次采样尝试时间作基线，
    // 否则冷启动场景下 `_lastGoodAt &&` 门会让 stale 永不告警。
    const baseline = _lastGoodAt || _firstAttemptAt;
    if (Date.now() - baseline > STALE_ALERT_MS && !_staleAlerted) {
      _staleAlerted = true;
      console.error(`[machine-vitals] 采样持续失败超 ${STALE_ALERT_MS / 60000}min，harness 派发将保守拒发: ${err.message}`);
      if (pool) {
        await writeVitalsSentinel(pool, {
          since: new Date(baseline).toISOString(),
          last_error: err.message,
        });
      }
    }
  }
  _cache = next;
  return next;
}

/**
 * 采样成功后无条件清除 stale 哨兵行（幂等）。真的清掉了行（rowCount>0）才留痕——
 * 记录 auto_recovered 事件 + 日志，避免每次成功采样都刷噪声。restart 后残留的哨兵
 * 也能被下一次成功采样自愈（不依赖本进程内的 _staleAlerted 内存 flag）。
 */
async function clearVitalsSentinelOnRecovery(pool) {
  try {
    const del = await pool.query(`DELETE FROM working_memory WHERE key = $1`, [SENTINEL_KEY]);
    if (del?.rowCount > 0) {
      console.log('[machine-vitals] stale 哨兵在采样恢复后自动清除（留痕）');
      try {
        const { emit } = await import('./event-bus.js');
        await emit('blocking_state_auto_recovered', 'machine-vitals', { key: SENTINEL_KEY });
      } catch (e) {
        console.warn('[machine-vitals] auto_recovered 留痕失败（不阻断）:', e.message);
      }
    }
  } catch (e) {
    console.warn('[machine-vitals] sentinel clear failed:', e.message);
  }
}

async function writeVitalsSentinel(pool, record) {
  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      [SENTINEL_KEY, JSON.stringify(record)],
    );
  } catch (e) {
    console.warn(`[machine-vitals] sentinel write failed:`, e.message);
  }
}

export function getMachineVitals() {
  if (!_cache) return { error: 'never_sampled', stale: true, relay_count: null, relay_containers: [], vm_total_mb: null, vm_used_mb: null, host_disk_pct: null, docker_disk_pct: null, sampled_at: null };
  return { ..._cache, stale: Date.now() - _cache.sampled_at > STALE_MS };
}

export function _resetVitalsCacheForTest() { _cache = null; _lastGoodAt = 0; _firstAttemptAt = 0; _staleAlerted = false; _peakState = null; }
export function _setVitalsCacheForTest(obj) { _cache = obj; }
