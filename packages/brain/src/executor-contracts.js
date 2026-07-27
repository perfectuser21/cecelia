/**
 * executor-contracts.js
 *
 * 执行者活性合同统一模块（T1）
 * 架构文档：docs/architecture/2026-07-10-executor-liveness-contract/architecture.md
 *
 * 六类执行者：brain-local / relay-container / kernel-process / headed-session / bridge / external-worker
 * - probe(task, ctx) → 'alive' | 'dead' | 'unknown'
 * - unknown 一律 fail-open：不杀 + console.warn
 * - assessTaskLiveness 是守护刀的唯一入口（T2 接入，T1 建模块）
 *
 * kernel-process（2026-07-27 补）：Kernel v1 的执行体是 Brain 容器内的裸 Node 进程
 * （harness-skill-relay.js launchKernelProcess），不是 docker 容器。此前这类任务被
 * EXECUTOR_KIND_FOR 硬编码打成 relay-container，探活走 `docker ps --filter
 * name=cecelia-relay-*` 恒返回 dead（事故 51836fb2）。
 */

import { execSync } from 'child_process';
import { assessKernelLiveness } from './lib/kernel-liveness.js';

export const KERNEL_EXECUTOR_KIND = 'kernel-process';

export const VALID_EXECUTOR_KINDS = [
  'brain-local',
  'relay-container',
  KERNEL_EXECUTOR_KIND,
  'headed-session',
  'bridge',
  'external-worker',
];

// ─── 打标映射（各派发点用的快查表）────────────────────────────────────────────
// 特殊 key __bridge_path / __local_spawn 代表路由路径（非 task_type）
export const EXECUTOR_KIND_FOR = {
  // harness_initiative 由 runHarnessInitiativeRouter → spawnSkillRelaySession 跑 relay-container
  harness_initiative: 'relay-container',
  // golden_path_proposal 同走 runHarnessInitiativeRouter → spawnSkillRelaySession（GP2/T2）
  golden_path_proposal: 'relay-container',
  // dev 由 dispatcher 暂标 brain-local（迁离 LangGraph 后，走 triggerCeceliaRun 本地 spawn）
  dev: 'brain-local',
  // content-pipeline 系列由外部 ZJ pipeline-worker 管，不探活
  'content-pipeline': 'external-worker',
  'content-research': 'external-worker',
  'content-copywriting': 'external-worker',
  'content-copy-review': 'external-worker',
  'content-generate': 'external-worker',
  'content-image-review': 'external-worker',
  'content-export': 'external-worker',
  // 路由路径 sentinel（用于测试断言和文档）
  __bridge_path: 'bridge',
  __local_spawn: 'brain-local',
};

// EXECUTOR_KIND_FOR 是纯常量、被 executor.js 与多个测试直接 import，形态不能改。
// 运行时分派（harness_runtime='kernel-v1' → kernel-process）走下面两个解析函数。

/**
 * 打标点用：派发时该写进 tasks.executor_kind 的值。
 * 只把 relay-container 家族按 payload.harness_runtime 升级成 kernel-process，
 * 其余 task_type 一字不动（dev / external-worker / bridge 路径不受影响）。
 * @returns {string|null} 无映射返回 null（保持调用方原有兜底语义）
 */
export function resolveExecutorKind(task) {
  const mapped = Object.prototype.hasOwnProperty.call(EXECUTOR_KIND_FOR, task?.task_type)
    ? EXECUTOR_KIND_FOR[task.task_type]
    : null;
  if (mapped === 'relay-container' && task?.payload?.harness_runtime === 'kernel-v1') {
    return KERNEL_EXECUTOR_KIND;
  }
  return mapped;
}

/**
 * 判活点用：库里存量的 executor_kind 可能是派发时写下的旧值
 * （实测 13 个 harness_runtime='kernel-v1' 的任务全被标成 relay-container），
 * 判活必须以 payload 为准，否则存量任务照样被 docker 探活判死。
 * 只做 relay-container → kernel-process 这一个方向的纠正，其余原样返回。
 */
export function resolveLivenessKind(task) {
  const persisted = task?.executor_kind || null;
  if (task?.payload?.harness_runtime === 'kernel-v1') {
    const mappedIsRelay = EXECUTOR_KIND_FOR[task?.task_type] === 'relay-container';
    if (persisted === 'relay-container' || persisted === KERNEL_EXECUTOR_KIND
        || (!persisted && mappedIsRelay)) {
      return KERNEL_EXECUTOR_KIND;
    }
  }
  return persisted;
}

