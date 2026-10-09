/**
 * 六层目录的列合同（第二轮：人打开看得懂、用得上）。
 * 规矩：每层只挂直接上级（上级的上级只靠「树位置」一行文字）；Notion 上每一列要么来自 Brain（原样或派生），
 * 要么是登记过的人工列；两样都不是就该删（清理脚本 scripts/ops/notion-tree-cleanup.mjs 按本合同算删列清单）。
 * 带值的旧列改名不删：ensureDirectorySchemas 在「新名不存在且旧名存在」时用 Notion 属性改名迁过去，值和人工选项都保留。
 */
const LAYERS = ['areas', 'value_streams', 'capabilities', 'workflows', 'activities', 'steps'];
const UUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const normalize = value => String(value ?? '').replaceAll('-', '').toLowerCase();
const rich = () => ({ rich_text: {} });
const relation = databaseId => ({ relation: { database_id: databaseId, single_property: {} } });
const count = () => ({ number: { format: 'number' } });
const title = () => ({ title: {} });
export const HUMAN_MARK_COLUMN = '去留（你填）';
const common = () => ({ 'Brain ID': rich(), '同步状态': { select: {} } });

export function buildDirectorySchemas(dbs) {
  const ids = new Set();
  for (const name of LAYERS) {
    if (typeof dbs?.[name] !== 'string' || !UUID.test(dbs[name])) throw new Error(`directory_schema:${name}:invalid_database_id`);
    const id = normalize(dbs[name]);
    if (ids.has(id)) throw new Error(`directory_schema:${name}:duplicate_database_id`);
    ids.add(id);
  }
  return {
    areas: { ...common(), Name: title(), '价值流': relation(dbs.value_streams) },
    value_streams: { ...common(), '名称': title(), '说明': rich(), '所属部门': relation(dbs.areas), '能力': relation(dbs.capabilities), '树位置': rich() },
    capabilities: {
      ...common(), '名称': title(), '说明': rich(), '所属价值流': relation(dbs.value_streams), '流程': relation(dbs.workflows),
      '状态': { select: {} }, '树位置': rich(),
    },
    workflows: {
      ...common(), '名称': title(), '所属能力': relation(dbs.capabilities), 'Activity': relation(dbs.activities), 'Activity 顺序': rich(),
      '运行方式': rich(), '运行情况': { select: {} }, '最近运行': { date: {} }, '7天次数': count(), '7天成功率': { number: { format: 'percent' } },
      '平均时长': rich(), [HUMAN_MARK_COLUMN]: { select: { options: ['有用', '没用', '过期', '删'].map(name => ({ name })) } }, '树位置': rich(),
    },
    activities: {
      ...common(), '名称': title(), '所属流程': relation(dbs.workflows), 'Step': relation(dbs.steps),
      '承诺（FR）': rich(), '输入': rich(), '输出': rich(), '谁来执行': { select: {} }, '还缺什么': rich(), '树位置': rich(),
    },
    steps: {
      ...common(), '名称': title(), '所属Activity': relation(dbs.activities), '顺序': count(), '做什么': rich(), '输入': rich(), '输出': rich(),
      '怎么验收': rich(), '失败了怎么办': rich(), '谁来执行': { select: {} }, '还缺什么': rich(),
    },
  };
}

/**
 * 旧名 → 新名（带值的列改名保值）。只有新名不存在且旧名存在时才改；两个都在就不动，旧列交给清理脚本。
 * 「平均时长(秒)」是数字列、新「平均时长」是带单位的文字，类型不同不改名（旧列由清理脚本删）。
 */
export const DIRECTORY_RENAMES = Object.freeze({
  areas: {},
  value_streams: { Name: '名称', Capabilities: '能力' },
  capabilities: { Name: '名称', Workflows: '流程', '登记状态': '状态' },
  workflows: { Workflow: '名称', Capability: '所属能力', Activities: 'Activity', '活动编排': 'Activity 顺序', '怎么运行': '运行方式',
    '在用吗': '运行情况', '你的标记': HUMAN_MARK_COLUMN },
  activities: { Name: '名称', '所属Workflows': '所属流程', Steps: 'Step', '承诺': '承诺（FR）' },
  steps: { '步骤': '名称', '动作': '做什么', Input: '输入', Output: '输出', '验收标准': '怎么验收', '失败处理': '失败了怎么办' },
});

