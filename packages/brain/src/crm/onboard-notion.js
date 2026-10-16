import { fault, uuid } from './onboard-common.js';
import { validateCustomerSchema } from './notion-mapping.js';
import { pageBrainId, validateOnboardPage, getOnboardPageState, reservePageAttempt, bindOnboardPage, sameId } from './onboard-page-store.js';

/** All pages must be consumed before accepting uniqueness; incomplete pagination never authorizes POST. */
async function findPage(request, binding, customerId) {
  let cursor = null; const cursors = new Set(), pages = [];
  for (let count = 0; count < 100; count++) {
    const response = await request(`/data_sources/${uuid(binding.data_source_id)}/query`, 'POST', {
      page_size: 100, filter: { property: binding.fields.brain_id, rich_text: { equals: customerId } }, ...(cursor ? { start_cursor: cursor } : {}),
    });
    if (!Array.isArray(response?.results) || typeof response.has_more !== 'boolean' || response.request_status?.type === 'incomplete') throw fault('incomplete_query');
    pages.push(...response.results);
    if (pages.length > 1) throw fault('identity_conflict');
    if (!response.has_more) return pages[0] ?? null;
    if (!response.next_cursor || cursors.has(response.next_cursor)) throw fault('incomplete_query');
    cursors.add(response.next_cursor); cursor = response.next_cursor;
  }
  throw fault('incomplete_query');
}
async function validateSchema(request, binding) {
  const schema = await request(`/data_sources/${uuid(binding.data_source_id)}`);
  if (!sameId(schema?.id, binding.data_source_id) || !binding.fields?.brain_id) throw fault('invalid_schema');
  validateCustomerSchema(schema, binding);
}
async function readAndBind(db, request, binding, customerId, page) {
  const readback = await request(`/pages/${uuid(page.id)}`);
  if (!sameId(readback?.id, page.id)) throw fault('identity_conflict');
  validateOnboardPage(readback, binding, customerId);
  return bindOnboardPage(db, binding, customerId, readback);
}

export async function recoverOnboardPage(db, request, binding, page) {
  const customerId = pageBrainId(page, binding);
  if (!customerId) return null;
  const current = await getOnboardPageState(db, binding, customerId);
  if (current.customer.source_page_id) {
    if (!sameId(current.customer.source_page_id, page.id)) throw fault('identity_conflict');
    validateOnboardPage(page, current.binding, customerId);
    return { customer: current.customer, recovered: false };
  }
  if (!current.attempt) throw fault('identity_conflict');
  await validateSchema(request, current.binding);
  const found = await findPage(request, current.binding, customerId);
  if (!found || !sameId(found.id, page.id)) throw fault('identity_conflict');
  return { customer: await readAndBind(db, request, current.binding, customerId, found), recovered: true };
}

export async function projectOnboardCustomer(db, request, binding, customer) {
  const current = await getOnboardPageState(db, binding, uuid(customer.id));
  if (current.customer.source_page_id) return { status: 'already_mapped', customer: current.customer };
  // Configured arrays (including []) authorize only known pages, never an unknown new page.
  if (!current.attempt && current.binding.fields?.allowed_page_ids !== undefined) return { status: 'blocked_scope' };
  await validateSchema(request, current.binding);
  let page = await findPage(request, current.binding, customer.id);
  if (page) {
    if (!current.attempt) throw fault('identity_conflict');
    return { status: 'mapped', customer: await readAndBind(db, request, current.binding, customer.id, page) };
  }
  const reserved = await reservePageAttempt(db, current.binding, current.customer);
  if (reserved.customer.source_page_id) return { status: 'already_mapped', customer: reserved.customer };
  if (!reserved.created) return { status: 'unknown' };
  // The fence transaction is committed. Any error, timeout or asynchronous result retains it.
  try { page = await request('/pages', 'POST', reserved.payload); }
  catch (error) { return { status: 'unknown', error_code: error.code ?? 'create_unknown' }; }
  if (page?.object === 'async_task' || !page?.id) return { status: 'unknown' };
  const found = await findPage(request, reserved.binding, customer.id);
  if (!found) return { status: 'unknown' };
  if (!sameId(found.id, page.id)) throw fault('identity_conflict');
  return { status: 'mapped', customer: await readAndBind(db, request, reserved.binding, customer.id, found) };
}
