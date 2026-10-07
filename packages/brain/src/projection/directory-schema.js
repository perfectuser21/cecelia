/**
 * 六层目录的列合同。规矩：Notion 上每一列要么来自 Brain（原样或派生），要么是登记过的人工列；两样都不是就该删
 * （清理脚本 scripts/ops/notion-tree-cleanup.mjs 按本合同算删列清单）。人填名称、Parent 及部门库 PARA 关系不归此模块写入。
 */
import { activityCardSchema, stepCardSchema, ACTIVITY_CARD_COLUMNS, STEP_CARD_COLUMNS } from './activity-card.js';
const LAYERS = ['areas', 'value_streams', 'capabilities', 'workflows', 'activities', 'steps'];
const UUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const normalize = value => String(value ?? '').replaceAll('-', '').toLowerCase();
const rich = () => ({ rich_text: {} });
const relation = databaseId => ({ relation: { database_id: databaseId, single_property: {} } });
const count = () => ({ number: { format: 'number' } });
const group = () => ({ select: {} });
export const SOURCE_COLUMN = '正本（只读·改请走 git）';
// 每一层都带上面所有层的名字：选项列用来分组，「树位置」一行看全路径（机器写；选项列不含英文逗号，追不到的标「(未归属)」）
// 部门树只有公司→部门两级，「树位置」仍写全链，不另设子部门列
const treeSchema = levels => ({
  '分组·公司': group(), '分组·部门': group(),
  ...(levels.includes('vs') ? { '分组·价值流': group() } : {}), ...(levels.includes('cap') ? { '分组·能力': group() } : {}),
  ...(levels.includes('wf') ? { '分组·流程': group() } : {}), '树位置': rich(),
});
// 流程库的运行情况列（机器写，来自 runs 表的 v_workflow_run_stats 与闹钟总账）；「你的标记」是人工列：只建列，投影器永远不写它的值
const workflowRuntimeSchema = () => ({
  '最近运行': { date: {} }, '在用吗': { select: {} }, '怎么运行': rich(),
  '7天次数': count(), '7天失败': count(), '7天成功率': { number: { format: 'percent' } }, '平均时长(秒)': count(),
  '你的标记': { select: { options: ['有用', '没用', '过期', '删'].map(name => ({ name })) } },
});
const common = () => ({ 'Brain ID': rich(), '登记缺口': rich(), '同步状态': { select: {} }, '同步时间': { date: {} } });

export function buildDirectorySchemas(dbs) {
  const ids = new Set();
  for (const name of LAYERS) {
    if (typeof dbs?.[name] !== 'string' || !UUID.test(dbs[name])) throw new Error(`directory_schema:${name}:invalid_database_id`);
    const id = normalize(dbs[name]);
    if (ids.has(id)) throw new Error(`directory_schema:${name}:duplicate_database_id`);
    ids.add(id);
  }
  return {
    areas: { ...common(), Name: { title: {} }, '价值流': relation(dbs.value_streams) },
    value_streams: { ...common(), Name: { title: {} }, '说明': rich(), '所属部门': relation(dbs.areas), Capabilities: relation(dbs.capabilities), ...treeSchema([]) },
    capabilities: {
      ...common(), Name: { title: {} }, Key: rich(), '说明': rich(), '登记状态': { select: {} },
      '所属价值流': relation(dbs.value_streams), Workflows: relation(dbs.workflows), ...treeSchema(['vs']),
    },
    workflows: {
      ...common(), Workflow: { title: {} }, '版本': rich(), Key: rich(), Capability: relation(dbs.capabilities), Activities: relation(dbs.activities),
      '渠道': rich(), '形态': rich(), '活动编排': rich(), '登记状态': { select: {} },
      ...workflowRuntimeSchema(), ...treeSchema(['vs', 'cap']),
    },
    activities: {
      ...common(), Name: { title: {} }, Key: rich(), '所属Workflows': relation(dbs.workflows), Steps: relation(dbs.steps),
      '执行主体': rich(), [SOURCE_COLUMN]: { url: {} }, ...activityCardSchema(), ...treeSchema(['vs', 'cap', 'wf']),
    },
    steps: {
      ...common(), '步骤': { title: {} }, Key: rich(), '顺序': count(), '所属Activity': relation(dbs.activities), '所属Workflows': relation(dbs.workflows),
      Input: rich(), Output: rich(), '验收标准': rich(), '证据读取': rich(),
      '实现来源': rich(), '执行主体': rich(), '登记状态': { select: {} }, ...stepCardSchema(), ...treeSchema(['vs', 'cap', 'wf']),
    },
  };
}

