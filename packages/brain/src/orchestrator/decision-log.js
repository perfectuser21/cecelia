/**
 * decision-log.js —— orchestrator_decision_log append-only 写入（IO 薄层）。
 *
 * hop 协议（spec §关键设计决策 6）：
 * - intent-log-before-dispatch：先 appendHop 再派发
 * - hop = MAX(hop)+1（nextHop）
 * - UNIQUE(run_id,hop) 冲突（pg 23505）= 有并发 orchestrator 实例 →
 *   throw SingletonConflictError，本进程立即退出（singleton 守卫），交 watchdog
 * 表结构：packages/brain/migrations/312_orchestrator_runs_state.sql（append-only trigger 在库层强制）
 * Commander 事件投影由 migration 367 的同事务 AFTER INSERT trigger 唯一负责；
 * 本薄层不得追加 harness_run_events，避免 authority 与 projection 双写分裂。
 */

const PG_UNIQUE_VIOLATION = '23505';

/** UNIQUE(run_id,hop) 冲突 = 并发 orchestrator 实例信号（singleton 守卫） */
export class SingletonConflictError extends Error {
  constructor(runId, hop, cause) {
    super(`orchestrator singleton conflict: run ${runId} hop ${hop} already logged (concurrent instance?)`);
    this.name = 'SingletonConflictError';
    this.runId = runId;
    this.hop = hop;
    this.cause = cause;
  }
}

/**
 * 追加一跳决策日志（intent-before-dispatch）。
 * observed/detail 显式 JSON.stringify（jsonb 列），detail 缺省 → null。
 */
export async function appendHop(pool, { runId, hop, observed, derivedPhase, gateVerdict, action, detail }) {
  if (observed == null) {
    // fail-fast：observed 快照是回放与 streak 推导的原料，空快照 = 静默丢观测（Task B review Minor ③）
    throw new Error(`appendHop: observed is required (run ${runId} hop ${hop})`);
  }
  try {
    await pool.query(
      `INSERT INTO orchestrator_decision_log
         (run_id, hop, observed, derived_phase, gate_verdict, action, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        runId,
        hop,
        JSON.stringify(observed),
        derivedPhase,
        gateVerdict ?? null,
        action,
        detail == null ? null : JSON.stringify(detail),
      ],
    );
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      throw new SingletonConflictError(runId, hop, err);
    }
    throw err;
  }
}

/** 下一跳编号：SELECT COALESCE(MAX(hop),0)+1 */
export async function nextHop(pool, runId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(MAX(hop), 0) + 1 AS next_hop FROM orchestrator_decision_log WHERE run_id = $1',
    [runId],
  );
  return Number(rows[0].next_hop);
}
