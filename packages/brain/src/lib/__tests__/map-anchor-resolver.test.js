import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  loadMapAnchorProjection,
  resolveMapAnchors,
} from '../map-anchor-resolver.js';

const featureId = '11111111-1111-4111-8111-111111111111';
const assertionId = '22222222-2222-4222-8222-222222222222';
const revision = 'a'.repeat(40);

function input(overrides = {}) {
  return {
    scopeKey: 'product-scope',
    capabilityKeys: ['CAP_A'],
    repoAdapters: [{
      scope_key: 'product-scope', repo: 'repo-a', adapter_key: 'legacy-ledger-v1',
    }],
    features: [{
      id: featureId,
      capability_key: 'CAP_A',
      name: 'Feature display name',
      unit_test_path: 'tests/exact.test.js',
      workflow_ref: null,
      guard_ref: 'probe:http://localhost:5221/api/brain/exact',
      assertions: [{
        id: assertionId,
        assertion_ref: 'tests/exact.test.js',
        assertion_revision: 2,
        na_reason: null,
      }],
    }],
    facts: {
      headers: [
        { kind: 'test', repo: 'repo-a', source_revision: revision },
        { kind: 'api', repo: 'repo-a', source_revision: revision },
      ],
      tests: [{ repo: 'repo-a', file_path: 'tests/exact.test.js' }],
      apis: [{ repo: 'repo-a', method: 'GET', path: '/api/brain/exact' }],
      dbSchemas: [],
      graphEdges: [],
    },
    ...overrides,
  };
}

describe('resolveMapAnchors', () => {
  it('仅以 capability_code 与 feature UUID 归属，并精确连接 test/API/assertion', () => {
    const result = resolveMapAnchors(input());

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ node_type: 'feature', node_key: featureId }),
      expect.objectContaining({
        node_type: 'artifact',
        node_key: 'repo-a:api:GET /api/brain/exact',
        attributes: expect.objectContaining({ target_exists: true }),
      }),
      expect.objectContaining({
        node_type: 'artifact',
        node_key: 'repo-a:test:tests/exact.test.js',
        attributes: expect.objectContaining({ target_exists: true }),
      }),
      expect.objectContaining({ node_type: 'assertion', node_key: assertionId }),
    ]));
    expect(result.edges.filter(({ edge_type }) => edge_type === 'implements')).toHaveLength(3);
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ edge_type: 'proves', edge_key: `${assertionId}:${featureId}` }),
    ]));
    expect(result.fact_revisions).toEqual({ 'repo-a': revision });
  });

  it('新鲜事实未命中时保留确定锚点目标为 missing，不用展示名模糊匹配', () => {
    const missing = input({
      features: [{
        ...input().features[0],
        name: 'exact.test.js',
        guard_ref: null,
        assertions: [],
      }],
      facts: { ...input().facts, tests: [], apis: [] },
    });
    const result = resolveMapAnchors(missing);
    const artifact = result.nodes.find(({ node_type }) => node_type === 'artifact');

    expect(artifact).toMatchObject({
      node_key: 'repo-a:test:tests/exact.test.js',
      attributes: { target_exists: false },
    });
    expect(result.issues).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reason_code: 'ambiguous_anchor' }),
    ]));
  });

  it('路径锚点命中多个 repo 时不任选候选，输出 ambiguous_anchor 且不造 artifact 边', () => {
    const ambiguous = input({
      repoAdapters: [
        { scope_key: 'product-scope', repo: 'repo-a', adapter_key: 'legacy-ledger-v1' },
        { scope_key: 'product-scope', repo: 'repo-b', adapter_key: 'registry-v1' },
      ],
      features: [{
        ...input().features[0], guard_ref: null, assertions: [],
      }],
      facts: {
        ...input().facts,
        tests: [
          { repo: 'repo-a', file_path: 'tests/exact.test.js' },
          { repo: 'repo-b', file_path: 'tests/exact.test.js' },
        ],
      },
    });
    const result = resolveMapAnchors(ambiguous);

    expect(result.nodes.filter(({ node_type }) => node_type === 'artifact')).toEqual([]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reason_code: 'ambiguous_anchor',
        candidates: ['repo-a:test:tests/exact.test.js', 'repo-b:test:tests/exact.test.js'],
      }),
    ]));
  });

  it('capability key 不在 manifest 时拒绝旧账本行，不以名称或 alias 猜归属', () => {
    const result = resolveMapAnchors(input({ capabilityKeys: ['CAP_B'] }));

    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason_code: 'capability_not_in_manifest' }),
    ]));
  });
});

describe('loadMapAnchorProjection', () => {
  it('legacy ledger adapter 使用 biz_area/capability_code 精确读取，不使用名称 ILIKE', async () => {
    const client = {
      query: vi.fn(async (sql) => {
        if (/FROM map_scope_repositories/i.test(sql)) {
          return { rows: [{
            scope_key: 'product-scope', repo: 'repo-a', adapter_key: 'legacy-ledger-v1',
          }] };
        }
        return { rows: [] };
      }),
    };

    await loadMapAnchorProjection(client, {
      scopeKey: 'product-scope', capabilityKeys: ['CAP_A'],
    });
    const sql = client.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toMatch(/j\.biz_area\s*=\s*\$1/i);
    expect(sql).toMatch(/j\.capability_code\s*=\s*ANY\s*\(\$2/i);
    expect(sql).not.toMatch(/ILIKE|LOWER\s*\(\s*j\.name/i);
  });

  it('核心 resolver 源码不含首验域、第二验收域或能力码常量', () => {
    const source = readFileSync(new URL('../map-anchor-resolver.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/cecelia|zenithjoy|\bF0\b|\bG1\b/i);
  });
});
