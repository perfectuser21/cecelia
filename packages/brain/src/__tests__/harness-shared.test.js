/**
 * 验证：harness-shared.js export 共享函数（含 Protocol v2 新增工具）。
 */
import { describe, it, expect } from 'vitest';

describe('harness-shared module', () => {
  it('exports parseDockerOutput / extractField / loadSkillContent', async () => {
    const mod = await import('../harness-shared.js');
    expect(typeof mod.parseDockerOutput).toBe('function');
    expect(typeof mod.extractField).toBe('function');
    expect(typeof mod.loadSkillContent).toBe('function');
  });

  it('parseDockerOutput 抽 claude --output-format json 末尾 result 段', async () => {
    const { parseDockerOutput } = await import('../harness-shared.js');
    const stdout = `some preamble\n{"result":"final-output-content","other":"x"}\n`;
    const out = parseDockerOutput(stdout);
    expect(out).toContain('final-output-content');
  });

  it('extractField 兼容 pr_url: <URL> 字面量 + JSON', async () => {
    const { extractField } = await import('../harness-shared.js');
    expect(extractField('pr_url: https://github.com/x/y/pull/1', 'pr_url')).toBe('https://github.com/x/y/pull/1');
    expect(extractField('"pr_url":"https://github.com/x/y/pull/2"', 'pr_url')).toBe('https://github.com/x/y/pull/2');
    expect(extractField('pr_url: null', 'pr_url')).toBeNull();
    expect(extractField('pr_url: FAILED', 'pr_url')).toBeNull();
  });

  it('loadSkillContent 缺文件时 throw（B56 fail-fast，不再返回空串）', async () => {
    // B56: CI 环境无 ~/.claude-account*/skills/，loadSkillContent 应 throw 而非静默返回空串。
    // 旧行为返回空串会导致 generator 拿空 SKILL prompt 跑出无 PR 的假成功，故 fail-fast。
    const { loadSkillContent } = await import('../harness-shared.js');
    expect(() => loadSkillContent('nonexistent-skill-name-xyz-b56')).toThrow(/SKILL\.md not found/);
  });

});

describe('EvaluatorOutputSchema — null 字段接受', () => {
  it('PASS verdict with null optional fields should parse successfully', async () => {
    const { EvaluatorOutputSchema } = await import('../harness-shared.js');
    const result = EvaluatorOutputSchema.safeParse({
      verdict: 'PASS',
      task_id: 'test-task-id',
      failed_step: null,
      log_excerpt: null,
    });
    expect(result.success).toBe(true);
  });

  it('PASS verdict with all-null optional fields should parse successfully', async () => {
    const { EvaluatorOutputSchema } = await import('../harness-shared.js');
    const result = EvaluatorOutputSchema.safeParse({
      verdict: 'PASS',
      task_id: null,
      feedback: null,
      failed_step: null,
      log_excerpt: null,
    });
    expect(result.success).toBe(true);
  });

  it('FAIL verdict without feedback fields should fail validation', async () => {
    const { EvaluatorOutputSchema } = await import('../harness-shared.js');
    const result = EvaluatorOutputSchema.safeParse({
      verdict: 'FAIL',
      task_id: 'test-task-id',
      failed_step: null,
      log_excerpt: null,
    });
    expect(result.success).toBe(false);
  });

  it('FAIL verdict with feedback should parse successfully', async () => {
    const { EvaluatorOutputSchema } = await import('../harness-shared.js');
    const result = EvaluatorOutputSchema.safeParse({
      verdict: 'FAIL',
      task_id: 'test-task-id',
      feedback: 'some error message',
      failed_step: null,
      log_excerpt: null,
    });
    expect(result.success).toBe(true);
  });
});
