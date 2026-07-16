/**
 * theater-mismatch-contract.test.js — 戏院错配闸合同测试（failing test 先行）
 *
 * Sprint: 建制W6（sprints/07161900-theater-mismatch-gate）
 * Task: b317ae29-9fbc-4d6f-abf0-016141d6c657
 *
 * 此文件是 contract-dod.md [BEHAVIOR] 条目的自动化对齐测试。
 * 真正的完整测试套件在 packages/brain/src/__tests__/harness-judge-theater.test.js。
 *
 * 在实现 harness-judge.js 新增两闸之前，所有 theater_mismatch 和
 * meta_verification_gap 断言应当 FAIL（TDD failing 状态）。
 */

import { describe, it, expect } from 'vitest';
import { runMechanicalGate } from '../../../packages/brain/src/harness-judge.js';

function makeDeps({ prdContent = '', contractContent = '', env = 'local_api' } = {}) {
  return {
    readFileFn: async (p) => {
      if (String(p).includes('sprint-prd')) return prdContent;
      if (String(p).includes('contract')) return contractContent;
      throw new Error('ENOENT');
    },
    listTestFilesFn: async () => ['a.test.ts'],
    dbPool: {
      query: async () => ({ rows: [{ target_environment: env }] }),
    },
  };
}

describe('Contract: 戏院错配闸 theater_mismatch', () => {
  it('TC-01: GP 含「微信真机发送」+ local_api → theater_mismatch FAIL', async () => {
    const ctx = {
      taskId: 'contract-tc01',
      worktreePath: '/tmp',
      sprintDir: 'test-sprint-tc01',
      brainResult: {
        verdict: 'PASS',
        behavior_tests: [{ command: 'npm test', exit_code: 0, log_tail: 'pass' }],
      },
    };
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. 微信真机发送消息\n',
      contractContent: '[BEHAVIOR] 发送微信消息\nTest: adb shell send',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    // FAILING: 实现前 pass 应为 true，这里断言 false 会 FAIL（TDD 预期）
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/theater_mismatch/);
  });

  it('TC-03: GP 含 adb + mac_web → theater_mismatch FAIL', async () => {
    const ctx = {
      taskId: 'contract-tc03',
      worktreePath: '/tmp',
      sprintDir: 'test-sprint-tc03',
      brainResult: {
        verdict: 'PASS',
        behavior_tests: [{ command: 'adb test', exit_code: 0, log_tail: 'pass' }],
      },
    };
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. adb shell 截图\n',
      contractContent: '[BEHAVIOR] adb screenshot',
      env: 'mac_web',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/theater_mismatch/);
  });
});

describe('Contract: 元验证补丁 meta_verification_gap', () => {
  it('TC-04: smoke 类标题 + contract 无 L3 断言 → meta_verification_gap FAIL', async () => {
    const ctx = {
      taskId: 'contract-tc04',
      worktreePath: '/tmp',
      sprintDir: 'test-sprint-tc04',
      brainResult: {
        verdict: 'PASS',
        behavior_tests: [{ command: 'curl', exit_code: 0, log_tail: 'ok' }],
      },
    };
    const deps = makeDeps({
      prdContent: '# Sprint PRD — smoke 验证脚本演习\n\n## Golden Path\n\n1. 验证脚本执行\n',
      contractContent: '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    // FAILING: 实现前 pass 应为 true，断言 false 会 FAIL（TDD 预期）
    expect(result.pass).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/meta_verification_gap/);
  });

  it('TC-05: smoke 类 PRD + contract 含 verification_level: L3 → 不误判', async () => {
    const ctx = {
      taskId: 'contract-tc05',
      worktreePath: '/tmp',
      sprintDir: 'test-sprint-tc05',
      brainResult: {
        verdict: 'PASS',
        behavior_tests: [{ command: 'adb check', exit_code: 0, log_tail: 'pass' }],
      },
    };
    const deps = makeDeps({
      prdContent: '# 验证脚本演习\n\n## Golden Path\n\n1. 真机验证\n',
      contractContent: '[BEHAVIOR] adb check\nverification_level: L3\nTest: manual:adb check',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.reasons.join(' ')).not.toMatch(/meta_verification_gap/);
  });
});

describe('Contract: 回归保护 — 正常合同不误伤', () => {
  it('TC-06: 正常 local_api 服务端合同 → pass:true', async () => {
    const ctx = {
      taskId: 'contract-tc06',
      worktreePath: '/tmp',
      sprintDir: 'test-sprint-tc06',
      brainResult: {
        verdict: 'PASS',
        behavior_tests: [{ command: 'npm test', exit_code: 0, log_tail: 'all pass' }],
      },
    };
    const deps = makeDeps({
      prdContent: '## Golden Path\n\n1. 调用 API 返回 200\n2. 响应含 status: ok\n',
      contractContent: '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api',
      env: 'local_api',
    });

    const result = await runMechanicalGate(ctx, deps);

    expect(result.pass).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });
});