/** 登记过的人工列：部门库是主理人 GTD 工作区（PARA 关系 + 名称/上下级/归档，部门入口回灌读它们），流程库「你的标记」是主理人打分。 */
export const DIRECTORY_HUMAN_COLUMNS = Object.freeze({
  areas: Object.freeze(['Name', 'Parent item', 'Sub-item', 'Archive', 'Domain', 'Goals', 'Issues', 'Knowledge_Opertional', 'Knowledge_Reference',
    'Project Notes', 'Project Status', 'Projects', 'Resources', 'Tasks', 'XX_Ideas']),
  value_streams: Object.freeze([]), capabilities: Object.freeze([]), workflows: Object.freeze(['你的标记']), activities: Object.freeze([]), steps: Object.freeze([]),
});

const SYSTEM = { 'Brain ID': 'Brain:id', '登记缺口': '派生:登记缺口', '同步状态': '系统:同步状态', '同步时间': '系统:同步时间' };
const TREE = levels => Object.fromEntries(Object.keys(treeSchema(levels)).map(c => [c, c === '分组·公司' || c === '分组·部门' ? '派生:部门树' : '派生:祖先链']));
const CARD = cols => Object.fromEntries(cols.map(c => [c, c.startsWith('格·') ? 'Brain:activity_cells' : c === '用料' ? 'Brain:activity_uses' : 'Brain:activities']));
/** 每一列的来源（给清理脚本 dry-run 和人看）：Brain:表.列 / 派生:说明 / 人工 / 系统。 */
export const DIRECTORY_COLUMN_SOURCES = Object.freeze({
  areas: { ...SYSTEM, Name: '人工', '价值流': '派生:value_streams.area_id 反查' },
  value_streams: { ...SYSTEM, ...TREE([]), Name: 'Brain:value_streams.name（建页时）', '说明': 'Brain:value_streams.description',
    '所属部门': 'Brain:value_streams.area_id', Capabilities: '派生:capabilities.parent_journey_id 反查' },
  capabilities: { ...SYSTEM, ...TREE(['vs']), Name: 'Brain:capabilities.name（建页时）', Key: 'Brain:capabilities.capability_code', '说明': 'Brain:capabilities.description',
    '登记状态': 'Brain:capabilities.status', '所属价值流': 'Brain:capabilities.parent_journey_id', Workflows: '派生:workflows.capability_id 反查' },
  workflows: { ...SYSTEM, ...TREE(['vs', 'cap']), Workflow: 'Brain:workflows.name（建页时）', '版本': 'Brain:workflows.version', Key: 'Brain:workflows.key',
    Capability: 'Brain:workflows.capability_id', Activities: 'Brain:workflow_activity_refs', '渠道': 'Brain:workflows.channel', '形态': 'Brain:workflows.form',
    '活动编排': '派生:workflow_activity_refs 按顺序列 Activity 名', '登记状态': 'Brain:workflows.status',
    '最近运行': '派生:runs + ops_schedule_entries 最近一次', '在用吗': '派生:runs/闹钟/引用', '怎么运行': '派生:ops_schedule_entries',
    '7天次数': '派生:v_workflow_run_stats.runs(7d)', '7天失败': '派生:v_workflow_run_stats.failed(7d)', '7天成功率': '派生:v_workflow_run_stats.success_rate(7d)',
    '平均时长(秒)': '派生:v_workflow_run_stats.avg_duration_ms(7d)', '你的标记': '人工' },
  activities: { ...SYSTEM, ...TREE(['vs', 'cap', 'wf']), ...CARD(ACTIVITY_CARD_COLUMNS), Name: 'Brain:activities.name（建页时）', Key: 'Brain:activities.capability_key+activity_key',
    '所属Workflows': 'Brain:workflow_activity_refs', Steps: 'Brain:steps.activity_id', '执行主体': 'Brain:activities.executor_kind', [SOURCE_COLUMN]: 'Brain:activities.contract_source' },
  steps: { ...SYSTEM, ...TREE(['vs', 'cap', 'wf']), ...Object.fromEntries(STEP_CARD_COLUMNS.map(c => [c, 'Brain:steps'])), '步骤': 'Brain:steps.name（建页时）', Key: 'Brain:steps.key',
    '顺序': 'Brain:steps.step_order', '所属Activity': 'Brain:steps.activity_id', '所属Workflows': '派生:所属 Activity 的流程引用',
    Input: 'Brain:steps.inputs', Output: 'Brain:steps.outputs', '验收标准': 'Brain:steps.readback', '证据读取': 'Brain:steps.readback+当前定义版本',
    '实现来源': 'Brain:steps.contract/当前定义版本', '执行主体': 'Brain:activities.executor_kind', '登记状态': 'Brain:steps.active' },
});

