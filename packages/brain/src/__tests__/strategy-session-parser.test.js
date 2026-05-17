/**
 * strategy-session-parser.test.js
 *
 * DoD:
 * - parseStrategySessionOutput 从 ```json 块解析 meeting_summary / key_tensions / krs
 * - parseStrategySessionOutput 支持纯 JSON 字符串
 * - 解析失败时返回 null
 * - krs 为空数组时仍然返回对象（而不是 null）
 */

import { describe, it, expect } from 'vitest';
import { parseStrategySessionOutput } from '../strategy-session-parser.js';

const VALID_OUTPUT = `
## C-Suite 战略会议记录

经过讨论，得出以下结论：

\`\`\`json
{
  "meeting_summary": "季度战略会议，讨论了增长目标和技术债务优先级",
  "key_tensions": ["成本控制 vs 快速扩张", "技术债务 vs 新功能"],
  "krs": [
    { "title": "Q2 MAU 增长至 10 万", "domain": "growth", "priority": "P0" },
    { "title": "核心 API 响应时间 < 100ms", "domain": "coding", "priority": "P1" },
    { "title": "运营成本降低 20%", "domain": "operations", "priority": "P1" }
  ]
}
\`\`\`

会议结束。
`;

const VALID_JSON_DIRECT = JSON.stringify({
  meeting_summary: '直接 JSON 格式',
  key_tensions: ['tension1'],
  krs: [{ title: 'KR 直接', domain: 'product', priority: 'P0' }]
});

describe('parseStrategySessionOutput', () => {
  it('从 ```json 块解析完整产出', () => {
    const result = parseStrategySessionOutput(VALID_OUTPUT);
    expect(result).not.toBeNull();
    expect(result.meeting_summary).toBe('季度战略会议，讨论了增长目标和技术债务优先级');
    expect(result.key_tensions).toHaveLength(2);
    expect(result.krs).toHaveLength(3);
    expect(result.krs[0].title).toBe('Q2 MAU 增长至 10 万');
    expect(result.krs[0].domain).toBe('growth');
    expect(result.krs[0].priority).toBe('P0');
  });

  it('从纯 JSON 字符串解析', () => {
    const result = parseStrategySessionOutput(VALID_JSON_DIRECT);
    expect(result).not.toBeNull();
    expect(result.meeting_summary).toBe('直接 JSON 格式');
    expect(result.krs).toHaveLength(1);
    expect(result.krs[0].title).toBe('KR 直接');
  });

  it('krs 为空数组时返回带空 krs 的对象（不返回 null）', () => {
    const output = '```json\n{"meeting_summary": "无 KR", "krs": []}\n```';
    const result = parseStrategySessionOutput(output);
    expect(result).not.toBeNull();
    expect(result.krs).toHaveLength(0);
    expect(result.meeting_summary).toBe('无 KR');
  });

  it('输出为空字符串时返回 null', () => {
    expect(parseStrategySessionOutput('')).toBeNull();
    expect(parseStrategySessionOutput(null)).toBeNull();
    expect(parseStrategySessionOutput(undefined)).toBeNull();
  });

  it('非 JSON 文本返回 null', () => {
    const result = parseStrategySessionOutput('这是一段普通的会议记录，没有 JSON 块。');
    expect(result).toBeNull();
  });

  it('JSON 块格式不合法时返回 null', () => {
    const output = '```json\n{ invalid json\n```';
    const result = parseStrategySessionOutput(output);
    expect(result).toBeNull();
  });

  it('缺失字段时使用默认值', () => {
    const output = '```json\n{"krs": [{"title": "KR1"}]}\n```';
    const result = parseStrategySessionOutput(output);
    expect(result).not.toBeNull();
    expect(result.meeting_summary).toBe('');
    expect(result.key_tensions).toEqual([]);
    expect(result.krs[0].title).toBe('KR1');
  });
});
