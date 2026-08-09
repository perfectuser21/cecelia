import { describe, it, expect, vi, beforeEach } from 'vitest';

// 评审台通知只给预览链接，操作员批准/驳回时手动 psql 直写 verdict:human_review
// 协议行（kernel task aae92bfc/31b93fd4 案卷）——通知里没有 run_id/task_id/
// pr_head_sha/review_request_hop，approve 端点又要求这些字段，操作员只能
// 现挖 DB。通知必须自带一条可直接用的 curl 审批模板（不含 approver token，
// 那是敏感凭据，不该进推送历史）。
process.env.BARK_TOKEN = 'test-bark-token';

const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' });
global.fetch = mockFetch;

const { notifyHarnessReviewPending } = await import('../notifier.js');

describe('notifyHarnessReviewPending — 评审通知带可执行审批模板', () => {
  beforeEach(() => vi.clearAllMocks());

  it('info 带完整审批坐标时，通知体含 approve curl 模板（不含 token）', async () => {
    await notifyHarnessReviewPending({
      task_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'kernel-ping playground',
      pr_url: 'https://github.com/perfectuser21/cecelia/pull/4739',
      preview_url: 'http://38.23.47.81:5300',
      run_id: '61def0bd-18ff-4814-83c8-ea462d0bbf72',
      pr_head_sha: '7fd74f36de8227e72c0a3c9f827d0d683d8871a0',
      review_request_hop: 33,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0];
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('/kernel-reviews/61def0bd-18ff-4814-83c8-ea462d0bbf72/approve');
    expect(decoded).toContain('7fd74f36de8227e72c0a3c9f827d0d683d8871a0');
    expect(decoded).toContain('"review_request_hop":33');
    expect(decoded).toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(decoded).not.toContain('x-approver-token');
    expect(decoded).not.toMatch(/token["\s:=]+[A-Za-z0-9]{20,}/);
  });

  it('info 缺审批坐标时（旧调用点）不崩，退回纯预览链接文案', async () => {
    await notifyHarnessReviewPending({
      task_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      title: '旧式调用',
      pr_url: 'https://github.com/o/r/pull/1',
      preview_url: 'http://38.23.47.81:5301',
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const decoded = decodeURIComponent(mockFetch.mock.calls[0][0]);
    expect(decoded).not.toContain('/kernel-reviews/');
    expect(decoded).toContain('5301');
  });
});
