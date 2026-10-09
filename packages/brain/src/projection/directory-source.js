/** 六层目录只读源：共享引用为准；不改契约、归属、版本或人工列。 */
import { isDeepStrictEqual } from 'node:util';
import { buildActivityCardProps, buildStepCardProps, executorLabel, humanize } from './activity-card.js';
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
const maybeNum = n => ({ number: n == null || !Number.isFinite(Number(n)) ? null : Number(n) });
const latest = (...values) => values.filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] ?? null;
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
/**
 * 一个流程现在算不算在用：runs 近 7 天有记录或闹钟近 7 天跑过=在跑（launchd/crontab 闹钟还没写 runs，两边都算）；
 * 有任务但没动静；只登记 Activity；空壳
 */
export function workflowUsageStatus(x) {
  const { ran7 = 0, alarms = 0, runs7 = 0, acts = 0 } = x || {};
  if (ran7 > 0 || runs7 > 0) return '在跑';
  if (alarms > 0) return '有任务近7天没跑';
  if (acts > 0) return '只登记没运行';
  return '空壳';
}
const FORMS = Object.freeze({ scheduled: '定时', android_rpa: '安卓手机', windows_rpa: 'Windows 电脑', api: '接口', app: '应用内',
  pipeline: '流水线', conversation: '对话', openclaw_skill: 'OpenClaw 技能' });
/**
 * 运行方式（一列人话）：有闹钟就逐条写「定时·每 5 分钟（us-vps）· 名字」（停用的标「已停」）；形态不是定时的先写形态（安卓手机/接口…）。
 */
