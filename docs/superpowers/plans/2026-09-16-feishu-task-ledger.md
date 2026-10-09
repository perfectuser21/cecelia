# 飞书群交办入账 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每小时把飞书群里真正派给秋米的活，识别出来入 Cecelia `tasks` 账并自动投影 Notion。

**Architecture:** 新增 `packages/brain/src/feishu-task-ledger.js`，照 `openclaw-guards.js` 的「纯函数内核 + 注入式 IO」范式。三道判据（@对象机械筛 → LLM 语义分类 → 重发去重）依次过滤，入账走账房 `createRoutedTask`，由 `scheduler-jobs.js` 每 60s 轮询、模块自 gate（整点窗口 + 60min 去重）。

**Tech Stack:** Node 20 ESM / vitest / 飞书 OpenAPI / 既有 `callLLM()` / 既有 `createRoutedTask()`

## Global Constraints

- 所有注释与文档中文；模块单文件不超 500 行
- **禁止任何入账行 `status='queued'`** —— queued + claimed_by IS NULL 会被 Brain tick 每 2 分钟捡走真去执行群消息
- 入账必须走 `createRoutedTask`，禁止 `INSERT INTO tasks`（`task-creation-inventory` 守卫会红）
- 飞书凭据只从 `process.env.FEISHU_APP_ID` / `FEISHU_APP_SECRET` 读；**禁止读 `/opt/openclaw/state/clawdbot.json`**（第三方文件 + 明文 secret）
- bot 身份用 open_id 匹配，禁止按显示名 `'秋米'` 匹配
- 缺凭据时模块 warn 并跳过，不抛错阻塞 scheduler
- 测试文件放 `packages/brain/src/__tests__/feishu-task-ledger.test.js`
- 测试命令：`cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js`
- 每个 task 两段式 commit：commit-1 failing test，commit-2 实现

---

## File Structure

| 文件 | 责任 |
|---|---|
| `packages/brain/src/feishu-task-ledger.js` | 新建。三道判据纯函数 + 飞书 API IO + 编排入口 |
| `packages/brain/src/__tests__/feishu-task-ledger.test.js` | 新建。纯函数单测 + mock IO |
| `packages/brain/src/task-creation-inventory.js` | 修改。新增一行登记 |
| `packages/brain/src/scheduler-jobs.js` | 修改。import + 注册表加一行 |

---

### Task 1: 判据 1 — @ 对象机械筛

**Files:**
- Create: `packages/brain/src/feishu-task-ledger.js`
- Test: `packages/brain/src/__tests__/feishu-task-ledger.test.js`

**Interfaces:**
- Produces: `GROUPS`（冻结数组，每项 `{ chatId, name, requireMention }`）、
  `selectCandidates(messages, group, botOpenId) -> Array<message>`

- [ ] **Step 1: 写 failing test**

```js
import { describe, it, expect } from 'vitest';
import { GROUPS, selectCandidates } from '../feishu-task-ledger.js';

const BOT = 'ou_bot123';
const msg = (o) => ({
  message_id: o.id, create_time: String(o.ts ?? 1000),
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js`
Expected: FAIL — `Failed to resolve import "../feishu-task-ledger.js"`

- [ ] **Step 3: 写最小实现**

