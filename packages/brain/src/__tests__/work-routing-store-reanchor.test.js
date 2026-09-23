import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { createRoutedTask, stripReanchorEvidence } from '../work-routing-store.js';
import { REANCHOR_EVIDENCE_KEYS } from '../orchestrator/preflight/base-sha-reanchor.js';

const REPOSITORY_FACTS = [{ scope_key: 'cecelia', repo: 'cecelia', aliases: [] }];
const OLD_BASE_SHA = 'a'.repeat(40);
const NEW_BASE_SHA = 'c'.repeat(40);

const REANCHOR_REQUEST = Object.freeze({
  source: 'api',
  source_id: 'reanchor-route',
  title: 're-entry after reanchor',
  mutation_intent: 'write',
  declared_change_kind: 'bugfix',
  repo_hint: 'cecelia',
  map_scope_hint: ['F1'],
  branch: 'cp-reanchor-route',
  base_sha: OLD_BASE_SHA,
});

function persistedReanchoredReceipt(overrides = {}) {
  return {
    id: 'receipt-reanchor',
    task_id: 'task-reanchor',
    source: 'api',
    source_id: 'reanchor-route',
    work_kind: 'coding_mutation',
    change_kind: 'bugfix',
    pipeline: 'harness',
    canonical_task_type: 'harness_initiative',
    default_execution_profile: 'hotfix-v1',
    execution_profile_override: null,
    repo: 'cecelia',
    map_scope: ['F1'],
    impact_contract_required: true,
    orchestrator: 'kernel-harness-v2',
    router_version: 'work-router-v1',
    route_reason: 'mutation_intent:write',
    anchor_generation: 2,
    evidence: {
      source: 'api',
      branch: 'cp-reanchor-route',
      base_sha: NEW_BASE_SHA,
      prev_base_sha: OLD_BASE_SHA,
      resigned_at: '2026-09-23T00:00:00.000Z',
      reanchor_reason: 'map_revision_advanced',
    },
    map_scope_validation_version: null,
    created_at: '2026-09-23T00:00:00.000Z',
    ...overrides,
  };
}

function replayClient({ status, hasV2Run, receipt }) {
  return {
    query: vi.fn(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] };
      if (String(sql).includes('pg_advisory_xact_lock')) return { rows: [] };
      if (String(sql).includes('FROM work_routing_receipts r')) {
        return {
          rows: [{
            routing_receipt_id: receipt.id,
            task_id: receipt.task_id,
            persisted_receipt: receipt,
            id: receipt.task_id,
            status,
            has_v2_run: hasV2Run,
          }],
        };
      }
      if (String(sql).includes('INSERT INTO cecelia_events')) return { rows: [] };
      throw new Error(`unexpected SQL: ${sql}`);
    }),
    release: vi.fn(),
  };
}

describe('work-routing-store × 接班收据', () => {
  it('幂等回读按 anchor_generation DESC, created_at DESC 取最新一代', async () => {
    const source = await readFile(new URL('../work-routing-store.js', import.meta.url), 'utf8');
    expect(source).toMatch(/WHERE r\.source=\$1 AND r\.source_id=\$2 AND r\.router_version=\$3\s+ORDER BY r\.anchor_generation DESC, r\.created_at DESC\s+LIMIT 1/);
  });

  it('REANCHOR_EVIDENCE_KEYS 恰为 base_sha / prev_base_sha / resigned_at / reanchor_reason', () => {
    expect(REANCHOR_EVIDENCE_KEYS).toEqual(['base_sha', 'prev_base_sha', 'resigned_at', 'reanchor_reason']);
  });

  it('sameRoute 比对 evidence 时剔除 base_sha / prev_base_sha / resigned_at / reanchor_reason', () => {
    expect(stripReanchorEvidence({ branch: 'cp-x', base_sha: 'a'.repeat(40), prev_base_sha: 'b'.repeat(40), resigned_at: 't', reanchor_reason: 'map_revision_advanced' }))
      .toEqual({ branch: 'cp-x' });
    expect(stripReanchorEvidence(null)).toEqual({});
  });

  it('重入请求带重锚定前的旧 base_sha，仍命中已接班收据（deduplicated）', async () => {
    const receipt = persistedReanchoredReceipt();
    const client = replayClient({ status: 'failed', hasV2Run: false, receipt });

    const replay = await createRoutedTask(client, REANCHOR_REQUEST, REPOSITORY_FACTS);

    expect(replay).toMatchObject({ deduplicated: true, routing_receipt_id: receipt.id });
  });

  it('分支不同则仍判定为路由冲突，即使 base_sha 系字段被忽略', async () => {
    const receipt = persistedReanchoredReceipt({
      evidence: {
        source: 'api',
        branch: 'cp-reanchor-route-DIFFERENT',
        base_sha: NEW_BASE_SHA,
        prev_base_sha: OLD_BASE_SHA,
        resigned_at: '2026-09-23T00:00:00.000Z',
        reanchor_reason: 'map_revision_advanced',
      },
    });
    const client = replayClient({ status: 'failed', hasV2Run: false, receipt });

    await expect(createRoutedTask(client, REANCHOR_REQUEST, REPOSITORY_FACTS))
      .rejects.toMatchObject({ code: 'work_route_idempotency_conflict' });
  });
});
