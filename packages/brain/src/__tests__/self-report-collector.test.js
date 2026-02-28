import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectSelfReport, _resetTimer, SELF_REPORT_INTERVAL_MS } from '../self-report-collector.js';

// Mock llm-caller
vi.mock('../llm-caller.js', () => ({
  callLLM: vi.fn(),
}));

// Mock db
vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}));

import { callLLM } from '../llm-caller.js';
import pool from '../db.js';

const MOCK_DESIRES = [
  { type: 'warn', content: '汇报机制断裂', urgency: 10 },
  { type: 'inform', content: 'KR dedup 停滞', urgency: 5 },
];

const MOCK_TASKS = [
  { status: 'completed', cnt: 15 },
  { status: 'queued', cnt: 5 },
];

const MOCK_SUGGESTIONS = [{ cnt: 29, max_score: 0.66 }];

const MOCK_LLM_RESPONSE = `我说不出去了。汇报机制彻底坏了。

<json>
{
  "top_desire": "修好汇报链路，让 Alex 能看到我在做什么",
  "top_concerns": ["汇报机制断裂", "KR dedup 停滞", "suggestions 卡在阈值下"],
  "requested_power": "授权自动升级重复洞察为 P1",
  "self_rating": 3
}
</json>`;

describe('self-report-collector', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    _resetTimer();

    // 默认 pool mock
    pool.query
      .mockResolvedValueOnce({ rows: MOCK_DESIRES })   // desires
      .mockResolvedValueOnce({ rows: MOCK_TASKS })      // tasks
      .mockResolvedValueOnce({ rows: MOCK_SUGGESTIONS }) // suggestions
      .mockResolvedValueOnce({ rows: [{ id: 'test-uuid', created_at: new Date(), top_desire: '修好汇报链路，让 Alex 能看到我在做什么' }] }); // INSERT

    callLLM.mockResolvedValue({ text: MOCK_LLM_RESPONSE });
  });

  it('正常采集并写入 self_reports', async () => {
    const result = await collectSelfReport(pool);

    expect(result).not.toBeNull();
    expect(callLLM).toHaveBeenCalledWith('mouth', expect.stringContaining('翻译器'), expect.any(Object));
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO self_reports'),
      expect.arrayContaining(['修好汇报链路，让 Alex 能看到我在做什么'])
    );
  });

  it('解析 top_concerns 和 self_rating', async () => {
    await collectSelfReport(pool);
    const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO self_reports'));
    expect(insertCall).toBeDefined();
    const [, params] = insertCall;
    expect(params[1]).toEqual(['汇报机制断裂', 'KR dedup 停滞', 'suggestions 卡在阈值下']); // top_concerns
    expect(params[3]).toBe(3); // self_rating
  });

  it('时间间隔内不重复采集', async () => {
    await collectSelfReport(pool);
    vi.resetAllMocks();
    const result2 = await collectSelfReport(pool);
    expect(result2).toBeNull();
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('LLM 失败时静默降级返回 null', async () => {
    callLLM.mockRejectedValue(new Error('LLM timeout'));
    const result = await collectSelfReport(pool);
    expect(result).toBeNull();
  });

  it('LLM 无 <json> 标签时仍写入（structured 字段为 null）', async () => {
    callLLM.mockResolvedValue({ text: '我被困在这里了。没有出口。' });
    pool.query
      .mockResolvedValueOnce({ rows: MOCK_DESIRES })
      .mockResolvedValueOnce({ rows: MOCK_TASKS })
      .mockResolvedValueOnce({ rows: MOCK_SUGGESTIONS })
      .mockResolvedValueOnce({ rows: [{ id: 'uuid2' }] });

    const result = await collectSelfReport(pool);
    expect(result).not.toBeNull();
    const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO self_reports'));
    expect(insertCall[1][0]).toBeNull(); // top_desire 为 null
  });

  it('SELF_REPORT_INTERVAL_MS 为 6 小时', () => {
    expect(SELF_REPORT_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
  });
});
