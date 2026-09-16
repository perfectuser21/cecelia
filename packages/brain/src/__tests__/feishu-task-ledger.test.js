/**
 * feishu-task-ledger.test.js — 飞书群交办入账
 * 判据来源：主理人 2026-09-16 拍板（决策 1c6679cd / 判定点 398d5f36）
 */
import { describe, it, expect } from 'vitest';
import {
  GROUPS, selectCandidates, dedupeResends, resolveReplyEvidence, buildTaskRequest,
  buildClassifyPrompt, parseClassifyResult, classifyCandidates,
} from '../feishu-task-ledger.js';

const BOT = 'ou_bot123';
const msg = (o) => ({
  message_id: o.id,
  create_time: String(o.ts ?? 1000),
  sender: { sender_type: o.from ?? 'user', id: o.senderId ?? 'ou_alex' },
  mentions: (o.men ?? []).map((id) => ({ id: { open_id: id } })),
  body: { content: JSON.stringify({ text: o.text ?? '' }) },
});

describe('GROUPS', () => {
  it('三个在册群，悦升云端 requireMention=true', () => {
    expect(GROUPS).toHaveLength(3);
    const ys = GROUPS.find((g) => g.chatId === 'oc_ee3fe04cf2541c4187f0fc054ae826de');
    expect(ys.requireMention).toBe(true);
    expect(GROUPS.find((g) => g.chatId === 'oc_ef60d6e3f199d90dd695b6ecc213d662').requireMention).toBe(false);
  });
});

describe('selectCandidates 判据1', () => {
  const group = { chatId: 'c1', name: '悦升云端', requireMention: true };

  it('requireMention 群：@秋米 的入选', () => {
    const out = selectCandidates([msg({ id: 'm1', men: [BOT], text: '帮我建三个飞书文档' })], group, BOT);
    expect(out.map((m) => m.message_id)).toEqual(['m1']);
  });

  it('requireMention 群：@的是人（非 bot）不入选', () => {
    const out = selectCandidates([msg({ id: 'm2', men: ['ou_xuxiao'], text: '徐老师看下' })], group, BOT);
    expect(out).toEqual([]);
  });

  it('requireMention 群：没有 @ 的不入选', () => {
    expect(selectCandidates([msg({ id: 'm3', text: '表在哪' })], group, BOT)).toEqual([]);
  });

  it('机器人自己发的消息一律不入选', () => {
    const out = selectCandidates([msg({ id: 'm4', from: 'app', men: [BOT] })], group, BOT);
    expect(out).toEqual([]);
  });

  it('requireMention=false 的群：所有人发消息入选', () => {
    const g2 = { chatId: 'c2', name: 'VPS 状态', requireMention: false };
    const out = selectCandidates([msg({ id: 'm5', text: '看下磁盘' }), msg({ id: 'm6', from: 'app' })], g2, BOT);
    expect(out.map((m) => m.message_id)).toEqual(['m5']);
  });

  it('空文本消息不入选（图片/撤回等无可入账内容）', () => {
    expect(selectCandidates([msg({ id: 'm7', men: [BOT], text: '  ' })], group, BOT)).toEqual([]);
  });
});

