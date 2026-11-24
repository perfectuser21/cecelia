import { createFoundationTask } from './workflow-foundation/registry.js';
import { UUID } from './workflow-foundation/contracts.js';

export const NOTION_LEADGEN_101_MARK = '[leadgen-101]';
const allowedFields = new Set(['公司', '关键词', '候选上限']);
const invalid = code => Object.assign(new Error(code), { code });

function readInput(body) {
  const fields = new Map();
  for (const line of body.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    const match = /^([^:：]+)\s*[:：]\s*(.+)$/u.exec(line);
    const label = match?.[1].trim();
    if (!allowedFields.has(label) || fields.has(label)) throw invalid('notion_leadgen_input_invalid');
    fields.set(label, match[2].trim());
  }
  const company = fields.get('公司');
  const keyword = fields.get('关键词');
  if (!company || !keyword || keyword.length > 80 || (fields.has('候选上限') && fields.get('候选上限') !== '1')) {
    throw invalid('notion_leadgen_input_invalid');
  }
  return { company, keyword };
}

export async function dispatchNotionLeadgen101(pool, { pageId, title, body, tenantId, bindings }, { createTask = createFoundationTask } = {}) {
  if (!UUID.test(pageId) || !title || typeof body !== 'string') throw invalid('notion_leadgen_input_invalid');
  const { company, keyword } = readInput(body);
  const binding = bindings && Object.hasOwn(bindings, company) ? bindings[company] : null;
  if (!binding || binding.tenant_id !== tenantId || !UUID.test(binding.workflow_id) || !UUID.test(binding.release_id)
    || !/^[A-Za-z0-9_-]{1,100}$/.test(binding.binding_key ?? '')) throw invalid('notion_leadgen_binding_unavailable');
  const { task } = await createTask(pool, {
    title: title.slice(0, 200),
    workflow_id: binding.workflow_id,
    release_id: binding.release_id,
    input: { binding_key: binding.binding_key, business: { keyword, max_candidates: 1 } },
    idempotency_key: 'notion-101:' + pageId,
  }, { notionPageId: pageId, notionTenantId: tenantId });
  return { taskId: task.id, kind: 'workflow_dispatch' };
}
