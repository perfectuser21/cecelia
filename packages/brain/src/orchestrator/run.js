/**
 * run.js —— orchestrator CLI 入口（独立于 Brain 容器生命周期的主机进程，D6）。
 *
 * 主机进程用法：
 *   node packages/brain/src/orchestrator/run.js --task-id <uuid> [--run-id <uuid>] [--dry-run]
 *
 * --dry-run：只观测+推导+打印（F5 前台雏形），零写入零派发。
 * 真实 dispatcher 归 T3：本入口的 dispatch 是占位 throw（--dry-run 下用不到）；
 * Brain tick 拉起/watchdog 重拉归 T4。
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { runLoop } from './loop.js';

/** 解析 --task-id / --run-id / --dry-run */
export function parseArgs(argv) {
  const args = { taskId: null, runId: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--task-id') args.taskId = argv[++i];
    else if (a === '--run-id') args.runId = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
  }
  if (!args.taskId) {
    throw new Error('用法: node packages/brain/src/orchestrator/run.js --task-id <uuid> [--run-id <uuid>] [--dry-run]');
  }
  return args;
}

/** 真实 deps 组装（ground-truth 的 execCmd 契约：返回 stdout；非零退出 throw 且 err.stdout 带输出） */
export async function buildRealDeps() {
  const { default: pool } = await import('../db.js'); // 延迟 import：--help/参数错误时不连库
  return {
    pool,
    execCmd: (cmd) => execSync(cmd, { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000 }),
    fileExists: (p) => existsSync(p),
    readFile: (p) => readFileSync(p, 'utf-8'),
    dispatch: async (action) => {
      // T3 认领：docker/codex/主机执行、换号、ARTIFACT 门、review 预览+Bark、merge 执行、report 六步链
      throw new Error(`NotImplemented: dispatcher(${action}) 归 T3，本骨架只支持 --dry-run`);
    },
    host: os.hostname(),
    pid: process.pid,
  };
}

async function main() {
  const { taskId, runId, dryRun } = parseArgs(process.argv.slice(2));
  const deps = await buildRealDeps();
  try {
    const result = await runLoop(deps, { taskId, runId, dryRun });
    console.log(`[orchestrator] exit: ${result.exitReason} (hops=${result.hops})`);
    process.exitCode = result.exitReason === 'singleton_conflict' ? 2 : 0;
  } finally {
    await deps.pool.end?.();
  }
}

// 仅直接执行时跑 main（被测试 import 时不执行）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[orchestrator] fatal: ${err.message}`);
    process.exit(1);
  });
}