// kernel-process probe 的默认 pool：懒加载，只在调用方没给 ctx.pool 时才 import，
// 避免单测里意外拉起真 pg Pool。
let _defaultPoolPromise = null;
async function _defaultKernelPool() {
  if (!_defaultPoolPromise) {
    _defaultPoolPromise = import('./db.js').then((m) => m.default).catch(() => null);
  }
  return _defaultPoolPromise;
}

// ─── 五合同 ────────────────────────────────────────────────────────────────────

export const EXECUTOR_CONTRACTS = {
  /**
   * brain-local: Brain 直接 spawn 的本地进程（cecelia-run / codex exec）
   * 活性：activeProcesses pid kill -0
   */
  'brain-local': {
    probe: async (task, ctx) => {
      const info = ctx?.activeProcesses?.get(task.id);
      if (!info) return 'unknown';
      // bridge 路径不走 pid 探活（LangGraph/bridge 自管活性）
      if (info.bridge) return 'unknown';
      // docker-executor 派发的 cecelia-task-* 容器：docker ps 前缀匹配探活
      if (info.docker) {
        const short12 = String(task.id).replace(/-/g, '').slice(0, 12);
        try {
          const out = execSync(
            `docker ps --filter "name=cecelia-task-${short12}" --format "{{.Names}}"`,
            { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
          ).trim();
          return out ? 'alive' : 'dead';
        } catch {
          return 'unknown';
        }
      }
      const pid = info.pid;
      if (!pid || typeof pid !== 'number' || pid <= 0) return 'unknown';
      try {
        process.kill(pid, 0);
        return 'alive';
      } catch {
        return 'dead';
      }
    },
    staleMinutes: 60,
    onStale: 'fail',
  },

  /**
   * relay-container: skill-relay docker/tmux session
   * 活性：docker ps 容器名前缀匹配
   */
  'relay-container': {
    probe: async (task, _ctx) => {
      const shortId = task.id?.substring(0, 8)?.toLowerCase();
      if (!shortId) return 'unknown';
      try {
        const out = execSync(
          `docker ps --filter "name=cecelia-relay-${shortId}" --format "{{.Names}}"`,
          { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
        ).trim();
        return out ? 'alive' : 'dead';
      } catch {
        return 'unknown';
      }
    },
    staleMinutes: null,
    onStale: 'reignite',
  },

  /**
   * kernel-process: Kernel v1 的裸 Node 进程（Brain 容器内 detached spawn）
   * 活性：initiative_runs.orchestrator_heartbeat_at → orchestrator_pid(+host) kill -0
   * fail-open：拿不到确定答案一律 unknown，绝不把"不知道"当"死"（事故 51836fb2）。
   *
   * staleMinutes/onStale 与 relay-container 完全对齐 —— 'reignite' 让 zombie-reaper 与
   * alertness/healing 都跳过它，交给 harness-relay-watchdog 的 kernel 专属回收路径。
   * 这个合同绝不能比 relay-container 更容易杀。
   */
  [KERNEL_EXECUTOR_KIND]: {
    probe: async (task, ctx) => {
      let pool = ctx?.pool ?? ctx?.dbPool ?? null;
      if (!pool && ctx?.allowDefaultPool !== false) pool = await _defaultKernelPool();
      const r = await assessKernelLiveness({ pool, task, run: ctx?.kernelRun ?? null });
      if (r.verdict === 'alive') return 'alive';
      if (r.verdict === 'dead') return 'dead';
      return 'unknown';
    },
    staleMinutes: null,
    onStale: 'reignite',
  },

  /**
   * headed-session: 交互 claude 认领的任务
   * 活性：claimed_by 进程/tmux 存活 + git/CI 活动
   * 保守实现：无法确认时返回 unknown（fail-open，绝不误杀）
   */
  'headed-session': {
    probe: async (task, _ctx) => {
      if (!task.claimed_by) return 'unknown';
      // tmux/进程探活：claimed_by 格式 "session:<name>" 或 "pid:<n>"
      const claimedBy = String(task.claimed_by);
      try {
        if (claimedBy.startsWith('pid:')) {
          const pid = parseInt(claimedBy.slice(4), 10);
          if (pid > 0) {
            try { process.kill(pid, 0); return 'alive'; } catch { /* fall through to tmux check */ }
          }
        }
        if (claimedBy.startsWith('session:') || claimedBy.startsWith('tmux:')) {
          const sessionName = claimedBy.replace(/^(session:|tmux:)/, '');
          try {
            execSync(`tmux has-session -t ${JSON.stringify(sessionName)} 2>/dev/null`, {
              timeout: 3000, stdio: 'pipe',
            });
            return 'alive';
          } catch { /* session gone */ }
        }
        return 'unknown';
      } catch {
        return 'unknown';
      }
    },
    staleMinutes: 120,
    onStale: 'release-claim-and-alert',
  },

  /**
   * bridge: cecelia-bridge 派发（initiative_plan/initiative_verify 等）
   * 活性：execution_attempts 递增 / last_attempt_at 在宽限期内
   * 注：staleness 判断已在 assessTaskLiveness 的 staleMinutes 窗口里统一处理
   */
  'bridge': {
    probe: async (task, _ctx) => {
      // bridge 的活性信号来自 last_attempt_at 近期有更新
      const lastAttempt = task.last_attempt_at ? new Date(task.last_attempt_at) : null;
      if (!lastAttempt || isNaN(lastAttempt.getTime())) return 'unknown';
      const minutesSince = (Date.now() - lastAttempt.getTime()) / 60000;
      // 宽限 60min：与 staleMinutes 对齐，让 assessTaskLiveness 做最终裁决
      return minutesSince < 60 ? 'alive' : 'dead';
    },
    staleMinutes: 60,
    onStale: 'requeue',
  },

  /**
   * external-worker: ZJ pipeline-worker 等外部编排
   * 永不探活，永不超时，等回调
   */
  'external-worker': {
    probe: async () => 'alive',
    staleMinutes: null,
    onStale: 'never',
  },
};

// ─── 守护刀唯一入口 ────────────────────────────────────────────────────────────

/**
 * assessTaskLiveness(task, ctx) — 守护刀的唯一活性判断入口（T2 各守护刀接入）
 *
 * @param {object} task  DB task 行（含 id/executor_kind/updated_at/last_attempt_at/claimed_by）
 * @param {object} ctx   运行上下文（activeProcesses Map 等）
 * @returns {Promise<{verdict:'alive'|'dead'|'unknown', reason?:string, kind?:string, onStale?:string}>}
 *
 * unknown 一律 fail-open（不杀 + console.warn）
 */
export async function assessTaskLiveness(task, ctx) {
  // 以 payload.harness_runtime 为准纠正存量误标（relay-container → kernel-process）
  const kind = resolveLivenessKind(task);

  if (!kind) {
    console.warn(
      `[executor-contracts] assessTaskLiveness: task=${task.id} executor_kind=null (legacy) — fail-open`
    );
    return { verdict: 'unknown', reason: 'no_executor_kind' };
  }

  const contract = EXECUTOR_CONTRACTS[kind];
  if (!contract) {
    console.warn(
      `[executor-contracts] assessTaskLiveness: task=${task.id} executor_kind=${kind} unknown — fail-open`
    );
    return { verdict: 'unknown', reason: 'unknown_kind' };
  }

  let verdict;
  try {
    verdict = await contract.probe(task, ctx);
  } catch (err) {
    console.warn(
      `[executor-contracts] probe failed task=${task.id} kind=${kind}: ${err.message} — fail-open`
    );
    return { verdict: 'unknown', reason: 'probe_error', kind, onStale: contract.onStale };
  }

  if (verdict === 'unknown') {
    console.warn(
      `[executor-contracts] task=${task.id} kind=${kind} probe=unknown — fail-open (not killing)`
    );
    // TODO(T2): emit cecelia_events 告警
    return { verdict: 'unknown', reason: 'probe_unknown', kind, onStale: contract.onStale };
  }

  const staleMinutes = contract.staleMinutes;

  // staleMinutes=null → 不走超时窗口判断（relay-container/external-worker）
  if (verdict === 'dead' && staleMinutes !== null) {
    const updatedAt = task.updated_at ? new Date(task.updated_at) : null;
    if (updatedAt && !isNaN(updatedAt.getTime())) {
      const minutesSince = (Date.now() - updatedAt.getTime()) / 60000;
      if (minutesSince < staleMinutes) {
        return { verdict: 'alive', reason: 'within_stale_window', kind, onStale: contract.onStale };
      }
    }
  }

  return { verdict, kind, onStale: contract.onStale, staleMinutes };
}
