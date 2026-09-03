// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：judge 机械闸 × V4 封印合同产物
//
// r39（run 2se9fh，attempt aaacb09b）案卷：judge 走 Brain API 时 authority worktree
// 回落 kernel 默认路径（V4 锚 task 无 worktree_path，候选文件在桥接工作区）→ 文件扫描
// 必零；docs-only 合同的 DoD 用 [ARTIFACT] 条目 → [BEHAVIOR] 计数也零 → 机械闸②双零
// FAIL（contract_tests=0），而同一 judge 亲手重跑冻结测试 6/6 全过——自相矛盾误杀。
//
// 修（决策 44f8cc31）：机械闸② testCount=0 时认 ctx.frozenContractArtifacts 中
// sprint tests/ 路径的封印产物计数。封印集在 ground-truth 装载时已过
// validateContractArtifacts({requireTests:true}) + seal 对账——密封证据即测试存在性
// 证明，不依赖 judge 宿主的文件系统。
//
// 真 import 被改模块 harness-judge.js（守卫在边上），不 mock 它。
import { describe, it, expect, vi } from 'vitest';
import { runMechanicalGate } from '../../../packages/brain/src/harness-judge.js';

function v4Ctx(overrides = {}) {
  return {
    taskId: 'task-2se9fh',
    worktreePath: '/nonexistent/kernel-default-worktree',
    sprintDir: 'sprints/coding-harness-20260903033320-2se9fh',
    brainResult: {
      verdict: 'PASS',
      behavior_tests: [{ command: 'npx vitest run', exit_code: 0, log_tail: 'Tests 6 passed (6)' }],
    },
    // docs-only 合同：DoD 是 [ARTIFACT] 条目，无任何 [BEHAVIOR] 行
    contractText: '# Sprint Contract Draft\n- [ ] [ARTIFACT] 中文说明文档存在且引用冻结 task_request_hash',
    ...overrides,
  };
}

// 宿主文件系统一无所有（复刻 kernel 默认 worktree 空扫描）
function emptyFsDeps() {
  return {
    listTestFilesFn: vi.fn(async () => []),
    readFileFn: vi.fn(async () => { throw new Error('ENOENT'); }),
    dbPool: { query: vi.fn(async (sql) => {
      if (/FROM tasks/.test(sql)) return { rows: [{ target_environment: 'local_api' }] };
      return { rows: [] };
    }) },
  };
}

describe('F1 step3 — judge 机械闸认封印测试产物（r39 契约）', () => {
  it('文件扫描零 + [ARTIFACT] 型 DoD，但封印集含 tests/ 条目 → 不误判 contract_tests=0', async () => {
    const ctx = v4Ctx({
      frozenContractArtifacts: [
        {
          path: 'sprints/coding-harness-20260903033320-2se9fh/contract-draft.md',
          content: '# draft', sha256: 'a'.repeat(64), source_revision: 'b'.repeat(40),
        },
        {
          path: 'sprints/coding-harness-20260903033320-2se9fh/tests/attempt-run-bridge.test.ts',
          content: 'test body', sha256: 'c'.repeat(64), source_revision: 'b'.repeat(40),
        },
      ],
    });
    const r = await runMechanicalGate(ctx, emptyFsDeps());
    expect(r.reasons.join()).not.toMatch(/contract_tests/);
    expect(r.pass).toBe(true);
  });

  it('封印集只有文档没有 tests/ 条目 → 仍判 contract_tests=0（密封证据不含测试不放行）', async () => {
    const ctx = v4Ctx({
      frozenContractArtifacts: [
        {
          path: 'sprints/coding-harness-20260903033320-2se9fh/contract-draft.md',
          content: '# draft', sha256: 'a'.repeat(64), source_revision: 'b'.repeat(40),
        },
      ],
    });
    const r = await runMechanicalGate(ctx, emptyFsDeps());
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/contract_tests/);
  });

  it('封印集缺席（kernel 旧路径）→ 行为不变：双零仍 FAIL', async () => {
    const r = await runMechanicalGate(v4Ctx(), emptyFsDeps());
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/contract_tests/);
  });

  it('tests/ 条目路径不在 sprint 目录下（越界路径）→ 不计入，仍 FAIL', async () => {
    const ctx = v4Ctx({
      frozenContractArtifacts: [
        {
          path: 'other-sprint/tests/foo.test.ts',
          content: 'x', sha256: 'c'.repeat(64), source_revision: 'b'.repeat(40),
        },
      ],
    });
    const r = await runMechanicalGate(ctx, emptyFsDeps());
    expect(r.pass).toBe(false);
    expect(r.reasons.join()).toMatch(/contract_tests/);
  });
});
