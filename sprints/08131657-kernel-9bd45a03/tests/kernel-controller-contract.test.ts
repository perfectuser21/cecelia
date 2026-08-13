/**
 * TDD Red 基线 — 真身 Session Controller（sprint 08131657，issue run 8783807c）
 *
 * 本文件是合同 Golden Path 的纯函数红证据（无需 Postgres 即红）：新模块
 * `packages/brain/src/lib/kernel-controller.js` 尚不存在 → import 直接抛 → 全红。
 *
 * DB 触达的接缝（renewControllerLease / assertControllerPushAllowed /
 * finalizeControllerExit / 真身 spawn identity）由两份已登记的真 PG 集成测试
 * （kernel-controller-lifecycle.pg / kernel-controller-ownership.pg）承接，禁 mock
 * 被改的边（真 PG、真 createKernelRun、真 finalizeKernelRun）——见 contract-dod.md
 * 「## 禁 mock 边清单」。generator 实现后本文件转绿，永久留 CI 作回归。
 */
import { describe, it, expect } from 'vitest';
import {
  deriveControllerSessionId,
  classifyKernelFailure,
  decideFatalAction,
  isHumanReviewPushFrozen,
  CONTROLLER_SESSION_PREFIX,
} from '../../../packages/brain/src/lib/kernel-controller.js';

describe('kernel-controller 真身身份 [BEHAVIOR]', () => {
  it('deriveControllerSessionId 返回真实进程身份而非裸 randomUUID', () => {
    const sid = deriveControllerSessionId({ pid: 4242, host: 'us-mac-m4' });
    // 真身身份带前缀 + 真实 pid + host，可反查进程；不再是 harness-skill-relay.js:241 的 randomUUID()
    expect(typeof sid).toBe('string');
    expect(sid.startsWith(CONTROLLER_SESSION_PREFIX)).toBe(true);
    expect(sid).toContain('4242');
    expect(sid).toContain('us-mac-m4');
    // 断言不是 8-4-4-4-12 的裸 UUID 形态（真身身份必须可反查，UUID 不可反查进程）
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sid)).toBe(false);
  });
});

describe('kernel-controller failure_class 决策 [BEHAVIOR]', () => {
  it('classifyKernelFailure：assembly/合同失效类 = unrecoverable', () => {
    expect(classifyKernelFailure('dependency_assembly_failed')).toBe('unrecoverable');
    expect(classifyKernelFailure('assembly_fault')).toBe('unrecoverable');
    expect(classifyKernelFailure('contract_invalid')).toBe('unrecoverable');
  });

  it('classifyKernelFailure：进程崩溃/瞬时基础设施类 = recoverable', () => {
    expect(classifyKernelFailure('kernel_process_sigkill')).toBe('recoverable');
    expect(classifyKernelFailure('transient_infra_timeout')).toBe('recoverable');
  });

  it('decideFatalAction：可恢复且未超上限 → resume', () => {
    const d = decideFatalAction({ failureClass: 'recoverable', resumeCount: 0, maxResume: 3 });
    expect(d.action).toBe('resume');
  });

  it('decideFatalAction：可恢复但已到上限 → terminate（对齐 orphan_requeue_count 烧到 3）', () => {
    const d = decideFatalAction({ failureClass: 'recoverable', resumeCount: 3, maxResume: 3 });
    expect(d.action).toBe('terminate');
  });

  it('decideFatalAction：不可恢复类一律 terminate', () => {
    const d = decideFatalAction({ failureClass: 'unrecoverable', resumeCount: 0, maxResume: 3 });
    expect(d.action).toBe('terminate');
  });
});

describe('kernel-controller 人审 push 冻结谓词 [BEHAVIOR]', () => {
  it('isHumanReviewPushFrozen：run 处于 human_review 时冻结 push', () => {
    expect(isHumanReviewPushFrozen({ phase: 'human_review' })).toBe(true);
  });

  it('isHumanReviewPushFrozen：非人审期不冻结', () => {
    expect(isHumanReviewPushFrozen({ phase: 'generate' })).toBe(false);
    expect(isHumanReviewPushFrozen({ phase: 'done' })).toBe(false);
  });
});
