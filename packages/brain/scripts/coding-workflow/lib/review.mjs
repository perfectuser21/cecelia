// QA 立场评审文档（02-review-rN.md）解析的纯函数：
//   `## 评分`     每行 `<维度>: <0–10 整数>`（维度见 lib/gan.mjs RUBRIC_DIMS）
//   `## 上轮问题` 每行 `- R-n: 关闭|坚持 —— 理由`（上轮仍开着的问题必须逐条表态）
//   `### R-n`     新问题：`针对:` `严重度: 阻断|重要|建议` `场景:` `依据:` + 说明；阻断/重要必须带场景与依据（防吹毛求疵）
// 结论不由文档决定，由 lib/gan.mjs decide 按评分与仍开着的问题代码判定。
import { parseFrontmatter } from './md-chain.mjs';
import { RUBRIC_DIMS } from './gan.mjs';

const ISSUE_RE = /^### (R-\d+)(?:[\s:：].*)?$/;
const SECTION_RE = /^##\s+(.+?)\s*$/;
const HEADING_RE = /^#{1,3}(?:\s|$)/;
const PRIOR_RE = /^\s*[-*]\s*(?:\*\*)?(R-\d+)(?:\*\*)?\s*[:：]\s*(?:\*\*)?(关闭|坚持)(?:\*\*)?\s*(?:[—–-]+\s*)?(.*)$/;
const SEVERITIES = ['阻断', '重要', '建议'];
export const BLOCKING = new Set(['阻断', '重要']);

/** `名字: 值` 字段行（名字/整行可加粗、全半角冒号）→ [名字, 值]；不是字段行返回 null。 */
function fieldOf(line) {
  const m = /^\s*(?:[-*]\s+)?(?:\*\*)?([^*:：\s][^*:：]*?)(?:\*\*)?\s*[:：]\s*(?:\*\*)?(.*?)(?:\*\*)?\s*$/.exec(line);
  return m ? [m[1].trim(), m[2].trim()] : null;
}

/** 正文按 `## 小节` 与 `### R-n` 切块。 */
function blocks(lines) {
  const sections = {};
  const issues = [];
  let cur = null;
  for (const line of lines) {
    const issue = ISSUE_RE.exec(line);
    if (issue) {
      cur = { id: issue[1], lines: [] };
      issues.push(cur);
      continue;
    }
    const sec = SECTION_RE.exec(line);
    if (sec && !line.startsWith('###')) {
      cur = { lines: [] };
      sections[sec[1].replace(/\*\*/g, '')] = cur;
      continue;
    }
    if (HEADING_RE.test(line)) {
      cur = null;
      continue;
    }
    cur?.lines.push(line);
  }
  return { sections, issues };
}

function parseScores(lines, errors) {
  const scores = {};
  for (const line of lines ?? []) {
    const f = fieldOf(line);
    if (f && RUBRIC_DIMS.includes(f[0]) && !(f[0] in scores)) scores[f[0]] = f[1];
  }
  const out = {};
  for (const d of RUBRIC_DIMS) {
    if (!(d in scores)) errors.push(`score_missing:${d}`);
    else if (!/^\d+$/.test(scores[d]) || Number(scores[d]) > 10) errors.push(`score_invalid:${d}`);
    else out[d] = Number(scores[d]);
  }
  return out;
}

function parseIssue({ id, lines }, known, errors) {
  const fields = {};
  const body = [];
  for (const line of lines) {
    const f = fieldOf(line);
    if (f && ['针对', '严重度', '场景', '依据'].includes(f[0]) && !(f[0] in fields)) fields[f[0]] = f[1];
    else if (line.trim()) body.push(line.trim());
  }
  const targets = (fields['针对'] ?? '').split(/[,，、\s]+/).filter(Boolean);
  const severity = fields['严重度'] ?? '';
  if (targets.length === 0) errors.push(`${id}:target_missing`);
  for (const t of targets) if (!known.has(t)) errors.push(`${id}:target_unknown:${t}`);
  if (!severity) errors.push(`${id}:severity_missing`);
  else if (!SEVERITIES.includes(severity)) errors.push(`${id}:severity_invalid`);
  if (BLOCKING.has(severity)) {
    if (!fields['场景']) errors.push(`${id}:scene_missing`);
    if (!fields['依据']) errors.push(`${id}:basis_missing`);
  }
  if (body.length === 0) errors.push(`${id}:body_empty`);
  return { id, targets, severity, scene: fields['场景'] ?? '', basis: fields['依据'] ?? '', body: body.join('\n') };
}

/**
 * 解析评审文档（可带 frontmatter）。specIds ∪ intentIds 为可针对的 ID；
 * priorIds = 上轮仍开着、本轮必须逐条表态的问题；usedIds = 以往已用过的编号（新问题不得复用，缺省同 priorIds）。
 * 返回 { scores, issues, prior: [{id, status, reason}], errors }。
 */
export function parseReview(text, { specIds = [], intentIds = [], priorIds = [], usedIds = priorIds } = {}) {
  const raw = typeof text === 'string' ? text : '';
  const fm = parseFrontmatter(raw);
  const { sections, issues: rawIssues } = blocks((fm ? fm.body : raw).split(/\r?\n/));
  const errors = [];
  const scores = parseScores(sections['评分']?.lines, errors);

  const prior = [];
  for (const line of sections['上轮问题']?.lines ?? []) {
    const m = PRIOR_RE.exec(line);
    if (m && !prior.some((p) => p.id === m[1])) prior.push({ id: m[1], status: m[2], reason: m[3].trim() });
  }
  for (const id of priorIds) if (!prior.some((p) => p.id === id)) errors.push(`prior_missing:${id}`);

  const known = new Set([...specIds, ...intentIds]);
  const used = new Set(usedIds);
  const issues = rawIssues.map((block) => {
    if (used.has(block.id)) errors.push(`${block.id}:id_reused`);
    return parseIssue(block, known, errors);
  });
  return { scores, issues, prior, errors };
}

/** 本轮之后仍开着的问题：上轮开着且本轮未「关闭」的 + 本轮新提的阻断/重要问题（建议级不算）。 */
export function openIssuesAfter(prevOpen, review) {
  const closed = new Set(review.prior.filter((p) => p.status === '关闭').map((p) => p.id));
  return [
    ...prevOpen.filter((i) => !closed.has(i.id)),
    ...review.issues.filter((i) => BLOCKING.has(i.severity)),
  ];
}
