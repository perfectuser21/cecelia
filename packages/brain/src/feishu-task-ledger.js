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
import { execFileSync } from 'node:child_process';

import { createRoutedTask as defaultCreateRoutedTask } from './work-routing-store.js';

/** 在册群（来源：OpenClaw clawdbot.json channels.feishu.accounts.main，此处固化，运行时不读第三方配置） */
export const GROUPS = Object.freeze([
  Object.freeze({ chatId: 'oc_ee3fe04cf2541c4187f0fc054ae826de', name: '悦升云端', requireMention: true, agentId: 'zenithjoy-router' }),
  Object.freeze({ chatId: 'oc_ef60d6e3f199d90dd695b6ecc213d662', name: 'VPS 状态', requireMention: false, agentId: 'zenithjoy-router' }),
  Object.freeze({ chatId: 'oc_e5ff09de4c2e30a332df0d3cf87f41ae', name: '外部Ai体验区', requireMention: true, agentId: 'zenithjoy-router' }),
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
 * 取 mention 对象里的 open_id。
 * 飞书两套形态：历史消息 API(im/v1/messages) 返回扁平 {"id":"ou_xxx","id_type":"open_id"}，
 * webhook 事件返回嵌套 {"id":{"open_id":"ou_xxx"}}。
 * 2026-09-16 生产实证：只认嵌套形态 → requireMention 群候选恒空 → 一条都入不了账。
 */
export function mentionOpenId(mention) {
  const id = mention?.id;
  if (typeof id === 'string') return id;
  return id?.open_id ?? null;
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
    return (m.mentions ?? []).some((x) => mentionOpenId(x) === botOpenId);
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
export function buildTaskRequest({ head, messageIds, group, botReplied, contextText, disposition }) {
  const text = cleanTitle(messageText(head));
  const status = outcomeToStatus(disposition)
    ?? (botReplied ? 'completed' : 'blocked');
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
      disposition: disposition ?? null,
      ledger_only: true,
    },
    task: {
      status,
      priority: 'P2',
      // DB 约束 chk_blocked_at_not_null：status=blocked 时 blocked_at 必须非空，
      // 缺了会让整批入账在 INSERT 处报错、created 恒为 0（2026-09-16 E2E 实证）
      ...(status === 'blocked' ? { blocked_at: new Date().toISOString() } : {}),
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

const OPENCLAW_DB = process.env.OPENCLAW_DB_PATH || '/opt/openclaw/state/state/openclaw.sqlite';
const EXEC_WINDOW_MS = 10 * 60 * 1000;

/** 解析 sqlite3 -json 输出；任何异常一律返回空数组（第三方库出问题不能拖垮守卫） */
export function parseRunRows(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return [];
  const a = t.indexOf('[');
  const b = t.lastIndexOf(']');
  if (a < 0 || b <= a) return [];
  try {
    const parsed = JSON.parse(t.slice(a, b + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 读 OpenClaw 的执行流水（只读！这是第三方状态库，写它=污染别人）。
 * 容器内无 node:sqlite（Node 20，22.5+ 才内置），用镜像自带的 sqlite3 CLI。
 * created_at 是毫秒时间戳，不是 datetime 字符串——用日期函数比较恒返回 0 行。
 */
export function loadAgentRuns({ execFileFn, agentId, sinceMs, dbPath = OPENCLAW_DB }) {
  const sql = `SELECT created_at, COALESCE(task_kind,'') AS task_kind, runtime
               FROM task_runs
               WHERE agent_id='${agentId}' AND created_at > ${Math.floor(sinceMs)}
               ORDER BY created_at`;
  try {
    const out = execFileFn('sqlite3', ['-readonly', '-json', dbPath, sql], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return parseRunRows(out);
  } catch (err) {
    console.warn(`[feishu-task-ledger] 读 OpenClaw run 失败（降级为无 run）: ${err.message}`);
    return [];
  }
}

// ── 根因识别：秋米"为什么没干"，答案就在它自己的回复里 ──────────────────────
// 2026-09-16 实证：机器回复有固定套话，用关键词就能分根因，不需要 LLM 去猜人说的话。
// 顺序即优先级：故障 > 等补料 > 已完成 > 普通答复。

/** 系统故障：认证失效、设备离线、上游报错——这类要起告警，是真坏了 */
const FAULT_PATTERNS = [
  /\b40[13]\b/, /invalid api key/i, /authentication_error/i, /unauthorized/i,
  /internal error/i, /temporary .*error/i, /rate.?limit/i,
  /(还没能|无法|未能|不能)(连接|访问|读取|获取)/, /(离线|不在线|连不上)/,
  /credit balance is too low/i, /quota|用量上限/,
];
/** 等主理人补东西：球在人那边，不是系统的问题 */
const WAITING_PATTERNS = [
  /(请|先)?(把|将).{0,12}(发来|发给我|提供|上传)/, /(需要|还需)(你|您)?(确认|提供|补充)/,
  /还需要确认/, /请确认/, /等(你|您)(的)?(确认|回复|资料)/,
  // 注意：不要匹配裸的「缺少 X」——秋米说「问题不是安装失败，而是缺少输入文件」
  // 是在做诊断，不是在等主理人补料（2026-09-16 实测边界）。只认带请求语气的。
];
/** 已经干完了：即使没留 run 记录（用 MCP 直接做的） */
const DONE_PATTERNS = [
  /已(创建|整理|生成|完成|建好|写好|同步|上传|发布)/, /已回读核验/, /创建(成功|完毕)/,
];

/**
 * 从秋米的一条回复判断根因。
 * 返回 fault | waiting | done | answer | none
 */
export function classifyBotReply(text) {
  const t = String(text ?? '').trim();
  if (!t) return 'none';
  if (FAULT_PATTERNS.some((re) => re.test(t))) return 'fault';
  if (WAITING_PATTERNS.some((re) => re.test(t))) return 'waiting';
  if (DONE_PATTERNS.some((re) => re.test(t))) return 'done';
  return 'answer';
}

/** 去掉飞书 @ 占位符（历史消息 API 把 @某人 渲染成 @_user_N）与多余空白 */
export function cleanTitle(text) {
  return String(text ?? '').replace(/@_user_\d+/g, '').replace(/\s+/g, ' ').trim();
}

const OUTCOME_PRIORITY = Object.freeze(['fault', 'waiting', 'done', 'answer']);

/**
 * 合成最终判定：执行记录 + 秋米回复根因。
 *   done    —— 有 run，或回复说已完成（MCP 直接干的不留 run）→ 入账 completed
 *   fault   —— 回复是系统故障 → 入账 blocked，附故障原文，可直接起告警
 *   waiting —— 回复在等主理人补料 → 入账 blocked，球在主理人
 *   answer  —— 普通答复（咨询答完即止）→ 不入账
 *   silent  —— 完全没回（实测全是闲聊碎片）→ 不入账
 *   unknown —— 早于 run 证据覆盖范围，无从判断 → 不入账
 */
export function resolveOutcome({
  head, messageIds, messages, runs, windowMs = EXEC_WINDOW_MS, evidenceFloorMs = null,
}) {
  const ids = new Set(messageIds ?? [head.message_id]);
  const groupMsgs = (messages ?? []).filter((m) => ids.has(m.message_id));
  const stamps = (groupMsgs.length ? groupMsgs : [head]).map((m) => Number(m.create_time));
  if (evidenceFloorMs != null && Math.max(...stamps) < evidenceFloorMs) return 'unknown';

  const executed = (runs ?? []).some((r) => {
    if (r?.task_kind === 'automation_run') return false;
    const t = Number(r?.created_at);
    return stamps.some((t0) => t - t0 > 0 && t - t0 <= windowMs);
  });

  // 回复归属：以重发组最后一条为起点（重发后秋米才会回），到下一条人发消息为止
  const lastStamp = Math.max(...stamps);
  const anchor = (groupMsgs.length ? groupMsgs : [head])
    .find((m) => Number(m.create_time) === lastStamp) ?? head;
  const replies = repliesFor(anchor, messages, windowMs === EXEC_WINDOW_MS ? REPLY_WINDOW_MS : windowMs);
  if (replies.length === 0) return executed ? 'done' : 'silent';

  const kinds = replies.map((m) => classifyBotReply(messageText(m)));
  for (const k of OUTCOME_PRIORITY) {
    if (kinds.includes(k)) return (k === 'answer' && executed) ? 'done' : k;
  }
  return executed ? 'done' : 'answer';
}

/**
 * 取属于这条交办的秋米回复：从交办时刻起，到「下一条人发的消息」为止（或 windowMs 封顶）。
 * 2026-09-16 实测：群里消息密集，只按 30min 窗口取会串台——「表在哪」会把 17 分钟后
 * 另一件事的 401 回复认成自己的，于是被误判成系统故障。
 */
export function repliesFor(head, messages, windowMs = REPLY_WINDOW_MS) {
  const t0 = Number(head.create_time);
  const sorted = [...(messages ?? [])].sort((a, b) => Number(a.create_time) - Number(b.create_time));
  const nextUser = sorted.find((m) => m?.sender?.sender_type === 'user' && Number(m.create_time) > t0);
  const ceiling = Math.min(
    t0 + windowMs,
    nextUser ? Number(nextUser.create_time) : Number.POSITIVE_INFINITY,
  );
  return sorted.filter((m) => m?.sender?.sender_type === 'app'
    && Number(m.create_time) > t0
    && Number(m.create_time) < ceiling);
}

/** 取交办后第一条秋米回复的摘录，作为"为什么卡住"的证据附在账目上 */
export function firstBotReplyExcerpt(head, messages, windowMs = REPLY_WINDOW_MS, maxLen = 200) {
  const reply = repliesFor(head, messages, windowMs)[0];
  return reply ? cleanTitle(messageText(reply)).slice(0, maxLen) : null;
}

/** 判定 → 入账状态；只有 done/fault/waiting 入账，其余返回 null。任何一态都不得产出 queued。 */
export function outcomeToStatus(outcome) {
  if (outcome === 'done') return 'completed';
  if (outcome === 'fault' || outcome === 'waiting') return 'blocked';
  return null;
}

/**
 * 三态机械判定（主理人 2026-09-16 拍板，零 LLM）：
 *   executed —— 交办后窗口内秋米真产生了执行记录 → 是任务，已办
 *   answered —— 没执行记录但秋米回了话 → 当场答完的提问，不是任务
 *   dropped  —— 既没执行也没回话 → 派了没人管的活，正是主理人最该看见的
 * 重发组内任一条命中即算 executed（实测 run 常挂在后一次重发上，而 head 取最早那条）。
 * automation_run 是 cron 定时的自主动作，与群消息无关，不算响应。
 */
/**
 * 证据覆盖下界：OpenClaw 会清理老 run（实测只保 7 天），早于最早一条 run 的消息，
 * "没有 run" 可能只是记录被清了，不能据此判定"没人干"。取 run 最早时间戳为下界；
 * 一条 run 都没有时回退到扫描起点（此时整段都不可信，全判 unknown）。
 */
export function resolveEvidenceFloor(runs, fallbackMs) {
  const stamps = (runs ?? []).map((r) => Number(r?.created_at)).filter((n) => Number.isFinite(n));
  return stamps.length ? Math.min(...stamps) : fallbackMs;
}

// 与 OpenClaw task_runs 保留期对齐（实测只保 7 天）；扫更早的消息也无证据可判
const LOOKBACK_SEC = 7 * 24 * 3600;

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

/**
 * scheduler 入口：拉群消息 → 机械判据 → 入账
 * 全程零 LLM：@对象靠 open_id 比对，"是不是真派了活"靠 OpenClaw 执行流水，都是查表。
 */
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
  const loadRuns = deps.loadAgentRunsFn
    ?? ((args) => loadAgentRuns({ execFileFn: execFileSync, ...args }));
  const createTask = deps.createRoutedTaskFn ?? defaultCreateRoutedTask;
  const sinceSec = deps.sinceSec ?? Math.floor(Date.now() / 1000) - LOOKBACK_SEC;

  const token = await fetchToken();
  const botOpenId = await fetchBot(token);
  let scanned = 0;
  let created = 0;
  const stats = { done: 0, fault: 0, waiting: 0, answer: 0, silent: 0, unknown: 0 };
  const errors = [];

  for (const group of GROUPS) {
    try {
      const messages = await fetchMessages({ token, chatId: group.chatId, startTimeSec: sinceSec });
      scanned += messages.length;
      const candidates = selectCandidates(messages, group, botOpenId);
      const deduped = dedupeResends(candidates);
      if (deduped.length === 0) continue;

      const runs = loadRuns({ agentId: group.agentId, sinceMs: sinceSec * 1000 });
      const evidenceFloorMs = resolveEvidenceFloor(runs, sinceSec * 1000);

      for (const c of deduped) {
        const outcome = resolveOutcome({
          head: c.head, messageIds: c.messageIds, messages, runs, evidenceFloorMs,
        });
        stats[outcome] = (stats[outcome] ?? 0) + 1;
        const status = outcomeToStatus(outcome);
        if (!status) continue; // answer/silent/unknown 不入账

        const req = buildTaskRequest({
          head: c.head,
          messageIds: c.messageIds,
          group,
          botReplied: resolveReplyEvidence(c.head, messages),
          contextText: buildContextText(c.head, messages),
          disposition: outcome,
        });
        // 故障/等待类附上秋米原话，主理人一眼看到卡在哪，不用回群里翻
        req.metadata.bot_reply_excerpt = firstBotReplyExcerpt(c.head, messages);
        await createTask(pool, req);
        created += 1;
      }
    } catch (err) {
      console.error(`[feishu-task-ledger] 群 ${group.chatId} 处理失败: ${err.message}`);
      errors.push(group.chatId);
    }
  }
  console.log(`[feishu-task-ledger] scanned=${scanned} created=${created} `
    + `done=${stats.done} fault=${stats.fault} waiting=${stats.waiting} `
    + `answer=${stats.answer} silent=${stats.silent} unknown=${stats.unknown}`);
  return { scanned, created, stats, errors };
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
