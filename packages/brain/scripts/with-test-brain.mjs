#!/usr/bin/env node
// 用法：node packages/brain/scripts/with-test-brain.mjs -- <测试命令> [参数...]
// 禁用真实自动化/模型/迁移；通过专属 IPC 确认就绪，finally 按实际进程组清理。
import { fork, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function signalGroup(child, signal) {
  if (!child?.pid) return;
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function alive(child) {
  if (!child?.pid) return false;
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true; // 不能证明组已消失，继续等待并保留清理责任。
    throw error;
  }
}
async function stop(child, graceMs) {
  if (!alive(child)) return;
  signalGroup(child, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  while (alive(child) && Date.now() < deadline) await sleep(10);
  if (alive(child)) signalGroup(child, 'SIGKILL');
  const killDeadline = Date.now() + 2000;
  while (alive(child) && Date.now() < killDeadline) await sleep(10);
  if (alive(child)) throw new Error(`测试进程组 ${child.pid} 未能回收`);
}

export async function runWithTestBrain(command, {
  serverScript = fileURLToPath(new URL('../server.js', import.meta.url)),
  env = process.env, startupTimeoutMs = 30000, timeoutMs = 300000, graceMs = 1000,
} = {}) {
  if (!Array.isArray(command) || !command[0]) throw new Error('必须指定测试命令');
  for (const value of [startupTimeoutMs, timeoutMs, graceMs]) {
    if (!Number.isFinite(value) || value <= 0 || value > 1800000) throw new Error('测试期限必须为 1–1800000ms');
  }
  const childEnv = { ...env, NODE_ENV: 'test', DB_NAME: 'cecelia_scratch',
    BRAIN_EVALUATOR_MODE: 'true', CECELIA_LLM_DISABLED: 'true',
    CECELIA_TICK_ENABLED: 'false', SKIP_MIGRATIONS: 'true',
    PORT: env.BRAIN_TEST_PORT || '5299' };
  delete childEnv.DATABASE_URL;
  delete childEnv.VITEST;
  childEnv.BRAIN_URL = `http://127.0.0.1:${childEnv.PORT}`;
  let brain, test, startupTimer, deadlineTimer, rejectInterrupt;
  const interrupted = new Promise((_, reject) => { rejectInterrupt = reject; });
  const onSignal = () => rejectInterrupt(new Error('测试被中断'));
  process.on('SIGTERM', onSignal); process.on('SIGINT', onSignal);
  try {
    brain = fork(serverScript, [], { env: childEnv, detached: process.platform !== 'win32',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: [] });
    const ready = new Promise((resolve, reject) => {
      brain.once('error', reject);
      brain.once('exit', code => reject(new Error(`测试 Brain 就绪前退出: ${code}`)));
      brain.on('message', msg => { if (msg?.type === 'brain-test-ready') resolve(); });
      startupTimer = setTimeout(() => reject(new Error('测试 Brain 就绪超时')), startupTimeoutMs);
    });
    await Promise.race([ready, interrupted]);
    clearTimeout(startupTimer);
    test = spawn(command[0], command.slice(1), { env: childEnv, detached: process.platform !== 'win32', stdio: 'inherit' });
    const finished = new Promise((resolve, reject) => {
      test.once('error', reject);
      test.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
      brain.once('exit', () => reject(new Error('测试期间 Brain 意外退出')));
      deadlineTimer = setTimeout(() => reject(new Error('测试执行超时')), timeoutMs);
    });
    return await Promise.race([finished, interrupted]);
  } finally {
    clearTimeout(startupTimer); clearTimeout(deadlineTimer);
    // 两组都尝试清理，一组异常不得跳过另一组。
    const results = await Promise.allSettled([stop(test, graceMs), stop(brain, graceMs)]);
    process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  runWithTestBrain(args).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message); process.exitCode = 1;
  });
}
