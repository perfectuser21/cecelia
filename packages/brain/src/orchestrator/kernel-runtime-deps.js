import { startExecutionDirectory } from '../execution-directory/store.js';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { createAttemptStore } from './attempt-store.js';
import { createActorInbox } from './actor-inbox.js';
import { createCommanderCoordinator } from './commander-coordinator.js';
import { createCommanderDirectiveExecutor } from './commander-directive-executor.js';
import { createCommanderStore } from './commander-store.js';
import { appendHop, nextHop } from './decision-log.js';
import { createDispatcher } from './dispatcher.js';
import {
  parseTrustedUids,
  resolveCredentialAccountHome,
} from './provider-account-home.js';
import {
  createCredentialBroker,
  createFileCredentialLoader,
} from './credential-broker.js';
import { createGitHubCredentialBroker } from './github-credential-broker.js';
import { resolveGitHubToken } from '../harness-credentials.js';
import { createTask } from '../actions.js';
import { createProviderRegistry } from './provider-registry.js';
import { claudeAdapter } from './providers/claude.js';
import { codexAdapter } from './providers/codex.js';
import { grokAdapter } from './providers/grok.js';
import { loadSkillBundle } from './skill-bundle.js';
import { createKernelHandlers } from './kernel-handlers.js';
import {
  ensureGitCommit,
  listGitArtifacts,
  readGitArtifact,
} from './git-artifact-reader.js';
import { createFrozenContractArtifactResolver } from './frozen-contract-artifacts.js';
import { createCapabilityGate } from './preflight/capability-gate.js';
import { createQuotaLedgerLoader } from './preflight/account-quota-ledger.js';
import { createProductionCapabilityProbes } from './preflight/production-probes.js';
import {
  createProductionExecutionTransport,
  DEFAULT_LOCAL_MACHINE_ID,
  DEFAULT_WORKER_BRAIN_URL,
} from './production-transport.js';
import { createWorkspaceSpecResolver } from './workspace-spec.js';
import { createRunEventStore } from './run-event-store.js';
import { parseBaseRepo } from './github-pr-discovery.js';
import {
  createHarnessImpactGates,
  verifyImpactMergeFence,
} from '../impact-contract/harness-gates.js';
import { resolveCompletedRepairGaps } from '../impact-contract/gap-resolution.js';
import {
  createExpiredAttemptAuthority,
  reconcileExpiredAttempt,
} from './expired-attempt-reconciler.js';
import { listCanonicalMachineIds } from './preflight/canonical-machine-id.js';



import { buildObservationDeps } from './kernel-observation-deps.js';

const KERNEL_ALERT_ROUTES = Object.freeze({
  kernel_account_quota_all_exhausted: {
    level: 'P0',
    debounce: { n: 1, cooldownMs: 30 * 60 * 1000 },
  },
  kernel_account_quota_gate_degraded: {
    level: 'P1',
    debounce: { n: 3, cooldownMs: 15 * 60 * 1000 },
  },
  // 已由 onPreflightBlocked 覆盖，此处显式不重复告警（值为 null 表示「登记过、有意不发」）
  kernel_capability_preflight_blocked: null,
});

export function createKernelAlertEmitter({ raise } = {}) {
  return async function emitKernelAlert(event = {}) {
    const kind = String(event.kind ?? 'kernel_unknown_alert');
    if (Object.prototype.hasOwnProperty.call(KERNEL_ALERT_ROUTES, kind)
        && KERNEL_ALERT_ROUTES[kind] === null) {
      return; // 有意不重复
    }
    const route = KERNEL_ALERT_ROUTES[kind] ?? { level: 'P2' };
    try {
      const doRaise = raise ?? (await import('../alerting.js')).raise;
      await doRaise(
        route.level,
        kind,
        JSON.stringify(event).slice(0, 2_000),
        route.debounce ? { debounce: route.debounce } : {},
      );
    } catch (error) {
      // 告警链路故障绝不能反过来打断派发
      console.warn(`[kernel-alert] ${kind} 发送失败:`, error?.message);
    }
  };
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
    const created = await createTask({
      db: pool,
      source: 'child',
      source_id: `staging-e2e:${payload.pr_url}`,
      title: `[Staging E2E] ${payload.pr_branch || payload.pr_url}`,
      description: `Kernel post-merge staging verification for ${payload.pr_url}`,
      task_type: 'staging_e2e',
      priority: 'P2',
      trigger_source: 'kernel_post_merge',
      allow_unscoped: true,
      payload,
    });
    return { created: !created.deduplicated };
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
    verifyImpactMerge: (input) => verifyImpactMergeFence(pool, input),
    resolveCompletedRepairGaps,
  });
}

