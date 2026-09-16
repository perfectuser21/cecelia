/**
 * feishu-task-ledger.test.js — 飞书群交办入账
 * 判据来源：主理人 2026-09-16 拍板（决策 1c6679cd / 判定点 398d5f36）
 */
import { describe, it, expect } from 'vitest';
import {
  GROUPS, selectCandidates, dedupeResends, resolveReplyEvidence, buildTaskRequest,
  fetchTenantToken, fetchBotOpenId, fetchGroupMessages,
  buildContextText, runFeishuTaskLedger,
  maybeRunFeishuTaskLedger, _resetFeishuLedgerGate,
  resolveDisposition, dispositionToStatus, parseRunRows,
} from '../feishu-task-ledger.js';
import { TASK_CREATION_INVENTORY } from '../task-creation-inventory.js';

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

const jsonRes = (obj) => ({ ok: true, json: async () => obj });

describe('飞书 API 客户端', () => {
  it('fetchTenantToken 取 token', async () => {
    const fetchFn = async () => jsonRes({ code: 0, tenant_access_token: 'tk1' });
    expect(await fetchTenantToken({ fetchFn, appId: 'a', appSecret: 'b' })).toBe('tk1');
  });

  it('fetchTenantToken 非 0 code 抛错', async () => {
    const fetchFn = async () => jsonRes({ code: 99991663, msg: 'app not found' });
    await expect(fetchTenantToken({ fetchFn, appId: 'a', appSecret: 'b' })).rejects.toThrow('app not found');
  });

  it('fetchBotOpenId 取 bot.open_id（不按显示名）', async () => {
    const fetchFn = async () => jsonRes({ code: 0, bot: { open_id: 'ou_bot9', app_name: '秋米' } });
    expect(await fetchBotOpenId({ fetchFn, token: 'tk' })).toBe('ou_bot9');
  });

  it('fetchGroupMessages 自动翻页并合并', async () => {
    const pages = [
      { code: 0, data: { items: [{ message_id: 'm1' }], has_more: true, page_token: 'p2' } },
      { code: 0, data: { items: [{ message_id: 'm2' }], has_more: false } },
    ];
    let n = 0;
    const urls = [];
    const fetchFn = async (url) => { urls.push(url); const r = jsonRes(pages[n]); n += 1; return r; };
    const out = await fetchGroupMessages({ fetchFn, token: 'tk', chatId: 'c1', startTimeSec: 100 });
    expect(out.map((m) => m.message_id)).toEqual(['m1', 'm2']);
    expect(urls[0]).toContain('start_time=100');
    expect(urls[1]).toContain('page_token=p2');
  });

  it('fetchGroupMessages 遇到 API 错误码抛错', async () => {
    const fetchFn = async () => jsonRes({ code: 230002, msg: 'no permission' });
    await expect(fetchGroupMessages({ fetchFn, token: 'tk', chatId: 'c1', startTimeSec: 1 }))
      .rejects.toThrow('no permission');
  });
});

describe('buildContextText', () => {
  const m = (id, ts, text) => ({
    message_id: id,
    create_time: String(ts),
    sender: { sender_type: 'user', id: 'ou_a' },
    body: { content: JSON.stringify({ text }) },
  });

  it('取前后各 N 条，标出 head', () => {
    const all = [m('a', 1, '一'), m('b', 2, '二'), m('c', 3, '三'), m('d', 4, '四')];
    const ctx = buildContextText(all[2], all, 1);
    expect(ctx).toContain('二');
    expect(ctx).toContain('四');
    expect(ctx).toContain('>>>');
  });
});

