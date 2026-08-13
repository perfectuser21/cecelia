import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import pg from 'pg';
import { createRoutedTask } from '../../work-routing-store.js';

const { Pool } = pg;
const REPOSITORY_FACTS = [{
  scope_key: 'cecelia',
  repo: 'cecelia',
  aliases: ['perfectuser21/cecelia'],
}];

describe('routing store transaction contract', () => {
  it('creates task and immutable receipt in one client transaction', async () => {
    const calls = [];
    const client = { query: async (sql, args) => {
      calls.push([sql, args]);
      if (String(sql).includes('INSERT INTO tasks')) return { rows: [{ id: 'task-1' }] };
      if (String(sql).includes('INSERT INTO work_routing_receipts')) return { rows: [{ id: 'receipt-1' }] };
      return { rows: [] };
    }};
    const result = await createRoutedTask(client, { source: 'api', source_id: '1', title: 'fix', mutation_intent: 'write', declared_change_kind: 'bugfix', repo_hint: 'perfectuser21/cecelia' }, REPOSITORY_FACTS);
    expect(result).toMatchObject({ task_id: 'task-1', routing_receipt_id: 'receipt-1' });
    expect(calls.map(([sql]) => sql)).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']));
    expect(calls.some(([sql, args]) => (
      String(sql).includes('INSERT INTO cecelia_events') && args[0] === 'work_routed'
    ))).toBe(true);
  });

  it('uses one checked-out connection and preserves canonical task fields', async () => {
    const calls = [];
    const client = {
      query: vi.fn(async (sql, args) => {
        calls.push([String(sql), args]);
        if (String(sql).includes('INSERT INTO tasks')) {
          return { rows: [{ id: 'task-2', task_type: 'harness_initiative', priority: 'P0' }] };
        }
        if (String(sql).includes('INSERT INTO work_routing_receipts')) {
          return { rows: [{ id: 'receipt-2' }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };

    const result = await createRoutedTask(pool, {
      source: 'api',
      source_id: 'request-2',
      title: 'critical fix',
      mutation_intent: 'write',
      declared_change_kind: 'bugfix',
      repo_hint: 'perfectuser21/cecelia',
      task: {
        priority: 'P0', project_id: 'project-1', status: 'queued',
        tags: ['router'], prd_content: 'frozen prd', execution_profile: 'US_CODEX',
        owner_role: 'developer', delivery_type: 'behavior-change', created_by: 'scheduler',
      },
    }, REPOSITORY_FACTS);

    expect(pool.connect).toHaveBeenCalledOnce();
    expect(client.release).toHaveBeenCalledOnce();
    expect(calls[0][0]).toBe('BEGIN');
    expect(calls.at(-1)[0]).toBe('COMMIT');
    expect(result.task).toMatchObject({ task_type: 'harness_initiative', priority: 'P0' });
    const taskInsert = calls.find(([sql]) => sql.includes('INSERT INTO tasks'));
    expect(taskInsert[0]).toContain('project_id');
    expect(taskInsert[0]).toContain('tags');
    expect(taskInsert[0]).toContain('prd_content');
    expect(taskInsert[0]).toContain('execution_profile');
    expect(taskInsert[0]).toContain('owner_role');
    expect(taskInsert[0]).toContain('delivery_type');
    expect(taskInsert[0]).toContain('created_by');
    expect(taskInsert[1]).toContain('P0');
    expect(taskInsert[1]).toContain('project-1');
    expect(taskInsert[1]).toContainEqual(['router']);
    expect(taskInsert[1]).toContain('frozen prd');
    expect(taskInsert[1]).toContain('US_CODEX');
    expect(taskInsert[1]).toContain('developer');
    expect(taskInsert[1]).toContain('behavior-change');
    expect(taskInsert[1]).toContain('scheduler');
  });

  it('joins an existing transaction without nested BEGIN/COMMIT', async () => {
    const calls = [];
    const client = { query: vi.fn(async (sql) => {
      calls.push(String(sql));
      if (String(sql).includes('INSERT INTO tasks')) return { rows: [{ id: 'task-3' }] };
      if (String(sql).includes('INSERT INTO work_routing_receipts')) return { rows: [{ id: 'receipt-3' }] };
      return { rows: [] };
    }) };

    await createRoutedTask(client, {
      source: 'inbox', source_id: 'atom-3', title: 'fix', mutation_intent: 'unknown',
      declared_change_kind: 'bugfix', repo_hint: 'perfectuser21/cecelia',
    }, REPOSITORY_FACTS, { transaction: 'existing' });

    expect(calls).not.toContain('BEGIN');
    expect(calls).not.toContain('COMMIT');
    expect(calls).not.toContain('ROLLBACK');
  });

  it('persists task and immutable receipt atomically in a real test database', async () => {
    const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://localhost/cecelia_test';
    const databaseName = new URL(databaseUrl).pathname.slice(1);
    expect(databaseName).toMatch(/(?:_test|_scratch)$/);
    const testPool = new Pool({ connectionString: databaseUrl });
    const client = await testPool.connect();
    try {
      await client.query('BEGIN');
      const sourceId = `routing-pg-${crypto.randomUUID()}`;
      const created = await createRoutedTask(client, {
        source: 'api',
        source_id: sourceId,
        title: 'routing atomicity fixture',
        mutation_intent: 'write',
        declared_change_kind: 'bugfix',
        repo_hint: 'perfectuser21/cecelia',
        branch: 'cp-routing-pg',
        base_sha: 'a'.repeat(40),
      }, REPOSITORY_FACTS, { transaction: 'existing' });

      const persisted = await client.query(
        `SELECT task.task_type, task.payload->>'routing_receipt_id' AS projected_receipt_id,
                task.payload->>'orchestrator' AS runtime_orchestrator,
                task.payload->>'harness_runtime' AS harness_runtime,
                receipt.pipeline, receipt.change_kind, receipt.repo,
                receipt.orchestrator AS receipt_orchestrator
           FROM tasks task
           JOIN work_routing_receipts receipt ON receipt.task_id = task.id
          WHERE task.id = $1`,
        [created.task_id],
      );
      expect(persisted.rows[0]).toMatchObject({
        task_type: 'harness_initiative',
        projected_receipt_id: created.routing_receipt_id,
        runtime_orchestrator: 'skill-relay',
        harness_runtime: 'kernel-v1',
        pipeline: 'harness',
        change_kind: 'bugfix',
        repo: 'cecelia',
        receipt_orchestrator: 'kernel-harness-v2',
      });

      await client.query('SAVEPOINT immutable_probe');
      await expect(client.query(
        'UPDATE work_routing_receipts SET route_reason=$2 WHERE id=$1',
        [created.routing_receipt_id, 'tampered'],
      )).rejects.toThrow(/append_only/);
      await client.query('ROLLBACK TO SAVEPOINT immutable_probe');

      await client.query('SAVEPOINT task_projection_probe');
      await expect(client.query(
        `UPDATE tasks
            SET payload = jsonb_set(payload, '{repo}', '"other"'::jsonb)
          WHERE id=$1`,
        [created.task_id],
      )).rejects.toThrow(/work_routing_task_projection_immutable/);
      await client.query('ROLLBACK TO SAVEPOINT task_projection_probe');

      await expect(client.query(
        `UPDATE tasks
            SET payload = payload || '{"unrelated_runtime_note":"ok"}'::jsonb
          WHERE id=$1`,
        [created.task_id],
      )).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await testPool.end();
    }
  });

  it('同一幂等身份只有完全相同请求可重放，路由变化 fail closed', async () => {
    const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://localhost/cecelia_test';
    const testPool = new Pool({ connectionString: databaseUrl });
    const client = await testPool.connect();
    try {
      await client.query('BEGIN');
      const sourceId = `routing-conflict-${crypto.randomUUID()}`;
      const first = await createRoutedTask(client, {
        source: 'api', source_id: sourceId, title: 'routing identity',
        mutation_intent: 'write', declared_change_kind: 'bugfix',
        repo_hint: 'perfectuser21/cecelia', map_scope_hint: ['cecelia'],
      }, REPOSITORY_FACTS, { transaction: 'existing' });
      const replay = await createRoutedTask(client, {
        source: 'api', source_id: sourceId, title: 'routing identity',
        mutation_intent: 'write', declared_change_kind: 'bugfix',
        repo_hint: 'perfectuser21/cecelia', map_scope_hint: ['cecelia'],
      }, REPOSITORY_FACTS, { transaction: 'existing' });
      expect(replay).toMatchObject({
        deduplicated: true,
        task_id: first.task_id,
        routing_receipt_id: first.routing_receipt_id,
        decision: { change_kind: 'bugfix' },
      });
      await expect(createRoutedTask(client, {
        source: 'api', source_id: sourceId, title: 'routing identity',
        mutation_intent: 'write', declared_change_kind: 'new_capability',
        repo_hint: 'perfectuser21/cecelia', map_scope_hint: ['cecelia'],
      }, REPOSITORY_FACTS, { transaction: 'existing' })).rejects.toThrow(/work_route_idempotency_conflict/);

      await expect(createRoutedTask(client, {
        source: 'api', source_id: sourceId, title: 'routing identity',
        mutation_intent: 'write', declared_change_kind: 'bugfix',
        repo_hint: 'perfectuser21/cecelia', map_scope_hint: ['cecelia'],
        branch: 'cp-different', base_sha: 'b'.repeat(40),
      }, REPOSITORY_FACTS, { transaction: 'existing' })).rejects.toThrow(/work_route_idempotency_conflict/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await testPool.end();
    }
  });

  it('coding request 缺 branch/base 时在创建前可信解析并冻结 canonical evidence', async () => {
    const client = { query: vi.fn(async (sql) => {
      if (String(sql).includes('INSERT INTO tasks')) return { rows: [{ id: 'task-auto-evidence' }] };
      if (String(sql).includes('INSERT INTO work_routing_receipts')) return { rows: [{ id: 'receipt-auto-evidence' }] };
      return { rows: [] };
    }) };
    const resolveRoutingEvidence = vi.fn(async () => ({
      branch: 'cp-route-inbox-abc12345',
      base_sha: 'c'.repeat(40),
    }));

    const created = await createRoutedTask(client, {
      source: 'inbox', source_id: 'atom-without-git-evidence', title: 'urgent fix',
      mutation_intent: 'write', declared_change_kind: 'bugfix',
      repo_hint: 'perfectuser21/cecelia',
    }, REPOSITORY_FACTS, { resolveRoutingEvidence });

    expect(resolveRoutingEvidence).toHaveBeenCalledWith(expect.objectContaining({
      source: 'inbox', source_id: 'atom-without-git-evidence', repo: 'cecelia',
    }), expect.any(Array));
    expect(created.decision.evidence).toEqual({
      source: 'inbox',
      branch: 'cp-route-inbox-abc12345',
      base_sha: 'c'.repeat(40),
    });
    expect(created.task.payload).toMatchObject({
      branch: 'cp-route-inbox-abc12345',
      base_sha: 'c'.repeat(40),
    });
  });

  it('拒绝 WorkspaceSpec 无法消费的非 cp-* coding branch，且不写 task/receipt', async () => {
    const client = { query: vi.fn(async (sql) => {
      if (String(sql).includes('INSERT INTO tasks')) return { rows: [{ id: 'must-not-exist' }] };
      if (String(sql).includes('INSERT INTO work_routing_receipts')) {
        return { rows: [{ id: 'must-not-exist' }] };
      }
      return { rows: [] };
    }) };

    await expect(createRoutedTask(client, {
      source: 'api', source_id: 'invalid-feature-branch', title: 'invalid branch',
      mutation_intent: 'write', declared_change_kind: 'bugfix',
      repo_hint: 'perfectuser21/cecelia',
      branch: 'feature/foo', base_sha: 'd'.repeat(40),
    }, REPOSITORY_FACTS)).rejects.toThrow(/routing_evidence_invalid/);

    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('INSERT INTO tasks')
      || String(sql).includes('INSERT INTO work_routing_receipts')
    ))).toBe(false);
  });

  it('缺省 branch/base 的幂等重放复用已冻结 evidence，不重读已经前进的 main', async () => {
    const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://localhost/cecelia_test';
    const testPool = new Pool({ connectionString: databaseUrl });
    const client = await testPool.connect();
    const resolvedEvidence = [
      { branch: 'cp-route-replay-stable', base_sha: 'e'.repeat(40) },
      { branch: 'cp-route-replay-stable', base_sha: 'f'.repeat(40) },
    ];
    const resolveRoutingEvidence = vi.fn(async () => resolvedEvidence.shift());
    try {
      await client.query('BEGIN');
      const sourceId = `routing-stable-replay-${crypto.randomUUID()}`;
      const request = {
        source: 'inbox', source_id: sourceId, title: 'stable replay',
        mutation_intent: 'write', declared_change_kind: 'bugfix',
        repo_hint: 'perfectuser21/cecelia',
      };
      const first = await createRoutedTask(client, request, REPOSITORY_FACTS, {
        transaction: 'existing', resolveRoutingEvidence,
      });
      const replay = await createRoutedTask(client, request, REPOSITORY_FACTS, {
        transaction: 'existing', resolveRoutingEvidence,
      });

      expect(resolveRoutingEvidence).toHaveBeenCalledOnce();
      expect(replay).toMatchObject({
        deduplicated: true,
        task_id: first.task_id,
        routing_receipt_id: first.routing_receipt_id,
        decision: {
          evidence: {
            branch: 'cp-route-replay-stable',
            base_sha: 'e'.repeat(40),
          },
        },
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await testPool.end();
    }
  });
});
