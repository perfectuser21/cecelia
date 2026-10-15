import { definitionDigest, object, authoringError } from './contracts.js';

const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEY = /^[a-z][a-z0-9_.-]{0,99}$/;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const TRANSPORTS = new Set(['openclaw-agent', 'codex-bridge', 'script']);
const safeField = s => typeof s === 'string' && FIELD.test(s) && !UNSAFE.has(s);
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);

function fields(value) {
  if (isObject(value) && value.type === 'object' && isObject(value.properties)) {
    const names = Object.keys(value.properties), required = value.required ?? [];
    if (names.every(safeField) && Array.isArray(required)
      && new Set(required).size === required.length && required.every(n => names.includes(n))) return { names, required };
  }
  if (Array.isArray(value) && value.length && value.every(v => isObject(v) && Array.isArray(v.fields))) {
    const names = value.flatMap(v => v.fields);
    if (names.every(safeField) && new Set(names).size === names.length) return { names, required: names };
  }
  return null;
}

function fixedSource(repo, path, revision) {
  return typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo)
    && typeof path === 'string' && /^(?:[\w-]+\/)*[\w.-]+$/.test(path)
    && !path.split('/').some(p => p === '.' || p === '..') && SHA.test(revision ?? '');
}

function resolveShared(slot, catalog, gap) {
  if (!slot.reuse_activity_id) return { contract: slot, source: null };
  const version = catalog.activity_versions?.find(v => v.id === slot.reuse_activity_definition_version_id);
  if (!UUID.test(slot.reuse_activity_id) || !version || version.activity_id !== slot.reuse_activity_id
    || version.payload?.activity_id !== slot.reuse_activity_id || !isObject(version.payload.contract)
    || !fixedSource(version.source_repo, version.source_path, version.source_commit)
    || (slot.reuse_contract_sha256 && slot.reuse_contract_sha256 !== version.contract_sha256)) {
    gap('shared_activity_version_invalid', slot.key); return { contract: slot, source: null };
  }
  return { contract: version.payload.contract, source: { repo: version.source_repo, ref: version.source_path, revision: version.source_commit } };
}

function implementation(contract, source, catalog, key, gap) {
  // bindings 列举来源文件，不负责替调用者选择其中哪一个是可执行入口。
  const impl = contract.implementation;
  if (!isObject(impl) || !['skill', 'code'].includes(impl.kind)) {
    gap('implementation_entry_missing', key); return null;
  }
  const revision = impl.revision === 'contract' && impl.repo === source?.repo ? source.revision : impl.revision;
  if (!fixedSource(impl.repo, impl.path, revision)
    || (impl.kind === 'skill' && !/(^|\/)SKILL\.md$/.test(impl.path))) gap('implementation_source_invalid', key);
  if (impl.kind === 'skill') {
    const skill = catalog.skills?.find(s => s.id === impl.skill_id);
    if (!skill || skill.status !== 'active') gap('skill_not_active', key);
  }
  if (impl.symbol) gap('implementation_symbol_unverified', key);
  return { kind: impl.kind, repo: impl.repo ?? null, path: impl.path ?? null,
    revision: revision ?? null, skill_id: impl.skill_id ?? null, validation_scope: 'reference_unverified' };
}

function warehouse(contract, catalog, key, gap) {
  const declared = contract.warehouse_dependencies ?? [];
  if (!Array.isArray(declared) || declared.length > 100) {
    gap('warehouse_dependencies_invalid', key); return [];
  }
  const result = [], seen = new Set();
  for (const item of declared) {
    const role = item?.role ?? 'uses';
    if (!isObject(item) || !KEY.test(item.key ?? '') || !['uses', 'depends', 'produces'].includes(role)) {
      gap('warehouse_dependencies_invalid', key); continue;
    }
    const matches = (catalog.warehouse_items ?? []).filter(w => w.key === item.key && w.active === true);
    if (matches.length !== 1) { gap('warehouse_item_missing', key, item.key); continue; }
    const identity = `${item.key}:${role}`;
    if (!seen.has(identity)) result.push({ item_id: matches[0].id, key: item.key, role });
    seen.add(identity);
  }
  return result;
}

