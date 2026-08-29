// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：Commander 分权翻转（判死权/处置权归位）
//
// Alex 08-29 拍板：两周 30 轮案卷归类——所有"程序性死亡"的共同形状是**机械层在
// 信息不全时做不可逆判死，而有判断力的 Commander 只有建议权且被三把锁锁成旁观者**。
// r80（run 5100560e）精确定位三把锁：
//   ① directive-validator ACTIVE_PHASES 不含 review/failed → 人审期/判死前 Commander
//      说什么都 invalid_phase；
//   ② deadline 过期一律 deadline_exceeded 拒绝 → 钟过了 Commander 无权说话（无续命权）；
//   ③ executor dispatch_role 只许 target_role 等于机械层已想派的角色 → 橡皮图章，
//      r80 它说"派 reviewer"被 illegal_role_at_kernel_boundary 拒绝后双方僵死 4h。
//
// 修法（Phase A，本批）：
// a) validator：ACTIVE_PHASES += review/failed；过期只拒 continue_default（逼它明确决定），
//    dispatch_role/retry_attempt/request_human/abort_run 过期仍可接受；
// b) executor：dispatch_role 允许改派任意非 commander 角色，角色→相位/动作映射；
//    原"同意机械层角色"快路径行为不变；
// c) loop：deadline fence ×3 + blocked_same_state 在 hybrid 下不直接 failRun，改为
//    覆盖 defaultDecision=MARK_FAILED 走既有 pre_terminal 会诊；Commander 改派后
//    run deadline 宽限 +30min（续命）；Commander 不可用 → fail-closed 回原判死
//    （loop 侧由 CI 集成测试与生产案卷盯守，本文件盯 a/b 两条纯函数边）。
//
// 真 import validator/executor（被改的边），deps 注入 stub。
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { validateCommanderDirective } from '../../../packages/brain/src/orchestrator/directive-validator.js';
import { createCommanderDirectiveExecutor } from '../../../packages/brain/src/orchestrator/commander-directive-executor.js';
import { COMMANDER_ACTIONS } from '../../../packages/brain/src/orchestrator/commander-contract.js';

const runId = randomUUID();

function directive(overrides = {}) {
  return {
    schema: 'commander-directive/v1',
    run_id: runId,
    event_cursor: 9,
    action: 'continue_default',
    reason: 'r80 案卷复刻',
    evidence_refs: ['event:9'],
    ...overrides,
  };
}

function validation(overrides = {}) {
  return {
    runId,
    eventCursor: 9,
    phase: 'evaluate',
    allowedActions: [...COMMANDER_ACTIONS],
    nextHop: 12,
    maxHops: 4096,
    duplicateHop: false,
    spentUsd: 1,
    maxUsd: 10,
    deadlineAt: '2026-08-29T10:00:00.000Z',
    now: '2026-08-29T09:00:00.000Z',
    strictMachine: null,
    capabilityAllowed: true,
    evidenceOwned: true,
    remainingRetryBudget: 2,
    ...overrides,
  };
}

function deps() {
  return {
    eventStore: { assertEvidenceRefs: vi.fn().mockResolvedValue(true) },
    attemptStore: { getById: vi.fn().mockResolvedValue(null) },
    commanderStore: {
      get: vi.fn().mockResolvedValue({ run_id: runId, event_cursor: 9 }),
      updateMemory: vi.fn().mockResolvedValue({ run_id: runId, event_cursor: 9 }),
    },
  };
}

describe('F1 step3 — 锁①：人审期/判死前 Commander 有发言权', () => {
  it('phase=review 的 dispatch_role 不再 invalid_phase', () => {
    const v = validateCommanderDirective(
      directive({ action: 'dispatch_role', target_role: 'reviewer' }),
      validation({ phase: 'review' }),
    );
    expect(v.accepted).toBe(true);
  });

  it('phase=failed（判死前会诊）的 dispatch_role 不再 invalid_phase', () => {
    const v = validateCommanderDirective(
      directive({ action: 'dispatch_role', target_role: 'evaluator' }),
      validation({ phase: 'failed' }),
    );
    expect(v.accepted).toBe(true);
  });

  it('负向：merge 相位仍不在 Commander 发言范围（公章不给）', () => {
    const v = validateCommanderDirective(
      directive({ action: 'dispatch_role', target_role: 'reviewer' }),
      validation({ phase: 'merge' }),
    );
    expect(v.accepted).toBe(false);
    expect(v.reason_code).toBe('invalid_phase');
  });
});

