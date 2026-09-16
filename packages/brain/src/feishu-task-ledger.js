/**
 * feishu-task-ledger.js — 飞书群交办入账
 *
 * 主理人在飞书群派给秋米的活 → Cecelia tasks 账 → 自动投影 Notion。
 * 决策：方向 1c6679cd / 判定点 398d5f36。
 *
 * 为什么不从 OpenClaw sqlite 搬（前序方案作废）：实勘发现 OpenClaw 不持久化群消息原文
 * （channel_ingress_events.payload_json 完成后清空、transcript 表 0 行、飞书群在
 * task_runs 只留 13 行 CLI 噪音），唯一可信源是飞书开放平台 API。
 *
 * 三道判据（主理人 2026-09-16 拍板）：
 *   ① @ 的必须是秋米不是人（实测 14 天 232 条带 @ 消息里仅 81 条 @秋米）
 *   ② 秋米能即答、没调 agent 去干的不算任务（规则法不可分，必须语义判）
 *   ③ 重发去重（实测同一任务因无响应被重发 3 次）
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

/** 归一化文本用于重发比对：去空白、去标点、截断 */
function normalizeForDedupe(text) {
  return text.replace(/\s+/g, '').replace(/[，。！？、,.!?~…]/g, '').slice(0, 60);
}

/**
 * 判据 3：重发去重
 * 实测同一任务因秋米无响应被重发 3 次（「整理商品表格」06:30/06:52/06:54）；
 * 不去重则一个活记三行。同发送人 + 归一化文本相同 + 窗口内 → 合并，保留最早一条为 head。
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

const CLASSES = Object.freeze(['task', 'question', 'debug_paste', 'chat']);

/**
 * 判据 2 的 prompt（主理人拍板：秋米能即答、没调 agent 去干的不算任务）。
 * 规则法已否决——「你拉个会议」5 字是任务，「现在的模型是什么」7 字是提问，
 * 长度与关键词都不可分，必须语义判。示例全部取自真实群消息。
 */
export function buildClassifyPrompt(items) {
  const lines = items
    .map((it) => `${it.index}. ${it.text.replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n');
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
