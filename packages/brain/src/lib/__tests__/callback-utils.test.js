import { describe, it, expect } from 'vitest';
import {
  normalizeCallbackStatus,
  extractPrNumber,
  extractFindingsValue,
  buildExecMetaJson,
  buildFailureFields,
} from '../callback-utils.js';

describe('callback-utils', () => {
  describe('normalizeCallbackStatus', () => {
    it('maps AI Done → completed', () => {
      expect(normalizeCallbackStatus('AI Done')).toBe('completed');
    });
    it('maps success → completed', () => {
      expect(normalizeCallbackStatus('success')).toBe('completed');
    });
    it('maps AI Failed → failed', () => {
      expect(normalizeCallbackStatus('AI Failed')).toBe('failed');
    });
    it('maps failed → failed', () => {
      expect(normalizeCallbackStatus('failed')).toBe('failed');
    });
    it('maps timeout → failed', () => {
      expect(normalizeCallbackStatus('timeout')).toBe('failed');
    });
    it('maps AI Quota Exhausted → quota_exhausted', () => {
      expect(normalizeCallbackStatus('AI Quota Exhausted')).toBe('quota_exhausted');
    });
    it('maps unknown → in_progress', () => {
      expect(normalizeCallbackStatus('something_else')).toBe('in_progress');
    });
  });

  describe('extractPrNumber', () => {
    it('extracts PR number from GitHub URL', () => {
      expect(extractPrNumber('https://github.com/org/repo/pull/123')).toBe(123);
    });
    it('returns null for null input', () => {
      expect(extractPrNumber(null)).toBe(null);
    });
    it('returns null when no /pull/ in URL', () => {
      expect(extractPrNumber('https://github.com/org/repo')).toBe(null);
    });
  });

  describe('extractFindingsValue', () => {
    it('returns string directly', () => {
      expect(extractFindingsValue('some findings')).toBe('some findings');
    });
    it('extracts findings field from object', () => {
      expect(extractFindingsValue({ findings: 'x' })).toBe('x');
    });
    it('returns null for null', () => {
      expect(extractFindingsValue(null)).toBe(null);
    });
  });

  describe('buildExecMetaJson', () => {
    it('returns null for non-object result', () => {
      expect(buildExecMetaJson('string')).toBe(null);
    });
    it('returns null when no meta keys present', () => {
      expect(buildExecMetaJson({ foo: 'bar' })).toBe(null);
    });
    it('returns JSON string with meta keys', () => {
      const result = buildExecMetaJson({ duration_ms: 1000, num_turns: 3 });
      const parsed = JSON.parse(result);
      expect(parsed.duration_ms).toBe(1000);
      expect(parsed.num_turns).toBe(3);
    });
  });

  describe('buildFailureFields', () => {
    it('returns nulls for non-failed status', () => {
      const { errorMessage, blockedDetail } = buildFailureFields('completed', null, null, null, 'task-1');
      expect(errorMessage).toBe(null);
      expect(blockedDetail).toBe(null);
    });
    it('returns error fields for failed status with object result', () => {
      const { errorMessage, blockedDetail } = buildFailureFields('failed', { result: 'oops' }, null, 1, 'task-1');
      expect(errorMessage).toBe('oops');
      expect(blockedDetail).toBeTruthy();
    });
  });

  /**
   * isSuccessfulExecution 模式验证
   *
   * task_run_metrics.exit_status 和 watchdog.cleanupMetrics 的 exitStatus
   * 必须基于规范化后的 newStatus（而非原始 status 字符串），确保
   * docker-executor 以 'success' 回调时也能正确写入 exit_status='success'。
   *
   * 修复前：两处使用 status === 'AI Done'，docker 'success' 会错误写入 'failed'
   * 修复后：(newStatus === 'completed' || newStatus === 'completed_no_pr') ? 'success' : 'failed'
   */
  describe('isSuccessfulExecution — exitStatus 计算依据', () => {
    function isSuccessfulExecution(newStatus) {
      return newStatus === 'completed' || newStatus === 'completed_no_pr';
    }

    it("docker 'success' → normalizeCallbackStatus → 'completed' → isSuccessful=true", () => {
      const newStatus = normalizeCallbackStatus('success');
      expect(isSuccessfulExecution(newStatus)).toBe(true);
    });

    it("bridge 'AI Done' → normalizeCallbackStatus → 'completed' → isSuccessful=true", () => {
      const newStatus = normalizeCallbackStatus('AI Done');
      expect(isSuccessfulExecution(newStatus)).toBe(true);
    });

    it("'completed_no_pr' → isSuccessful=true（dev 任务无 PR 也算成功）", () => {
      expect(isSuccessfulExecution('completed_no_pr')).toBe(true);
    });

    it("'failed' → isSuccessful=false", () => {
      const newStatus = normalizeCallbackStatus('failed');
      expect(isSuccessfulExecution(newStatus)).toBe(false);
    });

    it("'timeout' → normalizeCallbackStatus → 'failed' → isSuccessful=false", () => {
      const newStatus = normalizeCallbackStatus('timeout');
      expect(isSuccessfulExecution(newStatus)).toBe(false);
    });
  });
});
