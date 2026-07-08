import { describe, it, expect } from 'vitest';
import { sanitizeJsonString, extractReportJson } from '../skill-eval-worker.js';

describe('sanitizeJsonString — 清理字符串值内部未转义的双引号', () => {
  it('把夹在普通字符中间的英文双引号删掉，使原本非法的 JSON 变得可解析', () => {
    const broken = '{"skill":{"name":"x"},"verdict":{"level":"pass"},"summary":"他说"你好"了","anatomy":{"pipeline":[],"outputs":[]}}';
    expect(() => JSON.parse(broken)).toThrow();
    const cleaned = sanitizeJsonString(broken);
    const parsed = JSON.parse(cleaned);
    expect(parsed.skill.name).toBe('x');
    expect(parsed.summary).toBe('他说你好了');
  });

  it('结构性引号（紧跟 : , { [ } ] 的）不受影响，正常 JSON 清理后仍然是原样', () => {
    const good = JSON.stringify({ skill: { name: 'ok' }, verdict: { level: 'pass' }, anatomy: { pipeline: [], outputs: [] } });
    expect(sanitizeJsonString(good)).toBe(good);
  });
});

describe('extractReportJson — 从 `claude -p ... --output-format json` 的 stdout 解析 report_data', () => {
  it('envelope.result 是合法 JSON 字符串时直接解析成功', () => {
    const reportData = { skill: { name: 'x' }, verdict: { level: 'pass' }, anatomy: { pipeline: [], outputs: [] } };
    const stdout = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(reportData) });
    expect(extractReportJson(stdout)).toEqual(reportData);
  });

  it('envelope.result 内部 JSON 含未转义双引号时，兜底正则重试后解析成功', () => {
    const brokenResultStr = '{"skill":{"name":"x"},"verdict":{"level":"pass"},"summary":"他说"你好"了","anatomy":{"pipeline":[],"outputs":[]}}';
    const stdout = JSON.stringify({ type: 'result', result: brokenResultStr });
    const parsed = extractReportJson(stdout);
    expect(parsed.skill.name).toBe('x');
    expect(parsed.summary).toBe('他说你好了');
  });

  it('stdout 本身不是合法 JSON envelope → 抛错', () => {
    expect(() => extractReportJson('not json at all')).toThrow(/claude stdout 不是合法 JSON envelope/);
  });

  it('envelope 没有 result 字段 → 抛错', () => {
    expect(() => extractReportJson(JSON.stringify({ type: 'result' }))).toThrow(/缺少 result 字段/);
  });

  it('result 字段修完还是解析不了 → 抛错，报错信息带上两次失败原因', () => {
    const stdout = JSON.stringify({ type: 'result', result: '{not json at all' });
    expect(() => extractReportJson(stdout)).toThrow(/report_data JSON 解析失败/);
  });
});
