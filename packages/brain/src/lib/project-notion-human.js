// Projects 人工列采用 Notion 值域比较；状态别名只在人实际编辑时归一。
export const PROJECTS_DB = 'd83c40c2-ba63-8323-8dc7-01cc291c4d9b';
export const PROJECT_STATUS_TO_NOTION = Object.freeze({
  queued: 'Not Started', pending: 'Not Started', planning: 'In Progress', active: 'In Progress',
  in_progress: 'In Progress', paused: 'On Hold', blocked: 'On Hold', failed: 'On Hold',
  completed: 'Completed', cancelled: 'Discard', canceled: 'Discard', archived: 'Discard',
});
export const NOTION_TO_PROJECT_STATUS = Object.freeze({
  Inbox: 'planning', 'Not Started': 'planning', Planned: 'planning',
  'In Progress': 'in_progress', 'On Hold': 'paused', Completed: 'completed', Discard: 'cancelled',
});
export const HUMAN_FIELDS = ['status', 'priority', 'remark', 'due', 'ai_tier'];
export const HUMAN_COLUMNS = ['Status', 'Priority', 'Remark', 'Due Date', 'AI 参与'];
export const notionText = (parts) => (parts || []).map(p => p.plain_text ?? p.text?.content ?? '').join('');
const dateOnly = (d) => d ? (d instanceof Date
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : String(d).slice(0, 10)) : null;

function remarkText(value) {
  const text = String(value || '');
  if (text.length > 190000) throw new Error('备注超出 Notion 100 个文本块限制');
  const parts = [];
  for (let i = 0; i < text.length; i += 1900) parts.push({ type: 'text', text: { content: text.slice(i, i + 1900) } });
  return parts;
}

export function projectStatus(status) {
  if (PROJECT_STATUS_TO_NOTION[status]) return PROJECT_STATUS_TO_NOTION[status];
  console.warn(`[projects-sync] 未知项目状态 ${status}，显示 Not Started`);
  return 'Not Started';
}

export function readHuman(page) {
  const p = page.properties || {};
  // 缺列意味着 schema 已变化，不能把缺失误读成用户清空。
  for (const name of HUMAN_COLUMNS) {
    if (!p[name]) throw new Error(`项目页缺少人工列 ${name}`);
  }
  const status = p.Status.status?.name;
  if (!NOTION_TO_PROJECT_STATUS[status]) throw new Error(`未知项目状态 ${status}`);
  const ai_tier = p['AI 参与'].select?.name || '知情';
  if (!['知情', '盯着', '介入'].includes(ai_tier)) throw new Error(`未知 AI 参与 ${ai_tier}`);
  return { status, priority: p.Priority.select?.name || null,
    remark: notionText(p.Remark.rich_text), due: dateOnly(p['Due Date'].date?.start), ai_tier };
}

export function brainHuman(root, baseline = {}) {
  // 例如人将 Inbox 拉成 planning 后，应保留 Inbox，直到 Brain 真改状态。
  const status = NOTION_TO_PROJECT_STATUS[baseline.status] === root.status
    ? baseline.status : projectStatus(root.status);
  return { status, priority: root.custom_props?.priority || null,
    remark: root.custom_props?.remark || '', due: dateOnly(root.end_date), ai_tier: root.ai_tier || '知情' };
}

export function humanProps(v) {
  return {
    Status: { status: { name: v.status } },
    Priority: { select: v.priority ? { name: v.priority } : null },
    Remark: { rich_text: remarkText(v.remark) },
    'Due Date': { date: v.due ? { start: v.due } : null },
    'AI 参与': { select: { name: v.ai_tier } },
  };
}

export function mergeHuman(root, remote) {
  const brain = brainHuman(root, root.notion_props?.human_baseline);
  const baseline = { ...(root.notion_props?.human_baseline || { ...brain, remark: remote.remark }) };
  const pending = root.notion_props?.pending_human_push;
  const merged = { ...root, custom_props: { ...root.custom_props } };
  const overrides = [];
  let changed = false;
  for (const field of HUMAN_FIELDS) {
    // 远端成功、本地记基线失败：待推值是自己的回声，不能覆盖更新的 Brain 值。
    if (pending && remote[field] === pending[field]) baseline[field] = pending[field];
    if (remote[field] === baseline[field]) continue;
    baseline[field] = remote[field];
    if (remote[field] === brain[field]) continue;
    overrides.push({ field, brain_value: brain[field], notion_value: remote[field], at: new Date().toISOString() });
    changed = true;
    if (field === 'status') merged.status = NOTION_TO_PROJECT_STATUS[remote.status];
    else if (field === 'ai_tier') merged.ai_tier = remote.ai_tier;
    else if (field === 'due') merged.end_date = remote.due;
    else merged.custom_props[field] = remote[field];
  }
  return { root: merged, baseline, changed, overrides };
}
