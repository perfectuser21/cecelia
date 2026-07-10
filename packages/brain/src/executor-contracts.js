/**
 * executor-contracts.js — 执行者活性合同模块
 *
 * 五类执行者各定义 probe/staleMinutes/onStale。
 * assessTaskLiveness 是守护刀的唯一活性判定入口。
 * unknown 一律 fail-open（不杀 + console.warn + cecelia_events）。
 *
 * 架构参考: docs/architecture/2026-07-10-executor-liveness-contract/architecture.md
 */

import { execSync } from 'child_process';
import pool from './db.js';

// ──────────────────────────────────────────────────────────
// Probe implementations
// ──────────────────────────────────────────────────────────

async function probeBrainLocal(task, _ctx) {
  const pid = task.payload?.pid ?? task.metadata?.pid;
  if (!pid) return 'unknown';
  try {
    execSync(`kill -0 ${pid}`, { stdio: 'pipe' });
    return 'alive';
  } catch {
    return 'dead';
  }
}

async function probeRelayContainer(task, _ctx) {
  const shortId = String(task.id).slice(0, 8).toLowerCase();
  try {
    const out = execSync(
      `docker ps --filter "name=cecelia-relay-${shortId}" --format '{{.Names}}'`,
      { stdio: 'pipe', encoding: 'utf-8', timeout: 8000 }
    ).trim();
    return out.length > 0 ? 'alive' : 'dead';
  } catch {
    return 'unknown';
  }
}

async function probeHeadedSession(_task, _ctx) {
  // Brain 内部无法可靠探测外部交互 claude session → 保守返回 unknown
  // 架构决策：headed-session 超时 → release-claim-and-alert，绝不自动 fail
  return 'unknown';
}

async function probeBridge(task, _ctx) {
  if (!task.last_attempt_at) return 'unknown';
  const elapsedMin = (Date.now() - new Date(task.last_attempt_at).getTime()) / 60000;
  return elapsedMin < EXECUTOR_CONTRACTS['bridge'].staleMinutes ? 'alive' : 'dead';
}

async function probeExternalWorker(_task, _ctx) {
  return 'alive'; // 外部系统负责，Brain 永不干预
}

// ──────────────────────────────────────────────────────────
// 五合同表
// ──────────────────────────────────────────────────────────

export const EXECUTOR_CONTRACTS = {
  'brain-local': {
    probe: probeBrainLocal,
    staleMinutes: 60,
    onStale: 'fail',
  },
  'relay-container': {
    probe: probeRelayContainer,
    staleMinutes: null, // relay-watchdog 专管
    onStale: 'reignite',
  },
  'headed-session': {
    probe: probeHeadedSession,
    staleMinutes: 120,
    onStale: 'release-claim-and-alert',
  },
  'bridge': {
    probe: probeBridge,
    staleMinutes: 60,
    onStale: 'requeue',
  },
  'external-worker': {
    probe: probeExternalWorker,
    staleMinutes: null,
    onStale: 'never',
  },
};

// ──────────────────────────────────────────────────────────
// markExecutorKind — 打标工具，所有派发点调用
// ──────────────────────────────────────────────────────────

const VALID_KINDS = new Set(Object.keys(EXECUTOR_CONTRACTS));

export async function markExecutorKind(taskId, kind) {
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`markExecutorKind: invalid kind="${kind}". Valid: ${[...VALID_KINDS].join(', ')}`);
  }
  try {
    await pool.query(
      `UPDATE tasks SET executor_kind = $2, updated_at = NOW() WHERE id = $1`,
      [taskId, kind]
    );
  } catch (err) {
    // 非阻塞：打标失败不能中断派发流程，只告警
    console.warn(`[executor-contracts] markExecutorKind failed task=${taskId} kind=${kind}: ${err.message}`);
  }
}

// ──────────────────────────────────────────────────────────
// assessTaskLiveness — 守护刀唯一入口
// ──────────────────────────────────────────────────────────

async function emitFailOpenEvent(taskId, kind, reason) {
  try {
    await pool.query(
      `INSERT INTO cecelia_events (task_id, event_type, payload, created_at)
       VALUES ($1, 'executor_liveness_unknown', $2::jsonb, NOW())`,
      [taskId, JSON.stringify({ executor_kind: kind, reason })]
    );
  } catch {
    // 事件写入失败不阻塞
  }
}

/**
 * assessTaskLiveness(task, ctx) → { liveness, action, contract }
 *
 * liveness: 'alive' | 'dead' | 'unknown'
 * action:   'keep' | 'fail' | 'reignite' | 'requeue' | 'release-claim-and-alert' | 'fail-open' | 'never'
 */
export async function assessTaskLiveness(task, ctx = {}) {
  const kind = task.executor_kind ?? null;

  if (!kind || !EXECUTOR_CONTRACTS[kind]) {
    // NULL = legacy/未打标 → unknown → fail-open
    console.warn(`[executor-contracts] fail-open: task=${task.id} executor_kind=${kind} (untagged/unknown)`);
    await emitFailOpenEvent(task.id, kind, 'untagged');
    return { liveness: 'unknown', action: 'fail-open', contract: null };
  }

  const contract = EXECUTOR_CONTRACTS[kind];
  const liveness = await contract.probe(task, ctx);

  if (liveness === 'unknown') {
    console.warn(`[executor-contracts] fail-open: task=${task.id} kind=${kind} probe=unknown`);
    await emitFailOpenEvent(task.id, kind, 'probe_unknown');
    return { liveness: 'unknown', action: 'fail-open', contract };
  }

  if (liveness === 'alive') {
    return { liveness: 'alive', action: 'keep', contract };
  }

  // dead
  if (contract.onStale === 'never') {
    return { liveness: 'dead', action: 'never', contract };
  }

  return { liveness: 'dead', action: contract.onStale, contract };
}
