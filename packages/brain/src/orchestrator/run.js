import { pathToFileURL } from 'node:url';
import { kernelRuntimeRetiredError } from '../lib/kernel-retirement.js';
import { runLoop } from './loop.js';
import { buildRealDeps } from './kernel-runtime-deps.js';
export { buildRealDeps, buildDefaultHandlers, createKernelAlertEmitter } from './kernel-runtime-deps.js';

/** 解析 --task-id / --run-id / --controller-session-id / --resume-token / --dry-run */
export function parseArgs(argv) {
  const args = {
    taskId: null,
    runId: null,
    controllerSessionId: null,
    controllerGeneration: null,
    resumeToken: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--task-id') args.taskId = argv[++i];
    else if (a === '--run-id') args.runId = argv[++i];
    else if (a === '--controller-session-id') args.controllerSessionId = argv[++i];
    else if (a === '--controller-generation') args.controllerGeneration = Number(argv[++i]);
    else if (a === '--resume-token') args.resumeToken = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
  }
  if (!args.taskId) {
    throw new Error('用法: node packages/brain/src/orchestrator/run.js --task-id <uuid> --dry-run | --run-id <uuid> --controller-session-id <uuid> --controller-generation <n>');
  }
  if (!args.dryRun && (!args.runId || !args.controllerSessionId
      || !Number.isSafeInteger(args.controllerGeneration) || args.controllerGeneration < 1)) {
    throw new Error('controller_lease_identity_missing');
  }
  return args;
}

export async function runKernelMain(params, {
  buildDeps = buildRealDeps,
  runLoopFn = runLoop,
} = {}) {
  if (!params.dryRun) throw kernelRuntimeRetiredError();
  let pool;
  try {
    const deps = await buildDeps({
      readOnly: true,
      onPool: candidate => { pool = candidate; },
    });
    pool ??= deps?.pool;
    return await runLoopFn(deps, params);
  } finally {
    await pool?.end?.();
  }
}

export function exitCodeForExitReason(exitReason) {
  return ['singleton_conflict', 'controller_lease_lost'].includes(exitReason)
    ? 2
    : 0;
}

export async function main(
  argv = process.argv.slice(2),
  {
    runKernelMainFn = runKernelMain,
    log = console.log,
    setExitCode = (code) => { process.exitCode = code; },
  } = {},
) {
  const args = parseArgs(argv);
  const {
    taskId,
    runId,
    controllerSessionId,
    controllerGeneration,
    resumeToken,
    dryRun,
  } = args;
  const result = await runKernelMainFn({
    taskId,
    runId,
    controllerSessionId,
    controllerGeneration,
    resumeToken,
    dryRun,
  });
  log(`[orchestrator] exit: ${result.exitReason} (hops=${result.hops})`);
  setExitCode(exitCodeForExitReason(result.exitReason));
  return result;
}

// 仅直接执行时跑 main（被测试 import 时不执行）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[orchestrator] fatal: ${err.message}`);
    process.exit(1);
  });
}
