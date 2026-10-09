/**
 * project-brief.js — Project 简报纯函数模块（接力棒链 2afa6d69 棒2，决策 ee4842a6/3feeae3e）
 *
 * projects.brief 是随每棒交棒改写的活文档：{goal, status, facts, open_questions, changelog}。
 * 本模块只做数据变换（不碰 DB / 网络）：任意脏输入 → 合法形状；delta → 新 brief（不可变）；
 * 渲染成 Markdown / 派发 prompt 用的精简文本。
 *
 * DB 侧效果（建子任务 / 取消任务 / 改序号 / 写 pending_actions）在 lib/project-brief-apply.js，
 * 那一层用本模块的纯函数拼装最终结果——两者职责分离，方便本模块单测不碰真库。
 */
import { randomUUID } from 'node:crypto';

export const BRIEF_SCHEMA_VERSION = 1;
/** changelog 超过这个数丢最旧（handoff.js HANDOFF_LOG_MAX 同口径设计） */
export const CHANGELOG_MAX = 100;
const FACT_MAX_LEN = 500;
const TEXT_MAX_LEN = 2000;
const TITLE_MAX_LEN = 200;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const clampStr = (v, max) => String(v).slice(0, max);

/** 任意脏输入（null / 旧版 / 手改坏的 JSON）→ 合法 brief 形状。始终返回新对象，不改 raw。 */
export function normalizeBrief(raw) {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    goal: isNonEmptyString(b.goal) ? clampStr(b.goal, TEXT_MAX_LEN) : '',
    status: isNonEmptyString(b.status) ? clampStr(b.status, TEXT_MAX_LEN) : '',
    facts: Array.isArray(b.facts)
      ? b.facts.filter(isNonEmptyString).map((s) => clampStr(s, FACT_MAX_LEN))
      : [],
    open_questions: Array.isArray(b.open_questions)
      ? b.open_questions
          .filter((q) => q && typeof q === 'object' && isNonEmptyString(q.id) && isNonEmptyString(q.text))
          .map((q) => ({
            id: String(q.id),
            text: clampStr(q.text, TEXT_MAX_LEN),
            opened_by_task: q.opened_by_task ?? null,
            ...(q.closed_by_task ? { closed_by_task: q.closed_by_task } : {}),
            ...(isNonEmptyString(q.resolution) ? { resolution: clampStr(q.resolution, TEXT_MAX_LEN) } : {}),
          }))
      : [],
    changelog: Array.isArray(b.changelog)
      ? b.changelog
          .filter((e) => e && typeof e === 'object' && isNonEmptyString(e.at) && isNonEmptyString(e.kind))
          .map((e) => ({
            at: String(e.at),
            task_id: e.task_id ?? null,
            kind: String(e.kind),
            summary: clampStr(e.summary ?? '', TEXT_MAX_LEN),
          }))
      : [],
  };
}

function warnDefault(msg) {
  console.warn(`[project-brief] ${msg}`);
}

/**
 * brief_delta 原始输入 → 清洗后的合法形状；非法项丢弃并 warn。全部字段都缺/非法 → null。
 * 供 handoff.js buildHandoff 落库前调用，也供 lib/project-brief-apply.js 应用前复用。
 */
