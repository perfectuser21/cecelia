import { describe, expect, it } from 'vitest';
import {
  classifyKernelRunIdentity,
  loadKernelRunIdentityReport,
} from '../../scripts/kernel-run-identity-preflight.mjs';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

describe('Kernel run identity deploy preflight', () => {
  it('blocks deploy for duplicate active task-linked runs', () => {
    expect(classifyKernelRunIdentity(
      [{
        current_task_id: TASK_ID,
        active_count: 2,
        run_ids: [RUN_ID, '33333333-3333-4333-8333-333333333333'],
      }],
      [],
    )).toMatchObject({
      ok: false,
      duplicateActiveTasks: [TASK_ID],
    });
  });

  it('reports historical NULL identities without guessing them', () => {
    expect(classifyKernelRunIdentity(
      [],
      [{ id: RUN_ID, current_task_id: null, created_source: null }],
    )).toMatchObject({
      ok: true,
      historicalUntrustedRunIds: [RUN_ID],
    });
  });

  it('uses only read-only identity queries and supports the pre-migration schema', async () => {
    const sql = [];
    const db = {
      query: async (statement) => {
        sql.push(String(statement));
        if (String(statement).includes('information_schema.columns')) {
          return { rows: [{ exists: false }] };
        }
        return { rows: [] };
      },
    };

    const report = await loadKernelRunIdentityReport(db);

    expect(report.ok).toBe(true);
    expect(report.schema.createdSourceColumn).toBe(false);
    expect(sql).toHaveLength(3);
    expect(sql.join('\n')).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/i);
    expect(sql[2]).toContain('NULL::text AS created_source');
  });
});
