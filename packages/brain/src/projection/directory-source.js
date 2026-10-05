/** 六层目录只读源：共享引用为准；不改契约、归属、版本或人工列。 */
import { isDeepStrictEqual } from 'node:util';
export const DIRECTORY_TABLES = Object.freeze({ areas: 'areas', value_streams: 'journeys', capabilities: 'journeys', workflows: 'workflows', activities: 'activities', steps: 'steps' });
export const rich = value => ({ rich_text: value == null || value === '' ? [] : [{ text: { content: (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 1900) } }] });
const ref = (layer, id) => ({ layer, id });
const unique = items => [...new Map(items.map(x => [`${x.layer}:${x.id}`, x])).values()].sort((a, b) => a.id.localeCompare(b.id));
const title = value => ({ title: [{ text: { content: String(value).slice(0, 200) } }] });
const select = name => ({ select: { name: String(name || 'unknown') } });
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
    const item = { layer, table, id: row.id, pageId: row.notion_id || null,
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
      const row = make('value_streams', { ...j, notion_id: node?.notion_id || null }, {}, {
        ...(j.area_id ? { '所属部门': [ref('areas', j.area_id)] } : {}),
        Capabilities: data.journeys.filter(c => c.parent_journey_id === j.id).map(c => ref('capabilities', c.id)),
      }, [...(!b ? ['value_stream_binding_missing'] : []), ...(!j.area_id ? ['area_unknown'] : [])]);
      row.pageId = node?.notion_id || null;
    } else if (j.kind === 'capability') {
      make('capabilities', { ...j, notion_id: null }, { Name: title(j.name), Key: rich(j.capability_code || j.id),
        '说明': rich(j.description), '登记状态': select(j.status) }, {
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
    const row = make('workflows', w, { Workflow: title(w.name), Key: rich(w.key), '版本': rich(w.version),
      '渠道': rich(w.channel), '形态': rich(w.form), Trigger: rich(trigger), Input: rich(input), Output: rich(output),
      '执行策略': rich(policy), '登记状态': select(w.status),
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
      '使用位置': rich(usage.map(r => `${r.workflow_id} / ${r.slot_key} / ${r.sequence_no}`).join('\n')) }, {
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
      '登记状态': select(s.active ? 'active' : 'retired') }, {
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
    'journeys',COALESCE((SELECT jsonb_agg(to_jsonb(j)) FROM journeys j),'[]'::jsonb),
    'workflows',COALESCE((SELECT jsonb_agg(to_jsonb(w) || jsonb_build_object('definition_version',to_jsonb(v))) FROM workflows w
      LEFT JOIN workflow_definition_versions v ON v.workflow_id=w.id AND v.id::text=to_jsonb(w)->>'current_definition_version_id'),'[]'::jsonb),
    'activities',COALESCE((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('definition_version',to_jsonb(v))) FROM activities a
      LEFT JOIN activity_definition_versions v ON v.activity_id=a.id AND v.id::text=to_jsonb(a)->>'current_definition_version_id'
      WHERE (to_jsonb(a)->>'capability_key' IS NOT NULL AND to_jsonb(a)->>'activity_key' IS NOT NULL)
      OR EXISTS(SELECT 1 FROM workflow_activity_refs r WHERE r.activity_id=a.id AND r.active)),'[]'::jsonb),
    'steps',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM steps s),'[]'::jsonb),
    'refs',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM workflow_activity_refs r),'[]'::jsonb),
    'map_nodes',COALESCE((SELECT jsonb_agg(jsonb_build_object('scope',l.scope,'node_key',l.node_key,
      'name',n.name,'notion_id',l.notion_id,'journey_id',n.attributes->>'journey_id','active',true))
      FROM notion_map_node_pages l JOIN map_projection_runs r ON r.scope_key=l.scope AND r.status='active'
      JOIN map_projection_nodes n ON n.run_id=r.id AND n.node_key=l.node_key AND n.node_type='value_stream'
      WHERE l.archived_at IS NULL),'[]'::jsonb)) AS source`);
  return rows[0].source;
}