```js
/**
 * feishu-task-ledger.js — 飞书群交办入账
 *
 * 主理人在飞书群派给秋米的活 → Cecelia tasks 账 → 自动投影 Notion。
 * 决策：方向 1c6679cd / 判定点 398d5f36。
 * 三道判据（主理人 2026-09-16 拍板）：
 *   ①@ 的必须是秋米不是人 ②秋米能即答、没调 agent 干的不算任务 ③重发去重
 * 全部纯函数内核 + 注入式 IO，可单测。
 */

/** 在册群（来源：OpenClaw clawdbot.json channels.feishu.accounts.main，此处固化，运行时不读第三方配置） */
export const GROUPS = Object.freeze([
  Object.freeze({ chatId: 'oc_ee3fe04cf2541c4187f0fc054ae826de', name: '悦升云端', requireMention: true }),
  Object.freeze({ chatId: 'oc_ef60d6e3f199d90dd695b6ecc213d662', name: 'VPS 状态', requireMention: false }),
  Object.freeze({ chatId: 'oc_e5ff09de4c2e30a332df0d3cf87f41ae', name: '外部Ai体验区', requireMention: true }),
]);

/** 从飞书消息体里取纯文本（text / post 两种 msg_type） */
export function messageText(m) {
  try {
    const c = JSON.parse(m?.body?.content ?? '{}');
    if (typeof c.text === 'string') return c.text;
    if (Array.isArray(c.content)) {
      return c.content.flat().map((seg) => seg?.text ?? '').join('');
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * 判据 1：这条消息是不是"给秋米的"
 * requireMention 群必须 @ 到 bot 的 open_id（禁按显示名匹配——名字可改，open_id 不会）；
 * 非 requireMention 群（如 VPS 状态）所有人发消息都算。
 */
export function selectCandidates(messages, group, botOpenId) {
  return (messages ?? []).filter((m) => {
    if (m?.sender?.sender_type !== 'user') return false;
    if (!messageText(m).trim()) return false;
    if (!group.requireMention) return true;
    return (m.mentions ?? []).some((x) => x?.id?.open_id === botOpenId);
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js`
Expected: PASS（7 个用例）

- [ ] **Step 5: 两段式 commit**

```bash
git add packages/brain/src/__tests__/feishu-task-ledger.test.js
git commit -m "test(brain): 飞书交办判据1 failing test——@对象必须是 bot open_id"
git add packages/brain/src/feishu-task-ledger.js
git commit -m "feat(brain): 飞书交办入账判据1——机械筛 @ 对象"
```

---

### Task 2: 判据 3 — 重发去重

**Files:**
- Modify: `packages/brain/src/feishu-task-ledger.js`
- Test: `packages/brain/src/__tests__/feishu-task-ledger.test.js`

**Interfaces:**
- Consumes: `messageText(m)`
- Produces: `dedupeResends(candidates, windowMs = 30 * 60 * 1000) -> Array<{ head, messageIds: string[] }>`

实测依据：同一任务因秋米无响应被重发 3 次（「整理商品表格」06:30/06:52/06:54）。

- [ ] **Step 1: 写 failing test**

```js
import { dedupeResends } from '../feishu-task-ledger.js';

describe('dedupeResends 判据3', () => {
  const m = (id, ts, text, sender = 'ou_alex') => ({
    message_id: id, create_time: String(ts),
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js -t dedupeResends`
Expected: FAIL — `dedupeResends is not a function`

- [ ] **Step 3: 写最小实现**

```js
/** 归一化文本用于重发比对：去空白、去标点、截断 */
function normalizeForDedupe(text) {
  return text.replace(/\s+/g, '').replace(/[，。！？、,.!?~…]/g, '').slice(0, 60);
}

/**
 * 判据 3：重发去重
 * 实测同一任务因秋米无响应被重发 3 次；不去重则一个活记三行。
 * 同发送人 + 归一化文本相同 + 窗口内 → 合并，保留最早一条为 head。
 */
export function dedupeResends(candidates, windowMs = 30 * 60 * 1000) {
  const sorted = [...(candidates ?? [])].sort(
    (a, b) => Number(a.create_time) - Number(b.create_time),
  );
  const groups = [];
  for (const m of sorted) {
    const key = `${m.sender?.id}::${normalizeForDedupe(messageText(m))}`;
    const hit = groups.find(
      (g) => g.key === key && Number(m.create_time) - Number(g.head.create_time) <= windowMs,
    );
    if (hit) hit.messageIds.push(m.message_id);
    else groups.push({ key, head: m, messageIds: [m.message_id] });
  }
  return groups.map(({ head, messageIds }) => ({ head, messageIds }));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js`
Expected: PASS（11 个用例）

- [ ] **Step 5: 两段式 commit**

```bash
git add packages/brain/src/__tests__/feishu-task-ledger.test.js
git commit -m "test(brain): 飞书交办判据3 failing test——重发去重"
git add packages/brain/src/feishu-task-ledger.js
git commit -m "feat(brain): 飞书交办入账判据3——30min 窗口重发去重"
```

---

### Task 3: 执行回执 + 入账参数组装

**Files:**
- Modify: `packages/brain/src/feishu-task-ledger.js`
- Test: `packages/brain/src/__tests__/feishu-task-ledger.test.js`

