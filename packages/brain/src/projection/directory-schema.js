/** 六层目录的机器列合同。人填名称、Parent、负责人及旧关系不归此模块写入。 */
import { activityCardSchema, stepCardSchema } from './activity-card.js';
const LAYERS = ['areas', 'value_streams', 'capabilities', 'workflows', 'activities', 'steps'];
const UUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const normalize = value => String(value ?? '').replaceAll('-', '').toLowerCase();
const rich = () => ({ rich_text: {} });
const relation = databaseId => ({ relation: { database_id: databaseId, single_property: {} } });
const count = () => ({ number: { format: 'number' } });
const group = () => ({ select: {} });
// 每一层都带上面所有层的名字：选项列用来分组，「树位置」一行看全路径（机器写；选项列不含英文逗号，追不到的标「(未归属)」）
const treeSchema = levels => ({
  '分组·公司': group(), '分组·部门': group(), '分组·子部门': group(),
  ...(levels.includes('vs') ? { '分组·价值流': group() } : {}), ...(levels.includes('cap') ? { '分组·能力': group() } : {}),
  ...(levels.includes('wf') ? { '分组·流程': group() } : {}), '树位置': rich(),
});
// 流程库的运行情况列（机器写）；「你的标记」是人工列：只建列，投影器永远不写它的值
const workflowRuntimeSchema = () => ({
  'Activity 数': count(), '定时任务数': count(), '启用任务数': count(), '近7天有跑': count(), '失败任务数': count(), '静默任务数': count(), '步骤级运行次数': count(),
  '最近运行': { date: {} }, '在用吗': { select: {} }, '怎么运行': rich(), '旧功能状态': rich(),
  '你的标记': { select: { options: ['有用', '没用', '过期', '删'].map(name => ({ name })) } },
});
const common = () => ({
  'Brain ID': rich(), '真身来源': rich(), '登记缺口': rich(), '责任主体': rich(),
  '同步状态': { select: {} }, '同步时间': { date: {} },
});

export function buildDirectorySchemas(dbs) {
  const ids = new Set();
  for (const name of LAYERS) {
    if (typeof dbs?.[name] !== 'string' || !UUID.test(dbs[name])) throw new Error(`directory_schema:${name}:invalid_database_id`);
    const id = normalize(dbs[name]);
    if (ids.has(id)) throw new Error(`directory_schema:${name}:duplicate_database_id`);
    ids.add(id);
  }
  return {
    areas: { ...common(), Name: { title: {} }, Key: rich(), '价值流': relation(dbs.value_streams) },
    value_streams: { ...common(), Name: { title: {} }, '所属部门': relation(dbs.areas), Capabilities: relation(dbs.capabilities), ...treeSchema([]) },
    capabilities: {
      ...common(), Name: { title: {} }, Key: rich(), '说明': rich(), '登记状态': { select: {} },
      '所属价值流': relation(dbs.value_streams), Workflows: relation(dbs.workflows), ...treeSchema(['vs']),
    },
    workflows: {
      ...common(), Workflow: { title: {} }, '版本': rich(), Key: rich(), Capability: relation(dbs.capabilities), Activities: relation(dbs.activities),
      '渠道': rich(), '形态': rich(), Trigger: rich(), Input: rich(), Output: rich(),
      '执行策略': rich(), '活动编排': rich(), '登记状态': { select: {} },
      ...workflowRuntimeSchema(), ...treeSchema(['vs', 'cap']),
    },
    activities: {
      ...common(), Name: { title: {} }, '所属Workflows': relation(dbs.workflows), Steps: relation(dbs.steps),
      '使用位置': rich(), '执行主体': rich(), ...activityCardSchema(), ...treeSchema(['vs', 'cap', 'wf']),
    },
    steps: {
      ...common(), '步骤': { title: {} }, Key: rich(), '所属Activity': relation(dbs.activities), '所属Workflows': relation(dbs.workflows),
      Input: rich(), Output: rich(), '验收标准': rich(), '证据读取': rich(),
      '实现来源': rich(), '执行主体': rich(), '登记状态': { select: {} }, ...stepCardSchema(), ...treeSchema(['vs', 'cap', 'wf']),
    },
  };
}

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
