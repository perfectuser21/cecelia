/** 六层目录只读源：共享引用为准；不改契约、归属、版本或人工列。 */
import { isDeepStrictEqual } from 'node:util';
import { buildActivityCardProps, buildStepCardProps } from './activity-card.js';
import { TREE_NODES_SQL } from '../lib/tree-nodes-sql.js';
// 值是投影身份键（projection_links.entity_type 与 Notion「真身来源」文本），不是 SQL 表名；
// value_streams / capabilities 仍记作 journeys，改了会让已有目录页被当新页重建。
export const DIRECTORY_TABLES = Object.freeze({ areas: 'areas', value_streams: 'journeys', capabilities: 'journeys', workflows: 'workflows', activities: 'activities', steps: 'steps' });
export const rich = value => ({ rich_text: value == null || value === '' ? [] : [{ text: { content: (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 1900) } }] });
const ref = (layer, id) => ({ layer, id });
const unique = items => [...new Map(items.map(x => [`${x.layer}:${x.id}`, x])).values()].sort((a, b) => a.id.localeCompare(b.id));
const title = value => ({ title: [{ text: { content: String(value).slice(0, 200) } }] });
const select = name => ({ select: { name: String(name || 'unknown') } });
const num = n => ({ number: Number(n) || 0 });
const minuteDate = value => ({ date: value ? { start: new Date(Math.floor(new Date(value).getTime() / 60000) * 60000).toISOString() } : null }); // Notion 日期只到分钟，不取整读回对不上
const shanghai = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const shanghaiText = value => shanghai.format(new Date(value));
/** 闹钟的频率描述：一次性任务在库里是 JSON，翻成人话（上海时间） */
function scheduleText(desc) {
  const s = String(desc ?? '').trim();
  if (!s.startsWith('{')) return s || '频率未知';
  try { const j = JSON.parse(s); if (j.kind === 'at' && j.at) return `一次性 ${shanghaiText(j.at)}`; } catch { /* 不是 JSON 就原样给 */ }
  return s;
}
/** 一个流程现在算不算在用：有步骤级运行或近 7 天有任务跑过=在跑；有任务但没动静；只登记 Activity；空壳 */
export function workflowUsageStatus(x) {
  const { ran7 = 0, alarms = 0, spans = 0, acts = 0 } = x || {};
  if (ran7 > 0 || spans > 0) return '在跑';
  if (alarms > 0) return '有任务近7天没跑';
  if (acts > 0) return '只登记没运行';
  return '空壳';
}
const howItRuns = items => (Array.isArray(items) ? items : []).map(i =>
  `${i.enabled ? '●' : '○'} ${i.label} · ${scheduleText(i.schedule)} · ${i.status || '无记录'}${i.last ? ` · 最近 ${shanghaiText(i.last).slice(5)}` : ''}`).join('\n');
const NA = '(未归属)', NONE = '(无)', NOFLOW = '(未挂流程)';
const optionName = v => String(v ?? '').replaceAll(',', '，').trim().slice(0, 100); // Notion 选项名不能含英文逗号、最长 100
/**
 * 祖先链列：公司 / 部门 / 子部门（来自部门树）+ 价值流 / 能力 / 流程（按层级取到哪层写到哪层）。
 * 追不到的标「(未归属)」，不留空（Notion 空选项没法分组）；「树位置」只写祖先，不含自己。
 */
