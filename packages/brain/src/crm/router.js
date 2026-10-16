import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { internalAuthOrLoopback } from '../middleware/internal-auth.js';
import * as store from './store.js';
import { runCrmSync, createNotionRequest } from './notion-sync.js';
import { validateCustomerSchema } from './notion-mapping.js';
import { resolveContact } from './contact-resolve.js';
import { onboardContact } from './onboard-store.js';

/** Privileged cross-service API, not a customer-facing tenant authorization substitute. */
export function createCrmRouter({ pool, notionRequest } = {}) {
  const router = Router();
  router.use(internalAuthOrLoopback);
  router.use(rateLimit({ windowMs: 60_000, limit: 100, standardHeaders: 'draft-7', legacyHeaders: false }));
  router.get('/status', async (_req, res, next) => {
    if (process.env.CRM_SYNC_ENABLED !== 'true') return res.json({ enabled: false, bindings: [] });
    try { res.json({ enabled: true, bindings: await store.listBindings(pool) }); } catch (err) { next(err); }
  });
  router.use((_req, res, next) => process.env.CRM_SYNC_ENABLED === 'true'
    ? next() : res.status(503).json({ error: 'crm_disabled' }));
  router.post('/bindings', async (req, res, next) => {
    try {
      if (Object.keys(req.body ?? {}).some(k => !['tenant_id', 'data_source_id', 'enabled', 'fields'].includes(k))) {
        return res.status(400).json({ error: 'invalid_configuration' });
      }
      const input = req.body;
      if (!/^[0-9a-f-]{36}$/i.test(input?.data_source_id ?? '')) return res.status(400).json({ error: 'invalid_source' });
      const request = notionRequest ?? createNotionRequest();
      validateCustomerSchema(await request(`/data_sources/${input.data_source_id}`), input);
      res.json(await store.configureBinding(pool, input));
    } catch (err) { next(err); }
  });
  router.post('/bindings/:id/run', async (req, res, next) => {
    try { res.json(await runCrmSync(pool, req.params.id, notionRequest ? { request: notionRequest } : {})); }
    catch (err) { next(err); }
  });
  router.post('/contacts/resolve', async (req, res, next) => {
    try {
      const result = await resolveContact(pool, req.body);
      if (!result) return res.status(404).json({ error: 'not_found' });
      res.json(result);
    } catch (err) { next(err); }
  });
  router.post('/contacts/onboard', async (req, res, next) => {
    try { const result = await onboardContact(pool, req.body); res.status(result.created ? 201 : 200).json(result); }
    catch (err) { next(err); }
  });
  // Every write names its Tenant. No display-name matching or inferred account ownership.
  for (const [path, action] of [
    ['/accounts', store.registerAccount], ['/contacts', store.linkContact],
    ['/messages', store.ingestMessage], ['/reports', store.saveReport],
  ]) {
    router.post(path, async (req, res, next) => {
      try { const { tenant_id, ...input } = req.body ?? {}; res.json(await action(pool, tenant_id, input)); }
      catch (err) { next(err); }
    });
  }
  router.get('/tenants/:tenant/customers/:id', async (req, res, next) => {
    try {
      const customer = await store.getCustomer(pool, req.params.tenant, req.params.id);
      if (!customer) return res.status(404).json({ error: 'not_found' });
      const [messages, reports] = await Promise.all([
        store.listCustomerMessages(pool, req.params.tenant, customer.id), store.listCustomerReports(pool, req.params.tenant, customer.id),
      ]);
      res.json({ customer, messages, reports });
    } catch (err) { next(err); }
  });
  router.patch('/tenants/:tenant/customers/:id/profile', async (req, res, next) => {
    try { res.json(await store.updateProfile(pool, req.params.tenant, req.params.id, req.body ?? {})); }
    catch (err) { next(err); }
  });
  router.use((err, _req, res, _next) => {
    const code = err.code ?? 'crm_request_failed';
    const known = ['invalid_input', 'invalid_schema', 'invalid_markdown', 'not_found', 'tenant_mismatch', 'stale_revision', 'identity_conflict', 'binding_disabled'];
    res.status(code === 'not_found' ? 404 : known.includes(code) ? 409 : 503)
      .json({ error: known.includes(code) || /^notion_http_\d+$/.test(code) ? code : 'crm_request_failed', ...(err.receipt ? { receipt: err.receipt } : {}) });
  });
  return router;
}
