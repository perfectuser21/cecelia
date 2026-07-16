/**
 * harness-judge-level.test.js
 *
 * Sprint 07161400-pass-at-level-judge
 * TASK_ID: 750f5f5b-401a-4379-91c0-948a30327271
 *
 * 测试覆盖：
 *   ① 构造 L3 声明 + 纯 curl 证据 → 现版本 PASS（RED failing test，修复前应失败此断言）
 *   ② 修复后：L3 + 纯 curl → FAIL mechFail=level_evidence_mismatch
 *   ③ 存量无等级标记 → 行为不变（兼容回归）
 *   ④ L3 + 真机指纹关键词 → PASS（不过度拦截）
 *   ⑤ 条目级 verification_level 优先于顶层
 *   ⑥ curl 混合设备路径关键词 → PASS（边界）
 *
 * 注意：禁止 mock runMechanicalPreflightChecks 内部路径，必须调用真实函数。
 * CI 永久留存，回归防护。
 */

import { describe, it, expect } from 'vitest';
import { runMechanicalPreflightChecks } from '../harness-judge.js';

// ── 工具函数 ─────────────────────────────────────────────────────────────────

function makeL3CurlBrainResult(overrides = {}) {
  return {
    verdict: 'PASS',
    exit_code: 0,
    log_tail: 'curl http://localhost:5221/health → 200 OK',
    verification_level: 'L3',
    behavior_tests: [
      {
        command: 'curl http://localhost:5221/api/brain/tasks',
        exit_code: 0,
        log_tail: 'curl http://localhost:5221/api/brain/tasks\n{"tasks":[]}',
      },
    ],
    ...overrides,
  };
}

function makeLegacyBrainResult(overrides = {}) {
  // 存量格式：无 verification_level 字段
  return {
    verdict: 'PASS',
    exit_code: 0,
    log_tail: 'npm test\n✓ all tests passed',
    behavior_tests: [
      {
        command: 'npm test',
        exit_code: 0,
        log_tail: '✓ 3 tests passed',
      },
    ],
    ...overrides,
  };
}

// ── 测试套件 ─────────────────────────────────────────────────────────────────

