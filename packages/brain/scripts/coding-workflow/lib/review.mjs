// 规格评审文档解析的纯函数：verdict 行 + `### R-n` 问题小节 → {verdict, issues, errors}。
import { parseFrontmatter } from './md-chain.mjs';

// 允许字段名加粗、整行加粗、全/半角冒号，大小写不敏感
const VERDICT_RE = /^\s*(?:\*\*)?verdict(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*([^*\s]*)\s*(?:\*\*)?\s*$/i;
const ISSUE_RE = /^### (R-\d+)(?:[\s:：].*)?$/;
const HEADING_RE = /^#{1,3}(?:\s|$)/;
const TARGET_RE = /^\s*(?:\*\*)?针对(?:\*\*)?\s*[:：]\s*(.*)$/;
const VERDICTS = ['APPROVE', 'REVISE'];

function parseVerdict(lines) {
  for (const line of lines) {
    const m = VERDICT_RE.exec(line);
    if (!m) continue;
    const value = m[1].toUpperCase();
    return { found: true, verdict: VERDICTS.includes(value) ? value : null };
  }
  return { found: false, verdict: null };
}

/** 一个 R-n 小节的行 → {targets, body}；只有第一处 `针对` 行算目标行。 */
function parseSection(lines) {
  let targets = [];
  let hasTarget = false;
  const bodyLines = [];
  for (const line of lines) {
    const m = hasTarget ? null : TARGET_RE.exec(line);
    if (m) {
      hasTarget = true;
      targets = m[1].replace(/\*\*/g, '').split(/[,，、\s]+/).filter(Boolean);
      continue;
    }
    const t = line.trim();
    if (t) bodyLines.push(t);
  }
  return { targets, body: bodyLines.join('\n') };
}

function parseIssues(lines) {
  const issues = [];
  let current = null;
  for (const line of lines) {
    const m = ISSUE_RE.exec(line);
    if (m) {
      current = { id: m[1], lines: [] };
      issues.push(current);
    } else if (HEADING_RE.test(line)) {
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  return issues.map(({ id, lines: sectionLines }) => ({ id, ...parseSection(sectionLines) }));
}

/**
 * 解析评审文档（可带 frontmatter）。specIds ∪ intentIds 为 R-n 可针对的合法 ID。
 * 返回 {verdict: 'APPROVE'|'REVISE'|null, issues: [{id, targets, body}], errors: string[]}。
 */
export function parseReview(text, { specIds = [], intentIds = [] } = {}) {
  const raw = typeof text === 'string' ? text : '';
  const fm = parseFrontmatter(raw);
  const lines = (fm ? fm.body : raw).split(/\r?\n/);

  const errors = [];
  const { found, verdict } = parseVerdict(lines);
  if (!found) errors.push('verdict_missing');
  else if (verdict === null) errors.push('verdict_invalid');

  const issues = parseIssues(lines);
  if (verdict === 'REVISE' && issues.length === 0) errors.push('issues_missing');

  const known = new Set([...specIds, ...intentIds]);
  for (const { id, targets, body } of issues) {
    if (targets.length === 0) errors.push(`${id}:target_missing`);
    if (!body) errors.push(`${id}:body_empty`);
    for (const t of targets) if (!known.has(t)) errors.push(`${id}:target_unknown:${t}`);
  }

  return { verdict, issues, errors };
}
