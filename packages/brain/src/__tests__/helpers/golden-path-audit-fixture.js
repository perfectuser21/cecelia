import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGoldenPathAudit } from '../../lib/golden-path-audit.js';
import { setGoldenPathAudit } from '../../lib/golden-path-audit-runtime.js';

// 旧读路由回归复用真实审计模块，只隔离DB传输；不消耗被测业务SQL夹具。
export function installGoldenPathAuditFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gp-route-private-'));
  let id = 0;
  setGoldenPathAudit(createGoldenPathAudit({ root,
    source: { git_sha: 'a'.repeat(40), manifest: {} },
    flag: () => process.env.GOLDEN_PATH_LEGACY_READ === '1',
    store: { persist: async () => ({ id: ++id,
      created_at: '2026-10-02T00:00:00Z', db_time: '2026-10-02T00:00:00Z' }) },
  }));
  return () => { setGoldenPathAudit(null); rmSync(root, { recursive: true, force: true }); };
}
