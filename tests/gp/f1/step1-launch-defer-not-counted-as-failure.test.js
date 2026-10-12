// kernel 运行时退役，历史排队 run 的统计口径仍需保持 SQL / JS 一致。
import { describe, it, expect } from 'vitest';
import { isLaunchDeferredReason, launchDeferredSql } from '../../../packages/brain/src/lib/kernel-launch-deferral.js';

const SAMPLES = [
  [null, false],
  ['', false],
  ['kernel_remote_launch_deferred:orchestrator_bridge_prepare_http_429:orchestrator_slots_exhausted', true],
  ['kernel_remote_launch_deferred:orchestrator_bridge_start_request_failed:The operation was aborted', true],
  ['kernel_reconcile_remote_requeue:no_resumable_session', true],
  ['kernel_reconcile_remote_requeue:no_resumable_session:defers_exhausted', false],
  ['kernel_remote_launch_failed:orchestrator_bridge_prepare_http_400', false],
  ['boom', false],
];

// launchDeferredSql 的 JS 等价物：从生成的 SQL 文本里抽前缀/后缀，逐字翻译
//（IS NOT NULL / starts_with / right(col, N) <> suffix）
function sqlSemantics(reason) {
  const sql = launchDeferredSql('ir');
  const prefixes = [...sql.matchAll(/starts_with\(ir\.failure_reason, '([^']+)'\)/g)].map((m) => m[1]);
  const [, len, suffix] = sql.match(/right\(ir\.failure_reason, (\d+)\) <> '([^']+)'/);
  if (reason == null) return false;
  return prefixes.some((p) => reason.startsWith(p)) && reason.slice(-Number(len)) !== suffix;
}

describe('F1 step1 · 历史排队 run 不计入失败率', () => {
  it.each(SAMPLES)('SQL 判定与 JS 判定同结论：%j → %s', (reason, expected) => {
    expect(isLaunchDeferredReason(reason)).toBe(expected);
    expect(sqlSemantics(reason)).toBe(expected);
  });
});
