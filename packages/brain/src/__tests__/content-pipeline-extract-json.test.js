/**
 * content-pipeline-extract-json.test.js
 *
 * 覆盖 content-pipeline-graph.js::extractJsonField — skill 输出的最后一行 JSON
 * 里抽数组/对象字段（rule_details 等结构化数据）。
 */

import { describe, it, expect } from 'vitest';
import { extractJsonField } from '../content-pipeline-graph.js';

describe('extractJsonField', () => {
  it('extracts array field from single-line JSON', () => {
    const output = '{"copy_review_verdict":"REVISION","copy_review_rule_details":[{"id":"R1","pass":false}]}';
    const v = extractJsonField(output, 'copy_review_rule_details');
    expect(v).toEqual([{ id: 'R1', pass: false }]);
  });

  it('extracts object field from JSON', () => {
    const output = '{"node":"copy_review","details":{"passed":true,"score":5}}';
    const v = extractJsonField(output, 'details');
    expect(v).toEqual({ passed: true, score: 5 });
  });

  it('extracts scalar field from JSON (number)', () => {
    const output = '{"card_count":9,"verdict":"PASS"}';
    expect(extractJsonField(output, 'card_count')).toBe(9);
    expect(extractJsonField(output, 'verdict')).toBe('PASS');
  });

  it('picks last JSON line when multiple lines present', () => {
    const output = [
      'some logs',
      '{"first":true}',
      'more logs',
      '{"last":true,"copy_review_rule_details":[{"id":"R2","pass":true}]}',
    ].join('\n');
    const v = extractJsonField(output, 'copy_review_rule_details');
    expect(v).toEqual([{ id: 'R2', pass: true }]);
  });

  it('skips lines that parse but lack the field', () => {
    const output = '{"verdict":"PASS"}\n{"rule_details":[{"id":"R1"}]}';
    expect(extractJsonField(output, 'rule_details')).toEqual([{ id: 'R1' }]);
    expect(extractJsonField(output, 'verdict')).toBe('PASS');
  });

  it('returns null for empty or null input', () => {
    expect(extractJsonField('', 'any')).toBeNull();
    expect(extractJsonField(null, 'any')).toBeNull();
    expect(extractJsonField(undefined, 'any')).toBeNull();
  });

  it('returns null when field missing in all JSON lines', () => {
    const output = '{"a":1}\n{"b":2}';
    expect(extractJsonField(output, 'c')).toBeNull();
  });

  it('returns null for non-JSON text', () => {
    const output = 'foo: bar\nbaz: qux';
    expect(extractJsonField(output, 'foo')).toBeNull();
  });

  it('handles null/false values correctly (not confused with missing)', () => {
    const output = '{"copy_review_feedback":null,"image_review_verdict":"FAIL"}';
    expect(extractJsonField(output, 'copy_review_feedback')).toBeNull();
    expect(extractJsonField(output, 'image_review_verdict')).toBe('FAIL');
  });

  it('handles realistic copy_review skill output', () => {
    const output = `
some preamble logs
+ COPY_LEN=997
+ VERDICT=APPROVED
{"copy_review_verdict":"APPROVED","copy_review_feedback":null,"quality_score":5,"copy_review_rule_details":[{"id":"R1","label":"无禁用词","pass":true},{"id":"R2","label":"品牌词命中≥1","pass":true,"value":3},{"id":"R3","label":"copy ≥200 字","pass":true,"value":997},{"id":"R4","label":"article ≥500 字","pass":true,"value":3113},{"id":"R5","label":"article 有 md 标题","pass":true}]}
`;
    const details = extractJsonField(output, 'copy_review_rule_details');
    expect(Array.isArray(details)).toBe(true);
    expect(details).toHaveLength(5);
    expect(details[1]).toMatchObject({ id: 'R2', pass: true, value: 3 });
  });

  // ─── P0-4：copy_review_total / vision_avg 提到 payload 顶级 ───────
  // 背景：pipeline 3e3f2c09 的 copy_review event 里 copy_review_total=null，
  // 因为 NODE_CONFIGS.copy_review.json_outputs 只列 rule_details，总分被埋在
  // 数组里。前端做趋势图/阈值告警时必须到顶级字段拿 total，所以 json_outputs
  // 新增 copy_review_total / vision_avg 两个标量字段。这组测试锁死这两个
  // 标量字段能被 extractJsonField 正确抽出（与 rule_details 可并存）。

  it('extracts copy_review_total scalar alongside rule_details (realistic)', () => {
    // 来自真实 skill SKILL.md L315 的 echo 模板：
    // {..."quality_score":${SCORE},"copy_review_total":${LLM_TOTAL},"copy_review_threshold":18,"copy_review_rule_details":[...]}
    const output = `+ LLM_TOTAL=21
{"copy_review_verdict":"APPROVED","copy_review_feedback":null,"quality_score":5,"copy_review_total":21,"copy_review_threshold":18,"copy_review_rule_details":[{"id":"R1","pass":true},{"id":"LLM","pass":true,"value":21}]}`;
    expect(extractJsonField(output, 'copy_review_total')).toBe(21);
    expect(extractJsonField(output, 'copy_review_threshold')).toBe(18);
    // 同一行多字段可并存抽取，互不影响
    const details = extractJsonField(output, 'copy_review_rule_details');
    expect(Array.isArray(details)).toBe(true);
    expect(details).toHaveLength(2);
  });

  it('extracts vision_avg scalar from realistic image_review skill output', () => {
    // 来自 pipeline-review/SKILL.md L320 的 echo 模板：
    // {..."vision_avg":${AVG},"vision_threshold":14,"vision_enabled":${VISION_ENABLED},...}
    const output = `+ AVG=17
{"image_review_verdict":"PASS","image_review_feedback":null,"card_count":9,"vision_avg":17,"vision_threshold":14,"vision_enabled":true,"image_review_rule_details":[{"id":"RCOUNT","pass":true,"value":9}]}`;
    expect(extractJsonField(output, 'vision_avg')).toBe(17);
    expect(extractJsonField(output, 'vision_threshold')).toBe(14);
    expect(extractJsonField(output, 'vision_enabled')).toBe(true);
  });

  it('copy_review_total=null 时 extractJsonField 返回 null（不与 missing 混淆）', () => {
    // skill 在 bash 硬规则阶段就挂时不会跑 LLM，copy_review_total 会是 null。
    const output = `{"copy_review_verdict":"REVISION","copy_review_total":null,"copy_review_rule_details":[{"id":"R0","pass":false}]}`;
    expect(extractJsonField(output, 'copy_review_total')).toBeNull();
    // 但字段存在（vs. missing 时 extractJsonField 也返回 null，
    // 行为一致——调用方只用 null 判定是否有值，不区分 missing/explicit null）。
  });

  it('vision_avg=0 是有效分数（不被当成 missing）', () => {
    // 0 是合法最低分，必须被保留，不能误判成 null/missing。
    const output = `{"image_review_verdict":"FAIL","vision_avg":0,"image_review_rule_details":[]}`;
    expect(extractJsonField(output, 'vision_avg')).toBe(0);
  });
});
