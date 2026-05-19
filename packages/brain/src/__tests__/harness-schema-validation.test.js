import { describe, it, expect } from 'vitest';
import { ReviewerOutputSchema, EvaluatorOutputSchema, readAndValidateBrainResult } from '../harness-shared.js';
import { LLM_RETRY } from '../workflows/retry-policies.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

describe('ReviewerOutputSchema', () => {
  it('接受完整合法输出', () => {
    const valid = {
      verdict: 'APPROVED',
      rubric_scores: {
        dod_machineability: 8,
        scope_match_prd: 7,
        test_is_red: 9,
        internal_consistency: 8,
        risk_registered: 7,
      },
      feedback: '合同质量良好',
    };
    expect(ReviewerOutputSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝缺少 rubric 维度', () => {
    const missing = {
      verdict: 'APPROVED',
      rubric_scores: {
        dod_machineability: 8,
        scope_match_prd: 7,
        // test_is_red 缺失
        internal_consistency: 8,
        risk_registered: 7,
      },
      feedback: '...',
    };
    expect(ReviewerOutputSchema.safeParse(missing).success).toBe(false);
  });

  it('拒绝分数超出 1-10 范围', () => {
    const outOfRange = {
      verdict: 'REVISION',
      rubric_scores: {
        dod_machineability: 11,  // 超出范围
        scope_match_prd: 7,
        test_is_red: 9,
        internal_consistency: 8,
        risk_registered: 7,
      },
      feedback: '...',
    };
    expect(ReviewerOutputSchema.safeParse(outOfRange).success).toBe(false);
  });

  it('拒绝非法 verdict', () => {
    const badVerdict = {
      verdict: 'PASS',  // 应为 APPROVED|REVISION
      rubric_scores: {
        dod_machineability: 8, scope_match_prd: 7, test_is_red: 9,
        internal_consistency: 8, risk_registered: 7,
      },
      feedback: '...',
    };
    expect(ReviewerOutputSchema.safeParse(badVerdict).success).toBe(false);
  });
});

describe('EvaluatorOutputSchema', () => {
  it('接受 PASS verdict', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'PASS', feedback: 'ok' }).success).toBe(true);
  });

  it('接受 FIXED verdict', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'FIXED', feedback: 'ok' }).success).toBe(true);
  });

  it('拒绝非法 verdict', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'APPROVED', feedback: 'ok' }).success).toBe(false);
  });

  it('接受 FAIL verdict', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'FAIL', feedback: 'ci failed' }).success).toBe(true);
  });

  it('task_id 可选', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'PASS', feedback: 'ok' }).success).toBe(true);
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'PASS', task_id: 'abc', feedback: 'ok' }).success).toBe(true);
  });
});

describe('readAndValidateBrainResult', () => {
  function makeTmpDir(content) {
    const dir = mkdtempSync(path.join(tmpdir(), 'brain-result-'));
    writeFileSync(path.join(dir, '.brain-result.json'), JSON.stringify(content));
    return dir;
  }

  it('合法数据正常返回', async () => {
    const dir = makeTmpDir({
      verdict: 'APPROVED',
      rubric_scores: {
        dod_machineability: 8, scope_match_prd: 7, test_is_red: 9,
        internal_consistency: 8, risk_registered: 7,
      },
      feedback: 'good',
    });
    const result = await readAndValidateBrainResult(dir, ReviewerOutputSchema);
    expect(result.verdict).toBe('APPROVED');
    expect(result.rubric_scores.test_is_red).toBe(9);
  });

  it('缺维度时 throw schema_mismatch', async () => {
    const dir = makeTmpDir({
      verdict: 'APPROVED',
      rubric_scores: { dod_machineability: 8 },  // 缺 4 个维度
      feedback: 'ok',
    });
    await expect(readAndValidateBrainResult(dir, ReviewerOutputSchema))
      .rejects.toMatchObject({ code: 'schema_mismatch' });
  });

  it('文件不存在时 throw（来自 readBrainResult）', async () => {
    await expect(readAndValidateBrainResult('/nonexistent/path', ReviewerOutputSchema))
      .rejects.toThrow();
  });
});

describe('retry-policies schema_mismatch', () => {
  it('schema_mismatch 错误不被 LLM_RETRY 重试', () => {
    const err = new Error('ContractViolation: schema_mismatch — rubric_scores.test_is_red: Required');
    // retryOn 匹配 err.message，schema_mismatch 在消息中命中 PERMANENT_ERROR_RE
    expect(LLM_RETRY.retryOn(err)).toBe(false);
  });

  it('普通 LLM 错误仍被重试', () => {
    const err = new Error('503 Service Unavailable');
    expect(LLM_RETRY.retryOn(err)).toBe(true);
  });
});