**Interfaces:**
- Consumes: `messageText(m)`
- Produces:
  - `resolveReplyEvidence(head, allMessages, windowMs = 30 * 60 * 1000) -> boolean`
  - `buildTaskRequest({ head, messageIds, group, botReplied, contextText }) -> object`（createRoutedTask 入参）

- [ ] **Step 1: 写 failing test**

```js
import { resolveReplyEvidence, buildTaskRequest } from '../feishu-task-ledger.js';

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
    message_id: 'om_x1', create_time: '1789500000000',
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js -t buildTaskRequest`
Expected: FAIL — `resolveReplyEvidence is not a function`

- [ ] **Step 3: 写最小实现**

```js
const REPLY_WINDOW_MS = 30 * 60 * 1000;

/**
 * 执行回执（主理人拍板：用机器回复当凭据）
 * 交办后 windowMs 内同群出现机器人消息 = 已响应。
 */
export function resolveReplyEvidence(head, allMessages, windowMs = REPLY_WINDOW_MS) {
  const t0 = Number(head.create_time);
  return (allMessages ?? []).some((m) => {
    if (m?.sender?.sender_type !== 'app') return false;
    const dt = Number(m.create_time) - t0;
    return dt > 0 && dt <= windowMs;
  });
}

/**
 * 组装 createRoutedTask 入参。
 * 铁律：status 只能是 completed / blocked，绝不 queued——
 * queued + claimed_by IS NULL 会被 Brain tick 每 2 分钟捡走，真去"执行"群里的客户对话。
 */
export function buildTaskRequest({ head, messageIds, group, botReplied, contextText }) {
  const text = messageText(head).trim();
  return {
    source: 'inbox',
    source_id: head.message_id,
    title: text.replace(/\s+/g, ' ').slice(0, 60),
    description: contextText ? `${text}\n\n--- 群内上下文 ---\n${contextText}` : text,
    mutation_intent: 'none',
    declared_domain: 'operations',
    requested_task_type: 'workflow_run',
    metadata: {
      feishu_message_id: head.message_id,
      feishu_message_ids: messageIds,
      chat_id: group.chatId,
      chat_name: group.name,
      sender_open_id: head.sender?.id ?? null,
      create_time: head.create_time,
      bot_replied: botReplied,
      ledger_only: true,
    },
    task: {
      status: botReplied ? 'completed' : 'blocked',
      priority: 'P2',
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js`
Expected: PASS（20 个用例）

- [ ] **Step 5: 两段式 commit**

```bash
git add packages/brain/src/__tests__/feishu-task-ledger.test.js
git commit -m "test(brain): 飞书交办回执判定+入账组装 failing test（含禁 queued 负向断言）"
git add packages/brain/src/feishu-task-ledger.js
git commit -m "feat(brain): 飞书交办回执判定与 createRoutedTask 入参组装"
```

---

### Task 4: 判据 2 — LLM 语义分类

**Files:**
- Modify: `packages/brain/src/feishu-task-ledger.js`
- Test: `packages/brain/src/__tests__/feishu-task-ledger.test.js`

**Interfaces:**
- Consumes: `messageText(m)`
- Produces:
  - `buildClassifyPrompt(items) -> string`
  - `parseClassifyResult(raw, items) -> Array<'task'|'question'|'debug_paste'|'chat'>`
  - `classifyCandidates(groups, { callLLM }) -> Promise<Array<{ head, messageIds, classification }>>`

- [ ] **Step 1: 写 failing test**

```js
import { buildClassifyPrompt, parseClassifyResult, classifyCandidates } from '../feishu-task-ledger.js';

describe('判据2 LLM 语义分类', () => {
  const g = (id, text) => ({
    head: { message_id: id, create_time: '1000', sender: { id: 'ou_alex' },
            body: { content: JSON.stringify({ text }) } },
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
    const out = parseClassifyResult('[{"index":1,"type":"task"},{"index":2,"type":"question"}]',
      [{ index: 1 }, { index: 2 }]);
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
      [g('m1', '帮我建三个飞书文档'), g('m2', '表在哪')], { callLLM });
    expect(out.map((x) => x.head.message_id)).toEqual(['m1']);
    expect(out[0].classification).toBe('task');
  });

  it('空输入不调 LLM', async () => {
    let called = false;
    await classifyCandidates([], { callLLM: async () => { called = true; return { text: '[]' }; } });
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js -t 判据2`
Expected: FAIL — `buildClassifyPrompt is not a function`

