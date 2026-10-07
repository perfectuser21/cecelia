// intent 活动的纯函数：验收条目提取与 01-intent.md 渲染（不写时间戳，输出确定性）。

// 列表项标记：行首的 `-`/`*`（可带复选框）、`1.`/`1、`/`1)`，以及任意位置的圈号 ①-⑳ 与分号。
const ITEM_SPLIT_RE = /(?:^|\n)[ \t]*(?:[-*][ \t]+(?:\[[ xX]\][ \t]*)?|\d+[.、)）][ \t]*)|[①-⑳]|[；;]/;

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
  const idx = description.indexOf('验收');
  if (idx === -1) return [];
  let rest = description.slice(idx + '验收'.length).replace(/^[ \t]*[：:]?/, '');
  // 验收段到下一个 markdown 标题行为止
  const heading = rest.search(/\n#{1,6}[ \t]/);
  if (heading !== -1) rest = rest.slice(0, heading);
  return rest.split(ITEM_SPLIT_RE).map(squash).filter(Boolean);
}

/** payload.acceptance 优先；否则取 description 中"验收"之后的列表项。无则返回 []。 */
export function extractAcceptance(task) {
  const fromPay = fromPayload(task?.payload);
  if (fromPay.length > 0) return fromPay;
  return fromDescription(task?.description);
}

/** 渲染 01-intent.md：frontmatter + 标题 + 每条 `### I-n`。 */
export function renderIntent({ taskId, title, items }) {
  const heading = squash(title ?? '') || String(taskId);
  const lines = ['---', `task_id: ${taskId}`, 'step: intent', 'upstream: []', '---', `# ${heading}`, ''];
  items.forEach((item, i) => {
    lines.push(`### I-${i + 1}`, item, '');
  });
  return `${lines.join('\n')}`;
}
