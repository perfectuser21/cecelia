import { describe, expect, it, vi } from 'vitest';
import { pushQiumiStatus, PUSH_QIUMI_QUERY } from '../notion-gtd-sync.js';

describe('员工任务阻断回执', () => {
  it.each([
    ['手机 USB 离线', '手机 USB 离线'],
    [{ message: '微信未登录' }, '微信未登录'],
    [{ reason: 'device_offline' }, 'device_offline'],
    [null, 'device_busy'],
  ])('error_message 为空仍显示具体 detail/reason：%j', async (detail, expected) => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{
      id: 'task', status: 'blocked', error_message: null, blocked_reason: 'device_busy', blocked_detail: detail,
      zh_page_id: 'zh', en_page_id: null, receipt_fingerprint: 'snapshot-fingerprint',
    }] }).mockResolvedValue({ rows: [] });
    const notionReq = vi.fn().mockResolvedValue({ properties: { 状态: { status: { name: '进行中' } } } });
    await pushQiumiStatus({ query }, 'tok', { notionReq });
    const patch = notionReq.mock.calls.find((c) => c[2] === 'PATCH')[3];
    expect(patch.properties['OpenClaw结果'].rich_text[0].text.content).toBe(`[等待中: ${expected}]`);
    expect(patch.properties['状态'].status.name).toBe('进行中');
  });

  it('同状态原因或结果更新也能被查询；指纹不包含 updated_at', () => {
    expect(PUSH_QIUMI_QUERY).toMatch(/receipt_fingerprint/);
    expect(PUSH_QIUMI_QUERY).toMatch(/qiumi_pushed_receipt/);
    expect(PUSH_QIUMI_QUERY).toMatch(/md5\(jsonb_build_array\(/);
    expect(PUSH_QIUMI_QUERY).toMatch(/blocked_detail/);
    expect(PUSH_QIUMI_QUERY.match(/md5\(jsonb_build_array\([\s\S]*?\)::text\)/)?.[0]).not.toMatch(/updated_at|notion_props/);
  });

  it('只保存查询时的指纹，推送中产生新结果会在下轮重推', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{
      id: 'task', status: 'completed_no_pr', result: { summary: '读取作品21个' },
      zh_page_id: 'zh', en_page_id: null, receipt_fingerprint: 'old-snapshot',
    }] }).mockResolvedValue({ rows: [] });
    const notionReq = vi.fn().mockResolvedValue({ properties: { 状态: { status: { name: '进行中' } } } });
    await pushQiumiStatus({ query }, 'tok', { notionReq });
    const stamp = query.mock.calls.at(-1);
    expect(stamp[0]).toMatch(/qiumi_pushed_receipt/);
    expect(stamp[1]).toContain('old-snapshot');
  });
});