/** 登记过的人工列：部门库是主理人 GTD 工作区（PARA 关系 + 名称/上下级/归档，部门入口回灌读它们），流程库「去留（你填）」是主理人打分。 */
export const DIRECTORY_HUMAN_COLUMNS = Object.freeze({
  areas: Object.freeze(['Name', 'Parent item', 'Sub-item', 'Archive', 'Domain', 'Goals', 'Issues', 'Knowledge_Opertional', 'Knowledge_Reference',
    'Project Notes', 'Project Status', 'Projects', 'Resources', 'Tasks', 'XX_Ideas']),
  value_streams: Object.freeze([]), capabilities: Object.freeze([]), workflows: Object.freeze([HUMAN_MARK_COLUMN]), activities: Object.freeze([]), steps: Object.freeze([]),
});

const SYSTEM = { 'Brain ID': 'Brain:id', '同步状态': '系统:同步状态（有缺口=关联没连上或登记不全）' };
/** 每一列的来源（给清理脚本 dry-run 和人看）：Brain:表.列 / 派生:说明 / 人工。 */
export const DIRECTORY_COLUMN_SOURCES = Object.freeze({
  areas: { ...SYSTEM, Name: '人工', '价值流': '派生:value_streams.area_id 反查（只连建了页的价值流）' },
  value_streams: { ...SYSTEM, '名称': 'Brain:value_streams.name（建页时）', '说明': 'Brain:value_streams.description',
    '所属部门': 'Brain:value_streams.area_id（可为子部门）', '能力': '派生:capabilities.parent_journey_id 反查', '树位置': '派生:部门树' },
  capabilities: { ...SYSTEM, '名称': 'Brain:capabilities.name（建页时）', '说明': 'Brain:capabilities.description',
    '所属价值流': 'Brain:capabilities.parent_journey_id', '流程': '派生:workflows.capability_id 反查', '状态': 'Brain:capabilities.status（在用/弃用）', '树位置': '派生:祖先链' },
  workflows: { ...SYSTEM, '名称': 'Brain:workflows.name（建页时）', '所属能力': 'Brain:workflows.capability_id', 'Activity': 'Brain:workflow_activity_refs',
    'Activity 顺序': '派生:workflow_activity_refs 按顺序列 Activity 名', '运行方式': '派生:workflows.form + ops_schedule_entries（人话）',
    '运行情况': '派生:runs/闹钟/引用', '最近运行': '派生:runs + ops_schedule_entries 最近一次', '7天次数': '派生:v_workflow_run_stats.runs(7d)',
    '7天成功率': '派生:v_workflow_run_stats.success_rate(7d)', '平均时长': '派生:v_workflow_run_stats.avg_duration_ms(7d)', [HUMAN_MARK_COLUMN]: '人工', '树位置': '派生:祖先链' },
  activities: { ...SYSTEM, '名称': 'Brain:activities.name（建页时）', '所属流程': 'Brain:workflow_activity_refs', 'Step': 'Brain:steps.activity_id',
    '承诺（FR）': 'Brain:activities.promise', '输入': 'Brain:activities.inputs', '输出': 'Brain:activities.outputs', '谁来执行': 'Brain:activities.executor_kind',
    '还缺什么': '派生:标准项空缺 + activity_cells 红/待判/未验', '树位置': '派生:祖先链' },
  steps: { ...SYSTEM, '名称': 'Brain:steps.name（建页时）', '所属Activity': 'Brain:steps.activity_id', '顺序': 'Brain:steps.step_order', '做什么': 'Brain:steps.action',
    '输入': 'Brain:steps.inputs', '输出': 'Brain:steps.outputs', '怎么验收': '派生:steps.readback + 当前定义版本判定（人话）', '失败了怎么办': 'Brain:steps.on_fail',
    '谁来执行': 'Brain:activities.executor_kind', '还缺什么': '派生:空缺项 + 实现核验状态' },
});

