import { describe, it, expect, vi, afterEach } from 'vitest';
import { runCrmSync } from './notion-sync.js';
afterEach(() => vi.unstubAllEnvs());
const binding = { id: 'binding', tenant_id: 'tenant', data_source_id: 'source', enabled: true, fields: { name: '客户名称', customer_id: null, profile: null, manual: {} } };
const schema = { id: 'source', properties: { 客户名称: { type: 'title' } } };
const page = { id: 'page', parent: { data_source_id: 'source' }, last_edited_time: '2026-10-16T00:00:00Z', properties: { 客户名称: { type: 'title', title: [{ plain_text: '客户' }] } } };
function fixture() {
  const query = vi.fn(async sql => ({ rows: sql.includes('try_advisory') ? [{ locked: true }] : [] }));
  const client = { query, release: vi.fn() }, pool = { connect: vi.fn(async () => client) };
  const store = { listBindings: vi.fn(async () => [binding]), ingestCustomer: vi.fn(async () => ({ created: true, changed: true })), updateBindingCursor: vi.fn(), listPending: vi.fn(async () => []) };
  return { pool, client, store };
}
describe('CRM registered-source sync', () => {
  it('is fail-closed before obtaining a connection', async () => {
    vi.stubEnv('CRM_SYNC_ENABLED', 'false'); const x = fixture();
    expect((await runCrmSync(x.pool, 'binding', { store: x.store })).reason).toBe('disabled');
    expect(x.pool.connect).not.toHaveBeenCalled();
  });
  it('retains imported rows but does not advance cursor on a later page failure', async () => {
    vi.stubEnv('CRM_SYNC_ENABLED', 'true'); const x = fixture();
    const request = vi.fn().mockResolvedValueOnce(schema).mockResolvedValueOnce({ results: [page], has_more: true, next_cursor: 'next' }).mockRejectedValueOnce(Error('remote failure'));
    await expect(runCrmSync(x.pool, 'binding', { store: x.store, request })).rejects.toThrow();
    expect(x.store.ingestCustomer).toHaveBeenCalledTimes(1); expect(x.store.updateBindingCursor).not.toHaveBeenCalled();
    expect(x.client.release).toHaveBeenCalled(); expect(x.client.query.mock.calls.some(([sql]) => sql.includes('advisory_unlock'))).toBe(true);
  });
  it('rejects foreign source pages before ingesting', async () => {
    vi.stubEnv('CRM_SYNC_ENABLED', 'true'); const x = fixture();
    const request = vi.fn().mockResolvedValueOnce(schema).mockResolvedValueOnce({ results: [{ ...page, parent: { data_source_id: 'other' } }], has_more: false });
    await expect(runCrmSync(x.pool, 'binding', { store: x.store, request })).rejects.toThrow();
    expect(x.store.ingestCustomer).not.toHaveBeenCalled(); expect(x.store.updateBindingCursor).not.toHaveBeenCalled();
  });
  it('does not accept missing or repeated continuation tokens as success', async () => {
    vi.stubEnv('CRM_SYNC_ENABLED', 'true'); const x = fixture();
    const request = vi.fn().mockResolvedValueOnce(schema).mockResolvedValue({ results: [], has_more: true, next_cursor: null });
    await expect(runCrmSync(x.pool, 'binding', { store: x.store, request })).rejects.toThrow();
    expect(x.store.updateBindingCursor).not.toHaveBeenCalled();
  });
  it('never writes previously imported pages excluded by a reduced allowlist', async () => {
    vi.stubEnv('CRM_SYNC_ENABLED', 'true'); const x = fixture();
    x.store.listBindings.mockResolvedValue([{ ...binding, fields: { ...binding.fields, allowed_page_ids: [] } }]);
    x.store.listPending.mockResolvedValue([{ customer: { source_page_id: 'excluded-page' }, binding }]);
    const request = vi.fn().mockResolvedValueOnce(schema).mockResolvedValueOnce({ results: [], has_more: false });
    await runCrmSync(x.pool, 'binding', { store: x.store, request });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
