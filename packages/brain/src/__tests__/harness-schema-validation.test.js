import { describe, it, expect } from 'vitest';
import { ReviewerOutputSchema, EvaluatorOutputSchema, readAndValidateBrainResult } from '../harness-shared.js';
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
        verification_oracle_completeness: 8,
        ci_workflow_alignment: 8,
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
  it('接受 PASS verdict（无需 feedback）', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'PASS' }).success).toBe(true);
  });

  it('接受 FIXED verdict with feedback', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'FIXED', feedback: 'ok' }).success).toBe(true);
  });

  it('拒绝非法 verdict', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'APPROVED', feedback: 'ok' }).success).toBe(false);
  });

  it('接受 FAIL verdict with feedback（v2 format）', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'FAIL', feedback: 'ci failed' }).success).toBe(true);
  });

  it('接受 FAIL verdict with failed_step+log_excerpt（v1 真实格式）', () => {
    // 这是真实 evaluator skill 输出的格式，必须通过
    const real = {
      verdict: 'FAIL',
      task_id: '9a6a6c97-105e-4198-9acf-bb76ddd1036f',
      failed_step: 'WS1+WS2 实现缺失',
      log_excerpt: '[Step1] navigation.config.ts 未重构 → exit 1',
    };
    expect(EvaluatorOutputSchema.safeParse(real).success).toBe(true);
  });

  it('拒绝 FAIL verdict 且无任何 feedback/failed_step/log_excerpt', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'FAIL', task_id: 'abc' }).success).toBe(false);
  });

  it('task_id 可选', () => {
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'PASS' }).success).toBe(true);
    expect(EvaluatorOutputSchema.safeParse({ verdict: 'PASS', task_id: 'abc' }).success).toBe(true);
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
        verification_oracle_completeness: 8, ci_workflow_alignment: 8,
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

describe('EvaluatorOutputSchema 验证（readAndValidateBrainResult）', () => {
  function makeTmpDir2(content) {
    const dir = mkdtempSync(path.join(tmpdir(), 'eval-result-'));
    writeFileSync(path.join(dir, '.brain-result.json'), JSON.stringify(content));
    return dir;
  }

  it('FAIL 无任何 feedback 字段时 throw schema_mismatch', async () => {
    const dir = makeTmpDir2({ verdict: 'FAIL' });  // FAIL 但无 feedback/failed_step/log_excerpt
    await expect(readAndValidateBrainResult(dir, EvaluatorOutputSchema))
      .rejects.toMatchObject({ code: 'schema_mismatch' });
  });

  it('PASS 无 feedback 正常返回', async () => {
    const dir = makeTmpDir2({ verdict: 'PASS' });
    const result = await readAndValidateBrainResult(dir, EvaluatorOutputSchema);
    expect(result.verdict).toBe('PASS');
  });

  it('真实 v1 格式（failed_step+log_excerpt）正常返回', async () => {
    const dir = makeTmpDir2({
      verdict: 'FAIL',
      task_id: '9a6a6c97',
      failed_step: 'WS1+WS2 实现缺失',
      log_excerpt: '[Step1] exit 1',
    });
    const result = await readAndValidateBrainResult(dir, EvaluatorOutputSchema);
    expect(result.verdict).toBe('FAIL');
    expect(result.failed_step).toBe('WS1+WS2 实现缺失');
  });
});
