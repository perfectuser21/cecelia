/**
 * 刀B — judge API 机械校验 failing tests（TDD）
 * 验证三项机械预检在 runJudgeGate 或 judge 路由中优先于 AI 裁判运行：
 *   1. behavior_tests 为空 → FAIL 打回
 *   2. verdict 缺 exit_code+log_tail → FAIL 打回
 *   3. judgments_written 声明数与 decisions 表回读数对不上 → FAIL 打回
 */
import { describe, it, expect } from 'vitest';
import {
  runMechanicalPreflightChecks,
  checkJudgmentsWritten,
} from '../harness-judge.js';

describe('runMechanicalPreflightChecks', () => {
  it('behavior_tests 为 null → FAIL + mechFail=no_behavior_tests', () => {
    const result = runMechanicalPreflightChecks({ exit_code: 0, log_tail: 'ok' });
    expect(result).not.toBeNull();
    expect(result.verdict).toBe('FAIL');
    expect(result.mechFail).toBe('no_behavior_tests');
  });

  it('behavior_tests 为空数组 → FAIL + mechFail=no_behavior_tests', () => {
    const result = runMechanicalPreflightChecks({ behavior_tests: [], exit_code: 0, log_tail: 'ok' });
    expect(result).not.toBeNull();
    expect(result.verdict).toBe('FAIL');
    expect(result.mechFail).toBe('no_behavior_tests');
  });

  it('exit_code 为 null → FAIL + mechFail=missing_exit_code', () => {
    const result = runMechanicalPreflightChecks({ behavior_tests: ['t1'], log_tail: 'ok' });
    expect(result).not.toBeNull();
    expect(result.verdict).toBe('FAIL');
    expect(result.mechFail).toBe('missing_exit_code');
  });

  it('log_tail 为空字符串 → FAIL + mechFail=missing_log_tail', () => {
    const result = runMechanicalPreflightChecks({ behavior_tests: ['t1'], exit_code: 0, log_tail: '' });
    expect(result).not.toBeNull();
    expect(result.verdict).toBe('FAIL');
    expect(result.mechFail).toBe('missing_log_tail');
  });

  it('log_tail 缺失 → FAIL + mechFail=missing_log_tail', () => {
    const result = runMechanicalPreflightChecks({ behavior_tests: ['t1'], exit_code: 0 });
    expect(result).not.toBeNull();
    expect(result.verdict).toBe('FAIL');
    expect(result.mechFail).toBe('missing_log_tail');
  });

  it('所有字段合法 → null（通过）', () => {
    const result = runMechanicalPreflightChecks({
      behavior_tests: ['test_foo_pass'],
      exit_code: 0,
      log_tail: '1 passing',
    });
    expect(result).toBeNull();
  });

  it('exit_code=0（数字零）→ 视为合法', () => {
    const result = runMechanicalPreflightChecks({
      behavior_tests: ['t1'],
      exit_code: 0,
      log_tail: 'ok',
    });
    expect(result).toBeNull();
  });

  it('brainResult 为 null → FAIL（视为 behavior_tests 缺失）', () => {
    const result = runMechanicalPreflightChecks(null);
    expect(result).not.toBeNull();
    expect(result.verdict).toBe('FAIL');
  });
});

describe('checkJudgmentsWritten', () => {
  it('judgments_written 未声明 → null（跳过）', async () => {
    const fakePool = { query: () => Promise.resolve({ rows: [{ cnt: 5 }] }) };
    const result = await checkJudgmentsWritten({}, 'task-1', fakePool);
    expect(result).toBeNull();
  });

  it('judgments_written=2，DB 返回 2 → null（匹配）', async () => {
    const fakePool = { query: () => Promise.resolve({ rows: [{ cnt: 2 }] }) };
    const result = await checkJudgmentsWritten({ judgments_written: 2 }, 'task-1', fakePool);
    expect(result).toBeNull();
  });

  it('judgments_written=3，DB 返回 2 → FAIL + mechFail=judgments_written_mismatch', async () => {
    const fakePool = { query: () => Promise.resolve({ rows: [{ cnt: 2 }] }) };
    const result = await checkJudgmentsWritten({ judgments_written: 3 }, 'task-1', fakePool);
    expect(result).not.toBeNull();
    expect(result.verdict).toBe('FAIL');
    expect(result.mechFail).toBe('judgments_written_mismatch');
    expect(result.feedback).toContain('3');
    expect(result.feedback).toContain('2');
  });

  it('DB 查询失败 → null（保守跳过，不 fail）', async () => {
    const fakePool = { query: () => Promise.reject(new Error('connection error')) };
    const result = await checkJudgmentsWritten({ judgments_written: 1 }, 'task-1', fakePool);
    expect(result).toBeNull();
  });

  it('judgments_written=0，DB 返回 0 → null（零声明零实际，合法）', async () => {
    const fakePool = { query: () => Promise.resolve({ rows: [{ cnt: 0 }] }) };
    const result = await checkJudgmentsWritten({ judgments_written: 0 }, 'task-1', fakePool);
    expect(result).toBeNull();
  });
});
