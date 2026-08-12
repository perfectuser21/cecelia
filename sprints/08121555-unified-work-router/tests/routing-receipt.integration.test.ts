import { describe, it, expect } from 'vitest';
import pg from 'pg';

describe('Routing Receipt [BEHAVIOR]', () => {
  it('task 与 Routing Receipt 原子创建且 append-only', async () => {
    const store = await import('../../../packages/brain/src/work-routing-store.js');
    const db = process.env.DB_URL;
    expect(db, 'DB_URL is required for real PostgreSQL contract').toBeTruthy();
    const client = new pg.Client({ connectionString: db });
    await client.connect();
    await client.query("select pg_advisory_lock(hashtext('unified-work-router-contract'))");
    const first = await store.createRoutedTask({ dbUrl: db, source: 'api', source_id: `red-${Date.now()}`, title: '修改代码', mutation_intent: 'write', repo_hint: 'perfectuser21/cecelia', declared_change_kind: 'bugfix' });
    const second = await store.supersedeRoutingReceipt({ dbUrl: db, taskId: first.task_id, supersedesReceiptId: first.routing_receipt_id, reason: 'repo facts repaired' });
    expect(second.task_id).toBe(first.task_id);
    expect(second.routing_receipt_id).not.toBe(first.routing_receipt_id);
    const chain = await store.readRoutingReceiptChain({ dbUrl: db, taskId: first.task_id });
    expect(chain).toHaveLength(2);
    expect(chain.filter((r: { superseded_by_id?: string | null }) => !r.superseded_by_id)).toHaveLength(1);
    await expect(store.updateRoutingReceipt({ dbUrl: db, id: first.routing_receipt_id, route_reason: 'mutate history' })).rejects.toThrow(/append.only/i);
    const rows = await client.query('select id, task_id, supersedes_receipt_id from work_routing_receipts where task_id=$1 order by created_at', [first.task_id]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[1].supersedes_receipt_id).toBe(rows.rows[0].id);
    await client.query("select pg_advisory_unlock(hashtext('unified-work-router-contract'))");
    await client.end();
  });

  it('入口委托统一边界', async () => {
    const inventory = await import('../../../packages/brain/src/task-creation-inventory.js');
    expect(inventory.TASK_CREATION_INVENTORY.every((entry: { migration_status: string }) => entry.migration_status === 'routed')).toBe(true);
  });
});
