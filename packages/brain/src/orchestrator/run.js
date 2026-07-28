/**
 * run.js —— orchestrator CLI 入口（独立于 Brain 容器生命周期的主机进程，D6）。
 *
 * 主机进程用法：
 *   node packages/brain/src/orchestrator/run.js --task-id <uuid> [--run-id <uuid>] [--dry-run]
 *
 * --dry-run：只观测+推导+打印（F5 前台雏形），零写入零派发。
 * 非 dry-run 组装 provider-neutral dispatcher；Brain tick 拉起/watchdog 重拉另行接线。
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { runLoop } from './loop.js';
import { createAttemptStore } from './attempt-store.js';
import { createActorInbox } from './actor-inbox.js';
import { createCommanderCoordinator } from './commander-coordinator.js';
import { createCommanderDirectiveExecutor } from './commander-directive-executor.js';
import { createCommanderStore } from './commander-store.js';
import { appendHop, nextHop } from './decision-log.js';
import {
  createDispatcher,
  resolveProviderAccountHome,
} from './dispatcher.js';
import {
  createCredentialBroker,
  createFileCredentialLoader,
} from './credential-broker.js';
import { createProviderRegistry } from './provider-registry.js';
import { claudeAdapter } from './providers/claude.js';
import { codexAdapter } from './providers/codex.js';
import { grokAdapter } from './providers/grok.js';
import { loadSkillBundle } from './skill-bundle.js';
import { createKernelHandlers } from './kernel-handlers.js';
import { createGitHubMergeAdapter } from './github-merge-adapter.js';
import { createMergeEffectExecutor } from './merge-effect-executor.js';
import { createPostgresMergeEffectStore } from './merge-effect-store.js';
import { readGitArtifact } from './git-artifact-reader.js';
import { createCapabilityGate } from './preflight/capability-gate.js';
import { createProductionCapabilityProbes } from './preflight/production-probes.js';
import {
  createProductionExecutionTransport,
  DEFAULT_LOCAL_MACHINE_ID,
  DEFAULT_WORKER_BRAIN_URL,
} from './production-transport.js';
import { createWorkspaceSpecResolver } from './workspace-spec.js';
import { createRunEventStore } from './run-event-store.js';

const CANONICAL_MACHINE_IDS = new Set([
  'us-mac-m4',
  'xian-mac-m4',
  'xian-mac-m1',
]);

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

export async function buildDefaultHandlers({
  pool,
  attemptStore,
  judgeGate,
  mergeEffect,
  githubExecFile,
}) {
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

  let resolvedMergeEffect = mergeEffect;
  if (!resolvedMergeEffect) {
    const execFile = githubExecFile
      ?? ((file, args) => execFileSync(file, args, {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: 60_000,
      }));
    const adapter = createGitHubMergeAdapter({ execFile });
    resolvedMergeEffect = createMergeEffectExecutor({
      store: createPostgresMergeEffectStore(pool),
      observePullRequest: adapter.observePullRequest,
      mergePullRequest: adapter.mergePullRequest,
    });
  }

  return createKernelHandlers({
    pool,
    attemptStore,
    mergeEffect: resolvedMergeEffect,
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
  const commanderStore = overrides.commanderStore ?? createCommanderStore(pool);
  const eventStore = overrides.eventStore ?? createRunEventStore(pool);
  const commanderAttemptStore = {
    getLatestCommanderAttempt: (...args) => {
      if (typeof attemptStore.getLatestCommanderAttempt !== 'function') {
        throw new Error('attemptStore.getLatestCommanderAttempt unavailable');
      }
      return attemptStore.getLatestCommanderAttempt(...args);
    },
    listCommanderFailoverLineage: (...args) => {
      if (typeof attemptStore.listCommanderFailoverLineage !== 'function') {
        throw new Error('attemptStore.listCommanderFailoverLineage unavailable');
      }
      return attemptStore.listCommanderFailoverLineage(...args);
    },
    getById: (...args) => {
      if (typeof attemptStore.getById !== 'function') {
        throw new Error('attemptStore.getById unavailable');
      }
      return attemptStore.getById(...args);
    },
  };
  const actorInbox = overrides.actorInbox ?? {
    list: (...args) => createActorInbox(pool).list(...args),
    getCursor: (...args) => createActorInbox(pool).getCursor(...args),
  };
  const commanderCoordinator = overrides.commanderCoordinator
    ?? createCommanderCoordinator({
      commanderStore,
      eventStore,
      actorInbox,
      attemptStore: commanderAttemptStore,
      appendDecision: (input) => appendHop(pool, input),
      nextHop: (runId) => nextHop(pool, runId),
      now: overrides.now ?? (() => new Date()),
    });
  const commanderDirectiveExecutor = overrides.commanderDirectiveExecutor
    ?? createCommanderDirectiveExecutor({
      eventStore,
      attemptStore: commanderAttemptStore,
      commanderStore,
    });
  const env = overrides.env ?? process.env;
  const leaseOwner = overrides.leaseOwner ?? `${os.hostname()}:${process.pid}`;
  const brainUrl = overrides.brainUrl ?? env.BRAIN_URL ?? DEFAULT_WORKER_BRAIN_URL;
  const machineId = overrides.machineId ?? env.CECELIA_MACHINE_ID ?? DEFAULT_LOCAL_MACHINE_ID;
  if (!CANONICAL_MACHINE_IDS.has(machineId)) {
    throw new Error(`invalid_kernel_machine_id:${String(machineId)}`);
  }
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
      const resolveAccountHome = overrides.resolveAccountHome
        ?? resolveProviderAccountHome;
      const credentialBroker = overrides.credentialBroker
        ?? createCredentialBroker({
          controllerMachineId: machineId,
          loadCredential: overrides.loadCredential
            ?? createFileCredentialLoader({
              accountHomeResolver: (accountId) => (
                resolveAccountHome('codex', accountId)
              ),
            }),
        });
      launcher = createProductionExecutionTransport({
        env,
        spawnDetached,
        removeContainer,
        attemptStore,
        brainUrl,
        leaseOwner,
        fetchFn: overrides.fetchFn,
        credentialBroker,
        remoteBridgeTimeoutMs: overrides.remoteBridgeTimeoutMs,
      });
    }
    const handlers = overrides.handlers
      ?? await buildDefaultHandlers({ pool, execCmd, attemptStore });
    const shouldResolveWorkspace = overrides.resolveWorkspaceSpec !== undefined
      || typeof overrides.resolveRepoHead === 'function'
      || !overrides.launcher;
    const resolveRepoHead = overrides.resolveRepoHead
      ?? (async (repo) => {
        if (repo !== 'perfectuser21/cecelia') {
          throw new Error(`workspace_repo_not_supported:${String(repo)}`);
        }
        const repoRoot = env.CECELIA_REPO_ROOT ?? process.cwd();
        return execFileSync(
          'git',
          ['rev-parse', '--verify', 'origin/main^{commit}'],
          {
            cwd: repoRoot,
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
            timeout: 10_000,
          },
        ).trim();
      });
    const resolveWorkspaceSpec = overrides.resolveWorkspaceSpec
      ?? (shouldResolveWorkspace
        ? createWorkspaceSpecResolver({ resolveRepoHead })
        : null);
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
    const onFailurePersistenceFailed = overrides.onFailurePersistenceFailed
      ?? (async ({ attemptId, lifecycleCode, originalError, persistenceError }) => {
        const { raise } = await import('../alerting.js');
        await raise(
          'P1',
          'kernel_failure_persistence_failed',
          [
            `Kernel attempt ${attemptId} could not persist ${lifecycleCode}`,
            `lifecycle=${originalError?.message ?? String(originalError)}`,
            `persistence=${persistenceError?.message ?? String(persistenceError)}`,
          ].join('; '),
        );
      });
    dispatch = createDispatcher({
      attemptStore,
      registry,
      launcher,
      loadSkill: overrides.loadSkill ?? loadSkillBundle,
      handlers,
      preflightGate,
      machineId,
      resolveAccountHome: overrides.resolveAccountHome,
      randomUUID: overrides.randomUUID,
      createCallbackSecret: overrides.createCallbackSecret,
      onPreflightBlocked,
      onFailurePersistenceFailed,
      leaseOwner,
      leaseSeconds: overrides.leaseSeconds,
      ...(resolveWorkspaceSpec ? { resolveWorkspaceSpec } : {}),
    });
  }
  return {
    pool,
    execCmd,
    fileExists: overrides.fileExists ?? ((p) => existsSync(p)),
    readFile: overrides.readFile ?? ((p) => readFileSync(p, 'utf-8')),
    readGitFile: overrides.readGitFile ?? ((sha, p) => readGitArtifact(sha, p)),
    dispatch,
    commanderCoordinator,
    commanderDirectiveExecutor,
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