function treeProps(chain, names, levels) {
  const known = chain.length > 0;
  const props = {
    '分组·公司': select(optionName(chain[0]) || NA),
    '分组·部门': select(optionName(chain[1]) || (known ? NONE : NA)),
    '分组·子部门': select(optionName(chain.slice(2).join(' / ')) || (known ? NONE : NA)),
  };
  if (levels.includes('vs')) props['分组·价值流'] = select(optionName(names.vs) || NA);
  if (levels.includes('cap')) props['分组·能力'] = select(optionName(names.cap) || NA);
  if (levels.includes('wf')) props['分组·流程'] = select(optionName(names.wf) || NOFLOW);
  props['树位置'] = rich([...(known ? chain : [NA]), ...levels.map(l => names[l]).filter(Boolean)].map(optionName).join(' › '));
  return props;
}
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function currentDefinition(row, kind) {
  const version = row?.definition_version, identity = `${kind}_id`;
  return row?.current_definition_version_id && version?.id === row.current_definition_version_id &&
    version[identity] === row.id && version.payload?.[identity] === row.id && object(version.payload.contract) ? version : null;
}
const versionEvidence = version => version ? Object.fromEntries(['id','source_repo','source_path','source_commit'].map(k => [k,version[k]])) : null;
function currentStepDefinition(step, activity) {
  const version = currentDefinition(activity, 'activity');
  if (!step.active || !Array.isArray(version?.payload.steps)) return null;
  const matches = version.payload.steps.filter(entry => entry.step_id === step.id);
  if (matches.length !== 1) return null;
  const entry = matches[0], registration = entry.registration, contract = entry.contract;
  if (!object(contract) || !contract.key || entry.locator?.activity_id !== activity.id || entry.locator?.step_key !== contract.key ||
    registration?.id !== step.id || registration.key !== step.key || !(step.key === contract.key || step.key.endsWith(`.${contract.key}`)) ||
    !/^[a-f0-9]{64}$/.test(step.source_sha256 || '') || registration.source_sha256 !== step.source_sha256 ||
    registration.step_order !== step.step_order || registration.mode !== step.mode || !isDeepStrictEqual(registration.readback, step.readback)) return null;
  const bindings = (Array.isArray(version.payload.implementation_bindings) ? version.payload.implementation_bindings : [])
    .filter(binding => binding.scope === 'step' && binding.step_key === contract.key && binding.field === 'implementation');
  const referenceVerified = bindings.length > 0 && bindings.every(b => b.status === 'verified' && b.validation_scope === 'reference_only' && isDeepStrictEqual(b.raw, contract.implementation));
  return { version, contract, implementationStatus: referenceVerified ? 'reference_verified' : 'unverified' };
}
const fieldList = value => Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;

