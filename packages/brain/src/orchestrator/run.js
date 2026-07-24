/**
 * run.js —— orchestrator CLI 入口（独立于 Brain 容器生命周期的主机进程，D6）。
 *
 * 主机进程用法：
 *   node packages/brain/src/orchestrator/run.js --task-id <uuid> [--run-id <uuid>] [--dry-run]
 *
 * --dry-run：只观测+推导+打印（F5 前台雏形），零写入零派发。
 * 非 dry-run 组装 provider-neutral dispatcher；Brain tick 拉起/watchdog 重拉另行接线。
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { runLoop } from './loop.js';
import { createAttemptStore } from './attempt-store.js';
import { createDispatcher, createDetachedLauncher } from './dispatcher.js';
import { createProviderRegistry } from './provider-registry.js';
import { claudeAdapter } from './providers/claude.js';
import { codexAdapter } from './providers/codex.js';
import { grokAdapter } from './providers/grok.js';
import { loadSkillBundle } from './skill-bundle.js';
import { createKernelHandlers } from './kernel-handlers.js';
import { readGitArtifact } from './git-artifact-reader.js';

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

export async function buildDefaultHandlers({ pool, execCmd, attemptStore, judgeGate }) {
  const [
    judge,
    previewManager,
    staging,
    notifier,
    regression,
    handoff,
    okr,
    cleanup,
    dockerExecutor,
  ] = await Promise.all([
    import('../harness-judge.js'),
    import('../preview-manager.js'),
    import('../staging-e2e-runner.js'),
    import('../notifier.js'),
    import('../lib/callback-postprocess.js'),
    import('../handoff.js'),
    import('../okr-initiative-sync.js'),
    import('../harness-container-cleanup.js'),
    import('../docker-executor.js'),
  ]);

  const spawnStaging = async (payload) => {
    if (!payload.pr_url) return { created: false, reason: 'missing_pr_url' };
    const result = await pool.query(
      `INSERT INTO tasks (title, description, task_type, status, priority, payload)
       SELECT $1, $2, 'staging_e2e', 'queued', 'P2', $3::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM tasks WHERE task_type='staging_e2e' AND payload->>'pr_url'=$4
       )`,
      [
        `[Staging E2E] ${payload.pr_branch || payload.pr_url}`,
        `Kernel post-merge staging verification for ${payload.pr_url}`,
        JSON.stringify(payload),
        payload.pr_url,
      ],
    );
    return { created: result.rowCount > 0 };
  };

  return createKernelHandlers({
    pool,
    execCmd,
    attemptStore,
    promptDir: dockerExecutor.getHostPromptDir(),
    judgeGate: judgeGate ?? judge.runJudgeGate,
    allocatePort: previewManager.allocatePort,
    spawnReviewPreview: staging.spawnReviewPreview,
    notifyReview: notifier.notifyHarnessReviewPending,
    promote: regression.promoteRegressionOnHarnessMerged,
    buildHandoff: handoff.buildHandoff,
    saveHandoff: handoff.saveHandoff,
    syncOkr: okr.syncOkrInitiativeStatus,
    spawnStaging,
    cleanup: cleanup.killInitiativeContainers,
  });
}

/** 真实 deps 组装（ground-truth 的 execCmd 契约：返回 stdout；非零退出 throw 且 err.stdout 带输出） */
export async function buildRealDeps(overrides = {}) {
  const pool = overrides.pool
    ?? (await import('../db.js')).default; // 延迟 import：--help/参数错误时不连库
  const execCmd = overrides.execCmd
    ?? ((cmd) => execSync(cmd, { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000 }));
  const attemptStore = overrides.attemptStore ?? createAttemptStore(pool);
  let dispatch = overrides.dispatch;
  if (!dispatch) {
    const registry = overrides.registry ?? createProviderRegistry([claudeAdapter, codexAdapter, grokAdapter]);
    const detached = await import('../spawn/detached.js');
    const spawnDetached = overrides.spawnDetached ?? detached.spawnDockerDetached;
    const removeContainer = overrides.removeContainer ?? detached.removeDockerContainer;
    const launcher = overrides.launcher ?? createDetachedLauncher({
      spawnDetached,
      removeContainer,
      attemptStore,
    });
    const handlers = overrides.handlers
      ?? await buildDefaultHandlers({ pool, execCmd, attemptStore });
    dispatch = createDispatcher({
      attemptStore,
      registry,
      launcher,
      loadSkill: overrides.loadSkill ?? loadSkillBundle,
      handlers,
    });
  }
  return {
    pool,
    execCmd,
    fileExists: overrides.fileExists ?? ((p) => existsSync(p)),
    readFile: overrides.readFile ?? ((p) => readFileSync(p, 'utf-8')),
    readGitFile: overrides.readGitFile ?? ((sha, p) => readGitArtifact(sha, p)),
    dispatch,
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