describe('F1 step3 — 锁②：钟过了 Commander 有续命权', () => {
  const past = { deadlineAt: '2026-08-29T08:00:00.000Z', now: '2026-08-29T09:00:00.000Z' };

  it('过期后 dispatch_role 接受（可改派救活）', () => {
    const v = validateCommanderDirective(
      directive({ action: 'dispatch_role', target_role: 'evaluator' }),
      validation(past),
    );
    expect(v.accepted).toBe(true);
  });

  it('过期后 abort_run / request_human 接受（明确终局或升人）', () => {
    expect(validateCommanderDirective(directive({ action: 'abort_run' }), validation(past)).accepted).toBe(true);
    expect(validateCommanderDirective(directive({ action: 'request_human' }), validation(past)).accepted).toBe(true);
  });

  it('负向：过期后 continue_default 仍拒绝（逼它明确决定，不许含糊放行）', () => {
    const v = validateCommanderDirective(directive({ action: 'continue_default' }), validation(past));
    expect(v.accepted).toBe(false);
    expect(v.reason_code).toBe('deadline_exceeded');
  });

  it('负向：cost 预算仍是硬约束（钱是公章）', () => {
    const v = validateCommanderDirective(
      directive({ action: 'dispatch_role', target_role: 'evaluator' }),
      validation({ spentUsd: 10, maxUsd: 10 }),
    );
    expect(v.accepted).toBe(false);
    expect(v.reason_code).toBe('cost_budget_exceeded');
  });
});

describe('F1 step3 — 锁③：dispatch_role 可改派（不再橡皮图章）', () => {
  const waitReview = Object.freeze({ phase: 'review', action: 'wait:human_review', reason: 'callback_infrastructure_route_unknown' });

  it('r80 复刻：机械层想 wait:human_review，Commander 说派 reviewer → 接受，产出 spawn:reviewer@gan', async () => {
    const exec = createCommanderDirectiveExecutor(deps());
    const r = await exec.execute({
      directive: directive({ action: 'dispatch_role', target_role: 'reviewer' }),
      defaultDecision: waitReview,
      validation: validation({ phase: 'review' }),
    });
    expect(r.accepted).toBe(true);
    expect(r.decision.action).toBe('spawn:reviewer');
    expect(r.decision.phase).toBe('gan');
    expect(r.decision.reason).toMatch(/^commander_dispatch:/);
  });

  it('判死前会诊：机械层想 mark_failed，Commander 说派 evaluator → 接受，产出 spawn:evaluator@evaluate', async () => {
    const exec = createCommanderDirectiveExecutor(deps());
    const r = await exec.execute({
      directive: directive({ action: 'dispatch_role', target_role: 'evaluator' }),
      defaultDecision: { phase: 'failed', action: 'mark_failed', reason: 'automation_deadline_exceeded' },
      validation: validation({ phase: 'failed' }),
    });
    expect(r.accepted).toBe(true);
    expect(r.decision.action).toBe('spawn:evaluator');
    expect(r.decision.phase).toBe('evaluate');
  });

  it('generator 改派：默认非 spawn:generator 时映射为 generator-fix（保留候选血统）', async () => {
    const exec = createCommanderDirectiveExecutor(deps());
    const r = await exec.execute({
      directive: directive({ action: 'dispatch_role', target_role: 'generator' }),
      defaultDecision: waitReview,
      validation: validation({ phase: 'review' }),
    });
    expect(r.accepted).toBe(true);
    expect(r.decision.action).toBe('spawn:generator-fix');
    expect(r.decision.phase).toBe('generate');
  });

  it('原快路径不变：target_role 等于机械层已想派的角色 → 原样接受 defaultDecision', async () => {
    const exec = createCommanderDirectiveExecutor(deps());
    const dd = { phase: 'planning', action: 'spawn:planner', reason: 'no_prd' };
    const r = await exec.execute({
      directive: directive({ action: 'dispatch_role', target_role: 'planner' }),
      defaultDecision: dd,
      validation: validation({ phase: 'planning' }),
    });
    expect(r.accepted).toBe(true);
    expect(r.decision).toEqual(dd);
  });

  it('负向：改派 commander 自身仍拒绝', async () => {
    const exec = createCommanderDirectiveExecutor(deps());
    const r = await exec.execute({
      directive: directive({ action: 'dispatch_role', target_role: 'commander' }),
      defaultDecision: waitReview,
      validation: validation({ phase: 'review' }),
    });
    expect(r.accepted).toBe(false);
  });
});