export function buildDirectoryRows(data, config = {}) {
  const rows = [], journeys = new Map(data.journeys.map(j => [j.id, j]));
  const refs = data.refs.filter(r => r.active).sort((a, b) => a.sequence_no - b.sequence_no || a.slot_key.localeCompare(b.slot_key) || a.workflow_id.localeCompare(b.workflow_id));
  const runtimeByWorkflow = new Map((data.workflow_runtime || []).map(r => [r.workflow_id, r]));
  const areasById = new Map((data.areas || []).map(a => [a.id, a]));
  function areaChain(areaId) { // 公司 → 部门 → 子部门；有环就停在重复处，不死循环
    const out = [], visited = new Set(); let cur = areasById.get(areaId);
    while (cur && !visited.has(cur.id)) { visited.add(cur.id); out.unshift(cur.name); cur = areasById.get(cur.parent_area_id); }
    return out;
  }
  // 能力的部门：自己挂了部门用自己的（子部门），没有就继承价值流的
  function capabilityContext(capId) {
    const cap = journeys.get(capId), vs = cap && journeys.get(cap.parent_journey_id);
    return { chain: areaChain(cap?.area_id ?? vs?.area_id), names: { vs: vs?.name, cap: cap?.name } };
  }
  // Activity 的归属流程：「归属引用」（source_ref 为空）所在流程优先，没有就取第一条引用
  function activityContext(activityId) {
    const usage = refs.filter(r => r.activity_id === activityId);
    const wf = data.workflows.find(w => w.id === (usage.find(r => !r.source_ref) || usage[0])?.workflow_id);
    const base = wf ? capabilityContext(wf.capability_id) : { chain: [], names: {} };
    return { chain: base.chain, names: { ...base.names, wf: wf?.name } };
  }
  const bindings = config.value_stream_bindings || [], seen = new Set(), nodes = new Set();
  for (const b of bindings) {
    const key = `${b.scope}:${b.node_key}`;
    if (seen.has(b.journey_id) || nodes.has(key)) throw new Error('价值流绑定重复');
    seen.add(b.journey_id); nodes.add(key);
    const j = journeys.get(b.journey_id);
    const matches = data.map_nodes.filter(n => n.scope === b.scope && n.node_key === b.node_key && n.active && n.notion_id);
    if (!j || j.kind !== 'value_stream' || matches.length !== 1 || matches[0].name !== (b.expected_node_name || j.name) ||
      (b.expected_journey_name && j.name !== b.expected_journey_name) ||
      (matches[0].journey_id && matches[0].journey_id !== j.id)) throw new Error('价值流绑定与登记来源不一致');
  }
  function make(layer, row, properties, relations = {}, gaps = []) {
    const table = DIRECTORY_TABLES[layer];
    const createProperties = {};
    for (const key of ['Name','Workflow','版本','步骤']) {
      if (properties[key]) { createProperties[key] = properties[key]; delete properties[key]; }
    }
    // Activity 的旧 notion_id 来自更早的同步（可能指向别的库或回收站里的页），不能当目录页身份：
    // 页面身份只认目录链接与 Brain ID 查询（526 把旧步骤挂进流程后这些行才进目录，不改会报「目录页身份或数据库不符」）
    const item = { layer, table, id: row.id, pageId: layer === 'activities' ? null : row.notion_id || null,
      allowCreate: !['areas', 'value_streams'].includes(layer), relations, gaps, createProperties,
      properties: { 'Brain ID': rich(row.id), '真身来源': rich(`Brain ${table}:${row.id}`),
        '责任主体': rich('unknown'), ...properties } };
    rows.push(item); return item;
  }
  for (const a of data.areas) make('areas', a, { Key: rich(a.id) }, {
    '价值流': data.journeys.filter(j => j.kind === 'value_stream' && j.area_id === a.id).map(j => ref('value_streams', j.id)),
  });
  for (const j of data.journeys) {
    if (j.kind === 'value_stream') {
      const b = bindings.find(b => b.journey_id === j.id);
      const node = b && data.map_nodes.find(n => n.scope === b.scope && n.node_key === b.node_key && n.active);
      const row = make('value_streams', { ...j, notion_id: node?.notion_id || null }, treeProps(areaChain(j.area_id), {}, []), {
        ...(j.area_id ? { '所属部门': [ref('areas', j.area_id)] } : {}),
        Capabilities: data.journeys.filter(c => c.parent_journey_id === j.id).map(c => ref('capabilities', c.id)),
      }, [...(!b ? ['value_stream_binding_missing'] : []), ...(!j.area_id ? ['area_unknown'] : [])]);
      row.pageId = node?.notion_id || null;
    } else if (j.kind === 'capability') {
      make('capabilities', { ...j, notion_id: null }, { Name: title(j.name), Key: rich(j.capability_code || j.id),
        '说明': rich(j.description), '登记状态': select(j.status), ...treeProps(capabilityContext(j.id).chain, capabilityContext(j.id).names, ['vs']) }, {
        ...(j.parent_journey_id ? { '所属价值流': [ref('value_streams', j.parent_journey_id)] } : {}),
        Workflows: data.workflows.filter(w => w.capability_id === j.id).map(w => ref('workflows', w.id)),
      }, j.parent_journey_id ? [] : ['value_stream_unknown']);
    }
  }
  for (const w of data.workflows) {
    const usage = refs.filter(r => r.workflow_id === w.id);
    const version = currentDefinition(w, 'workflow'), declared = version?.payload.contract.trigger_inputs;
    const validInput = Array.isArray(declared) && declared.length > 0 && new Set(declared).size === declared.length &&
      declared.every(item => typeof item === 'string' && /^[A-Z][A-Za-z]+$/.test(item));
    const trigger = w.trigger ?? w.contract?.trigger, input = w.input ?? w.contract?.inputs ?? (validInput ? declared : undefined);
    const output = w.output ?? w.contract?.outputs, policy = w.execution_policy ?? w.contract?.execution_policy;
    const rt = runtimeByWorkflow.get(w.id) || {}, acts = unique(usage.map(r => ref('activities', r.activity_id))).length;
    const row = make('workflows', w, { Workflow: title(w.name), Key: rich(w.key), '版本': rich(w.version),
      '渠道': rich(w.channel), '形态': rich(w.form), Trigger: rich(trigger), Input: rich(input), Output: rich(output),
      '执行策略': rich(policy), '登记状态': select(w.status),
      'Activity 数': num(acts), '定时任务数': num(rt.alarms), '启用任务数': num(rt.enabled), '近7天有跑': num(rt.ran7),
      '失败任务数': num(rt.failed), '静默任务数': num(rt.silent), '步骤级运行次数': num(rt.spans),
      '最近运行': minuteDate(rt.last_run), '在用吗': select(workflowUsageStatus({ ...rt, acts })),
      '怎么运行': rich(howItRuns(rt.items)), '旧功能状态': rich(rt.legacy),
      ...treeProps(capabilityContext(w.capability_id).chain, capabilityContext(w.capability_id).names, ['vs', 'cap']),
      '活动编排': rich(usage.map(r => `${r.sequence_no}. ${r.slot_key} → ${r.activity_id}`).join('\n')) }, {
      ...(w.capability_id ? { Capability: [ref('capabilities', w.capability_id)] } : {}),
      Activities: unique(usage.map(r => ref('activities', r.activity_id))),
    }, [...(!w.capability_id ? ['capability_unknown'] : []), ...(!policy ? ['execution_policy_undeclared'] : []),
      ...(!trigger ? ['workflow_trigger_undeclared'] : []), ...(!input ? ['workflow_input_undeclared'] : []), ...(!output ? ['workflow_output_undeclared'] : [])]);
    row.definitionVersion = versionEvidence(version);
  }
  for (const a of data.activities) {
    const usage = refs.filter(r => r.activity_id === a.id);
    const version = currentDefinition(a, 'activity');
    const unresolved = (Array.isArray(version?.payload.steps) ? version.payload.steps : []).filter(entry =>
      !data.steps.some(step => step.activity_id === a.id && step.id === entry.step_id && currentStepDefinition(step, a)))
      .map(entry => `step_registration_unresolved:${entry.locator?.step_key || entry.contract?.key || 'unknown'}`);
    const row = make('activities', a, { Name: title(a.name), '执行主体': rich(a.executor_kind || 'unknown'),
      '责任主体': rich(a.contract?.owner ? JSON.stringify(a.contract.owner) : 'unknown'),
      '使用位置': rich(usage.map(r => `${r.workflow_id} / ${r.slot_key} / ${r.sequence_no}`).join('\n')),
      ...buildActivityCardProps(a, (data.cells || []).filter(c => c.step_id === a.id), (data.uses || []).filter(u => u.activity_id === a.id)),
      ...treeProps(activityContext(a.id).chain, activityContext(a.id).names, ['vs', 'cap', 'wf']) }, {
      '所属Workflows': unique(usage.map(r => ref('workflows', r.workflow_id))),
      Steps: data.steps.filter(s => s.activity_id === a.id && s.active).sort((a, b) => a.step_order - b.step_order).map(s => ref('steps', s.id)),
    }, [...(!a.executor_kind ? ['executor_unknown'] : []), ...(!a.contract ? ['contract_missing'] : []), ...unresolved]);
    row.definitionVersion = versionEvidence(version);
  }
  for (const s of data.steps) {
    const a = data.activities.find(a => a.id === s.activity_id), contract = s.contract || {}, readback = s.readback || {};
    const definition = currentStepDefinition(s, a), declared = definition?.contract;
    const directImplementation = contract.implementation ?? readback.implementation;
    const implementation = directImplementation ?? declared?.implementation;
    const implementationStatus = definition?.implementationStatus === 'reference_verified' && isDeepStrictEqual(implementation, declared.implementation) ? 'reference_verified' : 'unverified';
    const evidence = definition ? { ...readback, definition: { check: declared.check, dod: declared.dod, implementation_status: implementationStatus } } : readback;
    const row = make('steps', s, { '步骤': title(readback.name || contract.name || s.key), Key: rich(s.key),
      Input: rich(contract.input ?? fieldList(declared?.reads)), Output: rich(contract.output ?? fieldList(declared?.writes)),
      '验收标准': rich(contract.acceptance ?? readback.asserts ?? readback.expect ?? declared?.check),
      '证据读取': rich(evidence), '实现来源': rich(implementation), '执行主体': rich(a?.executor_kind || 'unknown'),
      '登记状态': select(s.active ? 'active' : 'retired'), ...buildStepCardProps(s),
      ...treeProps(activityContext(s.activity_id).chain, activityContext(s.activity_id).names, ['vs', 'cap', 'wf']) }, {
      ...(s.activity_id ? { '所属Activity': [ref('activities', s.activity_id)] } : {}),
      '所属Workflows': unique(refs.filter(r => r.activity_id === s.activity_id).map(r => ref('workflows', r.workflow_id))),
    }, [...(!implementation ? ['implementation_unknown'] : []), ...(!a ? ['activity_unknown'] : []),
      ...(definition && implementation ? [implementationStatus === 'reference_verified' ? 'implementation_execution_unverified' : 'implementation_unverified'] : [])]);
    row.definitionVersion = versionEvidence(definition?.version);
  }
  const order = Object.keys(DIRECTORY_TABLES);
  return rows.sort((a,b) => order.indexOf(a.layer)-order.indexOf(b.layer) || a.id.localeCompare(b.id));
}

