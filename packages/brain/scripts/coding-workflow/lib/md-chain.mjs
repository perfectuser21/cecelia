import fs from 'node:fs';
import path from 'node:path';

const CHAIN_FILES = ['01-intent.md', '02-spec.md'];
const INTENT_FILE = '01-intent.md';
const ANCHOR_RE = /^### ([A-Z]+-\d+)\s*$/;
const REF_RE = /^([^#/\\\s]+\.md)#([A-Z]+-\d+)$/;

/**
 * 解析 frontmatter：首行 `---` 到下一个 `---`，逐行 `key: value`。
 * 只认 task_id / step / upstream 三键；upstream 为单行 JSON 数组字面量。
 * 任何不合规都返回 null（视为无 frontmatter）。
 */
export function parseFrontmatter(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;

  const raw = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') continue;
    const idx = line.indexOf(':');
    if (idx === -1) return null;
    raw[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }

  if (!raw.task_id || !raw.step || raw.upstream === undefined) return null;
  let upstream;
  try {
    upstream = JSON.parse(raw.upstream);
  } catch {
    return null;
  }
  if (!Array.isArray(upstream) || !upstream.every((u) => typeof u === 'string')) return null;

  return {
    data: { task_id: raw.task_id, step: raw.step, upstream },
    body: lines.slice(end + 1).join('\n'),
  };
}

/** 提取锚点标题行 `### <ID>`（ID 形如 I-1），按出现顺序返回。 */
export function extractAnchors(text) {
  const anchors = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = ANCHOR_RE.exec(line);
    if (m) anchors.push(m[1]);
  }
  return anchors;
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * 校验 md 链：按顺序检查 01-intent.md、02-spec.md。
 * 返回 {ok, errors, files}，files 为实际存在的链文件名。
 */
export function checkChain({ dir, taskId }) {
  const errors = [];
  const files = [];
  const parsed = {};

  for (const f of CHAIN_FILES) {
    const text = readIfExists(path.join(dir, f));
    if (text === null) {
      errors.push(`file_missing:${f}`);
      continue;
    }
    files.push(f);
    const fm = parseFrontmatter(text);
    if (!fm) {
      errors.push(`frontmatter_missing:${f}`);
      continue;
    }
    parsed[f] = { fm, anchors: extractAnchors(fm.body), text };
    if (fm.data.task_id !== taskId) errors.push(`task_id_mismatch:${f}`);

    if (f === INTENT_FILE && fm.data.upstream.length > 0) {
      errors.push('intent_upstream_not_empty');
    }

    // intent 无上游，上游引用只校验后续文件
    const refs = f === INTENT_FILE ? [] : fm.data.upstream;
    for (const ref of refs) {
      const m = REF_RE.exec(ref);
      if (!m) {
        errors.push(`upstream_ref_invalid:${ref}`);
        continue;
      }
      const [, refFile, anchor] = m;
      const upText = readIfExists(path.join(dir, refFile));
      if (upText === null) {
        errors.push(`upstream_file_missing:${ref}`);
        continue;
      }
      const upFm = parseFrontmatter(upText);
      const upAnchors = extractAnchors(upFm ? upFm.body : upText);
      if (!upAnchors.includes(anchor)) errors.push(`upstream_anchor_missing:${ref}`);
    }
  }

  // 02-spec 必须覆盖 01-intent 的全部锚点
  if (parsed[INTENT_FILE] && parsed['02-spec.md']) {
    const covered = new Set();
    for (const ref of parsed['02-spec.md'].fm.data.upstream) {
      const m = REF_RE.exec(ref);
      if (m && m[1] === INTENT_FILE) covered.add(m[2]);
    }
    for (const id of parsed[INTENT_FILE].anchors) {
      if (!covered.has(id)) errors.push(`intent_not_covered:${id}`);
    }
  }

  return { ok: errors.length === 0, errors, files };
}
