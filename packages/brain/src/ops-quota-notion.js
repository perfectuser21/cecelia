/**
 * ops-quota-notion.js — 模型账号配额 → Notion「Ops Agent 图谱」列（工厂·F5 指挥舱 刀2 收尾）
 *
 * PRD 第 4 步判定点（主理人拍板）：配额并入现有 Agents&机器 库加列，不新开同步管道。
 * 图谱行 = agent/机器，配额 = 账号，二者对不上号，按 provider 桥接：
 *   agent.meta.model（openclaw 分身的模型 id）→ provider（claude/codex/grok）
 *   → 该 provider 下 status=ok 且 seven_day_pct 最大（最紧张）的账号 → 填到该 agent 行。
 * 无匹配（provider 未知 / 全部 key_expired）→ 不发列值（诚实留空，禁编造 0）。
 *
 * 缺列即补：ops-notion-schema.js 的 diffMissingProps 此前无人调用（"幂等补列"只落了注释），
 * 这里补成真的：GET 库属性 → 只 PATCH 缺的列，已有列绝不重发（防覆盖人调过的 select 颜色）。
 */
import { diffMissingProps } from './ops-notion-schema.js';

const PROVIDER_PATTERNS = [
  ['claude', /anthropic|claude/i],
  ['codex', /openai|gpt|codex/i],
  ['grok', /xai|grok/i],
];

/** openclaw 分身 model id（如 openai/gpt-5.6-terra）→ provider；认不出 → null。 */
export function inferProviderFromModelId(modelId) {
  const s = typeof modelId === 'string' ? modelId : '';
  if (!s) return null;
  for (const [provider, re] of PROVIDER_PATTERNS) {
    if (re.test(s)) return provider;
  }
  return null;
}

/** 该 provider 下 status=ok 里 seven_day_pct 最大者（并列取 five_hour_pct 大者）；无 → null。 */
export function pickProviderQuota(accounts, provider) {
  if (!provider || !Array.isArray(accounts)) return null;
  const p = String(provider).toLowerCase();
  const candidates = accounts.filter((a) => a
    && String(a.provider || '').toLowerCase() === p
    && a.status === 'ok'
    && typeof a.seven_day_pct === 'number');
  if (candidates.length === 0) return null;
  return candidates.reduce((best, a) => {
    if (!best) return a;
    if (a.seven_day_pct !== best.seven_day_pct) return a.seven_day_pct > best.seven_day_pct ? a : best;
    return (a.five_hour_pct ?? -1) > (best.five_hour_pct ?? -1) ? a : best;
  }, null);
}

/** 配额三列（机器列）；null 不发。 */
export function buildQuotaProps(q) {
  const p = {};
  if (!q || typeof q !== 'object') return p;
  if (typeof q.five_hour_pct === 'number') p.FiveHourPct = { number: q.five_hour_pct };
  if (typeof q.seven_day_pct === 'number') p.SevenDayPct = { number: q.seven_day_pct };
  if (q.last_checked_at) p.QuotaUpdatedAt = { date: { start: new Date(q.last_checked_at).toISOString() } };
  return p;
}

/**
 * 缺列即补（幂等）。返回 { added: string[] }。
 * @param {string} token Notion token
 * @param {string} dbId 目标库 id
 * @param {object} wantedProps 列定义（OPS_DB_PROPS.<lib>）
 * @param {{notionReq: Function}} deps 注入 notionReq(token, path, method, body)
 */
export async function ensureOpsDbProps(token, dbId, wantedProps, { notionReq }) {
  const db = await notionReq(token, `/databases/${dbId}`, 'GET');
  const missing = diffMissingProps(db?.properties, wantedProps);
  const added = Object.keys(missing);
  if (added.length > 0) {
    await notionReq(token, `/databases/${dbId}`, 'PATCH', { properties: missing });
  }
  return { added };
}
