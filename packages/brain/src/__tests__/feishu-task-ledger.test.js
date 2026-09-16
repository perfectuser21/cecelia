/**
 * feishu-task-ledger.test.js — 飞书群交办入账
 * 判据来源：主理人 2026-09-16 拍板（决策 1c6679cd / 判定点 398d5f36）
 */
import { describe, it, expect } from 'vitest';
import { GROUPS, selectCandidates } from '../feishu-task-ledger.js';

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
