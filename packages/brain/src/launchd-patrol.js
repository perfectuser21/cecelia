/**
 * launchd-patrol.js — 宿主机 launchd 服务巡检哨兵（任务 a5a6209a）
 *
 * 背景：launchd 服务被静默禁用/不加载已两次独立引发多天无告警生产故障
 * （07-08 zenithjoy-api 502 三天；07-10 com.cecelia.bridge 被 disabled，PR #3768）。
 * 本机 gui/501 域不存在 → ~/Library/LaunchAgents 永不加载，用 launchd 守 launchd
 * 是循环依赖，故守卫放 Brain（docker unless-stopped，存活性与宿主 launchd 独立）。
 *
 * 每 15min（模块自 gate）核对预期服务清单：
 *   - MUST_RUN_DAEMONS：系统域须 enabled + loaded + state=running
 *   - MUST_LOAD_DAEMONS：周期型，须 enabled + loaded（无常驻 pid）
 *   - MUST_LISTEN_PORTS：端口存活（双信号判定点 d172e54a：抓 launchd 管不到的
 *     nohup 孤儿宕机；zenithjoy-api 5200 与进程管理方式解耦）
 *   - EXPECTED_DISABLED：显式废弃名单，出现在 disabled 集合属预期不告警
 *     （判定点 6e9db0a8：frontend 判废弃，5211 已由 docker Dashboard 服务）
 *
 * 异常 → sendBark（dedupeKey DB 级 6h 去重，跨重启）+ raise P1（小时汇总通道）。
 * 宿主 ssh 不可达 → fail-open 不告警（照 harness-skill-relay 哲学；连续不可达由
 * scheduler_job_last_run 哨兵 + 战报兜底观测）。
 */
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { raise } from './alerting.js';
import { sendBark } from './notifier.js';

export const MUST_RUN_DAEMONS = ['com.cecelia.bridge'];
export const MUST_LOAD_DAEMONS = [
  'com.cecelia.bridge-keepalive',
  'com.cecelia.token-refresh',
  'com.cecelia.pf-firewall',
  'com.cecelia.smoke-nightly',
];
export const MUST_LISTEN_PORTS = [
  { port: 3457, name: 'cecelia-bridge' },
  { port: 5200, name: 'zenithjoy-api' },
  { port: 5201, name: 'zenithjoy-api-staging' },
];
// 仅声明用途（manifest 文档），运行逻辑不消费：不告警来自"不在必查名单"
export const EXPECTED_DISABLED = ['com.cecelia.frontend', 'com.n8n'];

const INTERVAL_MS = parseInt(
  process.env.LAUNCHD_PATROL_INTERVAL_MS || String(15 * 60 * 1000),
  10,
);
const BARK_DEDUPE_TTL_SEC = 6 * 3600;
const EXEC_TIMEOUT_MS = 20_000;

let lastRunAt = 0;
export function __resetLaunchdPatrolForTest() {
  lastRunAt = 0;
}

function defaultExec(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    timeout: EXEC_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** 密钥发现式回退（照 spawn/host-executor.js 先例）：宿主实际只有 id_rsa，硬编码 ed25519 会 Permission denied */
function discoverSshKey(keyExistsFn = existsSync) {
  const dir = `${homedir()}/.ssh`;
  for (const name of ['id_ed25519', 'id_rsa']) {
    const candidate = `${dir}/${name}`;
    if (keyExistsFn(candidate)) return candidate;
  }
  return `${dir}/id_ed25519`;
}

/** 容器内包 ssh 逃逸宿主（staging-e2e-runner.js spawnReviewPreview 同款三件套），宿主直跑原样返回 */
function buildHostCmd(cmd, inContainer, keyExistsFn) {
  if (!inContainer) return cmd;
  const target = process.env.CECELIA_HOST_EXEC_SSH || 'administrator@host.docker.internal';
  const key = discoverSshKey(keyExistsFn);
  const quoted = `'${cmd.replace(/'/g, `'\\''`)}'`;
  return `ssh -i ${key} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=10 ${target} ${quoted}`;
}

export function parseDisabledSet(out) {
  const set = new Set();
  for (const m of String(out).matchAll(/"([^"]+)"\s*=>\s*disabled/g)) set.add(m[1]);
  return set;
}

/**
 * scheduler-jobs handler（needsPool:false）。opts 仅供测试注入。
 * @returns {Promise<{skipped?:true}|{ok:false,reason:string}|{ok:true,checked:number,anomalies:string[]}>}
 */
export async function runLaunchdPatrol(opts = {}) {
  const now = opts.now ?? Date.now();
  if (now - lastRunAt < INTERVAL_MS) return { skipped: true };
  lastRunAt = now;

  const exec = opts.exec || defaultExec;
  const inContainer = opts.inContainer ?? existsSync('/.dockerenv');
  const run = (cmd) => exec(buildHostCmd(cmd, inContainer, opts.keyExistsFn));

  // 首条命令兼做连通性探针：宿主不可达 → fail-open（不告警服务异常）
  let disabledOut;
  try {
    disabledOut = run('launchctl print-disabled system');
  } catch (e) {
    console.warn('[launchd-patrol] 宿主不可达，本轮跳过：', e.message?.slice(0, 200));
    return { ok: false, reason: 'host_unreachable' };
  }

  const disabledSet = parseDisabledSet(disabledOut);
  const anomalies = [];

  for (const label of [...MUST_RUN_DAEMONS, ...MUST_LOAD_DAEMONS]) {
    if (disabledSet.has(label)) {
      anomalies.push(`disabled:${label}`);
      continue;
    }
    let printOut;
    try {
      printOut = run(`launchctl print system/${label}`);
    } catch {
      anomalies.push(`not_loaded:${label}`);
      continue;
    }
    if (MUST_RUN_DAEMONS.includes(label) && !/state = running/.test(printOut)) {
      anomalies.push(`not_running:${label}`);
    }
  }

  for (const { port, name } of MUST_LISTEN_PORTS) {
    try {
      run(`nc -z -G 3 localhost ${port}`);
    } catch {
      anomalies.push(`port_down:${port}(${name})`);
    }
  }

  const checked = MUST_RUN_DAEMONS.length + MUST_LOAD_DAEMONS.length + MUST_LISTEN_PORTS.length;

  if (anomalies.length > 0) {
    const msg = `宿主 launchd 巡检发现 ${anomalies.length} 项异常: ${anomalies.join(', ')}`;
    console.warn(`[launchd-patrol] ${msg}`);
    const fingerprint = [...anomalies].sort().join('|');
    try {
      await sendBark('launchd 巡检异常', msg, {
        dedupeKey: `launchd-patrol:${fingerprint}`,
        dedupeTtlSec: BARK_DEDUPE_TTL_SEC,
      });
    } catch (e) {
      console.warn('[launchd-patrol] sendBark 失败：', e.message);
    }
    try {
      await raise('P1', 'launchd_patrol_anomaly', msg);
    } catch (e) {
      console.warn('[launchd-patrol] raise 失败：', e.message);
    }
  }

  return { ok: true, checked, anomalies };
}
