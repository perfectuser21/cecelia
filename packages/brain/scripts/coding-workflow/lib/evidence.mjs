// 04-evidence.md 的解析与判定（纯函数）。
// 每条 `### E-n` 下：`对应: I-n[, I-m]`、`verdict: PASS|FAIL`、```command 代码块、```output 代码块（非空）。
import { parseFrontmatter } from './md-chain.mjs';
import { INTENT_ID_RE } from './intent.mjs';

export const OUTPUT_SUMMARY_MAX = 2000;
const ITEM_RE = /^### (E-\d+)(?:[\s:：].*)?$/;
const SECTION_END_RE = /^#{1,3} /;
const FENCE_RE = /^(`{3,}|~{3,})\s*([A-Za-z]*)\s*$/;
const COVERS_RE = /^对应\s*[:：]\s*(.*)$/;
const VERDICT_RE = /^verdict\s*[:：]\s*(\S*)\s*$/;
const LIST_MARK_RE = /^\s*(?:[-*]\s+)?/;

/** 尾部摘要：超过 OUTPUT_SUMMARY_MAX 时保留末尾并以 … 开头。 */
function tail(text) {
  return text.length > OUTPUT_SUMMARY_MAX ? `…${text.slice(-OUTPUT_SUMMARY_MAX)}` : text;
}

/** 行匹配结果 f 是否闭合以 fence 开启的代码块（同字符、不短于开启、不带语言）。 */
function closes(f, fence) {
  return Boolean(f) && f[1][0] === fence[0] && f[1].length >= fence.length && f[2] === '';
}

/** 按行切出 `### E-n` 段；代码块内的标题行不算结构。返回 [{ id, lines }]。 */
function sections(lines) {
  const out = [];
  let current = null;
  let fence = null;
  for (const line of lines) {
    if (fence === null) {
      const item = ITEM_RE.exec(line);
      if (item) {
        current = { id: item[1], lines: [] };
        out.push(current);
        continue;
      }
      if (SECTION_END_RE.test(line)) {
        current = null;
        continue;
      }
    }
    const f = FENCE_RE.exec(line);
    if (f && (fence === null || closes(f, fence))) {
      fence = fence === null ? f[1] : null;
    }
    current?.lines.push(line);
  }
  return out;
}

/** 解析一段：字段行在代码块外，command/output 取第一个同名代码块。 */
function parseSection({ id, lines }) {
  const errors = [];
  const blocks = {};
  let covers = null;
  let verdict = null;
  let open = null;
  for (const line of lines) {
    if (open) {
      const f = FENCE_RE.exec(line);
      if (closes(f, open.fence)) {
        if (!(open.lang in blocks)) blocks[open.lang] = open.body.join('\n');
        open = null;
      } else {
        open.body.push(line);
      }
      continue;
    }
    const f = FENCE_RE.exec(line);
    if (f) {
      open = { fence: f[1], lang: f[2], body: [] };
      continue;
    }
    const field = line.replace(LIST_MARK_RE, '').trim();
    const c = COVERS_RE.exec(field);
    if (c && covers === null) covers = c[1].split(/[,，、\s]+/).filter(Boolean);
    const v = VERDICT_RE.exec(field);
    if (v && verdict === null) verdict = v[1];
  }
  if (open) errors.push(`${id}:fence_unclosed`);

  if (!covers || covers.length === 0) errors.push(`${id}:covers_missing`);
  else for (const c of covers.filter((x) => !INTENT_ID_RE.test(x))) errors.push(`${id}:covers_invalid:${c}`);
  if (verdict === null) errors.push(`${id}:verdict_missing`);
  else if (verdict !== 'PASS' && verdict !== 'FAIL') errors.push(`${id}:verdict_invalid`);
  for (const lang of ['command', 'output']) {
    if (!(lang in blocks)) errors.push(`${id}:${lang}_missing`);
    else if (blocks[lang].trim() === '') errors.push(`${id}:${lang}_empty`);
  }
  return { item: { id, covers: covers ?? [], verdict, command: blocks.command ?? '', output: blocks.output ?? '' }, errors };
}

/** 解析 04-evidence.md 文本 → { items: [{id, covers, verdict, command, output}], errors }。有无 frontmatter 均可。 */
export function parseEvidence(text) {
  if (typeof text !== 'string') return { items: [], errors: ['evidence_not_text'] };
  const body = parseFrontmatter(text)?.body ?? text;
  const items = [];
  const errors = [];
  const seen = new Set();
  for (const section of sections(body.split(/\r?\n/))) {
    if (seen.has(section.id)) {
      errors.push(`${section.id}:duplicate`);
      continue;
    }
    seen.add(section.id);
    const parsed = parseSection(section);
    items.push(parsed.item);
    errors.push(...parsed.errors);
  }
  return { items, errors };
}

/**
 * 按 intentIds 判定解析结果。依次：格式错误或引用未知 I-n → evidence_invalid（errors）；
 * 有 I-n 未覆盖 → evidence_incomplete（missing）；任一 FAIL → verification_failed（failed 带尾部摘要）；
 * 否则 reason null。覆盖完整时附 summary（每条 I-n 的 verdict，被任一 FAIL 条目覆盖即 FAIL）与 verifiedIds。
 */
export function judgeEvidence({ items, errors }, intentIds) {
  const known = new Set(intentIds);
  const invalid = [...errors];
  for (const item of items) {
    for (const c of item.covers.filter((x) => INTENT_ID_RE.test(x) && !known.has(x))) invalid.push(`${item.id}:covers_unknown:${c}`);
  }
  if (invalid.length > 0) return { reason: 'evidence_invalid', errors: invalid };

  const missing = intentIds.filter((id) => !items.some((item) => item.covers.includes(id)));
  if (missing.length > 0) return { reason: 'evidence_incomplete', missing };

  const failedItems = items.filter((item) => item.verdict === 'FAIL');
  const summary = intentIds.map((id) => ({
    intent: id,
    verdict: failedItems.some((item) => item.covers.includes(id)) ? 'FAIL' : 'PASS',
  }));
  if (failedItems.length > 0) {
    const failed = failedItems.map(({ id, covers, command, output }) => ({ id, covers, command: tail(command), output: tail(output) }));
    return { reason: 'verification_failed', failed, summary };
  }
  return { reason: null, verifiedIds: [...intentIds], summary };
}
