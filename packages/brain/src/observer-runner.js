/**
 * Brain v2 Phase E1 — Observer Runner（独立 timer 看天）
 *
 * 在独立 setInterval 中周期跑 alertness / health-monitor / 资源压力评估，
 * 结果汇总到 observerState 单例。供 dashboard / 监控 API 直接读，不依赖 tick loop 周期。
 *
 * **本次 minimal 版**（E1）：
 * - observerState 单例 + 独立 30s setInterval
 * - 跑 evaluateAlertness / runLayer2HealthCheck / checkServerResources 写 observerState
 * - tick-runner.js 内 inline 调用**不改**（observer 是额外监控层，不替代 inline）
 *
 * **后续 E2/E3**（不在本 PR 范围）：
 * - tick-runner.js 改读 cached observerState 替代 inline 调用
 * - 自适应决策（alertness 高时自动 drain / pause）
 *
 * 上游 PRD：docs/design/brain-v2-c8-d-e-handoff.md §6
 */

import { evaluateAlertness } from './alertness/index.js';
import { runLayer2HealthCheck } from './health-monitor.js';
import { checkServerResources } from './executor.js';
// runLayer2HealthCheck(pool) 必须传 pool；不传则函数内部 pool.query 拿到 undefined
// 全部 query 失败被 catch 后 silent，监控数据全断（5/3 prod 实证）
import pool from './db.js';

const OBSERVER_INTERVAL_MS = parseInt(
  process.env.CECELIA_OBSERVER_INTERVAL_MS || String(30 * 1000),
  10
);

/**
 * Observer 状态单例。所有字段 nullable — 首次 tick 前为 null。
 * tick-runner.js 老 inline 调用是真值来源；observerState 是 cached 副本，仅给监控用。
 */
export const observerState = {
  alertness: null,        // { level, score, level_name, ... }
  health: null,           // { summary, layer2_status, ... }
  resources: null,        // { busy_seats, max_seats, ... }
  last_run_at: null,      // ISO timestamp
  last_run_duration_ms: null,
  last_run_error: null,   // null 或 Error.message
  run_count: 0,
};

let _observerTimer = null;
let _observerRunning = false;

/**
 * 单次 observer 跑：刷新 3 个 channel + 写 observerState。
 * Brain 启动时立即跑一次（避免 first 30s observerState 全 null）。
 */
export async function runOnce() {
  if (_observerRunning) {
    // 防重入：上次还没跑完就跳过
    return { skipped: true, reason: 'already_running' };
  }
  _observerRunning = true;
  const startMs = Date.now();
  let error = null;

  try {
    // 三个 channel 并行跑（互不依赖）
    const [alertnessRes, healthRes, resourcesRes] = await Promise.allSettled([
      evaluateAlertness(),
      runLayer2HealthCheck(pool),
      Promise.resolve(checkServerResources()),
    ]);

    if (alertnessRes.status === 'fulfilled') {
      observerState.alertness = alertnessRes.value;
    }
    if (healthRes.status === 'fulfilled') {
      observerState.health = healthRes.value;
    }
    if (resourcesRes.status === 'fulfilled') {
      observerState.resources = resourcesRes.value;
    }

    // 任一 channel reject → 记 error 但保留其他 channel cached value
    const errors = [alertnessRes, healthRes, resourcesRes]
      .filter((r) => r.status === 'rejected')
      .map((r) => r.reason?.message || String(r.reason));
    if (errors.length > 0) {
      error = errors.join('; ');
    }
  } catch (err) {
    // top-level 异常（不应该发生，Promise.allSettled 已兜住每个 channel）
    error = err.message;
  } finally {
    observerState.last_run_at = new Date().toISOString();
    observerState.last_run_duration_ms = Date.now() - startMs;
    observerState.last_run_error = error;
    observerState.run_count += 1;
    _observerRunning = false;
  }

  return {
    skipped: false,
    duration_ms: observerState.last_run_duration_ms,
    error,
    run_count: observerState.run_count,
  };
}

/**
 * 启动 observer 后台 timer。Brain 启动时调一次。
 * 立即跑 runOnce() 一次，然后 setInterval 每 OBSERVER_INTERVAL_MS（默认 30s）。
 */
export async function initObserverRunner() {
  if (_observerTimer) {
    // 幂等：已启动跳过
    return { started: false, reason: 'already_running' };
  }

  // 立即跑一次让 observerState 不全 null
  await runOnce();

  _observerTimer = setInterval(() => {
    runOnce().catch((err) => {
      console.error('[observer-runner] periodic runOnce 异常:', err.message);
    });
  }, OBSERVER_INTERVAL_MS);

  console.log(`[observer-runner] 启动，interval=${OBSERVER_INTERVAL_MS}ms`);
  return { started: true, interval_ms: OBSERVER_INTERVAL_MS };
}

/**
 * 停止 observer timer。供测试 / shutdown 用。
 */
export function stopObserverRunner() {
  if (_observerTimer) {
    clearInterval(_observerTimer);
    _observerTimer = null;
    return { stopped: true };
  }
  return { stopped: false, reason: 'not_running' };
}

/**
 * 测试 hook：重置 observerState + timer。
 */
export function _resetObserverForTests() {
  stopObserverRunner();
  observerState.alertness = null;
  observerState.health = null;
  observerState.resources = null;
  observerState.last_run_at = null;
  observerState.last_run_duration_ms = null;
  observerState.last_run_error = null;
  observerState.run_count = 0;
  _observerRunning = false;
}
