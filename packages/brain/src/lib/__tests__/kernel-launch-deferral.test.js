import { describe, it, expect } from 'vitest';
import {
  KERNEL_LAUNCH_DEFERRED_REASON_PREFIX,
  KERNEL_RECONCILE_REQUEUE_REASON_PREFIX,
  KERNEL_REQUEUE_EXHAUSTED_SUFFIX,
  isLaunchDeferredReason,
  launchDeferredSql,
  journeyRunStatsSelectSql,
  mapJourneyRunStatsRow,
} from '../kernel-launch-deferral.js';

describe('kernel-launch-deferral — 编排槽满排队 run 的识别', () => {
  it('前缀常量与 harness-skill-relay / watchdog 生成的 reason 一致', () => {
    expect(KERNEL_LAUNCH_DEFERRED_REASON_PREFIX).toBe('kernel_remote_launch_deferred:');
    expect(KERNEL_RECONCILE_REQUEUE_REASON_PREFIX).toBe('kernel_reconcile_remote_requeue:');
    expect(KERNEL_REQUEUE_EXHAUSTED_SUFFIX).toBe(':defers_exhausted');
  });

  describe('isLaunchDeferredReason', () => {
    it('正例：槽位满排队 / watchdog reconcile 回队', () => {
      expect(isLaunchDeferredReason('kernel_remote_launch_deferred:orchestrator_bridge_prepare_http_429')).toBe(true);
      expect(isLaunchDeferredReason('kernel_reconcile_remote_requeue:no_resumable_session')).toBe(true);
    });
    it('反例：真实失败 / 空值 / 非字符串', () => {
      expect(isLaunchDeferredReason('kernel_remote_launch_failed:orchestrator_bridge_prepare_http_400')).toBe(false);
      expect(isLaunchDeferredReason('spawn_failed')).toBe(false);
      expect(isLaunchDeferredReason('')).toBe(false);
      expect(isLaunchDeferredReason(null)).toBe(false);
      expect(isLaunchDeferredReason(undefined)).toBe(false);
      expect(isLaunchDeferredReason(42)).toBe(false);
    });
    it('反例：延后次数用尽后的终态失败不算排队', () => {
      expect(isLaunchDeferredReason('kernel_reconcile_remote_requeue:no_resumable_session:defers_exhausted')).toBe(false);
    });
    it('前缀必须在开头，不能是子串', () => {
      expect(isLaunchDeferredReason('x kernel_remote_launch_deferred:y')).toBe(false);
    });
  });

  // JS 判定与 SQL 判定的共同契约：同一张样本表，两套实现必须给出同样结论。
  // SQL 的 JS 等价物按 launchDeferredSql 的结构逐字翻译（IS NOT NULL / starts_with / right()）。
  describe('JS 与 SQL 判定共用的样本契约', () => {
    const SAMPLES = [
      [null, false],
      [undefined, false],
      ['', false],
      ['kernel_remote_launch_deferred:orchestrator_bridge_prepare_http_429:orchestrator_slots_exhausted', true],
      ['kernel_remote_launch_deferred:orchestrator_bridge_start_request_failed:The operation was aborted', true],
      ['kernel_reconcile_remote_requeue:no_resumable_session', true],
      ['kernel_reconcile_remote_requeue:no_resumable_session:defers_exhausted', false],
      ['kernel_remote_launch_failed:orchestrator_bridge_prepare_http_400', false],
      ['boom', false],
      ['kernel_remote_launch_deferredX', false],
    ];

    function sqlEquivalent(reason) {
      const sql = launchDeferredSql('ir');
      // 从生成的 SQL 里抽出前缀与后缀，确保等价物确实对应实际 SQL 文本，而非另写一份常量
      const prefixes = [...sql.matchAll(/starts_with\(ir\.failure_reason, '([^']+)'\)/g)].map((m) => m[1]);
      const [, suffixLen, suffix] = sql.match(/right\(ir\.failure_reason, (\d+)\) <> '([^']+)'/);
      if (reason == null) return false; // failure_reason IS NOT NULL
      return prefixes.some((p) => reason.startsWith(p))
        && reason.slice(-Number(suffixLen)) !== suffix; // right(col, N) <> suffix
    }

    it.each(SAMPLES)('%j → %s', (reason, expected) => {
      expect(isLaunchDeferredReason(reason)).toBe(expected);
      expect(sqlEquivalent(reason)).toBe(expected);
    });
  });

  describe('launchDeferredSql', () => {
    it('默认别名 ir，用 starts_with（不用 LIKE，避免 _ 通配符）', () => {
      const sql = launchDeferredSql();
      expect(sql).toContain("starts_with(ir.failure_reason, 'kernel_remote_launch_deferred:')");
      expect(sql).toContain("starts_with(ir.failure_reason, 'kernel_reconcile_remote_requeue:')");
      expect(sql).toContain('ir.failure_reason IS NOT NULL');
      expect(sql).toContain(":defers_exhausted'");
      expect(sql).not.toMatch(/\bLIKE\b/i);
    });
    it('自定义别名', () => {
      expect(launchDeferredSql('r')).toContain('starts_with(r.failure_reason,');
      expect(launchDeferredSql('r')).not.toContain('ir.failure_reason');
    });
  });

  describe('journeyRunStatsSelectSql / mapJourneyRunStatsRow', () => {
    const sql = journeyRunStatsSelectSql('ir');
    const d = launchDeferredSql('ir');

    it('runs / done / failed 都排除排队 run，deferred 单独计数', () => {
      expect(sql).toContain(`COUNT(*) FILTER (WHERE NOT ${d}) AS runs`);
      expect(sql).toContain(`COUNT(*) FILTER (WHERE ir.phase = 'done' AND NOT ${d}) AS done`);
      expect(sql).toContain(`COUNT(*) FILTER (WHERE ir.phase = 'failed' AND NOT ${d}) AS failed`);
      expect(sql).toContain(`COUNT(*) FILTER (WHERE ${d}) AS deferred`);
    });
    it('last_failure 只取非排队 run 的原因', () => {
      expect(sql).toContain(`FILTER (WHERE ir.failure_reason IS NOT NULL AND NOT ${d})`);
      expect(sql).toContain('AS last_failure');
    });

    it('mapper：success_rate 只按 done/(done+failed)，附带 deferred', () => {
      const out = mapJourneyRunStatsRow({
        journey_id: 'j1', journey_name: 'L1', runs: '5', done: '4', failed: '1',
        deferred: '227', last_run_at: 't', last_failure: null,
      });
      expect(out).toEqual({
        journey_id: 'j1', journey_name: 'L1', runs: 5, done: 4, failed: 1,
        deferred: 227, success_rate: 0.8, last_run_at: 't', last_failure: null,
      });
    });
    it('mapper：缺 deferred 列按 0；无终态 run 成功率 0', () => {
      const out = mapJourneyRunStatsRow({ journey_id: 'j', journey_name: 'n', runs: '0', done: '0', failed: '0', last_run_at: null });
      expect(out.deferred).toBe(0);
      expect(out.success_rate).toBe(0);
    });
  });
});
