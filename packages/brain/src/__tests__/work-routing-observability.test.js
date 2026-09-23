import { describe, expect, it } from 'vitest';
import {
  loadTaskRoutingAudit,
  loadWorkRoutingObservability,
  summarizeWorkRouting,
} from '../work-routing-observability.js';
import { GP_SCOPE_TASK_TYPES } from '../lib/task-type-registry.js';

describe('work routing observability', () => {
  it('reports receipt coverage, direct dev and legacy exemptions', () => {
    expect(summarizeWorkRouting({
      coding: 4, receipts: 3, directDev: 1, legacyExempt: 0,
      mapQueries: 3, codingRuns: 4, missingBusinessReceipts: 2,
      workRouteBlocked: 2, routeViolation: 1, mapPreflightFailed: 3,
    })).toEqual({
      coding_mutation_total: 4,
      coding_receipt_coverage: 0.75,
      missing_business_receipts: 2,
      coding_dev_direct: 1,
      harness_map_query_coverage: 0.75,
      legacy_exempt: 0,
      events: {
        work_route_blocked: 2,
        route_violation: 1,
        map_preflight_failed: 3,
      },
    });
  });

  it('loads bounded routing metrics from PostgreSQL facts', async () => {
    const query = vi.fn(async () => ({ rows: [{
      coding: 5, receipts: 5, direct_dev: 0, legacy_exempt: 0,
      map_queries: 5, coding_runs: 5, missing_business_receipts: 0,
      work_route_blocked: 1, route_violation: 0, map_preflight_failed: 2,
    }] }));
    await expect(loadWorkRoutingObservability({ query }, { days: 3 })).resolves.toMatchObject({
      coding_receipt_coverage: 1,
      harness_map_query_coverage: 1,
      coding_dev_direct: 0,
      legacy_exempt: 0,
    });
    expect(query.mock.calls[0][0]).toContain('work_routing_receipts');
    expect(query.mock.calls[0][0]).toContain('cecelia_events');
    expect(query.mock.calls[0][1]).toEqual(['3', GP_SCOPE_TASK_TYPES]);
  });

  it('loads per-task receipt, Map and Impact Contract audit projection', async () => {
    const rows = [{
      task_id: 'task-1', work_kind: 'coding_mutation', pipeline: 'harness',
      repo: 'cecelia', map_status: 'fresh', impact_contract_status: 'active',
      route_reason: 'coding mutation requires Harness', blocking_gate: null,
    }];
    const query = vi.fn(async () => ({ rows }));
    await expect(loadTaskRoutingAudit({ query }, ['task-1'])).resolves.toEqual({
      'task-1': expect.objectContaining({ repo: 'cecelia', map_status: 'fresh' }),
    });
    expect(query.mock.calls[0][0]).toContain('harness_impact_contracts');
  });

  // 迁移 465 后收据链式接班：同 task_id 可有多代（anchor_generation 递增）。
  // 裸 LEFT JOIN 会让每个任务按代数翻倍，coding/receipts/missing 计数全部虚高。
  it('只 JOIN 最新一代路由收据，不被链式接班的多代收据翻倍', async () => {
    const metricsQuery = vi.fn(async () => ({ rows: [{
      coding: 1, receipts: 1, direct_dev: 0, legacy_exempt: 0,
      map_queries: 1, coding_runs: 1, missing_business_receipts: 0,
      work_route_blocked: 0, route_violation: 0, map_preflight_failed: 0,
    }] }));
    await loadWorkRoutingObservability({ query: metricsQuery }, { days: 7 });
    const receiptLateral = /LEFT JOIN LATERAL \(\s*SELECT [\s\S]*?FROM work_routing_receipts \w+[\s\S]*?anchor_generation DESC[\s\S]*?LIMIT 1\s*\) receipt ON true/;
    const nakedReceiptJoin = /LEFT JOIN work_routing_receipts receipt ON receipt\.task_id=task\.id/;

    const metricsSql = metricsQuery.mock.calls[0][0];
    expect(metricsSql).toMatch(receiptLateral);
    expect(metricsSql).not.toMatch(nakedReceiptJoin);

    const auditQuery = vi.fn(async () => ({ rows: [] }));
    await loadTaskRoutingAudit({ query: auditQuery }, ['task-1']);
    const auditSql = auditQuery.mock.calls[0][0];
    expect(auditSql).toMatch(receiptLateral);
    expect(auditSql).not.toMatch(nakedReceiptJoin);
  });
});
