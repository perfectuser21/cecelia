/**
 * Brain v2 Phase E1 — Observer 状态查询 API
 *
 * GET /api/brain/observer/state — 返回 observerState 单例 cached 内容
 * GET /api/brain/observer/health — observer 自身健康（last_run_at 是否陈旧）
 *
 * 上游 PRD：docs/design/brain-v2-c8-d-e-handoff.md §6
 */

import express from 'express';
import { observerState } from '../observer-runner.js';

const router = express.Router();

router.get('/state', (req, res) => {
  res.json({
    alertness: observerState.alertness,
    health: observerState.health,
    resources: observerState.resources,
    last_run_at: observerState.last_run_at,
    last_run_duration_ms: observerState.last_run_duration_ms,
    last_run_error: observerState.last_run_error,
    run_count: observerState.run_count,
  });
});

router.get('/health', (req, res) => {
  if (!observerState.last_run_at) {
    return res.json({ healthy: false, reason: 'never_run' });
  }
  const ageMs = Date.now() - new Date(observerState.last_run_at).getTime();
  // 健康标准：last_run 不超过 2 倍 interval（默认 60s）
  const STALE_THRESHOLD_MS = 60 * 1000;
  const healthy = ageMs < STALE_THRESHOLD_MS;
  res.json({
    healthy,
    last_run_age_ms: ageMs,
    stale_threshold_ms: STALE_THRESHOLD_MS,
    last_run_error: observerState.last_run_error,
  });
});

export default router;
