import { UUID } from './workflow-foundation/contracts.js';
import { standaloneWorkflows } from './workflow-foundation/standalone-source.js';

const invalid = code => Object.assign(new Error(code), { code });

function readFields(body, allowedFields) {
  const fields = new Map();
  for (const line of body.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    const match = /^([^:：]+)\s*[:：]\s*(.+)$/u.exec(line);
    const label = match?.[1].trim();
    if (!allowedFields.has(label) || fields.has(label)) throw invalid('notion_leadgen_input_invalid');
    fields.set(label, match[2].trim());
  }
  return fields;
}

function readInput(body) {
  const fields = readFields(body, new Set(['公司','关键词','候选上限']));
  const company = fields.get('公司');
  const keyword = fields.get('关键词');
  if (!company || !keyword || keyword.length > 80 || (fields.has('候选上限') && fields.get('候选上限') !== '1')) {
    throw invalid('notion_leadgen_input_invalid');
  }
  return { company, business: { keyword, max_candidates: 1 } };
}

export function explicitLeadgenStages(description) {
  return [...new Set([...description.matchAll(/\[leadgen-(10[1-4])\]/g)].map(match => match[1]))];
}

function readSourceInput(stage, body) {
  const order = stage === '104';
  const field = order ? '原订单' : '来源运行';
  const fields = readFields(body, new Set(['公司', field]));
  const source = fields.get(field);
  const company = fields.get('公司');
  const valid = order ? UUID.test(source ?? '') || /^rec[A-Za-z0-9]{1,50}$/.test(source ?? '')
    : /^[A-Za-z0-9_-]{1,120}$/.test(source ?? '');
  if (!company || !valid) throw invalid('notion_leadgen_input_invalid');
  return { company, business: order ? { order_id: source } : { source_run: source } };
}

export function inactiveLeadgenReason(stage, body) {
  try {
    readSourceInput(stage, body);
    return '尚未登记独立执行端';
  } catch (error) {
    if (error.code !== 'notion_leadgen_input_invalid') throw error;
    return '请填写公司和有效的' + (stage === '104' ? '原订单' : '来源运行');
  }
}

export async function dispatchNotionLeadgen(pool, { stage, pageId, title, body, tenantId, bindings }, { createTask } = {}) {
  if (!Object.hasOwn(standaloneWorkflows, stage) || !UUID.test(pageId) || !title || typeof body !== 'string') {
    throw invalid('notion_leadgen_input_invalid');
  }
  const { company, business } = stage === '101' ? readInput(body) : readSourceInput(stage, body);
  const binding = bindings && Object.hasOwn(bindings, company) ? bindings[company] : null;
  if (!binding || binding.tenant_id !== tenantId || !UUID.test(binding.workflow_id) || !UUID.test(binding.release_id)
    || !/^[A-Za-z0-9_-]{1,100}$/.test(binding.binding_key ?? '')) throw invalid('notion_leadgen_binding_unavailable');
  const register = createTask ?? (await import('./workflow-foundation/registry.js')).createFoundationTask;
  const { task } = await register(pool, {
    title: title.slice(0, 200),
    workflow_id: binding.workflow_id,
    release_id: binding.release_id,
    input: { binding_key: binding.binding_key, business },
    idempotency_key: `notion-${stage}:${pageId}`,
  }, { notionPageId: pageId, notionTenantId: tenantId, ...(stage === '101' ? {} : { notionWorkflowKey: standaloneWorkflows[stage] }) });
  return { taskId: task.id, kind: 'workflow_dispatch' };
}
