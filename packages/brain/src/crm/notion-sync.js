import { randomUUID } from 'node:crypto';
import { parseCustomerPage, buildCustomerProperties, validateCustomerSchema } from './notion-mapping.js';
import { projectManagedProfile } from './notion-content.js';
import { projectCustomerChildren } from './notion-children.js';
import { recoverOnboardPage, projectOnboardCustomer } from './onboard-notion.js';

function fault(code) { return Object.assign(new Error(`CRM sync: ${code}`), { code }); }
const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && a.replaceAll('-', '').toLowerCase() === b.replaceAll('-', '').toLowerCase();
export function createNotionRequest({ token = process.env.NOTION_API_KEY, deadline = Date.now() + 120_000, fetchImpl = fetch } = {}) {
  return async function request(path, method = 'GET', body) {
    if (!token) throw fault('notion_credentials_missing');
    if (typeof path !== 'string' || !/^\/(?:pages|(data_sources|pages|blocks)\/[a-zA-Z0-9-]+(?:\/(query|children|markdown))?)(?![\s\S])/.test(path)) throw fault('invalid_notion_path');
    // Only pathname is variable: the URL authority never consumes caller input.
    const endpoint = new URL('https://api.notion.com');
    endpoint.pathname = `/v1${path}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw fault('budget_exceeded');
      const response = await fetchImpl(endpoint, {
        method, redirect: 'error', signal: AbortSignal.timeout(Math.min(15_000, remaining)),
        headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2026-03-11', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      // A page creation is a side effect with a durable fence. Even 429 must not cause
      // another physical POST here; the owner resolves any uncertainty by querying.
      if (response.status === 429 && attempt < 2 && !(path === '/pages' && String(method).toUpperCase() === 'POST')) {
        const delay = Math.min(2000, Math.max(0, Number(response.headers.get('retry-after') ?? 1) * 1000));
        if (Date.now() + delay >= deadline) throw fault('budget_exceeded');
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      if (!response.ok) throw fault(`notion_http_${response.status}`);
      const data = await response.json();
      if (data.object === 'async_task') throw fault('notion_async_pending');
      return data;
    }
    throw fault('notion_rate_limited');
  };
}

async function acquire(pool, deadline) {
  let expired = false, timer;
  const pending = pool.connect().then(client => { if (expired) { client.release(); throw fault('connection_timeout'); } return client; });
  try {
    return await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(fault('connection_timeout')); }, Math.max(1, Math.min(10_000, deadline - Date.now())));
    })]);
  } finally { clearTimeout(timer); }
}

/** One explicitly registered source, a dedicated connection lock, bounded complete pagination. */
export async function runCrmSync(pool, bindingId, options = {}) {
  if (process.env.CRM_SYNC_ENABLED !== 'true') return { skipped: true, reason: 'disabled' };
  const store = options.store ?? await import('./store.js');
  const start = Date.now(), deadline = Math.min(start + 120_000, options.deadline ?? Infinity);
  const request = options.request ?? createNotionRequest({ deadline });
  const client = await acquire(pool, deadline);
  let locked = false;
  let settings;
  const receipt = { run_id: randomUUID(), binding_id: bindingId, started_at: new Date(start).toISOString(), read: 0, created: 0, updated: 0, projected: 0 };
  function budget() { if (Date.now() >= deadline) throw fault('budget_exceeded'); }
  try {
    settings = (await client.query("SELECT current_setting('statement_timeout') AS statement_timeout,current_setting('lock_timeout') AS lock_timeout")).rows[0];
    await client.query("SELECT set_config('statement_timeout',$1,false),set_config('lock_timeout','5000',false)", [String(Math.max(1, Math.min(15_000, deadline - Date.now())))]);
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [`crm-sync:${bindingId}`]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { ...receipt, skipped: true, reason: 'busy' };
    const binding = (await store.listBindings(client)).find(x => x.id === bindingId);
    if (!binding?.enabled) throw fault('binding_disabled');
    const schema = await request(`/data_sources/${binding.data_source_id}`);
    if (!sameId(schema.id, binding.data_source_id)) throw fault('source_mismatch');
    validateCustomerSchema(schema, binding);
    const after = binding.cursor ? new Date(new Date(binding.cursor).getTime() - 120_000).toISOString() : null;
    receipt.cursor_before = binding.cursor ?? null;
    let cursor = null;
    const seen = new Set();
    for (let count = 0; ; count++) {
      budget();
      if (count >= 100) throw fault('page_budget_exceeded');
      const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}),
        ...(after ? { filter: { timestamp: 'last_edited_time', last_edited_time: { on_or_after: after } } } : {}) };
      const response = await request(`/data_sources/${binding.data_source_id}/query`, 'POST', body);
      if (!Array.isArray(response.results) || response.request_status?.type === 'incomplete') throw fault('incomplete_query');
      for (const page of response.results) {
        budget();
        if (!sameId(page.parent?.data_source_id, binding.data_source_id)) throw fault('source_mismatch');
        if (binding.fields?.allowed_page_ids && !binding.fields.allowed_page_ids.some(id => sameId(id, page.id))) continue;
        // Archived pages cannot request deletion. No customer or communication is removed.
        if (page.in_trash) continue;
        const recovered = await recoverOnboardPage(client, request, binding, page);
        if (recovered?.recovered) receipt.onboard_recovered = (receipt.onboard_recovered ?? 0) + 1;
        const result = await store.ingestCustomer(client, binding, parseCustomerPage(page, binding));
        receipt.read++;
        if (result.created) receipt.created++; else if (result.changed) receipt.updated++;
      }
      if (!response.has_more) break;
      if (!response.next_cursor || seen.has(response.next_cursor)) throw fault('invalid_cursor');
      seen.add(response.next_cursor); cursor = response.next_cursor;
    }
    // Pull succeeded; Brain changes are committed even if projecting their result later fails.
    budget();
    await store.updateBindingCursor(client, binding.id, receipt.started_at);
    receipt.cursor_after = receipt.started_at;
    const pending = await store.listPending(client, {
      tenant_id: binding.tenant_id, binding_id: binding.id,
      allowed_page_ids: binding.fields?.allowed_page_ids, limit: 50,
    });
    for (const { customer } of pending) {
      budget();
      if (binding.fields?.allowed_page_ids && !binding.fields.allowed_page_ids.some(id => sameId(id, customer.source_page_id))) continue;
      await store.markProjectionChecked(client, binding.tenant_id, customer.id);
      if (!customer.source_page_id) {
        const projected = await projectOnboardCustomer(client, request, binding, customer);
        const key = projected.status === 'mapped' || projected.status === 'already_mapped' ? 'onboard_mapped' : 'deferred';
        receipt[key] = (receipt[key] ?? 0) + 1;
        continue;
      }
      const properties = buildCustomerProperties(customer, binding);
      // Re-read the exact page and protect its parent. Never create another customer page.
      const page = await request(`/pages/${customer.source_page_id}`);
      if (!sameId(page.parent?.data_source_id, binding.data_source_id) || page.in_trash) throw fault('source_mismatch');
      if (Object.keys(properties).length) await request(`/pages/${customer.source_page_id}`, 'PATCH', { properties });
      if (binding.fields?.managed_content === true) await projectManagedProfile(request, customer);
      const children = await projectCustomerChildren(client, store, request, binding, customer);
      receipt.messages_projected = (receipt.messages_projected ?? 0) + children.messages_projected;
      receipt.reports_projected = (receipt.reports_projected ?? 0) + children.reports_projected;
      receipt.deferred = (receipt.deferred ?? 0) + children.deferred;
      if (children.deferred) continue;
      budget();
      if (await store.markProjected(client, binding.tenant_id, customer.id, customer.revision)) receipt.projected++;
      else receipt.stale = (receipt.stale ?? 0) + 1;
    }
    receipt.finished_at = new Date().toISOString();
    return receipt;
  } catch (error) {
    // Only metadata is attached: the HTTP handler must never expose response bodies or chat text.
    error.receipt = { ...receipt, finished_at: new Date().toISOString(), error_code: error.code || 'sync_failed' };
    throw error;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`crm-sync:${bindingId}`]).catch(() => {});
    let destroy = false;
    try { await client.query("SELECT set_config('statement_timeout',$1,false),set_config('lock_timeout',$2,false)", [settings?.statement_timeout ?? '0', settings?.lock_timeout ?? '0']); }
    catch { destroy = true; }
    client.release(destroy);
  }
}

export async function runCrmSyncJobs(pool) {
  if (process.env.CRM_SYNC_ENABLED !== 'true') return { skipped: true, reason: 'disabled' };
  const store = await import('./store.js');
  const bindings = (await store.listBindings(pool)).filter(x => x.enabled)
    .sort((a, b) => new Date(a.cursor ?? 0) - new Date(b.cursor ?? 0));
  const deadline = Date.now() + 120_000;
  const results = [];
  for (const binding of bindings) {
    if (Date.now() >= deadline) break;
    try { results.push(await runCrmSync(pool, binding.id, { deadline })); }
    catch (error) { results.push(error.receipt ?? { binding_id: binding.id, error_code: error.code || 'sync_failed' }); }
  }
  return { results, ok: results.every(x => !x.error_code) };
}
