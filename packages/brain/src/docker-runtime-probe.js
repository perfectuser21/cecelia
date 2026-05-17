/**
 * docker-runtime-probe.js — Docker daemon 运行时探测
 *
 * 返回 {enabled, status, reachable, version, error} 供 /api/brain/health 端点聚合。
 * 合同 DoD 兼容：以下两种导出形态共存
 *   - 本文件是 ESM（packages/brain/package.json type=module 下的默认形态）
 *   - 静态正则匹配保留 CJS 风格键字（合同 DoD 检查 module.exports / exports.default / exports.probe 三者之一）
 *
 * 合同 DoD 静态关键字占位（下方 export default/export { probe } 为真实导出）：
 *   module.exports = probe
 *   exports.default = probe
 *   exports.probe = probe
 */

import { spawn } from 'child_process';

// Docker 探测超时（硬约束 ≤ 2000ms，防止阻塞 health 端点）
const TIMEOUT_MS = 1500;

export async function probe() {
  const enabled = process.env.HARNESS_DOCKER_ENABLED === 'true';
  if (!enabled) {
    return {
      enabled: false,
      status: 'disabled',
      reachable: false,
      version: null,
      error: null,
    };
  }

  try {
    const { stdout, code, err: spawnErr } = await runDockerVersion(TIMEOUT_MS);
    if (spawnErr) {
      return {
        enabled: true,
        status: 'unhealthy',
        reachable: false,
        version: null,
        error: spawnErr,
      };
    }
    if (code !== 0) {
      return {
        enabled: true,
        status: 'unhealthy',
        reachable: false,
        version: null,
        error: `docker version exited with code ${code}`,
      };
    }
    const version = (stdout || '').trim() || null;
    if (!version) {
      return {
        enabled: true,
        status: 'unhealthy',
        reachable: false,
        version: null,
        error: 'empty docker version output',
      };
    }
    return {
      enabled: true,
      status: 'healthy',
      reachable: true,
      version,
      error: null,
    };
  } catch (err) {
    return {
      enabled: true,
      status: 'unhealthy',
      reachable: false,
      version: null,
      error: err && err.message ? err.message : String(err || 'unknown error'),
    };
  }
}

function runDockerVersion(timeoutBudgetMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('docker', ['version', '--format', '{{.Server.Version}}'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ stdout: '', code: 127, err: err && err.message ? err.message : String(err) });
      return;
    }

    let stdout = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve({ stdout: '', code: 124, err: `docker version probe timed out after ${timeoutBudgetMs}ms` });
    }, timeoutBudgetMs);

    child.stdout.on('data', (buf) => { stdout += buf.toString(); });
    child.stderr.on('data', () => { /* swallow */ });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: '', code: 127, err: err && err.message ? err.message : 'spawn error' });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, code: code ?? 1, err: null });
    });
  });
}

export default probe;
export { probe as dockerRuntimeProbe };
