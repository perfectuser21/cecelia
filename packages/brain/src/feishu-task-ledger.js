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
import { createRoutedTask as defaultCreateRoutedTask } from './work-routing-store.js';

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
    ?? (({ token, chatId, startTimeSec }) => fetchGroupMessages({
      fetchFn, token, chatId, startTimeSec,
    }));
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