export function sanitizeBriefDelta(raw, { warn = warnDefault } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};

  if (raw.goal !== undefined) {
    if (isNonEmptyString(raw.goal)) out.goal = clampStr(raw.goal, TEXT_MAX_LEN);
    else warn('brief_delta.goal 非法（须非空字符串），已丢弃');
  }
  if (raw.status !== undefined) {
    if (isNonEmptyString(raw.status)) out.status = clampStr(raw.status, TEXT_MAX_LEN);
    else warn('brief_delta.status 非法（须非空字符串），已丢弃');
  }
  if (raw.add_facts !== undefined) {
    if (Array.isArray(raw.add_facts)) {
      const facts = raw.add_facts.filter(isNonEmptyString).map((s) => clampStr(s, FACT_MAX_LEN));
      if (facts.length) out.add_facts = facts;
      else warn('brief_delta.add_facts 无有效项，已丢弃');
    } else warn('brief_delta.add_facts 非法（须字符串数组），已丢弃');
  }
  if (raw.open_questions !== undefined) {
    if (Array.isArray(raw.open_questions)) {
      const qs = raw.open_questions.filter(isNonEmptyString).map((s) => clampStr(s, TEXT_MAX_LEN));
      if (qs.length) out.open_questions = qs;
      else warn('brief_delta.open_questions 无有效项，已丢弃');
    } else warn('brief_delta.open_questions 非法（须字符串数组），已丢弃');
  }
  if (raw.close_questions !== undefined) {
    if (Array.isArray(raw.close_questions)) {
      const cq = raw.close_questions
        .filter((c) => c && typeof c === 'object' && isNonEmptyString(c.id))
        .map((c) => ({
          id: String(c.id),
          ...(isNonEmptyString(c.resolution) ? { resolution: clampStr(c.resolution, TEXT_MAX_LEN) } : {}),
        }));
      if (cq.length) out.close_questions = cq;
      else warn('brief_delta.close_questions 无有效项，已丢弃');
    } else warn('brief_delta.close_questions 非法（须对象数组），已丢弃');
  }
  if (raw.add_steps !== undefined) {
    if (Array.isArray(raw.add_steps)) {
      const steps = raw.add_steps
        .filter((s) => s && typeof s === 'object' && isNonEmptyString(s.title))
        .map((s) => ({
          title: clampStr(s.title, TITLE_MAX_LEN),
          ...(isNonEmptyString(s.description) ? { description: clampStr(s.description, TEXT_MAX_LEN) } : {}),
        }));
      if (steps.length) out.add_steps = steps;
      else warn('brief_delta.add_steps 无有效项，已丢弃');
    } else warn('brief_delta.add_steps 非法（须对象数组），已丢弃');
  }
  if (raw.cancel_steps !== undefined) {
    if (Array.isArray(raw.cancel_steps)) {
      const ids = raw.cancel_steps.filter(isNonEmptyString).map(String);
      if (ids.length) out.cancel_steps = ids;
      else warn('brief_delta.cancel_steps 无有效项，已丢弃');
    } else warn('brief_delta.cancel_steps 非法（须字符串数组），已丢弃');
  }
  if (raw.reorder !== undefined) {
    if (Array.isArray(raw.reorder)) {
      const ids = raw.reorder.filter(isNonEmptyString).map(String);
      if (ids.length) out.reorder = ids;
      else warn('brief_delta.reorder 非法（须字符串数组），已丢弃');
    } else warn('brief_delta.reorder 非法（须字符串数组），已丢弃');
  }

  return Object.keys(out).length ? out : null;
}

/**
 * brief + delta → 新 brief（纯函数，不改入参，始终返回新对象/新数组）。
 *
 * delta 形状与 sanitizeBriefDelta 输出一致，但 add_steps / cancel_steps / reorder 三项
 * 在这里只用于拼 changelog 摘要，接受"已解析成可读字符串"的数组（DB 侧实际建/砍/挪了什么，
 * 由 lib/project-brief-apply.js 解析好再传进来）——本函数不关心它们是否真的落了库。
 *
 * @param {object} brief 当前 brief（任意脏输入都先 normalizeBrief）
 * @param {object} delta
 * @param {{taskId?: string|null, now?: string}} [opts]
 */
