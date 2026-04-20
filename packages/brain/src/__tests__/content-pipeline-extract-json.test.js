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
});
