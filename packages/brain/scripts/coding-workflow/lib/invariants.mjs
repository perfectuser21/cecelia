// 铁律加载（审计 P1 #3，对应旧 harness「Invariant 加载进合同，每条要么有断言要么写明 N/A」）：
// intent 把 Brain 全部 active 铁律（decisions category=invariant）写成 01-invariants.md（每条 `### INV-<id 前 8 位>`）；
// spec 在 02 的 `## 铁律对照` 里对相关铁律逐条交代：引用已有 S-n/Q-n 覆盖，或「不适用：理由」；一条都不相关写「无相关铁律：理由」。
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter } from './md-chain.mjs';

export const INVARIANTS_FILE = '01-invariants.md';
const DECISION_CAP = 300;
const INV_HEADING_RE = /^### (INV-[0-9a-f]{8})\b/gm;
const SECTION_RE = /^## 铁律对照\s*$/m;
const LINE_RE = /^\s*[-*]\s*(INV-[0-9a-f]{8})\s*[:：]\s*(.*)$/;
const NA_RE = /^(?:不适用|N\/?A)\s*[:：]\s*(.{4,})$/i;
const NONE_RE = /^无相关铁律\s*[:：]\s*(.{8,})$/m;
const REF_RE = /\b[SQ]-\d+\b/g;

const cap = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/** decisions 行 → 01-invariants.md 全文。 */
export function renderInvariants(rows) {
  const lines = ['# 铁律清单（Brain active invariants）', '', '合同（02-spec.md）须在 `## 铁律对照` 里对与本改动相关的每条铁律逐条交代。', ''];
  if (rows.length === 0) lines.push('（当前没有 active 铁律）');
  for (const r of rows) {
    lines.push(`### INV-${String(r.id).slice(0, 8)}`, `- 主题：${cap(r.topic, 120)}`, `- 内容：${cap(r.decision, DECISION_CAP)}`, '');
  }
  return `${lines.join('\n')}\n`;
}

/** 01-invariants.md 里的全部 INV-id。 */
export const invariantIds = (text) => [...String(text ?? '').matchAll(INV_HEADING_RE)].map((m) => m[1]);

/** sprint 目录的铁律清单 id；文件不存在（旧 sprint）返回 []。 */
export function loadInvariantIds(dir) {
  const file = path.join(dir, INVARIANTS_FILE);
  return fs.existsSync(file) ? invariantIds(fs.readFileSync(file, 'utf8')) : [];
}

/** `## 铁律对照` 段正文（到下一个 `## ` 为止）；没有返回 null。 */
function section(body) {
  const m = SECTION_RE.exec(body);
  if (!m) return null;
  const rest = body.slice(m.index + m[0].length);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

/** 02 的铁律对照自检 → 错误码数组。清单为空不要求。 */
export function invariantErrors(specText, ids) {
  if (ids.length === 0) return [];
  const body = parseFrontmatter(specText)?.body ?? String(specText ?? '');
  const sec = section(body);
  if (sec === null) return ['invariants_section_missing'];
  const known = new Set(ids);
  const refs = new Set([...body.matchAll(/^### ([SQ]-\d+)\b/gm)].map((m) => m[1]));
  const errors = [];
  let entries = 0;
  for (const line of sec.split('\n')) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    entries += 1;
    const [, id, rest] = m;
    if (!known.has(id)) {
      errors.push(`${id}:unknown`);
      continue;
    }
    const cited = [...rest.matchAll(REF_RE)].map((r) => r[0]);
    const covered = cited.length > 0 && cited.every((c) => refs.has(c));
    if (!covered && !NA_RE.test(rest.trim())) errors.push(`${id}:unaddressed`);
  }
  if (entries === 0 && !NONE_RE.test(sec)) errors.push('invariants_section_empty');
  return errors;
}