function mappings(activities, input, gap) {
  const edges = new Map(activities.map(a => [a.key, new Set()]));
  for (const [index, a] of activities.entries()) {
    const declared = a.mapping;
    if (declared !== undefined && !isObject(declared)) { gap('input_mapping_invalid', a.key); continue; }
    const map = {};
    for (const field of a.inputs?.required ?? []) {
      let path = declared?.[field];
      if (path === undefined) {
        const sources = input?.names.includes(field) ? [`$input.${field}`] : [];
        for (const previous of activities.slice(0, index)) {
          if (previous.outputs?.names.includes(field)) sources.push(`$activity.${previous.key}.${field}`);
        }
        if (sources.length !== 1) { gap(sources.length ? 'input_mapping_ambiguous' : 'input_mapping_missing', a.key, field); continue; }
        [path] = sources;
      }
      map[field] = path;
    }
    // 可选字段的显式连接也必须检查，不能只校验 required 字段。
    for (const [field, path] of Object.entries(declared ?? {})) {
      if (!a.inputs?.names.includes(field) || !safeField(field)) gap('input_mapping_invalid', a.key, field);
      else map[field] = path;
    }
    for (const [field, path] of Object.entries(map)) {
      const fromInput = typeof path === 'string' && path.match(/^\$input\.([A-Za-z_][A-Za-z0-9_]*)$/);
      const fromActivity = typeof path === 'string' && path.match(/^\$activity\.(.+)\.([A-Za-z_][A-Za-z0-9_]*)$/);
      if (fromInput && input?.names.includes(fromInput[1]) && safeField(fromInput[1])) {
        if (a.inputs.required.includes(field) && !input.required.includes(fromInput[1])) gap('input_source_optional', a.key, field);
        continue;
      }
      if (fromActivity) {
        const sourceIndex = activities.findIndex(s => s.key === fromActivity[1]);
        if (sourceIndex >= 0) edges.get(a.key).add(fromActivity[1]);
        if (sourceIndex >= 0 && activities[sourceIndex].outputs?.names.includes(fromActivity[2]) && safeField(fromActivity[2])) {
          if (sourceIndex >= index) gap('activity_forward_dependency', a.key, field);
          if (a.inputs.required.includes(field) && !activities[sourceIndex].outputs.required.includes(fromActivity[2])) gap('input_source_optional', a.key, field);
          continue;
        }
      }
      gap('input_mapping_invalid', a.key, field);
    }
    a.input_mapping = map;
  }
  const visiting = new Set(), visited = new Set();
  function visit(key) {
    if (visiting.has(key)) { gap('activity_dependency_cycle', key); return; }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of edges.get(key) ?? []) visit(dependency);
    visiting.delete(key); visited.add(key);
  }
  for (const key of edges.keys()) visit(key);
}

function workflowOutputs(definition, output, activities, gap) {
  const declared = definition.output_mapping;
  if (declared !== undefined && !isObject(declared)) { gap('output_mapping_invalid'); return {}; }
  const result = {};
  for (const [field, path] of Object.entries(declared ?? {})) {
    const match = typeof path === 'string' && path.match(/^\$activity\.(.+)\.([A-Za-z_][A-Za-z0-9_]*)$/);
    const source = match && activities.find(a => a.key === match[1]);
    if (!safeField(field) || !output?.names.includes(field) || !source?.outputs?.names.includes(match[2])) {
      gap('output_mapping_invalid', null, field); continue;
    }
    if (output.required.includes(field) && !source.outputs.required.includes(match[2])) gap('output_source_optional', null, field);
    result[field] = path;
  }
  for (const field of output?.required ?? []) {
    if (Object.hasOwn(declared ?? {}, field)) continue;
    const sources = activities.filter(a => a.outputs?.names.includes(field));
    if (sources.length !== 1) gap(sources.length ? 'output_mapping_ambiguous' : 'output_mapping_missing', null, field);
    else {
      if (!sources[0].outputs.required.includes(field)) gap('output_source_optional', null, field);
      result[field] = `$activity.${sources[0].key}.${field}`;
    }
  }
  return result;
}

