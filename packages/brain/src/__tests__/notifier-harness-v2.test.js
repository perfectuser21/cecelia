/**
 * Harness v2 M6 — notifier 扩展单元测试
 *
 * 覆盖新增 4 个通知函数：
 *   - notifyHarnessContractApproved（阶段 A 合同 APPROVED）
 *   - notifyHarnessTaskMerged（每 Task PR merged）
 *   - notifyHarnessFinalE2E（阶段 C PASS / FAIL）
 *   - notifyHarnessBudgetWarning（预算 / 超时预警）
 *
 * 策略：mock 全局 fetch，按测试重载模块确保 rate-limit 状态隔离。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const originalEnv = { ...process.env };

describe('notifier harness v2 hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function loadNotifier() {
    delete process.env.FEISHU_BOT_WEBHOOK;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_OWNER_OPEN_IDS;
    process.env.FEISHU_BOT_WEBHOOK = 'https://open.feishu.cn/webhook/test';
    return import('../notifier.js');
  }

  // ─── notifyHarnessContractApproved ─────────────────────────────────────
  describe('notifyHarnessContractApproved', () => {
    it('合同 APPROVED 含 Task 数量 + 轮次', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const mod = await loadNotifier();
      const ok = await mod.notifyHarnessContractApproved({
        initiative_id: 'init-1',
        initiative_title: 'Add /version endpoint',
        task_count: 4,
        review_rounds: 3,
      });
      expect(ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('Add /version endpoint');
      expect(body.content.text).toContain('4 个 Task');
      expect(body.content.text).toContain('GAN 3');
    });

    it('未传 review_rounds 时不崩', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const mod = await loadNotifier();
      const ok = await mod.notifyHarnessContractApproved({
        initiative_id: 'init-2',
        task_count: 5,
      });
      expect(ok).toBe(true);
    });

    it('无 title 退回到 initiative_id', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const mod = await loadNotifier();
      await mod.notifyHarnessContractApproved({ initiative_id: 'id-only', task_count: 1 });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('id-only');
    });
  });

  // ─── notifyHarnessTaskMerged ───────────────────────────────────────────
  describe('notifyHarnessTaskMerged', () => {
    it('有 pr_url 时消息含链接', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const mod = await loadNotifier();
      const ok = await mod.notifyHarnessTaskMerged({
        initiative_id: 'init-1',
        task_id: 'task-1',
        title: 'Add migration',
        pr_url: 'https://github.com/x/y/pull/123',
      });
      expect(ok).toBe(true);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('Task PR merged');
      expect(body.content.text).toContain('https://github.com/x/y/pull/123');
    });

    it('无 pr_url 时仍发送', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const mod = await loadNotifier();
      const ok = await mod.notifyHarnessTaskMerged({
        initiative_id: 'init-1',
        task_id: 'task-2',
        title: 'No URL task',
      });
      expect(ok).toBe(true);
    });
  });

  // ─── notifyHarnessFinalE2E ────────────────────────────────────────────
  describe('notifyHarnessFinalE2E', () => {
    it('PASS 简短消息，不含失败场景', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const mod = await loadNotifier();
      await mod.notifyHarnessFinalE2E({
        initiative_id: 'init-1',
        verdict: 'PASS',
        initiative_title: 'Ship it',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('PASS');
      expect(body.content.text).toContain('Ship it');
      expect(body.content.text).not.toContain('归因');
    });

    it('FAIL 消息含归因 task + 前 3 个场景', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const mod = await loadNotifier();
      await mod.notifyHarnessFinalE2E({
        initiative_id: 'init-1',
        verdict: 'FAIL',
        failed_task_id: 'task-9',
        failed_scenarios: ['s1', 's2', 's3', 's4', 's5'],
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('FAIL');
      expect(body.content.text).toContain('task-9');
      expect(body.content.text).toContain('s1');
      expect(body.content.text).toContain('s2');
      expect(body.content.text).toContain('s3');
      expect(body.content.text).not.toContain('s4');
    });

    it('FAIL 无失败场景数组时仍发送', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const mod = await loadNotifier();
      const ok = await mod.notifyHarnessFinalE2E({
        initiative_id: 'init-fail',
        verdict: 'FAIL',
      });
      expect(ok).toBe(true);
    });
  });

  // ─── notifyHarnessBudgetWarning ───────────────────────────────────────
  describe('notifyHarnessBudgetWarning', () => {
    it('budget 预警消息含 80%', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const mod = await loadNotifier();
      await mod.notifyHarnessBudgetWarning({
        initiative_id: 'init-1',
        kind: 'budget',
        detail: '已用 $8.5 / $10',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('预算 80%');
      expect(body.content.text).toContain('已用 $8.5 / $10');
    });

    it('timeout 预警消息含 30 分钟', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const mod = await loadNotifier();
      await mod.notifyHarnessBudgetWarning({
        initiative_id: 'init-2',
        kind: 'timeout',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content.text).toContain('超时 30 分钟');
    });

    it('rate-limit：同 initiative 同 kind 60s 内第 2 次返回 false', async () => {
      mockFetch.mockResolvedValue({ ok: true });
      const mod = await loadNotifier();
      const first = await mod.notifyHarnessBudgetWarning({
        initiative_id: 'init-rl',
        kind: 'budget',
      });
      const second = await mod.notifyHarnessBudgetWarning({
        initiative_id: 'init-rl',
        kind: 'budget',
      });
      expect(first).toBe(true);
      expect(second).toBe(false); // rate-limited
    });
  });
});