function checkSchema(name, dbId, actual, wanted, requireAll = false) {
  if (!actual || normalize(actual.id) !== normalize(dbId)) throw new Error(`directory_schema:${name}:wrong_database`);
  if (actual.archived || actual.in_trash) throw new Error(`directory_schema:${name}:archived_database`);
  if (!actual.properties || typeof actual.properties !== 'object') throw new Error(`directory_schema:${name}:missing_properties`);
  const missing = {};
  for (const [key, expected] of Object.entries(wanted)) {
    const have = actual.properties[key];
    if (have === undefined) {
      if (expected.title && Object.values(actual.properties).some(p => p?.type === 'title' || p?.title)) {
        throw new Error(`directory_schema:${name}:${key}:title_name_conflict`);
      }
      if (requireAll) throw new Error(`directory_schema:${name}:${key}:missing_after_write`);
      missing[key] = expected;
      continue;
    }
    const type = Object.keys(expected)[0];
    const haveType = have?.type ?? ['rich_text', 'title', 'relation', 'select', 'date', 'number', 'people', 'checkbox', 'url']
      .find(candidate => Object.hasOwn(have ?? {}, candidate));
    if (haveType !== type) throw new Error(`directory_schema:${name}:${key}:expected_${type}:got_${haveType ?? 'unknown'}`);
    if (type === 'relation' && normalize(have.relation?.database_id) !== normalize(expected.relation.database_id)) {
      throw new Error(`directory_schema:${name}:${key}:wrong_relation_target`);
    }
  }
  return missing;
}

/**
 * 所有库先预检，类型或关系冲突时整批不写；只补缺列，不重命名/删除/修改既有属性。
 * Notion 无CAS或跨库事务：写前重读缩小人工并发窗口，不能承诺原子性。
 * 中途失败保留已补列，下一轮重试；只有最终逐库GET读回通过才返回verified。
 */
export async function ensureDirectorySchemas({ dbs, token, notionReq }) {
  const schemas = buildDirectorySchemas(dbs);
  const missing = {};
  for (const name of LAYERS) {
    const actual = await notionReq(token, `/databases/${dbs[name]}`, 'GET');
    missing[name] = checkSchema(name, dbs[name], actual, schemas[name]);
  }
  const added = {};
  for (const name of LAYERS) {
    if (Object.keys(missing[name]).length) {
      const current = await notionReq(token, `/databases/${dbs[name]}`, 'GET');
      missing[name] = checkSchema(name, dbs[name], current, schemas[name]);
    }
    added[name] = Object.keys(missing[name]);
    if (added[name].length) {
      await notionReq(token, `/databases/${dbs[name]}`, 'PATCH', { properties: missing[name] });
      const actual = await notionReq(token, `/databases/${dbs[name]}`, 'GET');
      checkSchema(name, dbs[name], actual, schemas[name], true);
    }
  }
  for (const name of LAYERS) {
    const actual = await notionReq(token, `/databases/${dbs[name]}`, 'GET');
    checkSchema(name, dbs[name], actual, schemas[name], true);
  }
  return { verified: true, added };
}
