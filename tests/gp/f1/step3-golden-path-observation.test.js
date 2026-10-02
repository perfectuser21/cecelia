// F1步骤3：真实上下文两旧helper → 私有durable audit → ACK先于旧读；未知DB拒旧读。
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { fetchLineContext } from '../../../packages/brain/src/harness-line-context.js';
import { createGoldenPathAudit } from '../../../packages/brain/src/lib/golden-path-audit.js';
import { readGoldenPathJournal } from '../../../packages/brain/src/lib/golden-path-journal.js';
import { goldenPathSource, setGoldenPathAudit } from '../../../packages/brain/src/lib/golden-path-audit-runtime.js';
const roots = [], previousFlag = process.env.GOLDEN_PATH_LEGACY_READ;
afterEach(() => {
  setGoldenPathAudit(null);
  if (previousFlag === undefined) delete process.env.GOLDEN_PATH_LEGACY_READ; else process.env.GOLDEN_PATH_LEGACY_READ = previousFlag;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function prepare({ unavailable = false } = {}) {
  process.env.GOLDEN_PATH_LEGACY_READ = '1';
  const root = mkdtempSync(path.join(os.tmpdir(), 'gp-step3-private-')); roots.push(root);
  const order = []; let nextId = 1;
  // 仅隔离外部DB传输；被验helper、runtime、audit、fsync journal均真实执行。
  const audit = createGoldenPathAudit({ root, source: goldenPathSource({ GIT_SHA: 'a'.repeat(40) }),
    flag: () => process.env.GOLDEN_PATH_LEGACY_READ === '1', store: {
      async persist(type, payload) {
        order.push({ kind: 'persist', type, payload });
        if (unavailable) throw new Error('DB unavailable');
        const at = new Date().toISOString();
        return { id: nextId++, created_at: at, gp_db_created_at: at, db_time: at };
      },
    } });
  setGoldenPathAudit(audit);
  const pool = { async query(sql) {
    order.push({ kind: 'read', sql });
    if (sql.includes('golden_path')) {
      const rows = readGoldenPathJournal(audit.file);
      const operation = sql.includes('JOIN golden_path') ? 'step_invariants' : 'cumulative_fr';
      const intent = rows.find(row => row.kind === 'intent' && row.payload.caller.operation === operation);
      expect(intent).toBeTruthy();
      expect(rows.some(row => row.kind === 'ack' && row.audit_id === intent.payload.audit_id)).toBe(true);
    }
    if (sql.includes('JOIN golden_path')) return { rows: [{ id: 'step-rule', title: '真实步骤约束' }] };
    if (sql.includes('JOIN journey_features')) return { rows: [{ ability_id: 'ability', ability_name: '真实能力', ability_status: 'done', owner_task_id: 'task', id: 'step', order_no: 1 }] };
    return { rows: [] };
  } };
  return { audit, pool, order };
}
it('两helper真实查询前持久ACK，caller只能来自内部代码，真实上下文产出保留', async () => {
  const f = prepare();
  const context = await fetchLineContext({ pool: f.pool }, { taskId: 'task', journeyId: 'journey' });
  expect(context.invariants).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'step-rule', source_level: 'step' })]));
  expect(context.cumulativeFR[0]).toMatchObject({ owner_task_id: 'task', ability_id: 'ability' });
  const rows = readGoldenPathJournal(f.audit.file), intents = rows.filter(row => row.kind === 'intent');
  expect(intents.map(row => row.payload.caller)).toEqual([
    { kind: 'internal_code', operation: 'step_invariants', module: 'harness-line-context' },
    { kind: 'internal_code', operation: 'cumulative_fr', module: 'harness-line-context' },
  ]);
  for (const intent of intents) expect(rows.some(row => row.kind === 'ack' && row.audit_id === intent.payload.audit_id)).toBe(true);
  for (const operation of ['step_invariants', 'cumulative_fr']) {
    const written = f.order.findIndex(row => row.kind === 'persist' && row.payload.caller.operation === operation);
    const read = f.order.findIndex(row => row.kind === 'read' && row.sql.includes(operation === 'step_invariants' ? 'JOIN golden_path' : 'JOIN journey_features'));
    expect(written).toBeLessThan(read);
  }
});
it('DB传输未知时两旧读不发生，私有journal永久gap而新查询继续', async () => {
  const f = prepare({ unavailable: true });
  const context = await fetchLineContext({ pool: f.pool }, { taskId: 'task', journeyId: 'journey' });
  expect(context.invariants).toEqual([]); expect(context.cumulativeFR).toEqual([]);
  expect(f.order.filter(row => row.kind === 'read').every(row => !row.sql.includes('golden_path'))).toBe(true);
  expect(f.order.some(row => row.kind === 'read' && row.sql.includes("'global','area'"))).toBe(true);
  expect(readGoldenPathJournal(f.audit.file).some(row => row.kind === 'gap')).toBe(true);
  expect(f.audit.status().healthy).toBe(false);
});