/** 真实 deps 组装（ground-truth 的 execCmd 契约：返回 stdout；非零退出 throw 且 err.stdout 带输出） */
export async function buildRealDeps(overrides = {}) {
  if (overrides.readOnly === true) return buildObservationDeps(overrides);
  const pool = overrides.pool
    ?? (await import('../db.js')).default; // 延迟 import：--help/参数错误时不连库
  overrides.onPool?.(pool);
  await (overrides.startExecutionDirectory ?? startExecutionDirectory)({pool,env:overrides.env??process.env});
  const execCmd = overrides.execCmd
    ?? ((cmd) => execSync(cmd, { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024, timeout: 60_000 }));
  const attemptStore = overrides.attemptStore ?? createAttemptStore(pool,{executionDirectory:true});
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
  // 生产 Brain 镜像的 cwd 是扁平 `/app`，并不是 Git worktree；部署仓通过
  // REPO_ROOT bind mount 暴露。冻结合同必须从这个权威 Git 根读取，否则批准
  // SHA 会被错误地判成缺少产物，Kernel 在 Generator 前 fail closed。
  const repoRoot = env.REPO_ROOT || process.cwd();
  const leaseOwner = overrides.leaseOwner ?? `${os.hostname()}:${process.pid}`;
  const brainUrl = overrides.brainUrl ?? env.BRAIN_URL ?? DEFAULT_WORKER_BRAIN_URL;
  const machineId = overrides.machineId ?? env.CECELIA_MACHINE_ID ?? DEFAULT_LOCAL_MACHINE_ID;
  if (!listCanonicalMachineIds().includes(machineId)) {
    throw new Error(`invalid_kernel_machine_id:${String(machineId)}`);
  }
  let dispatch = overrides.dispatch;
  let launcher = overrides.launcher;
  const resolveRepoHead = overrides.resolveRepoHead
    ?? (async (repo) => {
      const remote = execFileSync(
        'git',
        ['remote', 'get-url', 'origin'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          timeout: 10_000,
        },
      ).trim();
      if (parseBaseRepo(remote) !== repo) {
        throw new Error(`workspace_repo_not_supported:${String(repo)}`);
      }
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
  if (!dispatch) {
    const registry = overrides.registry ?? createProviderRegistry([claudeAdapter, codexAdapter, grokAdapter]);
    const createProductionCapabilityProbesFn = overrides.createProductionCapabilityProbesFn
      ?? createProductionCapabilityProbes;
    const productionProbes = overrides.productionProbes
      ?? createProductionCapabilityProbesFn({
        pool,
        registry,
        fetchFn: overrides.fetchFn,
        resolveGitHubTokenFn: overrides.resolveGitHubToken,
        brainUrl: overrides.brainUrl,
        env,
        requestTimeoutMs: overrides.preflightRequestTimeoutMs,
        nodeAdmissionRequestTimeoutMs: overrides.preflightNodeAdmissionTimeoutMs ?? 20_000,
      });
    const createCapabilityGateFn = overrides.createCapabilityGateFn ?? createCapabilityGate;
    const preflightGate = overrides.preflightGate
      ?? createCapabilityGateFn({
        ...productionProbes,
        probeTimeoutMs: overrides.preflightProbeTimeoutMs ?? 25_000,
        snapshotTtlMs: overrides.preflightSnapshotTtlMs ?? 1_000,
        // 配额账本接线：ops_model_accounts 是生产唯一真配额来源（us-vps 不挂账号凭据，
        // llm-capacity 的本机凭据探测在生产恒 ENOENT）。gate 侧只认 deps.loadAccountQuota，
        // 不自己 import pool —— 保持单测无 PG 可跑。
        loadAccountQuota: overrides.loadAccountQuota ?? createQuotaLedgerLoader({ pool }),
        emitAlert: overrides.emitAlert ?? createKernelAlertEmitter({}),
        // 额度闸接线：认证探针只回答"能不能登录"，回答不了"还有没有额度"。
        // 不接这一根线的话额度闸就是死代码（2026-08-19 连修两处都因为改在不参与
        // kernel 派发的路径上而毫无效果，教训见 capability-gate.js 内注释）。
        isAccountUsable: overrides.isAccountUsable
          ?? (async (accountId) => {
            try {
              const { isAccountUsable } = await import('../account-usage.js');
              return await isAccountUsable(accountId);
            } catch (error) {
              // 不再静默 fail-open：留痕后再放行，选号闸不承担准入 fail-closed 职责
              console.warn('[capability-gate] isAccountUsable 判据不可用，本次放行:', error?.message);
              return true;
            }
          }),
      });
    const detached = await import('../spawn/detached.js');
    const spawnDetached = overrides.spawnDetached ?? detached.spawnDockerDetached;
    const removeContainer = overrides.removeContainer ?? detached.removeDockerContainer;
    if (!launcher) {
      const credentialBroker = overrides.credentialBroker
        ?? createCredentialBroker({
          controllerMachineId: machineId,
          loadCredential: overrides.loadCredential
            // 凭据目录只经 overrides.env / overrides.loadCredential 注入；
            // overrides.resolveAccountHome 只影响执行目录（传给 createDispatcher）。
            ?? createFileCredentialLoader({
              accountHomeResolver: (accountId) => (
                resolveCredentialAccountHome('codex', accountId, { env })
              ),
              trustedUids: parseTrustedUids(env),
            }),
        });
      const githubCredentialBroker = overrides.githubCredentialBroker
        ?? createGitHubCredentialBroker({
          controllerMachineId: machineId,
          loadToken: overrides.resolveGitHubToken ?? resolveGitHubToken,
        });
      launcher = createProductionExecutionTransport({
        executionAuthority:overrides.executionAuthority,
        pool,
        env,
        spawnDetached,
        removeContainer,
        attemptStore,
        brainUrl,
        leaseOwner,
        fetchFn: overrides.fetchFn,
        credentialBroker,
        githubCredentialBroker,
        remoteBridgeTimeoutMs: overrides.remoteBridgeTimeoutMs,
        remoteBridgePrepareTimeoutMs: overrides.remoteBridgePrepareTimeoutMs,
      });
    }
    const handlers = overrides.handlers
      ?? await buildDefaultHandlers({ pool, execCmd, attemptStore });
    const shouldResolveWorkspace = overrides.resolveWorkspaceSpec !== undefined
      || typeof overrides.resolveRepoHead === 'function'
      || !overrides.launcher;
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
      db: pool,
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
      resolveFrozenContractArtifacts: overrides.resolveFrozenContractArtifacts
        ?? createFrozenContractArtifactResolver({
          db: pool,
          readGitFile: (sha, filePath, opts = {}) => readGitArtifact(sha, filePath, {
            cwd: repoRoot,
            repo: opts.repo ?? null,
          }),
          listGitFiles: (sha, prefix, opts = {}) => listGitArtifacts(sha, prefix, {
            cwd: repoRoot,
            repo: opts.repo ?? null,
          }),
        }),
      ...(resolveWorkspaceSpec ? { resolveWorkspaceSpec } : {}),
    });
  }
  const readImpactChangedFiles = overrides.readImpactChangedFiles
    ?? (async (baseRevision, headRevision, repo) => {
      ensureGitCommit(baseRevision, { cwd: repoRoot, repo });
      ensureGitCommit(headRevision, { cwd: repoRoot, repo });
      return execFileSync(
        'git',
        ['diff', '--name-only', `${baseRevision}...${headRevision}`],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
          timeout: 60_000,
        },
      ).split('\n').map((line) => line.trim()).filter(Boolean);
    });
  const impactGate = overrides.impactGate ?? createHarnessImpactGates({
    db: pool,
    readChangedFiles: readImpactChangedFiles,
  });
  let reconcileExpired = overrides.reconcileExpiredAttempt;
  if (!reconcileExpired && launcher) {
    let expiredAttemptAuthority = overrides.expiredAttemptAuthority ?? null;
    const terminalizeExpiredAttempt = async (input) => {
      expiredAttemptAuthority ??= createExpiredAttemptAuthority(pool);
      return expiredAttemptAuthority.terminalize(input);
    };
    reconcileExpired = ({ attempt }) => reconcileExpiredAttempt({
      attempt,
      launcher,
      attemptStore,
      terminalize: terminalizeExpiredAttempt,
      now: overrides.now ?? (() => new Date()),
      leaseSeconds: overrides.leaseSeconds ?? 300,
    });
  }
  return {
    pool,
    execCmd,
    fileExists: overrides.fileExists ?? ((p) => existsSync(p)),
    readFile: overrides.readFile ?? ((p) => readFileSync(p, 'utf-8')),
    readGitFile: overrides.readGitFile
      ?? ((sha, p, opts = {}) => readGitArtifact(sha, p, {
        cwd: repoRoot,
        repo: opts.repo ?? null,
      })),
    listGitFiles: overrides.listGitFiles
      ?? ((sha, prefix, opts = {}) => listGitArtifacts(sha, prefix, {
        cwd: repoRoot,
        repo: opts.repo ?? null,
      })),
    impactGate,
    dispatch,
    commanderCoordinator,
    commanderDirectiveExecutor,
    ...(reconcileExpired ? { reconcileExpiredAttempt: reconcileExpired } : {}),
    // 第 46 批：loop 静默等待停摆时发 run.wait_stalled 事件唤醒 Commander。
    runEventStore: eventStore,
    host: os.hostname(),
    pid: process.pid,
  };
}
