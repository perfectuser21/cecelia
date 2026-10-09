// intent 活动的纯函数：验收条目提取与 01-intent.md 渲染（不写时间戳，输出确定性）。
import { extractAnchors } from './md-chain.mjs';

// 列表项标记：行首的 `-`/`*`（可带复选框）、`1.`/`1、`/`1)`（标记后紧跟数字如 `2026.10` 不算），以及任意位置的圈号 ①-⑳。
const LIST_MARKER_RE = /(?:^|\n)[ \t]*(?:[-*][ \t]+(?:\[[ xX]\][ \t]*)?|\d+[.、)）](?!\d)[ \t]*)|[\u2460-\u2473]/;
// 验收段起点："验收"+可选标题后缀，之后必须紧跟冒号或换行/结尾，否则视为无关出现。
const SECTION_RE = /验收(?:标准|条件|项|清单|要求)?[ \t]*(?:[：:]|(?=\r?\n)|$)/;

/** 验收条目锚点 ID 的唯一格式（01-intent.md 的 `### I-n`），intent_ids 校验与 04-evidence 的对应字段共用。 */
export const INTENT_ID_RE = /^I-\d+$/;

/** 校验上下文里的 intent_ids：空/非数组 → 'intent_ids_missing'，元素格式不对 → 'intent_ids_invalid'，合法 → null。 */
export function intentIdsError(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 'intent_ids_missing';
  if (!ids.every((id) => typeof id === 'string' && INTENT_ID_RE.test(id))) return 'intent_ids_invalid';
  return null;
}

function squash(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

function fromPayload(payload) {
  const list = payload?.acceptance;
  if (!Array.isArray(list)) return [];
  return list.filter((x) => typeof x === 'string').map(squash).filter(Boolean);
}

function fromDescription(description) {
  if (typeof description !== 'string') return [];
  const m = SECTION_RE.exec(description);
  if (!m) return [];
  let rest = description.slice(m.index + m[0].length);
  // 验收段到下一个 markdown 标题行为止
  const heading = rest.search(/\n#{1,6}[ \t]/);
  if (heading !== -1) rest = rest.slice(0, heading);
  // 有列表标记时只按标记切；完全没有标记才退回按分号切
  const splitter = LIST_MARKER_RE.test(rest) ? new RegExp(LIST_MARKER_RE.source, 'g') : /[；;]/;
  return rest.split(splitter).map(squash).filter(Boolean);
}

/** payload.acceptance 优先；否则取 description 中"验收"之后的列表项。无则返回 []。 */
export function extractAcceptance(task) {
  const fromPay = fromPayload(task?.payload);
  if (fromPay.length > 0) return fromPay;
  return fromDescription(task?.description);
}

/** 背景原文：会被 md-chain 识别成锚点的行加反斜杠转义（渲染不变），其余原样。 */
function escapeAnchors(text) {
  return text
    .split('\n')
    .map((line) => (extractAnchors(line).length > 0 ? `\\${line}` : line))
    .join('\n');
}

/** 渲染 01-intent.md：frontmatter + 标题 + 可选 `## 背景`（task.description）+ 每条 `### I-n`。 */
export function renderIntent({ taskId, title, items, description }) {
  const heading = squash(title ?? '') || String(taskId);
  const lines = ['---', `task_id: ${taskId}`, 'step: intent', 'upstream: []', '---', `# ${heading}`, ''];
  const background = typeof description === 'string' ? description.trim() : '';
  if (background) lines.push('## 背景', '', escapeAnchors(background), '');
  items.forEach((item, i) => {
    lines.push(`### I-${i + 1}`, item, '');
  });
  return `${lines.join('\n')}`;
}
