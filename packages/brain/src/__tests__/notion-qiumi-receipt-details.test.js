import { describe, expect, it, vi } from 'vitest';
import { pushQiumiStatus, PUSH_QIUMI_QUERY } from '../notion-gtd-sync.js';

describe('员工任务阻断回执', () => {
  it('运行中派发结果不确定，员工能看到正在查询原运行而非空结果', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{
      id: 'task', status: 'in_progress', zh_page_id: 'zh', en_page_id: null,
      result: { dispatch_uncertain: { message: '派发未确认，正在查询原运行 qiumi-fixed-run' } },
      receipt_fingerprint: 'unknown-snapshot',
    }] }).mockResolvedValue({ rows: [] });
    const notionReq = vi.fn().mockResolvedValue({ properties: { 状态: { status: { name: '进行中' } } } });
    await pushQiumiStatus({ query }, 'tok', { notionReq });
    const patch = notionReq.mock.calls.find((c) => c[2] === 'PATCH')[3];
    expect(patch.properties['OpenClaw结果']?.rich_text[0].text.content).toContain('正在查询原运行');
  });
  it.each([
    ['手机 USB 离线', '手机 USB 离线'],
    [{ message: '微信未登录' }, '微信未登录'],
    [{ reason: 'device_offline' }, 'device_offline'],
    [null, 'device_busy'],
    [{ summary: '另一任务持锁' }, '另一任务持锁'],
    [{ candidates: ['小蓝', '小黄'] }, 'device_busy'],
  ])('error_message 为空仍显示具体 detail/reason：%j', async (detail, expected) => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{
      id: 'task', status: 'blocked', error_message: null, blocked_reason: 'device_busy', blocked_detail: detail,
      zh_page_id: 'zh', en_page_id: null, receipt_fingerprint: 'snapshot-fingerprint',
    }] }).mockResolvedValue({ rows: [] });
    const notionReq = vi.fn().mockResolvedValue({ properties: { 状态: { status: { name: '进行中' } } } });
    await pushQiumiStatus({ query }, 'tok', { notionReq });
    const patch = notionReq.mock.calls.find((c) => c[2] === 'PATCH')[3];
    expect(patch.properties['OpenClaw结果'].rich_text[0].text.content).toBe(`[受阻: ${expected}]`);
    expect(patch.properties['状态'].status.name).toBe('受阻');
  });

  it('同状态原因或结果更新也能被查询；指纹不包含 updated_at', () => {
    expect(PUSH_QIUMI_QUERY).toMatch(/receipt_fingerprint/);
    expect(PUSH_QIUMI_QUERY).toMatch(/qiumi_pushed_receipt/);
    expect(PUSH_QIUMI_QUERY).toMatch(/md5\(jsonb_build_array\(/);
    expect(PUSH_QIUMI_QUERY).toMatch(/blocked_detail/);
    expect(PUSH_QIUMI_QUERY.match(/md5\(jsonb_build_array\([\s\S]*?\)::text\)/)?.[0]).not.toMatch(/updated_at|notion_props/);
  });

  it.each([['阻塞', false, '阻塞'], ['进行中', true, null]])('人工 hold 和归档页都保存当前指纹：%s archived=%s', async (status, archived, hold) => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{
      id: 'task', status: 'blocked', zh_page_id: 'zh', en_page_id: null, receipt_fingerprint: 'same-content',
    }] }).mockResolvedValue({ rows: [] });
    const notionReq = vi.fn().mockResolvedValue({ archived, properties: { 状态: { status: { name: status } } } });
    const result = await pushQiumiStatus({ query }, 'tok', { notionReq });
    expect(notionReq.mock.calls.some((call) => call[2] === 'PATCH')).toBe(false);
    expect(query.mock.calls.at(-1)[1]).toEqual(['task', 'blocked', 'same-content', hold]);
    expect(hold ? result.skippedHuman : result.skippedGone).toBe(1);
    if (!hold) expect(query.mock.calls.at(-1)[0]).toContain("- 'qiumi_human_hold'");
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
