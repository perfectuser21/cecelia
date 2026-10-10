// 02-spec.md 自检：spec 活动生成后与 spec_review 改写后共用同一规则。
// 02 = 开发方的实现规格（### S-n）+ 用户视角 QA 场景（### Q-n，evaluator 真人 QA 按它在真实环境里黑盒验收）。
import { reportErrors, parseFrontmatter, extractAnchors } from './md-chain.mjs';
import { invariantErrors } from './invariants.mjs';

export const SPEC_FILE = '02-spec.md';
export const INTENT_FILE = '01-intent.md';
const SPEC_ID_RE = /^S-\d+$/;
const QA_RE = /^### (Q-\d+)(?:[\s:：].*)?$/;
const HEADING_RE = /^#{1,3}(?:\s|$)/;
const FIELD_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?(对应|前提|操作|期望)(?:\*\*)?\s*[:：]\s*(.*)$/;
const KEYS = { 对应: 'covers', 前提: 'pre', 操作: 'steps', 期望: 'expect' };

const bodyOf = (text) => parseFrontmatter(text)?.body ?? String(text ?? '');

/** 02 正文中按出现顺序的 `### S-n` 锚点。 */
export function specIds(text) {
  return extractAnchors(bodyOf(text)).filter((id) => SPEC_ID_RE.test(id));
}

/** QA 场景 `### Q-n`：对应（I-n 列表）/前提/操作/期望；字段可跨行（续行接到上一个字段）。 */
export function qaScenarios(text) {
  const out = [];
  let cur = null;
  let field = null;
  for (const line of bodyOf(text).split(/\r?\n/)) {
    const q = QA_RE.exec(line);
    if (q) {
      cur = { id: q[1], covers: [], pre: '', steps: '', expect: '' };
      out.push(cur);
      field = null;
      continue;
    }
    if (HEADING_RE.test(line)) {
      cur = null;
      continue;
    }
    if (!cur) continue;
    const f = FIELD_RE.exec(line);
    if (f) {
      field = KEYS[f[1]];
      const value = f[2].replace(/\*\*/g, '').trim();
      if (field === 'covers') cur.covers = value.split(/[,，、\s]+/).filter(Boolean);
      else cur[field] = value;
      continue;
    }
    if (field && field !== 'covers' && line.trim()) cur[field] = cur[field] ? `${cur[field]}\n${line.trim()}` : line.trim();
  }
  return out;
}

/** QA 场景自检：至少一条、每条有对应/操作/期望且对应的是已知 I-n、每个 I-n 至少被一条覆盖。 */
function qaErrors(text, intentIds) {
  const scenarios = qaScenarios(text);
  if (scenarios.length === 0) return ['qa_missing'];
  const errors = [];
  const known = new Set(intentIds);
  const covered = new Set();
  for (const q of scenarios) {
    if (q.covers.length === 0) errors.push(`${q.id}:covers_missing`);
    if (!q.steps) errors.push(`${q.id}:steps_missing`);
    if (!q.expect) errors.push(`${q.id}:expect_missing`);
    for (const c of q.covers) {
      if (known.has(c)) covered.add(c);
      else errors.push(`${q.id}:covers_unknown:${c}`);
    }
  }
  for (const id of intentIds) if (!covered.has(id)) errors.push(`qa_not_covered:${id}`);
  return errors;
}

/**
 * 02 自检：frontmatter/upstream 覆盖全部 I-n（reportErrors）、至少一条 `### S-n`、QA 场景合格、
 * 有铁律清单时 `## 铁律对照` 逐条交代（invariantErrors）。返回错误码数组。
 */
export function specErrors(text, taskId, intentIds, { invariantIds = [] } = {}) {
  const errors = reportErrors(text, { taskId, step: 'spec', coversFile: INTENT_FILE, ids: intentIds });
  if (specIds(text).length === 0) errors.push('spec_ids_missing');
  return [...errors, ...qaErrors(text, intentIds), ...invariantErrors(text, invariantIds), ...uncoveredErrors(text), ...judgmentErrors(text)];
}

/** `## <标题>` 段的正文（到下一个 `#`/`##` 标题为止，去首尾空行）；没有这一段返回 null。 */
function section(text, title) {
  const lines = bodyOf(text).split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${title}`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,2}\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

// 「无：理由」/「N/A：理由」：显式声明没有
const NONE_RE = /^(?:无|N\/A)\s*[:：]\s*\S/i;

/** 审计 #10（旧 proposer 规则C）：没真验的链路必须显式登记（可写「无：理由」），publish 原样转呈 PR。 */
export function uncoveredSection(text) {
  return section(text, '未覆盖真实链路');
}

function uncoveredErrors(text) {
  const body = uncoveredSection(text);
  if (body === null) return ['uncovered_section_missing'];
  return body === '' ? ['uncovered_section_empty'] : [];
}

const JUDGMENT_FIELDS = { 候选: 'candidates', 所选: 'chosen', 依据: 'basis', 误判后果: 'consequence' };

/** 判定点段的条目行（`- ` 开头）；没有段或写「无：理由」返回 []。 */
function judgmentLines(text) {
  const body = section(text, '判定点');
  if (!body || NONE_RE.test(body)) return [];
  return body.split('\n').map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, ''));
}

function parseJudgment(line) {
  const [name, ...parts] = line.split(/[｜|]/).map((x) => x.trim());
  const out = { name };
  for (const part of parts) {
    const m = /^(候选|所选|依据|误判后果)\s*[:：]\s*(.+)$/.exec(part);
    if (m) out[JUDGMENT_FIELDS[m[1]]] = m[2].trim();
  }
  return out;
}

const complete = (j) => Boolean(j.name) && Object.values(JUDGMENT_FIELDS).every((k) => j[k]);

/**
 * 审计 #13/#14（旧 proposer 9.6 判定点登记表）：可选段 `## 判定点`，每条
 * `- <名称>｜候选: …｜所选: …｜依据: …｜误判后果: …`（五要素齐全才算）。
 */
export function judgmentPoints(text) {
  return judgmentLines(text).map(parseJudgment).filter(complete);
}

function judgmentErrors(text) {
  return judgmentLines(text).map(parseJudgment).flatMap((j, i) => (complete(j) ? [] : [`judgment_invalid:${i + 1}`]));
}

const DEFER_RE = /后续|以后|另开|另立|下一期|下期|之后再|后面再|留待/;
const TASK_REF_RE = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?\b/i;

/**
 * 审计 #16（旧 reviewer 9.7）：开发方回应里，以「后续再做/另开/下一期」驳回却没给 Brain 任务 ID 的问题编号。
 * 风险规避不能只是一句文字承诺。
 */
export function untrackedDeferrals(responseText) {
  const out = [];
  for (const block of String(responseText ?? '').split(/^(?=### R-\d+)/m)) {
    const id = /^### (R-\d+)/.exec(block)?.[1];
    if (!id || !/处理\s*[:：]\s*驳回/.test(block)) continue;
    if (DEFER_RE.test(block) && !TASK_REF_RE.test(block)) out.push(id);
  }
  return out;
}
