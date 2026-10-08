// 进程清理断言 helper：读 pid 文件、轮询确认进程已不存在。
import fs from 'node:fs';
import { expect } from 'vitest';

/** 临时改 process.env 跑 fn（子进程按 process.env 继承），结束后恢复。 */
export async function withProcessEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** 轮询等文件出现（最多约 10s），超时失败。 */
export async function waitForFile(file) {
  for (let i = 0; i < 200; i += 1) {
    if (fs.existsSync(file)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect.fail(`等待 ${file} 超时`);
}

/** 读 pid 文件并断言是正整数。 */
export function readPid(file) {
  const pid = Number(fs.readFileSync(file, 'utf8'));
  expect(Number.isInteger(pid) && pid > 0).toBe(true);
  return pid;
}

/**
 * 进程被杀后可能短暂以僵尸状态存在（等 init 回收），轮询到 ESRCH；
 * 到期仍存在则补杀防泄漏并失败。
 */
export async function expectGone(pid, what) {
  for (let i = 0; i < 40; i += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      expect(error.code, what).toBe('ESRCH');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出 */ }
  expect.fail(`${what} (pid ${pid}) 仍然存活`);
}