describe('runFeishuTaskLedger', () => {
  it('缺凭据时跳过且不抛错', async () => {
    const out = await runFeishuTaskLedger({}, { env: {} });
    expect(out.skipped).toBe('missing_credentials');
  });

  it('端到端：只有 task 入账，且用 createRoutedTask', async () => {
    const created = [];
    const msgs = [
      {
        message_id: 'm1',
        create_time: '2000',
        sender: { sender_type: 'user', id: 'ou_alex' },
        mentions: [{ id: { open_id: 'ou_bot' } }],
        body: { content: JSON.stringify({ text: '帮我建三个飞书文档' }) },
      },
      {
        message_id: 'm2',
        create_time: '3000',
        sender: { sender_type: 'user', id: 'ou_alex' },
        mentions: [{ id: { open_id: 'ou_bot' } }],
        body: { content: JSON.stringify({ text: '表在哪' }) },
      },
      {
        message_id: 'm3',
        create_time: '4000',
        sender: { sender_type: 'app', id: 'ou_bot' },
        body: { content: JSON.stringify({ text: '好的，已建好' }) },
      },
    ];
    const out = await runFeishuTaskLedger({}, {
      env: { FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 'b' },
      fetchTokenFn: async () => 'tk',
      fetchBotOpenIdFn: async () => 'ou_bot',
      fetchMessagesFn: async ({ chatId }) => (chatId === 'oc_ee3fe04cf2541c4187f0fc054ae826de' ? msgs : []),
      callLLM: async () => ({ text: '[{"index":1,"type":"task"},{"index":2,"type":"question"}]' }),
      createRoutedTaskFn: async (_db, req) => { created.push(req); return { task: { id: 'x' } }; },
      sinceSec: 1,
    });
    expect(out.created).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0].source_id).toBe('m1');
    expect(created[0].task.status).toBe('completed');
    expect(created[0].task.status).not.toBe('queued');
  });

  it('单群失败不影响其他群（错误隔离）', async () => {
    const out = await runFeishuTaskLedger({}, {
      env: { FEISHU_APP_ID: 'a', FEISHU_APP_SECRET: 'b' },
      fetchTokenFn: async () => 'tk',
      fetchBotOpenIdFn: async () => 'ou_bot',
      fetchMessagesFn: async ({ chatId }) => {
        if (chatId === 'oc_ee3fe04cf2541c4187f0fc054ae826de') throw new Error('boom');
        return [];
      },
      callLLM: async () => ({ text: '[]' }),
      createRoutedTaskFn: async () => ({ task: { id: 'x' } }),
      sinceSec: 1,
    });
    expect(out.errors).toContain('oc_ee3fe04cf2541c4187f0fc054ae826de');
  });
});

describe('task-creation-inventory 登记', () => {
  it('feishu-task-ledger.js 已登记且标记为非可执行任务', () => {
    const row = TASK_CREATION_INVENTORY.find((r) => r.module === 'feishu-task-ledger.js');
    expect(row).toBeTruthy();
    expect(row.source).toBe('inbox');
    expect(row.creates_executable_task).toBe(false);
  });
});

describe('maybeRunFeishuTaskLedger 自 gate', () => {
  it('60 分钟内第二次调用被 gate 挡下', async () => {
    _resetFeishuLedgerGate();
    const first = await maybeRunFeishuTaskLedger({}, { env: {}, now: () => 1_000_000 });
    expect(first.skipped).toBe('missing_credentials');
    const second = await maybeRunFeishuTaskLedger({}, { env: {}, now: () => 1_000_000 + 60_000 });
    expect(second.skipped).toBe('cooldown');
  });

  it('超过 60 分钟后放行', async () => {
    _resetFeishuLedgerGate();
    await maybeRunFeishuTaskLedger({}, { env: {}, now: () => 1 });
    const out = await maybeRunFeishuTaskLedger({}, { env: {}, now: () => 61 * 60 * 1000 });
    expect(out.skipped).toBe('missing_credentials');
  });
});

// ── 回归：飞书历史消息 API 的 mentions[].id 是字符串，不是 {open_id} ──────────
// 2026-09-16 生产实证：im/v1/messages 返回 {"id":"ou_xxx","id_type":"open_id","name":"徐啸"}，
// 而 webhook 事件里是 {"id":{"open_id":"ou_xxx"}}。模块原先只认后者 →
// requireMention 群候选恒空 → 悦升云端群一条都入不了账。
describe('selectCandidates — mentions.id 两种形态都要认（回归）', () => {
  const group = { chatId: 'c1', name: '悦升云端', requireMention: true };
  const BOT2 = 'ou_bot123';
  const mk = (id, mentions) => ({
    message_id: id,
    create_time: '1000',
    sender: { sender_type: 'user', id: 'ou_alex' },
    mentions,
    body: { content: JSON.stringify({ text: '帮我建三个飞书文档' }) },
  });

  it('扁平字符串形态（历史消息 API）能匹配', () => {
    const out = selectCandidates(
      [mk('h1', [{ id: BOT2, id_type: 'open_id', name: '秋米' }])], group, BOT2,
    );
    expect(out.map((m) => m.message_id)).toEqual(['h1']);
  });

  it('嵌套对象形态（webhook 事件）能匹配', () => {
    const out = selectCandidates([mk('w1', [{ id: { open_id: BOT2 } }])], group, BOT2);
    expect(out.map((m) => m.message_id)).toEqual(['w1']);
  });

  it('扁平形态下 @ 的是人仍然不入选', () => {
    const out = selectCandidates(
      [mk('h2', [{ id: 'ou_xuxiao', id_type: 'open_id', name: '徐啸' }])], group, BOT2,
    );
    expect(out).toEqual([]);
  });
});

