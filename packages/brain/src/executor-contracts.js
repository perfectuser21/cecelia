/**
 * executor-contracts.js
 *
 * 执行者活性合同统一模块（T1）
 * 架构文档：docs/architecture/2026-07-10-executor-liveness-contract/architecture.md
 *
 * 五类执行者：brain-local / relay-container / headed-session / bridge / external-worker
 * - probe(task, ctx) → 'alive' | 'dead' | 'unknown'
 * - unknown 一律 fail-open：不杀 + console.warn
 * - assessTaskLiveness 是守护刀的唯一入口（T2 接入，T1 建模块）
 */

import { execSync } from 'child_process';
import defaultPool from './db.js';

export const VALID_EXECUTOR_KINDS = [
  'brain-local',
  'relay-container',
  'headed-session',
  'bridge',
  'external-worker',
];

// ─── 打标映射（各派发点用的快查表）────────────────────────────────────────────
// 特殊 key __bridge_path / __local_spawn 代表路由路径（非 task_type）
export const EXECUTOR_KIND_FOR = {
  // harness_initiative 由 runHarnessInitiativeRouter → spawnSkillRelaySession 跑 relay-container
  harness_initiative: 'relay-container',
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
   * 活性（双信号）：
   *   1. docker ps 容器名前缀匹配（快路径）
   *   2. initiative_run_events 心跳（harness-controller phase-event 自报）
   *      - docker dead 时作为兜底信号：30min 内有写入 → alive（T7 防误杀）
   *      - docker 抛异常时同理
   */
  'relay-container': {
    probe: async (task, _ctx) => {
      const shortId = task.id?.substring(0, 8)?.toLowerCase();
      let dockerResult = 'unknown'; // 'alive' | 'dead' | 'unknown'

      if (shortId) {
        try {
          const out = execSync(
            `docker ps --filter "name=cecelia-relay-${shortId}" --format "{{.Names}}"`,
            { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
          ).trim();
          dockerResult = out ? 'alive' : 'dead';
        } catch {
          dockerResult = 'unknown';
        }
      }

      // 快路径：docker 已确认存活
      if (dockerResult === 'alive') return 'alive';

      // 次信号：查 initiative_run_events 心跳（phase-event 自报）
      // 30min 内有事件 → 任务仍在活跃地跑各阶段
      const HEARTBEAT_MINUTES = 30;
      try {
        const { rows } = await defaultPool.query(
          `SELECT MAX(ts) AS last_ts FROM initiative_run_events WHERE initiative_id = $1`,
          [task.id]
        );
        const lastTs = rows[0]?.last_ts;
        if (lastTs != null) {
          const minutesSince = (Date.now() / 1000 - Number(lastTs)) / 60;
          if (minutesSince < HEARTBEAT_MINUTES) return 'alive';
        }
        // 有心跳数据但已过期，或无心跳数据：沿用 docker 结论
        return dockerResult === 'dead' ? 'dead' : 'unknown';
      } catch {
        // DB 不可达 → fail-open
        return 'unknown';
      }
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
  const kind = task.executor_kind;

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