export function applyBriefDelta(brief, delta, { taskId = null, now = new Date().toISOString() } = {}) {
  const base = normalizeBrief(brief);
  const next = {
    goal: base.goal,
    status: base.status,
    facts: [...base.facts],
    open_questions: base.open_questions.map((q) => ({ ...q })),
    changelog: [...base.changelog],
  };
  const entries = [];

  if (isNonEmptyString(delta?.goal)) {
    const goal = clampStr(delta.goal, TEXT_MAX_LEN);
    next.goal = goal;
    entries.push({ kind: 'goal', summary: `目标改为：${goal}` });
  }
  if (isNonEmptyString(delta?.status)) {
    const status = clampStr(delta.status, TEXT_MAX_LEN);
    next.status = status;
    entries.push({ kind: 'status', summary: `现状更新：${status}` });
  }
  if (Array.isArray(delta?.add_facts) && delta.add_facts.length) {
    const added = [];
    for (const raw of delta.add_facts) {
      if (!isNonEmptyString(raw)) continue;
      const fact = clampStr(raw, FACT_MAX_LEN);
      if (!next.facts.includes(fact)) {
        next.facts.push(fact);
        added.push(fact);
      }
    }
    if (added.length) entries.push({ kind: 'facts', summary: `新增事实：${added.join('；')}` });
  }
  if (Array.isArray(delta?.open_questions) && delta.open_questions.length) {
    const opened = [];
    for (const raw of delta.open_questions) {
      if (!isNonEmptyString(raw)) continue;
      const q = { id: randomUUID(), text: clampStr(raw, TEXT_MAX_LEN), opened_by_task: taskId };
      next.open_questions.push(q);
      opened.push(q.text);
    }
    if (opened.length) entries.push({ kind: 'question_opened', summary: `提出未决问题：${opened.join('；')}` });
  }
  if (Array.isArray(delta?.close_questions) && delta.close_questions.length) {
    const closed = [];
    for (const c of delta.close_questions) {
      if (!c || !isNonEmptyString(c.id)) continue;
      const idx = next.open_questions.findIndex((q) => q.id === c.id && !q.closed_by_task);
      if (idx === -1) continue;
      next.open_questions[idx] = {
        ...next.open_questions[idx],
        closed_by_task: taskId,
        ...(isNonEmptyString(c.resolution) ? { resolution: clampStr(c.resolution, TEXT_MAX_LEN) } : {}),
      };
      closed.push(next.open_questions[idx].text);
    }
    if (closed.length) entries.push({ kind: 'question_closed', summary: `结了未决问题：${closed.join('；')}` });
  }
  if (Array.isArray(delta?.add_steps) && delta.add_steps.length) {
    const titles = delta.add_steps.filter(isNonEmptyString).map(String);
    if (titles.length) entries.push({ kind: 'add_steps', summary: `新增棒：${titles.join('；')}` });
  }
  if (Array.isArray(delta?.cancel_steps) && delta.cancel_steps.length) {
    const items = delta.cancel_steps.filter(isNonEmptyString).map(String);
    if (items.length) entries.push({ kind: 'cancel_steps', summary: `砍棒：${items.join('；')}` });
  }
  if (Array.isArray(delta?.reorder) && delta.reorder.length) {
    const items = delta.reorder.filter(isNonEmptyString).map(String);
    if (items.length) entries.push({ kind: 'reorder', summary: `调整顺序：${items.join(' → ')}` });
  }

  for (const e of entries) {
    next.changelog.push({ at: now, task_id: taskId, kind: e.kind, summary: e.summary });
  }
  if (next.changelog.length > CHANGELOG_MAX) {
    next.changelog = next.changelog.slice(next.changelog.length - CHANGELOG_MAX);
  }
  return next;
}

/** brief → 人读 Markdown（挂 handoff 镜像 / Notion 正文共用）。 */
export function renderBriefMarkdown(brief) {
  const b = normalizeBrief(brief);
  const list = (arr, empty) => (arr.length ? arr.map((x) => `- ${x}`).join('\n') : `- （${empty}）`);
  const openQs = b.open_questions.filter((q) => !q.closed_by_task);
  const closedQs = b.open_questions.filter((q) => q.closed_by_task);
  const lines = [
    '## 目标',
    b.goal || '（未写目标）',
    '',
    '## 现状',
    b.status || '（未写现状）',
    '',
    '## 已知事实',
    list(b.facts, '无'),
    '',
    '## 未决问题',
    openQs.length ? openQs.map((q) => `- ${q.text}`).join('\n') : '- （无）',
  ];
  if (closedQs.length) {
    lines.push('', '已结：', closedQs.map((q) => `- ${q.text}${q.resolution ? `（${q.resolution}）` : ''}`).join('\n'));
  }
  lines.push(
    '',
    '## 变更日志（最近 10 条）',
    b.changelog.length
      ? b.changelog
          .slice(-10)
          .reverse()
          .map((e) => `- ${String(e.at).slice(0, 16).replace('T', ' ')} · ${e.kind} · ${e.summary}`)
          .join('\n')
      : '- （无）',
  );
  return lines.join('\n');
}

/** brief → 派发 prompt 用的精简文本（目标/现状/事实/未决问题/最近 5 条变更）；空 brief → ''。 */
export function formatBriefForPrompt(brief, { maxLen = 1200 } = {}) {
  const b = normalizeBrief(brief);
  if (!b.goal && !b.status && !b.facts.length && !b.open_questions.length && !b.changelog.length) return '';
  const lines = [];
  lines.push(`目标：${b.goal || '（未写）'}`);
  lines.push(`现状：${b.status || '（未写）'}`);
  if (b.facts.length) lines.push(`已知事实：${b.facts.slice(-8).join('；')}`);
  const openQs = b.open_questions.filter((q) => !q.closed_by_task);
  if (openQs.length) lines.push(`未决问题：${openQs.slice(-5).map((q) => q.text).join('；')}`);
  const recent = b.changelog.slice(-5).reverse();
  if (recent.length) {
    lines.push('最近变更：');
    for (const e of recent) lines.push(`- ${e.summary}`);
  }
  let text = lines.join('\n');
  if (text.length > maxLen) text = `${text.slice(0, maxLen)}…`;
  return text;
}