- [ ] **Step 3: 写最小实现**

```js
const CLASSES = Object.freeze(['task', 'question', 'debug_paste', 'chat']);

/**
 * 判据 2 的 prompt（主理人拍板：秋米能即答、没调 agent 干的不算任务）。
 * 规则法已否决——「你拉个会议」5 字是任务，「现在的模型是什么」7 字是提问，
 * 长度与关键词都不可分，必须语义判。
 */
export function buildClassifyPrompt(items) {
  const lines = items.map((it) => `${it.index}. ${it.text.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
  return `你在判断飞书群里主理人发给 AI 助理「秋米」的消息，哪些是真正布置的任务。

四档分类：
- task：要求秋米执行动作并产出结果。例：「帮我建三个飞书文档，分别填写公司信息、产品信息、目标人群」「把抖音读昵称这个操作沉淀成一个 Skill」「你拉个会议」
- question：只是索取信息，秋米答一句就完了。例：「表在哪」「现在的模型是什么」「悦升云端的获客列表在哪？」
- debug_paste：粘贴报错、终端输出、日志求解释，不是交办新活
- chat：状态告知、闲聊、确认。例：「授权成功了」「在吗？」「他还在找」

判断要点：要求秋米去"做一件事并交付产出"才是 task；秋米当场回答一句就能完结的不是 task。

待分类消息：
${lines}

只输出 JSON 数组，不要任何解释文字，格式：
[{"index":1,"type":"task"},{"index":2,"type":"question"}]`;
}

/** 解析分类结果；任何不可解析/未知类别一律降级 chat（宁漏不错记） */
export function parseClassifyResult(raw, items) {
  const fallback = items.map(() => 'chat');
  const text = String(raw ?? '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return fallback;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return fallback;
  }
  if (!Array.isArray(parsed)) return fallback;
  const byIndex = new Map(parsed.map((p) => [Number(p?.index), String(p?.type)]));
  return items.map((it) => {
    const t = byIndex.get(Number(it.index));
    return CLASSES.includes(t) ? t : 'chat';
  });
}