// ── 三态机械判定：有 run / 无 run 但有回复 / 无 run 也没回复 ────────────────
describe('resolveDisposition 三态机械判定（零 LLM）', () => {
  const heads = (ts) => ({
    message_id: 'm' + ts,
    create_time: String(ts),
    sender: { sender_type: 'user', id: 'ou_alex' },
    body: { content: JSON.stringify({ text: '帮我建三个飞书文档' }) },
  });
  const botMsg = (ts) => ({
    message_id: 'b' + ts, create_time: String(ts),
    sender: { sender_type: 'app', id: 'ou_bot' },
    body: { content: JSON.stringify({ text: '好的' }) },
  });
  const run = (ts) => ({ created_at: ts });

  it('交办后窗口内有 run → executed（任务，已办）', () => {
    const d = resolveDisposition({
      head: heads(1_000_000), messageIds: ['m1000000'],
      messages: [heads(1_000_000)], runs: [run(1_000_000 + 60_000)],
    });
    expect(d).toBe('executed');
  });

  it('无 run 但秋米有回复 → answered（当场答完的提问，不入账）', () => {
    const d = resolveDisposition({
      head: heads(2_000_000), messageIds: ['m2000000'],
      messages: [heads(2_000_000), botMsg(2_000_000 + 30_000)], runs: [],
    });
    expect(d).toBe('answered');
  });

  it('无 run 也没回复 → dropped（派了没人管，必须入账 blocked）', () => {
    const d = resolveDisposition({
      head: heads(3_000_000), messageIds: ['m3000000'],
      messages: [heads(3_000_000)], runs: [],
    });
    expect(d).toBe('dropped');
  });

  it('重发组内任一条命中 run 即算 executed（run 常挂在后一次重发上）', () => {
    // 实测：06:30 首发无响应 → 06:52 重发才触发 run；head 取最早那条
    const first = heads(4_000_000);
    const resend = heads(4_000_000 + 22 * 60 * 1000);
    const d = resolveDisposition({
      head: first,
      messageIds: [first.message_id, resend.message_id],
      messages: [first, resend],
      runs: [run(4_000_000 + 22 * 60 * 1000 + 60_000)],
    });
    expect(d).toBe('executed');
  });

  it('run 发生在交办之前 → 不算', () => {
    const d = resolveDisposition({
      head: heads(5_000_000), messageIds: ['m5000000'],
      messages: [heads(5_000_000)], runs: [run(5_000_000 - 60_000)],
    });
    expect(d).toBe('dropped');
  });

  it('automation_run（cron 定时）不算响应群消息的执行', () => {
    const d = resolveDisposition({
      head: heads(6_000_000), messageIds: ['m6000000'],
      messages: [heads(6_000_000)],
      runs: [{ created_at: 6_000_000 + 60_000, task_kind: 'automation_run' }],
    });
    expect(d).toBe('dropped');
  });
});

describe('dispositionToStatus 三态 → 入账状态', () => {
  it('executed → completed；dropped → blocked；answered → 不入账(null)', () => {
    expect(dispositionToStatus('executed')).toBe('completed');
    expect(dispositionToStatus('dropped')).toBe('blocked');
    expect(dispositionToStatus('answered')).toBe(null);
  });

  it('三态都不产出 queued', () => {
    for (const d of ['executed', 'answered', 'dropped']) {
      expect(dispositionToStatus(d)).not.toBe('queued');
    }
  });
});

describe('parseRunRows — sqlite CLI -json 输出解析', () => {
  it('解析出 created_at 数值与 task_kind', () => {
    const rows = parseRunRows('[{"created_at":1789500000000,"task_kind":"exec","runtime":"cli"}]');
    expect(rows).toEqual([{ created_at: 1789500000000, task_kind: 'exec', runtime: 'cli' }]);
  });

  it('空输出 → 空数组（库里该 agent 无 run 是正常情况）', () => {
    expect(parseRunRows('')).toEqual([]);
    expect(parseRunRows('[]')).toEqual([]);
  });

  it('坏输出 → 空数组，不抛错（守卫不能因第三方库异常而崩）', () => {
    expect(parseRunRows('Error: no such table')).toEqual([]);
  });
});
