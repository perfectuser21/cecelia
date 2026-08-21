// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：merge 主权唯一性（kernel fence ↔ shepherd 收口器）
//
// 2026-08-22 生产实证（r42 run f44bdef7 / PR #5012）：shepherd 在 CI 绿 + MERGEABLE 时
// 对所有带 pr_url 的任务 executeMerge；其 kernel 豁免条件只认旧 LangGraph 时代的
// payload.harness_mode 字段，kernel-v1 任务（task_type=harness_initiative，
// payload.harness_runtime='kernel-v1'，无 harness_mode）漏网 → capability-change
// 的 merge fence（人批闸）被整个旁路，run 还在 wait:poll_ci 时 PR 已被合。
// 修法：SQL 过滤加 task_type 排除 + JS 行级谓词 isKernelSovereignTask 双保险，
// merge 主权唯一归 kernel merge_pr。
import { describe, expect, it } from 'vitest';
import {
  isKernelSovereignTask,
  SHEPHERD_KERNEL_EXEMPT_SQL,
} from '../../../packages/brain/src/shepherd.js';

describe('F1 step3：shepherd 不得对 kernel 主权任务 auto-merge（r42 案卷）', () => {
  it('kernel-v1 任务（task_type=harness_initiative）判为主权任务', () => {
    expect(isKernelSovereignTask({
      task_type: 'harness_initiative',
      payload: { harness_runtime: 'kernel-v1' },
    })).toBe(true);
  });

  it('仅凭 payload.harness_runtime=kernel-v1 也判主权（task_type 缺失的防御）', () => {
    expect(isKernelSovereignTask({
      payload: { harness_runtime: 'kernel-v1' },
    })).toBe(true);
  });

  it('旧 LangGraph harness_mode 任务仍判主权（原豁免不回退）', () => {
    expect(isKernelSovereignTask({ payload: { harness_mode: 'true' } })).toBe(true);
    expect(isKernelSovereignTask({ payload: { harness_mode: 't' } })).toBe(true);
  });

  it('普通 dev 任务不受影响（shepherd 照常收口）', () => {
    expect(isKernelSovereignTask({ task_type: 'dev', payload: {} })).toBe(false);
    expect(isKernelSovereignTask({ payload: null })).toBe(false);
    expect(isKernelSovereignTask({})).toBe(false);
  });

  it('SQL 过滤片段排除 harness_initiative（第一道防线在查询层）', () => {
    expect(SHEPHERD_KERNEL_EXEMPT_SQL).toMatch(/task_type/);
    expect(SHEPHERD_KERNEL_EXEMPT_SQL).toMatch(/harness_initiative/);
  });
});
