/**
 * host-exec.js — 容器内 ssh 逃逸宿主执行的共享三件套
 * 提取自 launchd-patrol.js（ops-collector 复用，重复第2处即提取）。行为不变。
 */
import { existsSync } from 'fs';
import { execSync, exec as execCb } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';

const execAsync = promisify(execCb);

export const EXEC_TIMEOUT_MS = 20_000;
// execSync 默认 maxBuffer 仅 1MB，采集类命令早已超出（n8n 画布导出 2.1MB、
// 执行历史 JSON 数 MB），超限抛 ENOBUFS 且**报错不含真实原因**——2026-09-06 实证
// 第4腿（n8n workflow）因此静默转 parse_error。给足余量，宁可占内存不可丢数据。
export const EXEC_MAX_BUFFER = 128 * 1024 * 1024;

/**
 * @param {string} cmd
 * @param {{timeoutMs?:number}} [opts] 重命令（如拉 24MB 阶段执行数据）可放宽超时——
 *   默认 20s 会 ETIMEDOUT（2026-09-08 实证：阶段归因拉 300×80KB 必超）。超时机制本身保留。
 */
export function defaultExec(cmd, opts = {}) {
  return execSync(cmd, {
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? EXEC_TIMEOUT_MS,
    maxBuffer: EXEC_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * defaultExec 的异步孪生。语义（encoding/timeout/maxBuffer/stdio、抛错对象带
 * status+stderr）与同步版逐条对齐，唯一区别是**不阻塞事件循环**。
 *
 * 为什么必须有它（2026-09-20 实证，任务 424d9dd2）：ops-model-accounts-collector
 * 串行探 8 个账号，单账号超时 30s，最坏 240s。execSync 期间事件循环整段停摆——
 * dispatch tick 不跑、HTTP 不响应、kernel 租约续不上、心跳停。而 scheduler 给
 * job 配的 `timeoutMs` 走的是 Promise.race（scheduler-jobs.js:129-135），
 * **对同步阻塞完全无效**：定时器根本没机会跑。也就是说那道超时闸是纸糊的，
 * 唯一的解法是不要在事件循环里同步阻塞。
 *
 * 新代码一律用本函数；`defaultExec` 保留只为不惊动既有调用方。
 *
 * @param {string} cmd
 * @param {{timeoutMs?:number}} [opts]
 * @returns {Promise<string>} stdout
 */
export async function defaultExecAsync(cmd, opts = {}) {
  const { stdout } = await execAsync(cmd, {
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? EXEC_TIMEOUT_MS,
    maxBuffer: EXEC_MAX_BUFFER,
  });
  return stdout;
}

/** 密钥发现式回退（照 spawn/host-executor.js 先例）：宿主实际只有 id_rsa，硬编码 ed25519 会 Permission denied */
export function discoverSshKey(keyExistsFn = existsSync) {
  const dir = `${homedir()}/.ssh`;
  for (const name of ['id_ed25519', 'id_rsa']) {
    const candidate = `${dir}/${name}`;
    if (keyExistsFn(candidate)) return candidate;
  }
  return `${dir}/id_ed25519`;
}

/** 容器内包 ssh 逃逸宿主，宿主直跑原样返回 */
export function buildHostCmd(cmd, inContainer, keyExistsFn) {
  if (!inContainer) return cmd;
  const target = process.env.CECELIA_HOST_EXEC_SSH || 'administrator@host.docker.internal';
  const key = discoverSshKey(keyExistsFn);
  const quoted = `'${cmd.replace(/'/g, `'\\''`)}'`;
  return `ssh -i ${key} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=10 ${target} ${quoted}`;
}
