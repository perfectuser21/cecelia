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
import { createCapabilityGate } from './preflight/capability-gate.js';
import { createProductionCapabilityProbes } from './preflight/production-probes.js';
import { createExecutionTransportRouter } from './execution-transport.js';
import { createRemoteBridgeTransport } from './remote-bridge-transport.js';

const DEFAULT_WORKER_BRAIN_URL = 'http://host.docker.internal:5221';

function guardRemoteConfiguration(remote, {
  enabled,
  bridgeUrls,
  sharedSecret,
}) {
  const assertAvailable = (input) => {
    const machine = input?.target?.machine;
    const bridgeUrl = bridgeUrls?.[machine];
    if (
      enabled !== true
      || typeof bridgeUrl !== 'string'
      || bridgeUrl.trim().length === 0
      || typeof sharedSecret !== 'string'
      || sharedSecret.length < 32
    ) {
      throw new Error(`execution_transport_unavailable:${String(machine)}`);
    }
  };
  return Object.freeze({
    async launch(input) {
      assertAvailable(input);
      return remote.launch(input);
    },
    async inspect(input) {
      assertAvailable(input);
      return remote.inspect(input);
    },
    async cancel(input) {
      assertAvailable(input);
      return remote.cancel(input);
    },
  });
}

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
  const env = overrides.env ?? process.env;
  const leaseOwner = overrides.leaseOwner ?? `${os.hostname()}:${process.pid}`;
  const brainUrl = overrides.brainUrl ?? env.BRAIN_URL ?? DEFAULT_WORKER_BRAIN_URL;
  let dispatch = overrides.dispatch;
  if (!dispatch) {
    const registry = overrides.registry ?? createProviderRegistry([claudeAdapter, codexAdapter, grokAdapter]);
    const productionProbes = overrides.productionProbes
      ?? createProductionCapabilityProbes({
        pool,
        registry,
        fetchFn: overrides.fetchFn,
        resolveGitHubTokenFn: overrides.resolveGitHubToken,
        brainUrl: overrides.brainUrl,
        env,
        requestTimeoutMs: overrides.preflightRequestTimeoutMs,
      });
    const preflightGate = overrides.preflightGate
      ?? createCapabilityGate({
        ...productionProbes,
        probeTimeoutMs: overrides.preflightProbeTimeoutMs ?? 6_000,
        snapshotTtlMs: overrides.preflightSnapshotTtlMs ?? 1_000,
      });
    const detached = await import('../spawn/detached.js');
    const spawnDetached = overrides.spawnDetached ?? detached.spawnDockerDetached;
    const removeContainer = overrides.removeContainer ?? detached.removeDockerContainer;
    let launcher = overrides.launcher;
    if (!launcher) {
      const localLauncher = createDetachedLauncher({
        spawnDetached,
        removeContainer,
        attemptStore,
        brainUrl,
        leaseOwner,
        machineId: 'us-mac-m4',
      });
      const remoteEnabled = env.KERNEL_FLEET_REMOTE_ENABLED === 'true';
      const bridgeUrls = {
        'xian-mac-m4': env.XIAN_M4_KERNEL_BRIDGE_URL,
        'xian-mac-m1': env.XIAN_M1_KERNEL_BRIDGE_URL,
      };
      const sharedSecret = env.KERNEL_FLEET_BRIDGE_TOKEN;
      const remoteBridge = createRemoteBridgeTransport({
        enabled: remoteEnabled,
        bridgeUrls,
        sharedSecret,
        brainUrl,
        fetchFn: overrides.fetchFn,
        timeoutMs: overrides.remoteBridgeTimeoutMs,
      });
      const remoteLauncher = guardRemoteConfiguration(remoteBridge, {
        enabled: remoteEnabled,
        bridgeUrls,
        sharedSecret,
      });
      launcher = createExecutionTransportRouter({
        local: localLauncher,
        remote: remoteLauncher,
      });
    }
    const handlers = overrides.handlers
      ?? await buildDefaultHandlers({ pool, execCmd, attemptStore });
    const onPreflightBlocked = overrides.onPreflightBlocked
      ?? (async (blocked) => {
        const { raise } = await import('../alerting.js');
        const reason = blocked.fallback_reason ?? 'unknown';
        const evidence = JSON.stringify(blocked.evidence ?? {}).slice(0, 2_000);
        await raise(
          'P1',
          `kernel_capability_preflight_${reason}`,
          `Kernel capability preflight blocked: ${reason} ${evidence}`,
        );
      });
    dispatch = createDispatcher({
      attemptStore,
      registry,
      launcher,
      loadSkill: overrides.loadSkill ?? loadSkillBundle,
      handlers,
      preflightGate,
      machineId: overrides.machineId ?? process.env.CECELIA_MACHINE_ID,
      resolveAccountHome: overrides.resolveAccountHome,
      randomUUID: overrides.randomUUID,
      createCallbackSecret: overrides.createCallbackSecret,
      onPreflightBlocked,
      leaseOwner,
      leaseSeconds: overrides.leaseSeconds,
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