export function runModeText(form, items) {
  const list = Array.isArray(items) ? items : [];
  const lines = list.map(i => `${i.enabled ? '' : '（已停）'}定时·${scheduleText(i.schedule)}${i.host ? `（${i.host}）` : ''}${i.label ? `· ${i.label}` : ''}`);
  const head = form && form !== 'scheduled' ? FORMS[form] ?? form : !list.length ? (form ? FORMS[form] : '未写') : null;
  return [head, ...lines].filter(Boolean).join('\n');
}
/** 平均时长带单位：毫秒 / 秒 / 分钟；没有运行记录留空。 */
export function durationText(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return null;
  const n = Number(ms);
  if (n < 1000) return `${Math.round(n)} 毫秒`;
  if (n < 60000) return `${(n / 1000).toFixed(1)} 秒`;
  return `${(n / 60000).toFixed(1)} 分钟`;
}
const STATUS = Object.freeze({ active: '在用', deprecated: '弃用' });
const NA = '(未归属)';
/** 「树位置」：一行文字写全部祖先（部门树全链 + 价值流/能力/流程），不含自己；追不到部门的写「(未归属)」。 */
const treePath = (chain, names) => rich([...(chain.length ? chain : [NA]), ...names.filter(Boolean)].join(' › '));
const op = v => (typeof v === 'string' ? v : JSON.stringify(v));
/** 怎么验收（人话）：读什么（查库/看日志/看指标/请求）+ 应该是什么 + 定义版本里的判定。 */
export function acceptanceText(contract = {}, readback = {}, declared) {
  if (contract.acceptance) return op(contract.acceptance);
  const parts = [];
  const where = { sql: readback.query && `查数据库：${readback.query}`, log: readback.regex && `看日志：匹配「${readback.regex}」`,
    metric: readback.ref && `看指标：${readback.ref}`, none: '不读回' }[readback.type];
  if (where) parts.push(where);
  else if (readback.url) parts.push(`请求：${readback.url}`);
  else if (readback.type) parts.push(`${readback.type}：${readback.ref ?? readback.query ?? ''}`.replace(/：$/, ''));
  const expect = readback.expect;
  if (expect && typeof expect === 'object' && 'op' in expect) parts.push(`结果应 ${expect.op} ${'value' in expect ? op(expect.value) : `指标 ${expect.ref}`}`);
  else if (expect != null) parts.push(`应：${op(expect)}`);
  if (readback.asserts) parts.push(`应满足：${op(readback.asserts)}`);
  if (declared?.check) parts.push(`判定：${declared.check}`);
  return parts.join('；') || null;
}
const STEP_GAPS = Object.freeze({ implementation_unknown: '实现没登记', implementation_unverified: '实现未核验',
  implementation_execution_unverified: '实现未实跑验证', activity_unknown: '没有所属 Activity' });
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
    for (const key of ['名称']) {
      if (properties[key]) { createProperties[key] = properties[key]; delete properties[key]; }
    }
    // Activity 的旧 notion_id 来自更早的同步（可能指向别的库或回收站里的页），不能当目录页身份：
    // 页面身份只认目录链接与 Brain ID 查询（526 把旧步骤挂进流程后这些行才进目录，不改会报「目录页身份或数据库不符」）
    const item = { layer, table, id: row.id, pageId: layer === 'activities' ? null : row.notion_id || null,
      allowCreate: layer !== 'areas', relations, gaps, createProperties, properties: { 'Brain ID': rich(row.id), ...properties } };
    rows.push(item); return item;
  }
  // 价值流由目录接管：挂了能力的才建页（空壳不建，作 catalog gap 报出）；旧地图页只按显式绑定认领，不凭同名
  const hasCapabilities = vsId => data.journeys.some(c => c.kind === 'capability' && c.parent_journey_id === vsId);
  const projectedStream = j => j.kind === 'value_stream' && (hasCapabilities(j.id) || bindings.some(b => b.journey_id === j.id));
  for (const a of data.areas) make('areas', a, {}, {
    '价值流': data.journeys.filter(j => projectedStream(j) && j.area_id === a.id).map(j => ref('value_streams', j.id)),
  });
  for (const j of data.journeys) {
    if (j.kind === 'value_stream') {
      const b = bindings.find(b => b.journey_id === j.id);
      const node = b && data.map_nodes.find(n => n.scope === b.scope && n.node_key === b.node_key && n.active);
      const row = make('value_streams', { ...j, notion_id: node?.notion_id || null }, { '名称': title(j.name), '说明': rich(j.description),
        '树位置': treePath(areaChain(j.area_id), []) }, {
        ...(j.area_id ? { '所属部门': [ref('areas', j.area_id)] } : {}),
        '能力': data.journeys.filter(c => c.parent_journey_id === j.id).map(c => ref('capabilities', c.id)),
      }, [...(!projectedStream(j) ? ['value_stream_empty'] : []), ...(!j.area_id ? ['area_unknown'] : [])]);
      row.pageId = node?.notion_id || null;
      row.allowCreate = projectedStream(j);
    } else if (j.kind === 'capability') {
      const ctx = capabilityContext(j.id);
      make('capabilities', { ...j, notion_id: null }, { '名称': title(j.name), '说明': rich(j.description),
        '状态': select(STATUS[j.status] ?? j.status ?? '未写'), '树位置': treePath(ctx.chain, [ctx.names.vs]) }, {
        ...(j.parent_journey_id ? { '所属价值流': [ref('value_streams', j.parent_journey_id)] } : {}),
        '流程': data.workflows.filter(w => w.capability_id === j.id).map(w => ref('workflows', w.id)),
      }, j.parent_journey_id ? [] : ['value_stream_unknown']);
    }
  }
  const activityNames = new Map(data.activities.map(a => [a.id, a.name]));
  for (const w of data.workflows) {
    const usage = refs.filter(r => r.workflow_id === w.id);
    const version = currentDefinition(w, 'workflow'), ctx = capabilityContext(w.capability_id);
    const rt = runtimeByWorkflow.get(w.id) || {}, acts = unique(usage.map(r => ref('activities', r.activity_id))).length;
    const row = make('workflows', w, { '名称': title(w.name),
      // 顺序属于流程↔Activity 引用（共用 Activity 在不同流程里位置不同），只在这里按引用顺序列名字
      'Activity 顺序': rich(usage.map(r => `${r.sequence_no}. ${activityNames.get(r.activity_id) ?? r.activity_id}`).join('\n')),
      '运行方式': rich(runModeText(w.form, rt.items)), '运行情况': select(workflowUsageStatus({ ...rt, acts })),
      '最近运行': minuteDate(latest(rt.last_started, rt.last_run)), '7天次数': num(rt.runs7), '7天成功率': maybeNum(rt.success_rate),
      '平均时长': rich(durationText(rt.avg_duration_ms)), '树位置': treePath(ctx.chain, [ctx.names.vs, ctx.names.cap]) }, {
      ...(w.capability_id ? { '所属能力': [ref('capabilities', w.capability_id)] } : {}),
      'Activity': unique(usage.map(r => ref('activities', r.activity_id))),
    }, !w.capability_id ? ['capability_unknown'] : []);
    row.definitionVersion = versionEvidence(version);
  }
  for (const a of data.activities) {
    const usage = refs.filter(r => r.activity_id === a.id);
    const version = currentDefinition(a, 'activity'), ctx = activityContext(a.id);
    const unresolved = (Array.isArray(version?.payload.steps) ? version.payload.steps : []).filter(entry =>
      !data.steps.some(step => step.activity_id === a.id && step.id === entry.step_id && currentStepDefinition(step, a)))
      .map(entry => `Step 登记对不上：${entry.locator?.step_key || entry.contract?.key || 'unknown'}`);
    const row = make('activities', a, { '名称': title(a.name),
      ...buildActivityCardProps(a, (data.cells || []).filter(c => c.step_id === a.id), (data.uses || []).filter(u => u.activity_id === a.id), unresolved),
      '树位置': treePath(ctx.chain, [ctx.names.vs, ctx.names.cap, ctx.names.wf]) }, {
      '所属流程': unique(usage.map(r => ref('workflows', r.workflow_id))),
      'Step': data.steps.filter(s => s.activity_id === a.id && s.active).sort((a, b) => a.step_order - b.step_order).map(s => ref('steps', s.id)),
    });
    row.definitionVersion = versionEvidence(version);
  }
  for (const s of data.steps) {
    const a = data.activities.find(a => a.id === s.activity_id), contract = s.contract || {}, readback = s.readback || {};
    const definition = currentStepDefinition(s, a), declared = definition?.contract;
    const directImplementation = contract.implementation ?? readback.implementation;
    const implementation = directImplementation ?? declared?.implementation;
    const implementationStatus = definition?.implementationStatus === 'reference_verified' && isDeepStrictEqual(implementation, declared.implementation) ? 'reference_verified' : 'unverified';
    const fields = { '做什么': s.action, '输入': s.inputs ?? contract.input ?? fieldList(declared?.reads), '输出': s.outputs ?? contract.output ?? fieldList(declared?.writes),
      '怎么验收': acceptanceText(contract, readback, declared), '失败了怎么办': s.on_fail };
    const states = [...(!implementation ? ['implementation_unknown'] : []), ...(!a ? ['activity_unknown'] : []),
      ...(definition && implementation ? [implementationStatus === 'reference_verified' ? 'implementation_execution_unverified' : 'implementation_unverified'] : [])];
    const blank = Object.entries(fields).filter(([, v]) => v == null || v === '' || (Array.isArray(v) && !v.length)).map(([k]) => k);
    const missing = [...(blank.length ? [`没写：${blank.join('、')}`] : []), ...states.map(g => STEP_GAPS[g])];
    const row = make('steps', s, { '名称': title(readback.name || contract.name || s.name || s.key), '顺序': maybeNum(s.step_order),
      ...buildStepCardProps(s), '输入': rich(fields['输入'] ? humanize(fields['输入']) : null), '输出': rich(fields['输出'] ? humanize(fields['输出']) : null),
      '怎么验收': rich(fields['怎么验收']), '谁来执行': select(executorLabel(a?.executor_kind)), '还缺什么': rich(missing.join('\n') || '齐了') }, {
      ...(s.activity_id ? { '所属Activity': [ref('activities', s.activity_id)] } : {}),
    }, !a ? ['activity_unknown'] : []);
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
      'ran7',(SELECT count(*) FROM ops_schedule_entries e WHERE e.workflow_id=w.id AND e.last_run_at > now() - interval '7 days'),
      'last_run',(SELECT max(e.last_run_at) FROM ops_schedule_entries e WHERE e.workflow_id=w.id),
      'runs7',COALESCE(st.runs,0),'failed7',COALESCE(st.failed,0),'success_rate',st.success_rate,
      'avg_duration_ms',st.avg_duration_ms,'last_started',st.last_started_at,
      'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('label',x.label,'schedule',x.schedule_desc,'enabled',x.enabled,
        'status',x.last_status,'last',x.last_run_at,'source',x.source,'host',x.host) ORDER BY x.enabled DESC, x.last_run_at DESC NULLS LAST)
        FROM (SELECT e.label,e.schedule_desc,e.enabled,e.last_status,e.last_run_at,e.source,to_jsonb(e)->>'host_alias' AS host
          FROM ops_schedule_entries e WHERE e.workflow_id=w.id
          ORDER BY e.enabled DESC, e.last_run_at DESC NULLS LAST LIMIT 12) x),'[]'::jsonb))) FROM workflows w
      LEFT JOIN v_workflow_run_stats st ON st.workflow_id=w.id AND st.time_window='7d'),'[]'::jsonb),
    'map_nodes',COALESCE((SELECT jsonb_agg(jsonb_build_object('scope',l.scope,'node_key',l.node_key,
      'name',n.name,'notion_id',l.notion_id,'journey_id',n.attributes->>'journey_id','active',true))
      FROM notion_map_node_pages l JOIN map_projection_runs r ON r.scope_key=l.scope AND r.status='active'
      JOIN map_projection_nodes n ON n.run_id=r.id AND n.node_key=l.node_key AND n.node_type='value_stream'
      WHERE l.archived_at IS NULL),'[]'::jsonb)) AS source`);
  return rows[0].source;
}
