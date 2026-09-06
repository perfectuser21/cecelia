/**
 * host-exec.js — 容器内 ssh 逃逸宿主执行的共享三件套
 * 提取自 launchd-patrol.js（ops-collector 复用，重复第2处即提取）。行为不变。
 */
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';

export const EXEC_TIMEOUT_MS = 20_000;
// execSync 默认 maxBuffer 仅 1MB，采集类命令早已超出（n8n 画布导出 2.1MB、
// 执行历史 JSON 数 MB），超限抛 ENOBUFS 且**报错不含真实原因**——2026-09-06 实证
// 第4腿（n8n workflow）因此静默转 parse_error。给足余量，宁可占内存不可丢数据。
export const EXEC_MAX_BUFFER = 128 * 1024 * 1024;

export function defaultExec(cmd) {
  return execSync(cmd, {
    encoding: 'utf8',
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: EXEC_MAX_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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
