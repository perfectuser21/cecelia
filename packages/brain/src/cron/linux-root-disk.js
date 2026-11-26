import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { raise } from '../alerting.js';
import { isIsolatedRuntime } from '../runtime-safety.js';

export const LINUX_ROOT_DISK_INTERVAL_SEC = 900;
const ALERT_OPTIONS = { debounce: { n: 1, cooldownMs: 60 * 60_000 } };
const execFileAsync = promisify(execFile);
let lastSampleAt = -Infinity;

export async function runLinuxRootDisk({
  env = process.env, now = Date.now(), readFile: read = readFile, execFile: exec = execFileAsync, raise: alert = raise,
} = {}) {
  const device = env.CECELIA_LINUX_ROOT_DEVICE;
  if (!device || env.BRAIN_DEPLOY_CANARY === '1' || isIsolatedRuntime(env)) {
    return { skipped: true, reason: 'disabled' };
  }
  if (now - lastSampleAt < LINUX_ROOT_DISK_INTERVAL_SEC * 1000) return { skipped: true, reason: 'throttled' };
  lastSampleAt = now;

  const path = env.REPO_ROOT;
  let sample;
  try {
    const mountinfo = await read('/proc/self/mountinfo', 'utf8');
    const mounts = mountinfo.split('\n').filter(line => line.split(' ')[4] === path);
    const [mount = ''] = mounts;
    const [fields, filesystem = ''] = mount.split(' - ');
    // 部署目录须是宿主根文件系统上的同路径 bind，缺挂载或迁到独立盘时不能采到容器 overlay。
    if (!path || mounts.length !== 1 || fields.split(' ')[3] !== path || filesystem.split(' ')[1] !== device) {
      throw new Error(`部署目录 ${path} 未绑定到预期根卷 ${device}`);
    }
    const { stdout } = await exec('df', ['-Pk', path], {
      env: { ...process.env, LC_ALL: 'C' }, timeout: 5_000, maxBuffer: 4_096,
    });
    // GNU df 可显示同设备的另一绑定挂载。路径身份以前面核验的 mountinfo 为准。
    const [source, , , freeKiB, capacity] = stdout.trim().split('\n').at(-1).trim().split(/\s+/);
    const availableBytes = Number(freeKiB) * 1024;
    const usedPercent = Number.parseInt(capacity, 10);
    if (source !== device || !/^-?\d+$/.test(freeKiB) ||
        !/^\d+%$/.test(capacity) || !Number.isSafeInteger(availableBytes) || !Number.isSafeInteger(usedPercent)) {
      throw new Error(`根卷 ${device} 的 df 来源或容量输出无效`);
    }
    sample = { device, usedPercent, availableBytes: Math.max(0, availableBytes) };
  } catch (error) {
    await alert('P1', 'disk_linux_root_unavailable', `US Linux 根卷 ${device} 采样失败：${error.message}`, ALERT_OPTIONS);
    throw error;
  }

  const { usedPercent, availableBytes } = sample;
  const message = `US Linux 根卷 /（${device}）已用 ${usedPercent}%，可用 ${availableBytes} 字节`;
  console.log(`[linux_root_disk] device=${device} used=${usedPercent}% available_bytes=${availableBytes}`);
  if (usedPercent >= 90) {
    await alert('P1', 'disk_linux_root_critical', message, ALERT_OPTIONS);
  } else if (usedPercent >= 80) {
    await alert('P2', 'disk_linux_root_warning', message, ALERT_OPTIONS);
  }
  return sample;
}