const typeOf = have => have?.type ?? ['rich_text', 'title', 'relation', 'select', 'date', 'number', 'people', 'checkbox', 'url']
  .find(candidate => Object.hasOwn(have ?? {}, candidate));

/** 待做的改名：新名不在、旧名在、且类型与新合同一致。返回 [[旧名, 新名], …]。 */
export function pendingRenames(layer, properties, wanted) {
  return Object.entries(DIRECTORY_RENAMES[layer] || {}).filter(([from, to]) => properties?.[to] === undefined && properties?.[from] !== undefined &&
    wanted[to] && typeOf(properties[from]) === Object.keys(wanted[to])[0]);
}

function checkSchema(name, dbId, actual, wanted, requireAll = false) {
  if (!actual || normalize(actual.id) !== normalize(dbId)) throw new Error(`directory_schema:${name}:wrong_database`);
  if (actual.archived || actual.in_trash) throw new Error(`directory_schema:${name}:archived_database`);
  if (!actual.properties || typeof actual.properties !== 'object') throw new Error(`directory_schema:${name}:missing_properties`);
  const renames = requireAll ? [] : pendingRenames(name, actual.properties, wanted);
  const properties = { ...actual.properties };
  for (const [from, to] of renames) { properties[to] = properties[from]; delete properties[from]; }
  const missing = {};
  for (const [key, expected] of Object.entries(wanted)) {
    const have = properties[key];
    if (have === undefined) {
      if (expected.title && Object.values(properties).some(p => p?.type === 'title' || p?.title)) {
        throw new Error(`directory_schema:${name}:${key}:title_name_conflict`);
      }
      if (requireAll) throw new Error(`directory_schema:${name}:${key}:missing_after_write`);
      missing[key] = expected;
      continue;
    }
    const type = Object.keys(expected)[0];
    const haveType = typeOf(have);
    if (haveType !== type) throw new Error(`directory_schema:${name}:${key}:expected_${type}:got_${haveType ?? 'unknown'}`);
    if (type === 'relation' && normalize(have.relation?.database_id) !== normalize(expected.relation.database_id)) {
      throw new Error(`directory_schema:${name}:${key}:wrong_relation_target`);
    }
  }
  return { missing, renames };
}

/**
 * 所有库先预检，类型或关系冲突时整批不写；先把带值旧列改成新名（保值），再补缺列；不删除既有属性。
 * Notion 无CAS或跨库事务：写前重读缩小人工并发窗口，不能承诺原子性。
 * 中途失败保留已改/已补列，下一轮重试；只有最终逐库GET读回通过才返回verified。
 */
export async function ensureDirectorySchemas({ dbs, token, notionReq }) {
  const schemas = buildDirectorySchemas(dbs);
  const plan = {};
  for (const name of LAYERS) {
    const actual = await notionReq(token, `/databases/${dbs[name]}`, 'GET');
    plan[name] = checkSchema(name, dbs[name], actual, schemas[name]);
  }
  const added = {}, renamed = {};
  for (const name of LAYERS) {
    if (Object.keys(plan[name].missing).length || plan[name].renames.length) {
      const current = await notionReq(token, `/databases/${dbs[name]}`, 'GET');
      plan[name] = checkSchema(name, dbs[name], current, schemas[name]);
    }
    added[name] = Object.keys(plan[name].missing);
    renamed[name] = plan[name].renames.map(([from, to]) => `${from}→${to}`);
    if (added[name].length || renamed[name].length) {
      await notionReq(token, `/databases/${dbs[name]}`, 'PATCH', { properties: {
        ...Object.fromEntries(plan[name].renames.map(([from, to]) => [from, { name: to }])), ...plan[name].missing } });
      const actual = await notionReq(token, `/databases/${dbs[name]}`, 'GET');
      checkSchema(name, dbs[name], actual, schemas[name], true);
    }
  }
  for (const name of LAYERS) {
    const actual = await notionReq(token, `/databases/${dbs[name]}`, 'GET');
    checkSchema(name, dbs[name], actual, schemas[name], true);
  }
  return { verified: true, added, renamed };
}
