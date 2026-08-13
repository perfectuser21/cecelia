/**
 * D2: projector.js runProjection() 追加 backbone 层测试
 * Task: cb41e551-f483-4189-af9f-9d3275d59d35
 * Sprint: sprints/08131750-relay-cb41e551
 *
 * 根因：runProjection() 未查 journey_steps 表，backbone 类型节点数恒为 0。
 * 本测试 mock DB client，验证 backbone 节点和 contains 边正确生成。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ──────────────────────────────────────────────
// Mock pool（db.js）
// ──────────────────────────────────────────────
const mockPool = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../../db.js', () => ({ default: mockPool }));

import { runProjection } from '../projector.js';

// ──────────────────────────────────────────────
// 四步骨干 Fixture（F1 的 journey_steps）
// 与合同约束一致：接单进车间即分档/合同即法律/造完真验/交付有回执
// ──────────────────────────────────────────────
const BACKBONE_ROWS = [
  {
    id: 'step-1',
    step_key: 'f1-step-intake',
    name: '接单进车间即分档',
    promise: '接单后进车间，立即按来料类型分档',
    status: 'active',
    display_order: 1,
    capability_code: 'F1',
  },
  {
    id: 'step-2',
    step_key: 'f1-step-contract',
    name: '合同即法律',
    promise: '合同文本生效，双方签字即构成法律约束',
    status: 'active',
    display_order: 2,
    capability_code: 'F1',
  },
  {
    id: 'step-3',
    step_key: 'f1-step-verify',
    name: '造完真验',
    promise: '造完必须真实验收，不得形式过关',
    status: 'active',
    display_order: 3,
    capability_code: 'F1',
  },
  {
    id: 'step-4',
    step_key: 'f1-step-delivery',
    name: '交付有回执',
    promise: '交付必须有回执，回执是结案依据',
    status: 'active',
    display_order: 4,
    capability_code: 'F1',
  },
];

// 最小化 Manifest（只含 F1 capability）
const MINIMAL_MANIFEST = {
  scope_key: 'cecelia',
  schema_version: 1,
  value_streams: [
    { key: 'factory', name: '工厂', perceiver: '待造软件', order: 1 },
  ],
  capabilities: [
    { key: 'F1', name: '开发闭环', value_stream_key: 'factory', order: 2 },
  ],
  boundaries: [],
  crosscut_pool: [],
  shared_prerequisites: { applicable: false, items: [], reason: 'test' },
};

// ──────────────────────────────────────────────
// 测试辅助：构建捕获 INSERT 参数的 mock client
// ──────────────────────────────────────────────
function makeMockClient(backboneRows) {
  const insertedNodes = [];
  const insertedEdges = [];

  const client = {
    query: vi.fn(async (sql, params) => {
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
      if (/INSERT INTO map_projection_runs/i.test(sql)) return { rows: [{ id: 'test-run-id-001' }] };
      if (/INSERT INTO map_projection_nodes/i.test(sql) && params) {
        // params: [runId, nodeId, nodeType, nodeKey, name, sourceRefs, attributes]
        insertedNodes.push({
          node_type: params[2],
          node_key: params[3],
          name: params[4],
          attributes: params[6],
        });
        return { rows: [] };
      }
      if (/INSERT INTO map_projection_edges/i.test(sql) && params) {
        // params: [runId, edgeId, edgeType, edgeKey, fromNodeId, toNodeId, sourceRefs, attributes]
        insertedEdges.push({
          edge_type: params[2],
          edge_key: params[3],
          from_node_id: params[4],
          to_node_id: params[5],
        });
        return { rows: [] };
      }
      if (/UPDATE map_projection_runs/i.test(sql)) return { rows: [] };
      // backbone 查询：SELECT ... FROM journey_steps js JOIN journeys j
      if (/FROM journey_steps/i.test(sql) || /journey_steps/i.test(sql)) {
        return { rows: backboneRows };
      }
      if (/fact_snapshot_headers/i.test(sql)) return { rows: [] };
      // 默认
      return { rows: [] };
    }),
    release: vi.fn(),
    _insertedNodes: insertedNodes,
    _insertedEdges: insertedEdges,
  };
  return client;
}

// ──────────────────────────────────────────────
// Red 测试：backbone 节点数 = 4
// 当前 runProjection 未查 journey_steps，所以 backbone 节点数 = 0，断言 = 4 会 FAIL
// ──────────────────────────────────────────────
describe('[RED→GREEN] runProjection() backbone 层装配', () => {
  it('FAIL: runProjection() 后 backbone 节点数应 = 4（当前未实现返回 0）', async () => {
    const client = makeMockClient(BACKBONE_ROWS);

    await runProjection({
      manifestId: 'manifest-id-001',
      manifestDigest: 'deadbeef',
      scopeKey: 'cecelia',
      manifest: MINIMAL_MANIFEST,
      client,
      factRevisions: {},
    });

    const backboneNodes = client._insertedNodes.filter((n) => n.node_type === 'backbone');
    // Red 阶段：当前实现无 backbone 装配，骨干节点数 = 0，断言 = 4 会 FAIL
    expect(backboneNodes).toHaveLength(4);
  });

  it('FAIL: backbone 节点 attributes 应含 promise/status/display_order/step_key', async () => {
    const client = makeMockClient(BACKBONE_ROWS);

    await runProjection({
      manifestId: 'manifest-id-002',
      manifestDigest: 'deadbeef2',
      scopeKey: 'cecelia',
      manifest: MINIMAL_MANIFEST,
      client,
      factRevisions: {},
    });

    const backboneNodes = client._insertedNodes.filter((n) => n.node_type === 'backbone');
    // 先会在 length=4 处 FAIL（Red 阶段）
    expect(backboneNodes).toHaveLength(4);
    for (const node of backboneNodes) {
      const attrs = JSON.parse(node.attributes);
      expect(attrs).toHaveProperty('promise');
      expect(attrs).toHaveProperty('status');
      expect(attrs).toHaveProperty('display_order');
      expect(attrs).toHaveProperty('step_key');
    }
  });

  it('FAIL: capability → backbone contains 边数应 >= 5（1 capability + 4 backbone）', async () => {
    const client = makeMockClient(BACKBONE_ROWS);

    await runProjection({
      manifestId: 'manifest-id-003',
      manifestDigest: 'deadbeef3',
      scopeKey: 'cecelia',
      manifest: MINIMAL_MANIFEST,
      client,
      factRevisions: {},
    });

    // 正常: 1 contains 边（value_stream → capability）
    // backbone 后: +4 contains 边（capability → backbone step）= 5 总计
    const containsEdges = client._insertedEdges.filter((e) => e.edge_type === 'contains');
    expect(containsEdges.length).toBeGreaterThanOrEqual(5);
  });
});

// ──────────────────────────────────────────────
// Green 验证：backbone 节点名称正确（在 Green 阶段这些应全绿）
// ──────────────────────────────────────────────
describe('[GREEN] backbone 节点名称与 journey_steps.name 一致', () => {
  it('backbone 节点包含四步骨干名称', async () => {
    const client = makeMockClient(BACKBONE_ROWS);

    await runProjection({
      manifestId: 'manifest-id-004',
      manifestDigest: 'cafebabe',
      scopeKey: 'cecelia',
      manifest: MINIMAL_MANIFEST,
      client,
      factRevisions: {},
    });

    const backboneNodes = client._insertedNodes.filter((n) => n.node_type === 'backbone');
    // Red 阶段会先在 length=4 处 FAIL
    expect(backboneNodes).toHaveLength(4);
    const names = backboneNodes.map((n) => n.name);
    expect(names).toContain('接单进车间即分档');
    expect(names).toContain('合同即法律');
    expect(names).toContain('造完真验');
    expect(names).toContain('交付有回执');
  });
});
