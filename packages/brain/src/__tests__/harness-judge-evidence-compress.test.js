/**
 * harness-judge-evidence-compress.test.js
 *
 * TDD Red→Green 测试：验证 compressBrainResult 修复 brainResult 截断误判问题。
 *
 * Task ID: ea20ba86-9ce4-4fbf-84cd-987a8b3f5ba6
 * Sprint: sprints/07151610-judge-evidence-truncation
 *
 * BEHAVIOR 覆盖：
 *   BEHAVIOR-1  截断复现（用旧逻辑直接验证 bug）
 *   BEHAVIOR-2  修复后 KEYMARK 可见（核心回归测试）
 *   BEHAVIOR-3  条目上限：10 条输入只展开前 8 条
 *   BEHAVIOR-4  单条超长 log_tail 截断标记
 *   BEHAVIOR-5  总长度预算 ≤ 6000 字符
 *   BEHAVIOR-6  既有接口不变（buildJudgePrompt 包含 KEYMARK）
 *   BEHAVIOR-7  compressBrainResult 命名导出可用
 */

import { describe, it, expect } from 'vitest';
import { buildJudgePrompt, compressBrainResult } from '../harness-judge.js';

// 构造标准的 dod/gp stub（让 buildJudgePrompt 可以调用）
function makeMeta() {
  return {
    contractText: 'stub contract',
    contractE2E: 'stub e2e',
    gpLines: 'GP-1: step1',
    agentVerdict: 'PASS',
    transcript: '',
    agentStdout: '',
  };
}

// ─────────────────────────────────────────────
// BEHAVIOR-1: 截断复现
// 验证：behavior_tests[1].log_tail 含 KEYMARK，
// 但 behavior_tests[0].log_tail 超长时，旧截断逻辑会把 KEYMARK 挤出去。
// 这个 it() 在 Red 阶段应该 PASS（它只是记录旧 bug 存在的事实）。
// ─────────────────────────────────────────────
describe('[BEHAVIOR-1] 截断复现（旧逻辑 bug 记录）', () => {
  it('旧截断逻辑：behavior_tests[1].log_tail 的 KEYMARK 被挤出 2000 字符外', () => {
    const brainResult = {
      behavior_tests: [
        { command: 'test1', exit_code: 0, log_tail: 'A'.repeat(2000) },
        { command: 'test2', exit_code: 0, log_tail: 'PREFIX_KEYMARK_SUFFIX' },
      ],
    };
    // 用旧逻辑复现 bug
    const oldSerialized = JSON.stringify(brainResult).slice(0, 2000);
    // 断言旧逻辑确实丢失了 KEYMARK（KEYMARK 在 2000 字符之后）
    expect(oldSerialized.includes('KEYMARK')).toBe(false);
  });
});

// ─────────────────────────────────────────────
// BEHAVIOR-2: 修复后 KEYMARK 可见（核心回归测试）
// Red 阶段：compressBrainResult 未实现或未注入，此测试 FAIL
// Green 阶段：compressBrainResult 实现后，此测试 PASS
// ─────────────────────────────────────────────
describe('[BEHAVIOR-2] 修复后 KEYMARK 可见', () => {
  it('compressBrainResult：behavior_tests[1].log_tail 的 KEYMARK 必须可见', () => {
    const brainResult = {
      behavior_tests: [
        { command: 'test1', exit_code: 0, log_tail: 'A'.repeat(2000) },
        { command: 'test2', exit_code: 0, log_tail: 'PREFIX_KEYMARK_SUFFIX' },
      ],
    };
    const compressed = compressBrainResult(brainResult);
    expect(compressed).toContain('KEYMARK');
  });

  it('buildJudgePrompt：prompt 中包含 behavior_tests[0] 和 [1] 的 command', () => {
    const brainResult = {
      behavior_tests: [
        { command: 'test1', exit_code: 0, log_tail: 'A'.repeat(2000) },
        { command: 'test2', exit_code: 0, log_tail: 'PREFIX_KEYMARK_SUFFIX' },
      ],
    };
    const meta = makeMeta();
    const prompt = buildJudgePrompt(meta, brainResult);
    expect(prompt).toContain('test1');
    expect(prompt).toContain('test2');
    expect(prompt).toContain('KEYMARK');
  });
});

