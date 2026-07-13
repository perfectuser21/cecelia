import { describe, it, expect, vi, beforeEach } from 'vitest';

const recordActionReceipt = vi.fn().mockResolvedValue('r-9');
const resolveActionReceipt = vi.fn().mockResolvedValue(true);
vi.mock('../receipt-collector.js', () => ({ recordActionReceipt, resolveActionReceipt }));

describe('feishu-alert 回执接线（T4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function loadAndEscalate(webhookUrl) {
    if (webhookUrl === undefined) delete process.env.FEISHU_SKILL_EVAL_WEBHOOK;
    else process.env.FEISHU_SKILL_EVAL_WEBHOOK = webhookUrl;
    const { alertSkillEvalFailure } = await import('../feishu-alert.js');
    // 连报 3 次同 mode 触发 escalate → 立即走 sendToFeishu
    alertSkillEvalFailure('crash', 't-1');
    alertSkillEvalFailure('crash', 't-2');
    alertSkillEvalFailure('crash', 't-3');
    // escalate 的 send 是 fire-and-forget，等微任务/定时清空
    await new Promise((r) => setTimeout(r, 20));
  }

  it('webhook 已配置 + 发送成功 → record(feishu/skill_eval_webhook) + confirmed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await loadAndEscalate('https://feishu.example/skill-eval');
    expect(recordActionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'feishu', target: 'skill_eval_webhook' })
    );
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-9', 'confirmed', expect.anything());
  });

  it('webhook 返回非 2xx → resolve failed', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    await loadAndEscalate('https://feishu.example/skill-eval');
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-9', 'failed', expect.objectContaining({ http_status: 502 }));
  });

  it('webhook fetch 抛错 → resolve failed（error 证据）', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('net down'));
    await loadAndEscalate('https://feishu.example/skill-eval');
    expect(resolveActionReceipt).toHaveBeenCalledWith('r-9', 'failed', expect.objectContaining({ error: 'net down' }));
  });

  it('webhook 未配置（本地日志兜底）→ 不写回执', async () => {
    global.fetch = vi.fn();
    await loadAndEscalate(undefined);
    expect(recordActionReceipt).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
