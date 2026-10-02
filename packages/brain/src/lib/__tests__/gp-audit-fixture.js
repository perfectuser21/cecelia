import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach } from 'vitest';
import { createGoldenPathAudit } from '../golden-path-audit.js';
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
export function fixture({ persist } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gp-private-audit-')); roots.push(root);
  const events = [];
  const store = { persist: persist ?? (async (type, payload) => {
    const old = events.find(e => e.payload.audit_id === payload.audit_id);
    if (old) return old;
    const row = { id: events.length + 1, event_type: type, payload,
      created_at: '2026-10-02T00:00:00.000Z', gp_db_created_at: '2026-10-02T00:00:00.000Z', db_time: '2026-10-02T00:00:00.000Z' };
    events.push(row); return row;
  }) };
  const audit = createGoldenPathAudit({ root, store, source: { git_sha: 'a'.repeat(40), manifest: { audit: 'b'.repeat(64) } },
    flag: () => false });
  return { root, events, audit, store };
}
export const hit = { method: 'GET', route: '/golden_path', path_kind: 'read', allowed: false };