describe('冻结合同测试进入独立裁判证据', () => {
  it('prompt carries the exact approved test path, digest, and source', () => {
    const prompt = buildJudgePrompt({
      ...makeMeta(),
      frozenContractArtifacts: [{
        type: 'frozen_contract_test',
        path: 'sprints/example/tests/red.test.js',
        content: 'FROZEN_RED_ORACLE',
        sha256: 'a'.repeat(64),
        source_sha: 'b'.repeat(40),
      }],
    });

    expect(prompt).toContain('sprints/example/tests/red.test.js');
    expect(prompt).toContain('FROZEN_RED_ORACLE');
    expect(prompt).toContain('a'.repeat(64));
    expect(prompt).toContain('b'.repeat(40));
  });
});

// ─────────────────────────────────────────────
// BEHAVIOR-3: 条目上限：10 条输入只展开前 8 条
// ─────────────────────────────────────────────
describe('[BEHAVIOR-3] 条目上限：10 条输入只展开前 8 条', () => {
  it('前 8 条展开，第 9/10 条不展开，含「另有 2 条已省略」', () => {
    const brainResult = {
      behavior_tests: Array(10)
        .fill(null)
        .map((_, i) => ({ command: `cmd-${i}`, exit_code: 0, log_tail: 'short' })),
    };
    const compressed = compressBrainResult(brainResult);
    expect(compressed).toContain('cmd-0');
    expect(compressed).toContain('cmd-7');
    expect(compressed).not.toContain('cmd-8');
    expect(compressed).not.toContain('cmd-9');
    expect(compressed).toContain('另有 2 条已省略');
  });
});

// ─────────────────────────────────────────────
// BEHAVIOR-4: 单条超长 log_tail 截断标记
// ─────────────────────────────────────────────
describe('[BEHAVIOR-4] 单条超长 log_tail 截断标记', () => {
  it('log_tail 超 600 字符时，截至 600 字符并追加「…（已截断）」', () => {
    const brainResult = {
      behavior_tests: [{ command: 'test', exit_code: 0, log_tail: 'X'.repeat(800) }],
    };
    const compressed = compressBrainResult(brainResult);
    expect(compressed).toContain('…（已截断）');
    // 验证截断后 log_tail 的 X 不超过 600 个
    const xMatch = compressed.match(/X+/);
    if (xMatch) {
      expect(xMatch[0].length).toBeLessThanOrEqual(600);
    }
  });
});

// ─────────────────────────────────────────────
// BEHAVIOR-5: 总长度预算 ≤ 6000 字符
// ─────────────────────────────────────────────
describe('[BEHAVIOR-5] 总长度预算 ≤ 6000 字符', () => {
  it('最大压力输入下 compressBrainResult 输出长度不超过 6000', () => {
    const brainResult = {
      verdict: 'FAIL',
      exit_code: 1,
      log_tail: 'T'.repeat(600),
      behavior_tests: Array(8)
        .fill(null)
        .map((_, i) => ({
          command: 'C'.repeat(300),
          exit_code: 1,
          log_tail: 'L'.repeat(800),
        })),
    };
    const compressed = compressBrainResult(brainResult);
    expect(compressed.length).toBeLessThanOrEqual(6000);
  });
});

// ─────────────────────────────────────────────
// BEHAVIOR-7: compressBrainResult 命名导出可用
// ─────────────────────────────────────────────
describe('[BEHAVIOR-7] compressBrainResult 命名导出可用', () => {
  it('compressBrainResult 是从 harness-judge.js 导出的函数', () => {
    expect(typeof compressBrainResult).toBe('function');
  });

  it('null/undefined brainResult 不崩溃，返回字符串', () => {
    expect(() => compressBrainResult(null)).not.toThrow();
    expect(typeof compressBrainResult(null)).toBe('string');
    expect(() => compressBrainResult(undefined)).not.toThrow();
  });
});
