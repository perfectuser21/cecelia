import fs from 'node:fs';
import path from 'node:path';

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

/** 本链各文件的 step 与"upstream 必须覆盖哪个文件的全部锚点"，按链顺序排列。 */
export const CHAIN = [
  { file: '01-intent.md', step: 'intent', covers: null },
  { file: '02-spec.md', step: 'spec', covers: '01-intent.md' },
  { file: '03-build.md', step: 'build', covers: '02-spec.md' },
  { file: '04-evidence.md', step: 'verify', covers: '01-intent.md' },
];
const DEFAULT_FILES = ['01-intent.md', '02-spec.md'];

/** 单个上游引用的错误（格式非法 / 文件缺失 / 锚点不存在），无错返回 null。 */
function refError(dir, ref) {
  const m = REF_RE.exec(ref);
  if (!m) return `upstream_ref_invalid:${ref}`;
  const [, refFile, anchor] = m;
  const upText = readIfExists(path.join(dir, refFile));
  if (upText === null) return `upstream_file_missing:${ref}`;
  const upFm = parseFrontmatter(upText);
  const upAnchors = extractAnchors(upFm ? upFm.body : upText);
  return upAnchors.includes(anchor) ? null : `upstream_anchor_missing:${ref}`;
}

/** 下游 file 的 upstream 没覆盖到的上游锚点：`<file>_not_covered:<ID>`（02-spec 另报兼容的 intent_not_covered）。 */
function coverageErrors(file, upstream, target, targetAnchors) {
  const covered = new Set();
  for (const ref of upstream) {
    const m = REF_RE.exec(ref);
    if (m && m[1] === target) covered.add(m[2]);
  }
  const errors = [];
  for (const id of targetAnchors.filter((a) => !covered.has(a))) {
    errors.push(`${file}_not_covered:${id}`);
    if (file === '02-spec.md') errors.push(`intent_not_covered:${id}`);
  }
  return errors;
}

/**
 * 校验 md 链。files 为本次应存在的链文件（缺省为 01-intent/02-spec，兼容只有两步的旧 sprint）；
 * 按 CHAIN 顺序检查 task_id、step、upstream 引用真实存在、upstream 覆盖上游全部锚点。
 * 返回 {ok, errors, files}，files 为实际存在的链文件名（链顺序）。
 */
export function checkChain({ dir, taskId, files: wanted = DEFAULT_FILES }) {
  const errors = [];
  const files = [];
  const parsed = {};
  const known = new Set(CHAIN.map((c) => c.file));
  for (const f of wanted) if (!known.has(f)) errors.push(`file_unknown:${f}`);

  for (const { file: f, step, covers } of CHAIN.filter((c) => wanted.includes(c.file))) {
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
    parsed[f] = { fm, anchors: extractAnchors(fm.body) };
    if (fm.data.task_id !== taskId) errors.push(`task_id_mismatch:${f}`);
    if (fm.data.step !== step) errors.push(`step_mismatch:${f}`);

    // intent 无上游，上游引用只校验后续文件
    if (covers === null) {
      if (fm.data.upstream.length > 0) errors.push('intent_upstream_not_empty');
      continue;
    }
    for (const ref of fm.data.upstream) {
      const err = refError(dir, ref);
      if (err) errors.push(err);
    }
    if (parsed[covers]) errors.push(...coverageErrors(f, fm.data.upstream, covers, parsed[covers].anchors));
  }

  return { ok: errors.length === 0, errors, files };
}

/**
 * 单个链文件的自检（build 结束时校验 03）：frontmatter 存在、task_id/step 一致，
 * upstream 每项形如 `<coversFile>#<ID>` 且 ID 属于 ids，并覆盖全部 ids。返回错误码数组。
 */
export function reportErrors(text, { taskId, step, coversFile, ids }) {
  const fm = parseFrontmatter(text);
  if (!fm) return ['frontmatter_missing'];
  const errors = [];
  if (fm.data.task_id !== taskId) errors.push('task_id_mismatch');
  if (fm.data.step !== step) errors.push('step_mismatch');
  const covered = new Set();
  for (const ref of fm.data.upstream) {
    const m = REF_RE.exec(ref);
    if (!m || m[1] !== coversFile || !ids.includes(m[2])) errors.push(`upstream_ref_invalid:${ref}`);
    else covered.add(m[2]);
  }
  for (const id of ids) if (!covered.has(id)) errors.push(`not_covered:${id}`);
  return errors;
}
