import { describe, expect, it } from 'vitest';

import {
  buildMapEnvelope,
  findUnclaimedFacts,
  summarizeMapFreshness,
} from '../map-read-service.js';

const now = new Date('2026-08-11T09:30:00.000Z');
const revision = 'a'.repeat(40);

function header(kind, overrides = {}) {
  return {
    kind,
    repo: 'cecelia',
    source_revision: revision,
    scanner_version: `${kind === 'graph' ? 'graph' : `${kind}-registry`}-v2`,
    scanned_at: new Date(now.getTime() - 60_000),
    row_count: 1,
    ...overrides,
  };
}

describe('Unified Map response metadata', () => {
  it('四类 repo snapshot 都新鲜时返回可追溯 fresh 汇总', () => {
    const freshness = summarizeMapFreshness([
      header('api'),
      header('db_schema', { scanner_version: 'db-schema-v2' }),
      header('graph', { scanner_version: 'graph-v3' }),
      header('test'),
    ], now, ['cecelia']);

    expect(freshness).toMatchObject({
      status: 'fresh',
      reason_code: 'snapshots_fresh',
      repos: {
        cecelia: {
          status: 'fresh',
          source_revision: revision,
        },
      },
    });
    expect(freshness.repos.cecelia.snapshots).toHaveLength(4);
  });

  it('任何必需 snapshot 陈旧或缺失时 fail-closed 为 unknown', () => {
    const freshness = summarizeMapFreshness([
      header('api'),
      header('db_schema', { scanner_version: 'db-schema-v2' }),
      header('graph', {
        scanner_version: 'graph-v3',
        scanned_at: new Date(now.getTime() - 16 * 60_000),
      }),
    ], now, ['cecelia']);

    expect(freshness.status).toBe('unknown');
    expect(freshness.reason_code).toBe('snapshot_incomplete_or_stale');
    expect(freshness.repos.cecelia.status).toBe('unknown');
    expect(freshness.repos.cecelia.snapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'graph', status: 'unknown', reason_code: 'snapshot_stale' }),
      expect.objectContaining({ kind: 'test', status: 'unknown', reason_code: 'snapshot_missing' }),
    ]));
  });

  it('所有读响应共享 manifest/projection/fact revision envelope', () => {
    const result = buildMapEnvelope({
      scopeKey: 'cecelia',
      manifestVersion: { version: 3, digest: 'b'.repeat(64) },
      projectionRun: {
        projection_digest: 'c'.repeat(64),
        fact_revisions: { cecelia: revision },
      },
      freshness: { status: 'fresh' },
      now,
    });

    expect(result).toEqual({
      scope_key: 'cecelia',
      manifest_version: 3,
      manifest_digest: 'b'.repeat(64),
      projection_digest: 'c'.repeat(64),
      fact_revisions: { cecelia: revision },
      generated_at: now.toISOString(),
      freshness: { status: 'fresh' },
    });
  });
});

describe('unclaimed facts', () => {
  it('按 repo/kind/stable_ref/method 精确扣除 artifact，禁止 node key 模糊匹配', () => {
    const facts = [
      { repo: 'cecelia', fact_kind: 'test', stable_ref: 'tests/F0.test.js' },
      { repo: 'cecelia', fact_kind: 'test', stable_ref: 'tests/F0-extra.test.js' },
      { repo: 'cecelia', fact_kind: 'api', stable_ref: '/api/f0', method: 'GET' },
      { repo: 'cecelia', fact_kind: 'api', stable_ref: '/api/f0', method: 'POST' },
    ];
    const nodes = [
      {
        node_type: 'artifact',
        node_key: 'not-the-file-path',
        attributes: {
          repo: 'cecelia', fact_kind: 'test', stable_ref: 'tests/F0.test.js',
        },
      },
      {
        node_type: 'artifact',
        node_key: 'not-the-api-path',
        attributes: {
          repo: 'cecelia', fact_kind: 'api', stable_ref: '/api/f0', method: 'GET',
        },
      },
    ];

    expect(findUnclaimedFacts(facts, nodes)).toEqual([
      { repo: 'cecelia', fact_kind: 'api', stable_ref: '/api/f0', method: 'POST' },
      { repo: 'cecelia', fact_kind: 'test', stable_ref: 'tests/F0-extra.test.js' },
    ]);
  });
});