/** 只编译定义。固定文件、资源和运行效果的核验属于后续关卡，绝不在这里宣称可调用。 */
export function compileAssemblyPlan(definition, catalog = {}, { tenantId = 'default' } = {}) {
  object(definition, 'definition');
  if (Buffer.byteLength(JSON.stringify(definition)) > 150000) throw authoringError('定义超过大小限制', 413);
  const definition_sha256 = definitionDigest(definition), gaps = [];
  const gap = (code, activity_key = null, field = null) => {
    if (!gaps.some(g => g.code === code && g.activity_key === activity_key && g.field === field)) gaps.push({ code, activity_key, field });
  };
  if (definition.tenant_id !== undefined && definition.tenant_id !== tenantId) gap('tenant_mismatch');
  if (!KEY.test(definition.key ?? '')) gap('workflow_key_invalid');
  if (!fixedSource(definition.source?.repo, definition.source?.ref, definition.source?.revision)) gap('definition_source_invalid');
  const input = fields(definition.input_schema ?? definition.inputs), output = fields(definition.output_schema ?? definition.outputs);
  if (!input) gap('input_contract_missing');
  if (!output) gap('output_contract_missing');
  const slots = definition.activities;
  if (!Array.isArray(slots) || !slots.length) gap('activities_missing');
  if (Array.isArray(slots) && slots.length > 100) throw authoringError('活动数量超过限制', 413);
  const seen = new Set();
  const activities = (Array.isArray(slots) ? slots : []).map((slot, index) => {
    if (!isObject(slot)) { gap('activity_invalid', String(index)); slot = {}; }
    const key = slot.key;
    if (!KEY.test(key ?? '') || seen.has(key)) gap('activity_key_invalid', key ?? null);
    seen.add(key);
    if (slot.order !== undefined && slot.order !== index + 1) gap('activity_order_invalid', key);
    const { contract, source } = resolveShared(slot, catalog, gap);
    if (contract.tenant_id !== undefined && contract.tenant_id !== tenantId) gap('tenant_mismatch', key);
    const inputs = fields(contract.input_schema ?? contract.inputs), outputs = fields(contract.output_schema ?? contract.outputs);
    if (!inputs) gap('input_contract_missing', key);
    if (!outputs) gap('output_contract_missing', key);
    if (!['agent', 'code'].includes(contract.executor_kind)) gap('executor_unsupported', key);
    if (!Array.isArray(contract.acceptance) || !contract.acceptance.length
      || !contract.acceptance.every(s => typeof s === 'string' && s.trim())) gap('acceptance_missing', key);
    const transport = contract.runtime?.transport ?? definition.runtime?.transport;
    if (!transport) gap('transport_missing', key);
    else if (!TRANSPORTS.has(transport)) gap('transport_unsupported', key);
    const impl = implementation(contract, source ?? definition.source, catalog, key, gap);
    if (impl && ((contract.executor_kind === 'agent' && impl.kind !== 'skill')
      || (contract.executor_kind === 'code' && impl.kind !== 'code'))) gap('executor_implementation_mismatch', key);
    return { key, sequence_no: index + 1, activity_id: slot.reuse_activity_id ?? null,
      definition_version_id: slot.reuse_activity_definition_version_id ?? null,
      inputs, outputs, implementation: impl, transport: transport ?? null,
      warehouse_dependencies: warehouse(contract, catalog, key, gap),
      mapping: slot.reuse_activity_id ? slot.input_mapping : contract.input_mapping };
  });
  mappings(activities, input, gap);
  const output_mapping = workflowOutputs(definition, output, activities, gap);
  const structurally_complete = gaps.length === 0;
  gap('implementation_reference_unverified');
  gap('runtime_admission_unverified');
  gap('execution_evidence_unverified');
  return { protocol: 'workflow-assembly-plan-v1', key: definition.key ?? null, definition_sha256,
    tenant_id: tenantId, structurally_complete, callable: false,
    readiness: structurally_complete ? 'unverified' : 'blocked', input_fields: input, output_fields: output,
    output_mapping, activities: activities.map(({ mapping: _mapping, ...a }) => a), gaps };
}
