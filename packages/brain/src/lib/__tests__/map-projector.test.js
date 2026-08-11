import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { digestMapManifest } from '../map-manifest-schema.js';
import {
  MAP_PROJECTOR_VERSION,
  buildMapProjection,
  stableMapEdgeId,
  stableMapNodeId,
} from '../map-projector.js';

const manifest = JSON.parse(readFileSync(
  new URL('../../../config/map-manifests/cecelia.v1.json', import.meta.url),
  'utf8',
));

function build(input = manifest, factRevisions = {}) {
  return buildMapProjection({
    manifest: input,
    manifestDigest: digestMapManifest(input),
    factRevisions,
  });
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectKeys(item)]),
    );
  }
  return value;
}

describe('Universal Map deterministic structure projector', () => {
  it('一次完整输入精确生成 2 Value Stream、11 Capability、7 Cross-cut', () => {
    const projection = build();
    const count = (type) => projection.nodes.filter((node) => node.node_type === type).length;

    expect(count('value_stream')).toBe(2);
    expect(count('capability')).toBe(11);
    expect(count('crosscut')).toBe(7);
    expect(projection.nodes).toHaveLength(20);
    expect(projection.nodes.every(({ node_id }) => /^[0-9a-f]{64}$/.test(node_id))).toBe(true);
  });

  it('Boundary 只生成 hands_off_to 边，不生成 Boundary 节点', () => {
    const projection = build();
    const boundaries = projection.edges.filter(({ edge_type }) => edge_type === 'hands_off_to');

    expect(projection.nodes.some(({ node_type }) => node_type === 'boundary')).toBe(false);
    expect(boundaries).toHaveLength(2);
    expect(boundaries.map(({ edge_key }) => edge_key).sort()).toEqual(['F0_TO_G1', 'F3_TO_G3']);
    expect(boundaries.every(({ attributes }) => typeof attributes.statement === 'string')).toBe(true);
  });

  it('Cross-cut 生成 serves 与 owned_by，且不计入 Capability', () => {
    const projection = build();
    const serves = projection.edges.filter(({ edge_type }) => edge_type === 'serves');
    const ownedBy = projection.edges.filter(({ edge_type }) => edge_type === 'owned_by');

    expect(serves).toHaveLength(14);
    expect(ownedBy).toHaveLength(4);
    expect(projection.edges.filter(({ edge_type }) => edge_type === 'contains')).toHaveLength(11);
    expect(projection.nodes.filter(({ node_type }) => node_type === 'capability')).toHaveLength(11);
  });

  it('Cross-cut 可直接 serves Capability 节点', () => {
    const input = structuredClone(manifest);
    input.crosscut_pool[0].serves = ['F1'];
    const projection = build(input);
    const capability = projection.nodes.find(({ node_key }) => node_key === 'F1');
    const crosscut = projection.nodes.find(({ node_key }) => node_key === input.crosscut_pool[0].key);

    expect(projection.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        edge_type: 'serves',
        from_node_id: crosscut.node_id,
        to_node_id: capability.node_id,
      }),
    ]));
  });

  it('shared prerequisite 不适用时不造节点和 requires 边', () => {
    const projection = build();

    expect(projection.nodes.filter(({ node_type }) => node_type === 'prerequisite')).toEqual([]);
    expect(projection.edges.filter(({ edge_type }) => edge_type === 'requires')).toEqual([]);
  });

  it('shared prerequisite 适用时按 serves 生成目标到前置的 requires 边', () => {
    const applicable = structuredClone(manifest);
    applicable.shared_prerequisites = {
      applicable: true,
      items: [{ key: 'shared_bootstrap', name: '共享入场', serves: ['factory', 'butler'] }],
    };
    const projection = build(applicable);

    expect(projection.nodes.filter(({ node_type }) => node_type === 'prerequisite')).toHaveLength(1);
    expect(projection.edges.filter(({ edge_type }) => edge_type === 'requires')).toHaveLength(2);
  });

  it('stable ID 只由 scope/type/key 决定，展示名与 run 无关', () => {
    const first = build();
    const renamed = structuredClone(manifest);
    renamed.value_streams[0].name = 'Renamed stream';
    renamed.capabilities[0].name = 'Renamed capability';
    const second = build(renamed);

    expect(first.nodes.map(({ node_id }) => node_id)).toEqual(second.nodes.map(({ node_id }) => node_id));
    expect(first.edges.map(({ edge_id }) => edge_id)).toEqual(second.edges.map(({ edge_id }) => edge_id));
    expect(first.projection_digest).not.toBe(second.projection_digest);
    expect(stableMapNodeId('scope', 'capability', 'key')).toMatch(/^[0-9a-f]{64}$/);
    expect(stableMapEdgeId('scope', 'contains', 'edge-key')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('相同输入和 fact revisions 重建得到完全相同排序与 digest', () => {
    const facts = { repo_b: 'b'.repeat(40), repo_a: 'a'.repeat(40) };
    const first = build(manifest, facts);
    const second = build(reverseObjectKeys(manifest), reverseObjectKeys(facts));

    expect(first.nodes).toEqual(second.nodes);
    expect(first.edges).toEqual(second.edges);
    expect(first.projection_digest).toBe(second.projection_digest);
    expect(first.projection_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.projector_version).toBe(MAP_PROJECTOR_VERSION);
  });

  it('结构变化或 fact revision 变化会改变 projection digest', () => {
    const first = build(manifest, { repo: 'a'.repeat(40) });
    const changedFacts = build(manifest, { repo: 'b'.repeat(40) });
    const changedBoundary = structuredClone(manifest);
    changedBoundary.boundaries[0].statement = 'Changed declaration';

    expect(changedFacts.projection_digest).not.toBe(first.projection_digest);
    expect(build(changedBoundary, { repo: 'a'.repeat(40) }).projection_digest)
      .not.toBe(first.projection_digest);
  });

  it('核心实现不包含首验域或第二验收域身份常量', () => {
    const source = readFileSync(new URL('../map-projector.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/cecelia|zenithjoy|\bF0\b|\bG1\b/i);
  });
});
