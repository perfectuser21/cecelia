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