/** 单条SQL使用同一数据库快照；复合身份绑定当前版本，旧行无current字段时不取历史。 */
export async function loadDirectorySource(pool) {
  const { rows } = await pool.query(`SELECT jsonb_build_object(
    'areas',COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM areas a),'[]'::jsonb),
    'journeys',COALESCE((SELECT jsonb_agg(to_jsonb(j)) FROM ${TREE_NODES_SQL} j),'[]'::jsonb),
    'workflows',COALESCE((SELECT jsonb_agg(to_jsonb(w) || jsonb_build_object('definition_version',to_jsonb(v))) FROM workflows w
      LEFT JOIN workflow_definition_versions v ON v.workflow_id=w.id AND v.id::text=to_jsonb(w)->>'current_definition_version_id'),'[]'::jsonb),
    'activities',COALESCE((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('definition_version',to_jsonb(v))) FROM activities a
      LEFT JOIN activity_definition_versions v ON v.activity_id=a.id AND v.id::text=to_jsonb(a)->>'current_definition_version_id'
      WHERE (to_jsonb(a)->>'capability_key' IS NOT NULL AND to_jsonb(a)->>'activity_key' IS NOT NULL)
      OR EXISTS(SELECT 1 FROM workflow_activity_refs r WHERE r.activity_id=a.id AND r.active)),'[]'::jsonb),
    'steps',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM steps s),'[]'::jsonb),
    'cells',COALESCE((SELECT jsonb_agg(jsonb_build_object('step_id',c.step_id,'cell_key',c.cell_key,'cell_status',c.cell_status,'parent_cell_key',c.parent_cell_key))
      FROM activity_cells c WHERE c.step_id IS NOT NULL),'[]'::jsonb),
    'uses',COALESCE((SELECT jsonb_agg(jsonb_build_object('activity_id',u.activity_id,'item_name',i.name,'role',u.role) ORDER BY i.name)
      FROM activity_uses u JOIN warehouse_items i ON i.id=u.item_id),'[]'::jsonb),
    'refs',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM workflow_activity_refs r),'[]'::jsonb),
    'workflow_runtime',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'workflow_id',w.id,
      'alarms',(SELECT count(*) FROM ops_schedule_entries e WHERE e.workflow_id=w.id),
      'enabled',(SELECT count(*) FROM ops_schedule_entries e WHERE e.workflow_id=w.id AND e.enabled),
      'ran7',(SELECT count(*) FROM ops_schedule_entries e WHERE e.workflow_id=w.id AND e.last_run_at > now() - interval '7 days'),
      'failed',(SELECT count(*) FROM ops_schedule_entries e WHERE e.workflow_id=w.id AND e.last_status='失败'),
      'silent',(SELECT count(*) FROM ops_schedule_entries e WHERE e.workflow_id=w.id AND e.last_status='静默'),
      'last_run',(SELECT max(e.last_run_at) FROM ops_schedule_entries e WHERE e.workflow_id=w.id),
      'spans',(SELECT count(*) FROM spans s WHERE s.workflow_id=w.id),
      'legacy',(SELECT f.status FROM journey_features f WHERE f.id::text=to_jsonb(w)->>'legacy_feature_id'),
      'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('label',x.label,'schedule',x.schedule_desc,'enabled',x.enabled,
        'status',x.last_status,'last',x.last_run_at,'source',x.source) ORDER BY x.enabled DESC, x.last_run_at DESC NULLS LAST)
        FROM (SELECT e.label,e.schedule_desc,e.enabled,e.last_status,e.last_run_at,e.source FROM ops_schedule_entries e WHERE e.workflow_id=w.id
          ORDER BY e.enabled DESC, e.last_run_at DESC NULLS LAST LIMIT 12) x),'[]'::jsonb))) FROM workflows w),'[]'::jsonb),
    'map_nodes',COALESCE((SELECT jsonb_agg(jsonb_build_object('scope',l.scope,'node_key',l.node_key,
      'name',n.name,'notion_id',l.notion_id,'journey_id',n.attributes->>'journey_id','active',true))
      FROM notion_map_node_pages l JOIN map_projection_runs r ON r.scope_key=l.scope AND r.status='active'
      JOIN map_projection_nodes n ON n.run_id=r.id AND n.node_key=l.node_key AND n.node_type='value_stream'
      WHERE l.archived_at IS NULL),'[]'::jsonb)) AS source`);
  return rows[0].source;
}
