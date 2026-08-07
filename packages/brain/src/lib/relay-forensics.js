/**
 * relay-forensics.js — relay 容器死因保全(TOP2 刀1 件③,2026-08-07)
 *
 * 病:容器死了,死因也跟着没了。当晚三条 harness_initiative 全灭后想查死因,
 * `docker ps -a` 里一具尸体都不剩——janitor.sh --mode frequent 每 15 分钟跑一次
 * 无过滤的 `docker container prune -f`(janitor.sh:436),三次 prune 的时刻
 * (LA 04:00:04 / 04:15:04 / 04:30:04)与三个容器的死亡时刻一一对应,
 * docker logs 连同容器一起被回收。Brain 侧 spawn/detached.js 特意不加 --rm 就是为了
 * 留 forensic,但注释里说的"callback router 之后 docker rm 主动清"其实从未实现,
 * 真正的清理者一直是 janitor,而它不给任何人留证据。
 *
 * 药:不跟收割器抢时间,直接在容器回调到达的那一刻落盘——那时容器进程还没退出,
 * docker logs 必然拿得到。
 *
 * 全程 best-effort:任何失败都只返回 ok:false,绝不抛、绝不拖累回调 ack。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * docker 容器名合法字符集。containerId 来自 HTTP 路由参数
 * (POST /harness/callback/:containerId),会被拼进 shell 命令 —— 必须先卡死字符集,
 * 否则等于把 shell 交给调用方。
 */
const SAFE_CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function isSafeContainerName(name) {
  return typeof name === 'string' && SAFE_CONTAINER_NAME.test(name);
}

/**
 * forensic 落盘目录。默认放在 prompt 目录下:compose 已把宿主
 * ~/claude-output/cecelia-prompts bind-mount 到 Brain 容器 /tmp/cecelia-prompts,
 * 写这里宿主直接可见、且不随 Brain 容器重建蒸发。
 * (Brain 容器的 /tmp 本体是 100M tmpfs,直接写 /tmp 等于没存。)
 */
export function relayForensicDir(env = process.env) {
  if (env.CECELIA_RELAY_FORENSIC_DIR) return env.CECELIA_RELAY_FORENSIC_DIR;
  const promptDir = env.CECELIA_PROMPT_DIR || '/tmp/cecelia-prompts';
  return path.join(promptDir, 'relay-forensics');
}

/**
 * 抓 docker logs 落盘。
 * @returns {{ok: boolean, path?: string, bytes?: number, reason?: string}}
 */
export function captureRelayContainerLogs({
  containerId,
  execFn = (cmd) => execSync(cmd, { encoding: 'utf8', timeout: 15000, maxBuffer: 32 * 1024 * 1024 }),
  dir = relayForensicDir(),
  tailLines = 5000,
} = {}) {
  if (!isSafeContainerName(containerId)) {
    return { ok: false, reason: 'unsafe_container_name' };
  }

  let logs;
  try {
    // 2>&1 合并 stderr:早退/崩溃的真话常常只写在 stderr
    logs = execFn(`docker logs --tail ${Number(tailLines)} ${containerId} 2>&1`) || '';
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  if (!logs.trim()) return { ok: false, reason: 'empty_logs' };

  const target = path.join(dir, `${containerId}.log`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(target, logs, 'utf8');
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  console.log(`[relay-forensics] ${containerId} 日志已保全 → ${target} (${logs.length} bytes)`);
  return { ok: true, path: target, bytes: logs.length };
}

/**
 * 按 task 短 id 保全该 initiative 名下所有容器(含已退出的)的日志。
 *
 * 收割路径用:容器死得连回调都没发出来时(如直接吃 SIGKILL),
 * 这是 janitor prune 之前最后一次拿到 docker logs 的机会。
 * 必须用 `docker ps -a` 按前缀反查真实容器名 —— 容器名是
 * cecelia-relay-<short8>-<随机后缀>,后缀在收割侧无从得知,
 * 拿 `cecelia-relay-<short8>` 直接去 docker logs 只会 no such container(等于没做)。
 *
 * @returns {{captured: string[], reason?: string}}
 */
export function captureRelayForensicsByShortId({ shortId, execFn, dir } = {}) {
  if (!isSafeContainerName(shortId)) return { captured: [], reason: 'unsafe_short_id' };

  const exec = execFn
    || ((cmd) => execSync(cmd, { encoding: 'utf8', timeout: 15000, maxBuffer: 32 * 1024 * 1024 }));

  let names;
  try {
    names = (exec(`docker ps -a --format '{{.Names}}' --filter name=cecelia-relay-${shortId}`) || '')
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    return { captured: [], reason: err.message };
  }

  const captured = [];
  for (const name of names) {
    const r = captureRelayContainerLogs({ containerId: name, execFn: exec, dir });
    if (r.ok) captured.push(name);
  }
  return { captured };
}
