/**
 * [BEHAVIOR] 真身 Session Controller 生命周期纯谓词契约（TDD Red 种子）
 *
 * 本文件是 proposer 起的 TDD 红种子：只断言 kernel-controller-lifecycle.js 必须新增的
 * 纯函数契约（不依赖 PG / 不依赖子进程），因此在 authoring checkout（runtime_resources.postgres=false）
 * 也能跑出红。真 PG + 真子进程的重活由 packages/brain/src/__tests__/integration/
 * kernel-controller-daemon.pg.integration.test.js 承接（brain-integration job 起真 PG 跑）。
 *
 * 现状：下列导出在实现前都不存在 → typeof !== 'function' / 值不符 → 全红。
 * 禁 mock 边：本文件是纯函数契约，不涉及被改的 PG/子进程边，故无 mock（合规）。
 */
import { describe, it, expect } from 'vitest';
import * as lifecycle from '../../../packages/brain/src/orchestrator/kernel-controller-lifecycle.js';

describe('classifyControllerRecovery — Kernel fatal 按 failure_class 分流 [L2]', () => {
  it('assembly_fault 归不可恢复类 terminate', () => {
    expect(typeof lifecycle.classifyControllerRecovery).toBe('function');
    expect(lifecycle.classifyControllerRecovery('assembly_fault')).toBe('terminate');
  });
  it('contract_invalid / contract_fault 归不可恢复类 terminate', () => {
    expect(lifecycle.classifyControllerRecovery('contract_invalid')).toBe('terminate');
    expect(lifecycle.classifyControllerRecovery('contract_fault')).toBe('terminate');
  });
  it('transient / infrastructure_blocked 归可恢复类 resume', () => {
    expect(lifecycle.classifyControllerRecovery('transient')).toBe('resume');
    expect(lifecycle.classifyControllerRecovery('infrastructure_blocked')).toBe('resume');
  });
  it('未知/缺失 failure_class fail-open 为 resume（可恢复优先，不误杀活 run）', () => {
    expect(lifecycle.classifyControllerRecovery(null)).toBe('resume');
    expect(lifecycle.classifyControllerRecovery('some_unknown_code')).toBe('resume');
  });
});

describe('isPushFrozenForRun — human_review 期 push 冻结判据 [L2]', () => {
  it('等待人审（awaiting_human_review / merge_gate）且非终态 → 冻结 true', () => {
    expect(typeof lifecycle.isPushFrozenForRun).toBe('function');
    expect(lifecycle.isPushFrozenForRun({
      phase: 'evaluate', failure_reason: 'awaiting_human_review',
    })).toBe(true);
  });
  it('正常活跃 run（无人审等待）→ 不冻结 false', () => {
    expect(lifecycle.isPushFrozenForRun({
      phase: 'generate', failure_reason: null,
    })).toBe(false);
  });
  it('终态 run（done/failed）→ 不冻结 false（人审窗口已关）', () => {
    expect(lifecycle.isPushFrozenForRun({
      phase: 'done', failure_reason: 'awaiting_human_review',
    })).toBe(false);
    expect(lifecycle.isPushFrozenForRun({
      phase: 'failed', failure_reason: 'awaiting_human_review',
    })).toBe(false);
  });
});

describe('Controller never_started 兜底契约 [L2]', () => {
  it('导出 never_started 结构化 reason 前缀常量', () => {
    expect(typeof lifecycle.CONTROLLER_NEVER_STARTED_REASON_PREFIX).toBe('string');
    expect(lifecycle.CONTROLLER_NEVER_STARTED_REASON_PREFIX.length).toBeGreaterThan(0);
  });
});

describe('续租 / 终局回写 / 兜底 函数存在性契约 [L2]', () => {
  it('renewControllerLease 导出（周期续租 controller_lease_expires_at，ownership 守卫）', () => {
    expect(typeof lifecycle.renewControllerLease).toBe('function');
  });
  it('finalizeControllerTaskResult 导出（终局 task.result 回写 pr_url+merged+summary）', () => {
    expect(typeof lifecycle.finalizeControllerTaskResult).toBe('function');
  });
});