/** 判据 2：过 LLM，只放行 task */
export async function classifyCandidates(groups, { callLLM }) {
  if (!groups || groups.length === 0) return [];
  const items = groups.map((g, i) => ({ index: i + 1, text: messageText(g.head) }));
  const { text } = await callLLM('thalamus', buildClassifyPrompt(items), { timeout: 60_000 });
  const types = parseClassifyResult(text, items);
  return groups
    .map((g, i) => ({ ...g, classification: types[i] }))
    .filter((g) => g.classification === 'task');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js`
Expected: PASS（27 个用例）

- [ ] **Step 5: 两段式 commit**

```bash
git add packages/brain/src/__tests__/feishu-task-ledger.test.js
git commit -m "test(brain): 飞书交办判据2 failing test——LLM 四档分类与降级"
git add packages/brain/src/feishu-task-ledger.js
git commit -m "feat(brain): 飞书交办入账判据2——LLM 语义分类只放行 task"
```

---

### Task 5: 飞书 API 客户端

**Files:**
- Modify: `packages/brain/src/feishu-task-ledger.js`
- Test: `packages/brain/src/__tests__/feishu-task-ledger.test.js`

**Interfaces:**
- Produces:
  - `fetchTenantToken({ fetchFn, appId, appSecret }) -> Promise<string>`
  - `fetchBotOpenId({ fetchFn, token }) -> Promise<string>`
  - `fetchGroupMessages({ fetchFn, token, chatId, startTimeSec }) -> Promise<Array<message>>`（自动翻页）

- [ ] **Step 1: 写 failing test**

```js
import { fetchTenantToken, fetchBotOpenId, fetchGroupMessages } from '../feishu-task-ledger.js';

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
    const fetchFn = async (url) => { urls.push(url); return jsonRes(pages[n++]); };
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js -t 飞书 API`
Expected: FAIL — `fetchTenantToken is not a function`

- [ ] **Step 3: 写最小实现**

```js
const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

async function feishuJson(fetchFn, url, init) {
  const res = await fetchFn(url, init);
  const body = await res.json();
  if (body?.code !== 0) {
    throw new Error(`feishu_api_error: ${body?.msg ?? 'unknown'} (code=${body?.code})`);
  }
  return body;
}

export async function fetchTenantToken({ fetchFn, appId, appSecret }) {
  const body = await feishuJson(fetchFn, `${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  return body.tenant_access_token;
}

/** bot 自身 open_id——身份判定只认它，显示名可被改 */
export async function fetchBotOpenId({ fetchFn, token }) {
  const body = await feishuJson(fetchFn, `${FEISHU_BASE}/bot/v3/info`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return body?.bot?.open_id ?? null;
}

export async function fetchGroupMessages({ fetchFn, token, chatId, startTimeSec }) {
  const out = [];
  let pageToken = null;
  do {
    let url = `${FEISHU_BASE}/im/v1/messages?container_id_type=chat&container_id=${chatId}`
      + `&page_size=50&sort_type=ByCreateTimeDesc&start_time=${startTimeSec}`;
    if (pageToken) url += `&page_token=${pageToken}`;
    const body = await feishuJson(fetchFn, url, { headers: { Authorization: `Bearer ${token}` } });
    out.push(...(body.data?.items ?? []));
    pageToken = body.data?.has_more ? body.data?.page_token : null;
  } while (pageToken);
  return out;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js`
Expected: PASS（32 个用例）

- [ ] **Step 5: 两段式 commit**

```bash
git add packages/brain/src/__tests__/feishu-task-ledger.test.js
git commit -m "test(brain): 飞书 API 客户端 failing test——token/bot open_id/翻页"
git add packages/brain/src/feishu-task-ledger.js
git commit -m "feat(brain): 飞书 OpenAPI 客户端（tenant token / bot open_id / 群消息翻页）"
```

---

### Task 6: 编排入口 + 上下文组装 + 守卫登记

**Files:**
- Modify: `packages/brain/src/feishu-task-ledger.js`
- Modify: `packages/brain/src/task-creation-inventory.js`
- Test: `packages/brain/src/__tests__/feishu-task-ledger.test.js`

**Interfaces:**
- Consumes: 前 5 个 task 的全部导出
- Produces: `buildContextText(head, messages, radius = 3) -> string`、
  `runFeishuTaskLedger(pool, deps = {}) -> Promise<{ skipped?, scanned, created }>`

- [ ] **Step 1: 写 failing test**

```js
import { buildContextText, runFeishuTaskLedger } from '../feishu-task-ledger.js';
import { TASK_CREATION_INVENTORY } from '../task-creation-inventory.js';

describe('buildContextText', () => {
  const m = (id, ts, text) => ({ message_id: id, create_time: String(ts),
    sender: { sender_type: 'user', id: 'ou_a' }, body: { content: JSON.stringify({ text }) } });

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
      { message_id: 'm1', create_time: '2000', sender: { sender_type: 'user', id: 'ou_alex' },
        mentions: [{ id: { open_id: 'ou_bot' } }],
        body: { content: JSON.stringify({ text: '帮我建三个飞书文档' }) } },
      { message_id: 'm2', create_time: '3000', sender: { sender_type: 'user', id: 'ou_alex' },
        mentions: [{ id: { open_id: 'ou_bot' } }],
        body: { content: JSON.stringify({ text: '表在哪' }) } },
      { message_id: 'm3', create_time: '4000', sender: { sender_type: 'app', id: 'ou_bot' },
        body: { content: JSON.stringify({ text: '好的，已建好' }) } },
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js -t runFeishuTaskLedger`
Expected: FAIL — `runFeishuTaskLedger is not a function`

- [ ] **Step 3: 写最小实现（模块）**

```js
import { callLLM as defaultCallLLM } from './llm-caller.js';
import { createRoutedTask as defaultCreateRoutedTask } from './work-routing-store.js';

const LOOKBACK_SEC = 14 * 24 * 3600;

/** 取 head 前后各 radius 条做上下文——「你拉个会议」这类短指令离开上下文不可解 */
export function buildContextText(head, messages, radius = 3) {
  const sorted = [...messages].sort((a, b) => Number(a.create_time) - Number(b.create_time));
  const idx = sorted.findIndex((m) => m.message_id === head.message_id);
  if (idx < 0) return '';
  return sorted
    .slice(Math.max(0, idx - radius), idx + radius + 1)
    .map((m) => {
      const who = m.sender?.sender_type === 'app' ? '秋米' : '人';
      const mark = m.message_id === head.message_id ? '>>> ' : '    ';
      return `${mark}[${who}] ${messageText(m).replace(/\s+/g, ' ').slice(0, 120)}`;
    })
    .join('\n');
}

/** scheduler 入口：拉群消息 → 三道判据 → 入账 */
export async function runFeishuTaskLedger(pool, deps = {}) {
  const env = deps.env ?? process.env;
  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    console.warn('[feishu-task-ledger] 缺 FEISHU_APP_ID/FEISHU_APP_SECRET，跳过');
    return { skipped: 'missing_credentials', scanned: 0, created: 0 };
  }
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const fetchToken = deps.fetchTokenFn ?? (() => fetchTenantToken({ fetchFn, appId, appSecret }));
  const fetchBot = deps.fetchBotOpenIdFn ?? ((token) => fetchBotOpenId({ fetchFn, token }));
  const fetchMessages = deps.fetchMessagesFn
    ?? (({ token, chatId, startTimeSec }) => fetchGroupMessages({ fetchFn, token, chatId, startTimeSec }));
  const callLLMFn = deps.callLLM ?? defaultCallLLM;
  const createTask = deps.createRoutedTaskFn ?? defaultCreateRoutedTask;
  const sinceSec = deps.sinceSec ?? Math.floor(Date.now() / 1000) - LOOKBACK_SEC;

  const token = await fetchToken();
  const botOpenId = await fetchBot(token);
  let scanned = 0;
  let created = 0;
  const errors = [];

  for (const group of GROUPS) {
    try {
      const messages = await fetchMessages({ token, chatId: group.chatId, startTimeSec: sinceSec });
      scanned += messages.length;
      const candidates = selectCandidates(messages, group, botOpenId);
      const deduped = dedupeResends(candidates);
      const tasks = await classifyCandidates(deduped, { callLLM: callLLMFn });
      for (const t of tasks) {
        const req = buildTaskRequest({
          head: t.head,
          messageIds: t.messageIds,
          group,
          botReplied: resolveReplyEvidence(t.head, messages),
          contextText: buildContextText(t.head, messages),
        });
        req.metadata.classification = t.classification;
        await createTask(pool, req);
        created += 1;
      }
    } catch (err) {
      console.error(`[feishu-task-ledger] 群 ${group.chatId} 处理失败: ${err.message}`);
      errors.push(group.chatId);
    }
  }
  return { scanned, created, errors };
}
```

- [ ] **Step 4: 登记 task-creation-inventory**

在 `packages/brain/src/task-creation-inventory.js` 的 `notion-push-sync.js` 那一行后面插入：

```js
  // 2026-09-16 飞书群交办入账（决策 1c6679cd）：群里派给秋米的活 → tasks 账本留痕，
  // 状态只写 completed/blocked，不产可执行任务
  { module: 'feishu-task-ledger.js', source: 'inbox', creates_executable_task: false, migration_status: 'routed' },
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js`
Expected: PASS（37 个用例）

- [ ] **Step 6: 两段式 commit**

```bash
git add packages/brain/src/__tests__/feishu-task-ledger.test.js
git commit -m "test(brain): 飞书交办编排 failing test——端到端只放行 task + 错误隔离 + inventory 登记"
git add packages/brain/src/feishu-task-ledger.js packages/brain/src/task-creation-inventory.js
git commit -m "feat(brain): 飞书交办入账编排入口 + task-creation-inventory 登记"
```

---

### Task 7: scheduler 注册 + 自 gate

**Files:**
- Modify: `packages/brain/src/feishu-task-ledger.js`
- Modify: `packages/brain/src/scheduler-jobs.js`
- Test: `packages/brain/src/__tests__/feishu-task-ledger.test.js`

**Interfaces:**
- Produces: `maybeRunFeishuTaskLedger(pool, deps) -> Promise<{ skipped? } | result>`（60min 自 gate 包装）

- [ ] **Step 1: 写 failing test**

```js
import { maybeRunFeishuTaskLedger, _resetFeishuLedgerGate } from '../feishu-task-ledger.js';

describe('maybeRunFeishuTaskLedger 自 gate', () => {
  it('60 分钟内第二次调用被 gate 挡下', async () => {
    _resetFeishuLedgerGate();
    const deps = { env: {}, now: () => 1_000_000 };
    const first = await maybeRunFeishuTaskLedger({}, deps);
    expect(first.skipped).toBe('missing_credentials');
    const second = await maybeRunFeishuTaskLedger({}, { ...deps, now: () => 1_000_000 + 60_000 });
    expect(second.skipped).toBe('cooldown');
  });

  it('超过 60 分钟后放行', async () => {
    _resetFeishuLedgerGate();
    await maybeRunFeishuTaskLedger({}, { env: {}, now: () => 0 });
    const out = await maybeRunFeishuTaskLedger({}, { env: {}, now: () => 61 * 60 * 1000 });
    expect(out.skipped).toBe('missing_credentials');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/feishu-task-ledger.test.js -t 自 gate`
Expected: FAIL — `maybeRunFeishuTaskLedger is not a function`

- [ ] **Step 3: 写最小实现**

```js
const GATE_INTERVAL_MS = 60 * 60 * 1000;
let _lastRunAt = 0;

/** 测试用：重置 gate 状态 */
export function _resetFeishuLedgerGate() { _lastRunAt = 0; }

/** scheduler 每 60s 调一次，本函数自 gate 到 60min 一跑 */
export async function maybeRunFeishuTaskLedger(pool, deps = {}) {
  const now = (deps.now ?? Date.now)();
  if (_lastRunAt && now - _lastRunAt < GATE_INTERVAL_MS) return { skipped: 'cooldown' };
  _lastRunAt = now;
  return runFeishuTaskLedger(pool, deps);
}
```

- [ ] **Step 4: 注册到 scheduler-jobs.js**

在 import 区（`runOpenclawGuards` 那行附近）加：

```js
import { maybeRunFeishuTaskLedger } from './feishu-task-ledger.js';
```

在注册表里 `openclaw-guards` 那一行后面加：

```js
  { name: 'feishu-task-ledger', needsPool: true, timeoutMs: 120_000, handler: (pool) => maybeRunFeishuTaskLedger(pool), description: '飞书群交办入账（决策1c6679cd）：群里派给秋米的活经三道判据入 tasks 账并投影 Notion，自 gate 60min' },
```

- [ ] **Step 5: 跑全量 brain 测试**

Run: `cd packages/brain && npm test`
Expected: PASS，无回归

- [ ] **Step 6: 两段式 commit**

```bash
git add packages/brain/src/__tests__/feishu-task-ledger.test.js
git commit -m "test(brain): 飞书交办 scheduler 自 gate failing test"
git add packages/brain/src/feishu-task-ledger.js packages/brain/src/scheduler-jobs.js
git commit -m "feat(brain): 飞书交办入账注册进 scheduler（60min 自 gate）"
```

---

### Task 8: 凭据落位 + 部署

**Files:**
- 无 repo 文件改动（凭据不入 git）

- [ ] **Step 1: 录入 1Password**

```bash
source ~/.credentials/1password.env && export OP_SERVICE_ACCOUNT_TOKEN
op item create --category "API Credential" --title "Feishu-Qiumi-Bot" --vault CS \
  "app_id=<秋米 appId>" "app_secret=<秋米 appSecret>" \
  --tags feishu,openclaw
```

秋米凭据当前明文位于 us-vps `/opt/openclaw/state/clawdbot.json` → `channels.feishu.accounts.main`。
读取方式（不要 echo 到终端）：`ssh us-vps "python3 -c \"import json;d=json.load(open('/opt/openclaw/state/clawdbot.json'))['channels']['feishu']['accounts']['main'];print(d['appId'])\""`

- [ ] **Step 2: 注入 Brain 容器 env**

在 us-vps 的 Brain compose env 文件加 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 两行，然后：

```bash
ssh us-vps 'cd /root/cecelia && COMPOSE_PROJECT_NAME=cecelia docker compose up -d cecelia-node-brain'
ssh us-vps 'docker exec cecelia-node-brain sh -c "printenv FEISHU_APP_SECRET | wc -c"'
```

Expected: 输出 > 1（非 0 即凭据已注入）

- [ ] **Step 3: 部署新镜像（走 MMV 交叉构建 SOP）**

按 memory `usvps-image-build-via-mmv`：`--platform linux/amd64` 在 MMV 构建 → save/load 到 us-vps → 先验后删旧镜像。

- [ ] **Step 4: 确认 scheduler 已挂上**

```bash
ssh us-vps 'docker logs cecelia-node-brain --since 5m 2>&1 | grep -i feishu-task-ledger | head'
```

Expected: 出现该 job 的运行日志（或 `缺 FEISHU_APP_ID` 的 warn，若 env 尚未注入）

---

### Task 9: Final E2E 验收

**Files:**
- 无代码改动，纯验证

- [ ] **Step 1: 触发一次真实归集**

```bash
ssh us-vps 'docker exec cecelia-node-brain node --input-type=module -e "
import pool from \"/root/cecelia/packages/brain/src/db.js\";
import { runFeishuTaskLedger } from \"/root/cecelia/packages/brain/src/feishu-task-ledger.js\";
const r = await runFeishuTaskLedger(pool, {});
console.log(JSON.stringify(r));
process.exit(0);
"'
```

Expected: `{"scanned":<>0,"created":<>0,"errors":[]}`

- [ ] **Step 2: 断言 1 — 入账计数 > 0**

```bash
curl -s "localhost:5221/api/brain/tasks?limit=100" | python3 -c "
import json,sys
rows=json.load(sys.stdin)
hit=[r for r in rows if (r.get('payload') or {}).get('feishu_message_id')]
print('入账行数:', len(hit)); assert len(hit) > 0"
```

- [ ] **Step 3: 断言 2 — 抽 3 条与飞书原文逐字比对**

抽 3 行的 `payload.feishu_message_id`，用 `im/v1/messages/<message_id>` 拉原文，比对 `title` 是否为原文前 60 字、`create_time` 是否一致。

- [ ] **Step 4: 断言 3 — 幂等（再跑一次计数不翻倍）**

重复 Step 1 后重新数 Step 2 的计数，必须与第一次相同。

- [ ] **Step 5: 断言 4 — Notion Tasks 库读回**

```bash
source ~/.credentials/1password.env && export OP_SERVICE_ACCOUNT_TOKEN
NOTION_KEY=$(op item get "Notion" --vault CS --fields credential --reveal | tr -d '"')
```

用 Notion API 查询 Tasks 库，确认这些标题出现（不接受"应该会推"）。

- [ ] **Step 6: 断言 5/6/7 — 三条负向**

```bash
curl -s "localhost:5221/api/brain/tasks?limit=200" | python3 -c "
import json,sys
rows=[r for r in json.load(sys.stdin) if (r.get('payload') or {}).get('feishu_message_id')]
# 5: 提问未入账
assert not [r for r in rows if r['title'].strip() in ('表在哪','现在的模型是什么','在吗？')], '提问被误入账'
# 6: 重发只入一行
ids=[(r.get('payload') or {}).get('feishu_message_id') for r in rows]
assert len(ids)==len(set(ids)), '存在重复 message_id'
# 7: 无任何 queued
assert not [r for r in rows if r['status']=='queued'], '出现 queued，会被 tick 误执行'
print('三条负向断言全过, 共', len(rows), '行')"
```

- [ ] **Step 7: 断言 8 — CI 全绿**

```bash
gh pr checks --watch
```

---

## Self-Review 结论

- **Spec 覆盖**：第 3 节数据源→Task 5；第 4 节三道判据→Task 1/4/2；第 5 节回执→Task 3；第 6 节入账→Task 3/6；第 7 节水位→Task 6（`sinceSec` 默认回溯 14 天，幂等由 `source_id` 兜底）；第 8 节凭据→Task 8；第 9 节模块结构→Task 1-7；第 10 节测试→各 task 内嵌 + Task 9。无遗漏。
- **占位符**：无 TBD/TODO；每个代码步骤均含完整可运行代码。
- **类型一致**：`messageText` / `selectCandidates(messages, group, botOpenId)` / `dedupeResends -> {head, messageIds}` / `buildTaskRequest({head, messageIds, group, botReplied, contextText})` / `classifyCandidates(groups, {callLLM}) -> {head, messageIds, classification}` 在各 task 间签名一致。