describe('dedupeResends 判据3', () => {
  const m = (id, ts, text, sender = 'ou_alex') => ({
    message_id: id,
    create_time: String(ts),
    sender: { sender_type: 'user', id: sender },
    body: { content: JSON.stringify({ text }) },
  });

  it('同发送人 30min 内近似重复合并为一条，保留最早那条为 head', () => {
    const out = dedupeResends([
      m('a3', 5_400_000, '我给你五个商品名，你帮我整理到一个表格里'),
      m('a2', 4_320_000, '我给你五个商品名，你帮我整理到一个表格里'),
      m('a1', 3_600_000, '我给你五个商品名，你帮我整理到一个表格里'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].head.message_id).toBe('a1');
    expect(out[0].messageIds.sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('超出 30min 窗口的同文本视为两次交办', () => {
    const out = dedupeResends([
      m('b1', 0, '帮我建个飞书文档'),
      m('b2', 31 * 60 * 1000, '帮我建个飞书文档'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('不同发送人的相同文本不合并', () => {
    const out = dedupeResends([
      m('c1', 0, '帮我建个飞书文档', 'ou_alex'),
      m('c2', 60_000, '帮我建个飞书文档', 'ou_yujin'),
    ]);
    expect(out).toHaveLength(2);
  });

  it('文本不同则不合并', () => {
    const out = dedupeResends([
      m('d1', 0, '帮我建个飞书文档'),
      m('d2', 60_000, '帮我建个多维表'),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('resolveReplyEvidence 回执判定', () => {
  const head = { create_time: '1000000', sender: { sender_type: 'user', id: 'ou_alex' } };
  const bot = (ts) => ({ create_time: String(ts), sender: { sender_type: 'app', id: 'ou_bot' } });

  it('30min 内机器人有回复 → 已响应', () => {
    expect(resolveReplyEvidence(head, [head, bot(1_000_000 + 60_000)])).toBe(true);
  });

  it('机器人回复在交办之前 → 不算响应', () => {
    expect(resolveReplyEvidence(head, [bot(999_000), head])).toBe(false);
  });

  it('超过 30min 才回复 → 不算响应', () => {
    expect(resolveReplyEvidence(head, [head, bot(1_000_000 + 31 * 60 * 1000)])).toBe(false);
  });

  it('全程无机器人消息 → 未响应', () => {
    expect(resolveReplyEvidence(head, [head])).toBe(false);
  });
});

describe('buildTaskRequest 入账参数', () => {
  const head = {
    message_id: 'om_x1',
    create_time: '1789500000000',
    sender: { sender_type: 'user', id: 'ou_alex' },
    body: { content: JSON.stringify({ text: '帮我建三个飞书文档，分别填写公司信息、产品信息、目标人群' }) },
  };
  const group = { chatId: 'oc_ee3f', name: '悦升云端', requireMention: true };

  it('source_id 用飞书 message_id 做幂等键', () => {
    const r = buildTaskRequest({ head, messageIds: ['om_x1'], group, botReplied: true, contextText: 'ctx' });
    expect(r.source).toBe('inbox');
    expect(r.source_id).toBe('om_x1');
  });

  it('有机器人回复 → completed；无回复 → blocked', () => {
    expect(buildTaskRequest({ head, messageIds: ['om_x1'], group, botReplied: true, contextText: '' }).task.status)
      .toBe('completed');
    expect(buildTaskRequest({ head, messageIds: ['om_x1'], group, botReplied: false, contextText: '' }).task.status)
      .toBe('blocked');
  });

  it('绝不产出 queued —— queued 会被 Brain tick 捡走真执行群消息', () => {
    for (const replied of [true, false]) {
      const r = buildTaskRequest({ head, messageIds: ['om_x1'], group, botReplied: replied, contextText: '' });
      expect(r.task.status).not.toBe('queued');
    }
  });

  it('非编码工单：mutation_intent=none / domain=operations', () => {
    const r = buildTaskRequest({ head, messageIds: ['om_x1'], group, botReplied: true, contextText: '' });
    expect(r.mutation_intent).toBe('none');
    expect(r.declared_domain).toBe('operations');
    expect(r.requested_task_type).toBe('workflow_run');
  });

  it('title 截断到 60 字，metadata 带全部 message_id 与群信息', () => {
    const r = buildTaskRequest({
      head, messageIds: ['om_x1', 'om_x2'], group, botReplied: false, contextText: '上下文',
    });
    expect(r.title.length).toBeLessThanOrEqual(60);
    expect(r.metadata.feishu_message_ids).toEqual(['om_x1', 'om_x2']);
    expect(r.metadata.chat_name).toBe('悦升云端');
    expect(r.metadata.bot_replied).toBe(false);
    expect(r.metadata.ledger_only).toBe(true);
    expect(r.description).toContain('上下文');
  });
});

describe('判据2 LLM 语义分类', () => {
  const g = (id, text) => ({
    head: {
      message_id: id,
      create_time: '1000',
      sender: { id: 'ou_alex' },
      body: { content: JSON.stringify({ text }) },
    },
    messageIds: [id],
  });

  it('prompt 含四档定义与真实反例（规则法已否决）', () => {
    const p = buildClassifyPrompt([{ index: 1, text: '帮我建三个飞书文档' }]);
    expect(p).toContain('task');
    expect(p).toContain('question');
    expect(p).toContain('debug_paste');
    expect(p).toContain('chat');
    expect(p).toContain('你拉个会议');
    expect(p).toContain('现在的模型是什么');
  });

  it('parseClassifyResult 解析 JSON 数组', () => {
    const out = parseClassifyResult(
      '[{"index":1,"type":"task"},{"index":2,"type":"question"}]',
      [{ index: 1 }, { index: 2 }],
    );
    expect(out).toEqual(['task', 'question']);
  });

  it('parseClassifyResult 容忍 markdown 代码围栏', () => {
    const out = parseClassifyResult('```json\n[{"index":1,"type":"task"}]\n```', [{ index: 1 }]);
    expect(out).toEqual(['task']);
  });

  it('LLM 返回不可解析时全部降级为 chat（宁漏不错记）', () => {
    expect(parseClassifyResult('抱歉我无法回答', [{ index: 1 }, { index: 2 }])).toEqual(['chat', 'chat']);
  });

  it('未知类别降级为 chat', () => {
    expect(parseClassifyResult('[{"index":1,"type":"urgent"}]', [{ index: 1 }])).toEqual(['chat']);
  });

  it('classifyCandidates 只放行 task', async () => {
    const callLLM = async () => ({ text: '[{"index":1,"type":"task"},{"index":2,"type":"question"}]' });
    const out = await classifyCandidates(
      [g('m1', '帮我建三个飞书文档'), g('m2', '表在哪')],
      { callLLM },
    );
    expect(out.map((x) => x.head.message_id)).toEqual(['m1']);
    expect(out[0].classification).toBe('task');
  });

  it('空输入不调 LLM', async () => {
    let called = false;
    await classifyCandidates([], { callLLM: async () => { called = true; return { text: '[]' }; } });
    expect(called).toBe(false);
  });
});