describe('harness-judge-level：PASS@L 分级判定', () => {

  /**
   * ① RED FAILING TEST（修复前）
   *
   * 当前 runMechanicalPreflightChecks 无等级校验：
   * L3 声明 + 纯 curl 证据 → 当前版本返回 null（PASS），这是要修复的漏洞。
   *
   * 本测试描述"修复后期望"：FAIL mechFail=level_evidence_mismatch。
   * 修复前跑此测试会 RED（返回 null 而非 FAIL 对象）。
   */
  it('[RED] L3 声明 + 纯 curl 证据 → 修复后应 FAIL mechFail=level_evidence_mismatch', () => {
    const brainResult = makeL3CurlBrainResult();
    const result = runMechanicalPreflightChecks(brainResult);

    // 修复后期望：返回 FAIL 对象，mechFail=level_evidence_mismatch
    // 修复前此断言会 FAIL（因为当前版本返回 null）
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      verdict: 'FAIL',
      mechFail: 'level_evidence_mismatch',
    });
    expect(result.feedback).toMatch(/L3|level|evidence|真机|指纹/i);
  });

  /**
   * ① RED 补充：顶层 verification_level:'L3' + behavior_tests log_tail 纯 vitest 输出
   */
  it('[RED] L3 声明 + 纯 vitest 输出 → 修复后应 FAIL mechFail=level_evidence_mismatch', () => {
    const brainResult = makeL3CurlBrainResult({
      behavior_tests: [
        {
          command: 'npx vitest run',
          exit_code: 0,
          log_tail: '✓ harness-judge.test.js (5)\nTest Files  1 passed (1)',
        },
      ],
    });
    const result = runMechanicalPreflightChecks(brainResult);

    expect(result).not.toBeNull();
    expect(result?.mechFail).toBe('level_evidence_mismatch');
  });

  /**
   * ③ 兼容回归：存量 brainResult 无 verification_level → 行为不变，不 FAIL
   */
  it('兼容回归：存量无 verification_level 字段 → 返回 null（不 FAIL）', () => {
    const brainResult = makeLegacyBrainResult();
    const result = runMechanicalPreflightChecks(brainResult);

    // 存量格式不得因缺失 verification_level 而 FAIL
    expect(result).toBeNull();
  });

  it('兼容回归：verification_level 缺失 + behavior_tests 正常 → null', () => {
    const brainResult = {
      verdict: 'PASS',
      exit_code: 0,
      log_tail: 'some output',
      behavior_tests: [
        { command: 'npm test', exit_code: 0, log_tail: 'Tests: 3 passed' },
      ],
      // 无 verification_level
    };
    expect(runMechanicalPreflightChecks(brainResult)).toBeNull();
  });

  /**
   * ④ 真机指纹关键词：L3 + adb shell → PASS（不过度拦截）
   */
  it('真机指纹：L3 + adb shell 输出 → 返回 null（PASS）', () => {
    const brainResult = makeL3CurlBrainResult({
      behavior_tests: [
        {
          command: 'adb shell dumpsys activity',
          exit_code: 0,
          log_tail: 'adb shell dumpsys activity\ncom.example.app/.MainActivity RESUMED',
        },
      ],
    });
    expect(runMechanicalPreflightChecks(brainResult)).toBeNull();
  });

  it('真机指纹：L3 + UiSelector 输出 → 返回 null（PASS）', () => {
    const brainResult = makeL3CurlBrainResult({
      behavior_tests: [
        {
          command: 'python uiautomator_test.py',
          exit_code: 0,
          log_tail: 'UiSelector(text="登录") found\nAccessibilityNodeInfo[clickable=true]',
        },
      ],
    });
    expect(runMechanicalPreflightChecks(brainResult)).toBeNull();
  });

  it('真机指纹：L3 + 截图绝对路径 → 返回 null（PASS）', () => {
    const brainResult = makeL3CurlBrainResult({
      behavior_tests: [
        {
          command: 'take_screenshot',
          exit_code: 0,
          screenshot: '/data/screenshots/result_20260716.png',
          log_tail: 'Screenshot saved to /data/screenshots/result_20260716.png',
        },
      ],
    });
    expect(runMechanicalPreflightChecks(brainResult)).toBeNull();
  });

  it('真机指纹：L3 + /sdcard/ 设备路径 → 返回 null（PASS）', () => {
    const brainResult = makeL3CurlBrainResult({
      behavior_tests: [
        {
          command: 'adb pull /sdcard/log.txt',
          exit_code: 0,
          log_tail: 'pull /sdcard/log.txt → local/log.txt 1 file pulled',
        },
      ],
    });
    expect(runMechanicalPreflightChecks(brainResult)).toBeNull();
  });

  /**
   * ⑤ 条目级 verification_level 优先于顶层
   */
  it('条目级优先：顶层 L2 + 条目 L3 + 纯 curl → 按条目 L3 执法 → FAIL', () => {
    const brainResult = {
      verdict: 'PASS',
      exit_code: 0,
      log_tail: 'npm test passed',
      verification_level: 'L2', // 顶层 L2
      behavior_tests: [
        {
          command: 'curl localhost:5221/health',
          exit_code: 0,
          log_tail: 'curl localhost:5221/health → 200',
          verification_level: 'L3', // 条目级 L3 应被执法
        },
      ],
    };
    const result = runMechanicalPreflightChecks(brainResult);

    expect(result).not.toBeNull();
    expect(result?.mechFail).toBe('level_evidence_mismatch');
  });

  it('条目级优先：顶层 L3 + 条目无标记 + 纯 curl → 按顶层 L3 执法 → FAIL', () => {
    const brainResult = {
      verdict: 'PASS',
      exit_code: 0,
      log_tail: 'curl output',
      verification_level: 'L3', // 顶层 L3
      behavior_tests: [
        {
          command: 'curl localhost:5221/health',
          exit_code: 0,
          log_tail: 'curl localhost:5221/health\n{"status":"ok"}',
          // 无条目级 verification_level，继承顶层 L3
        },
      ],
    };
    const result = runMechanicalPreflightChecks(brainResult);

    expect(result).not.toBeNull();
    expect(result?.mechFail).toBe('level_evidence_mismatch');
  });

  it('条目级优先：顶层 L3 + 条目明确 L2 → 条目按 L2 通过（不 FAIL）', () => {
    const brainResult = {
      verdict: 'PASS',
      exit_code: 0,
      log_tail: 'some output',
      verification_level: 'L3', // 顶层 L3
      behavior_tests: [
        {
          command: 'npm test',
          exit_code: 0,
          log_tail: '3 tests passed',
          verification_level: 'L2', // 条目明确降级到 L2，不应被 L3 执法
        },
      ],
    };
    // L2 条目不要求真机指纹
    expect(runMechanicalPreflightChecks(brainResult)).toBeNull();
  });

  /**
   * ⑥ curl 混合设备路径关键词 → PASS（边界，不过度拦截）
   * PRD 边界情况：log_tail 含 "curl" 前缀但同时含设备路径关键词 → 判 PASS
   */
  it('curl混合设备路径：curl 前缀 + /data/ 设备路径 → 返回 null（不拦截）', () => {
    const brainResult = makeL3CurlBrainResult({
      behavior_tests: [
        {
          command: 'curl adb://device/data/app/log.txt',
          exit_code: 0,
          log_tail: 'curl 从设备拉取日志\npath=/data/app/com.example/log.txt\nsize=1024',
        },
      ],
    });
    expect(runMechanicalPreflightChecks(brainResult)).toBeNull();
  });

  /**
   * 基础机械预检兼容性：原有三项预检不受影响
   */
  it('基础兼容：behavior_tests 为空 → 原 no_behavior_tests FAIL（不受等级逻辑干扰）', () => {
    const result = runMechanicalPreflightChecks({ verdict: 'PASS', exit_code: 0, log_tail: 'ok', behavior_tests: [] });
    expect(result?.mechFail).toBe('no_behavior_tests');
  });

  it('基础兼容：缺 exit_code → 原 missing_exit_code FAIL', () => {
    const result = runMechanicalPreflightChecks({
      verdict: 'PASS',
      log_tail: 'ok',
      behavior_tests: [{ command: 'x', exit_code: 0, log_tail: 'ok' }],
    });
    expect(result?.mechFail).toBe('missing_exit_code');
  });

  it('基础兼容：缺 log_tail → 原 missing_log_tail FAIL', () => {
    const result = runMechanicalPreflightChecks({
      verdict: 'PASS',
      exit_code: 0,
      log_tail: '',
      behavior_tests: [{ command: 'x', exit_code: 0, log_tail: 'ok' }],
    });
    expect(result?.mechFail).toBe('missing_log_tail');
  });
});
