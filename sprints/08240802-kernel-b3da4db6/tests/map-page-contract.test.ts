import { describe, expect, it } from 'vitest';

import { buildMapViewModel, createScopeRequestController, emptyMapState } from '../../../apps/core/features/planning/pages/map-view-model';

describe('系统总图冻结合同', () => {
  it('map API 实时投影必须转换为三层可见模型', () => {
    const model = buildMapViewModel({
      scope_key: 'cecelia',
      manifest_version: 6,
      freshness: { status: 'fresh' },
      nodes: [
        { key: 'butler', type: 'value_stream', name: '管家' },
        { key: 'G1', type: 'capability', name: '统一查询' },
        { key: 'f1', type: 'feature', name: '系统总图' },
        { key: 'a1', type: 'assertion', name: '页面验收' },
      ],
      edges: [
        { from: 'butler', to: 'G1', type: 'contains' },
        { from: 'G1', to: 'f1', type: 'contains' },
        { from: 'f1', to: 'a1', type: 'proves' },
      ],
    });

    expect(model.valueStreams[0].capabilities[0].features[0]).toMatchObject({
      key: 'f1',
      proofCount: 1,
    });
  });

  it('失败或空投影必须清除上一 scope', () => {
    expect(emptyMapState('zenithjoy-workspace')).toMatchObject({
      scope: 'zenithjoy-workspace',
      valueStreams: [],
      staleDataVisible: false,
    });
  });

  it('搜索必须保留匹配能力的祖先层级并为无结果返回明确空态', () => {
    const model = buildMapViewModel({
      scope_key: 'cecelia',
      manifest_version: 6,
      freshness: { status: 'fresh' },
      nodes: [
        { key: 'butler', type: 'value_stream', name: '管家' },
        { key: 'G1', type: 'capability', name: '统一查询' },
        { key: 'f1', type: 'feature', name: '系统总图' },
      ],
      edges: [
        { from: 'butler', to: 'G1', type: 'contains' },
        { from: 'G1', to: 'f1', type: 'contains' },
      ],
    });

    expect(model.search('系统总图')).toMatchObject({
      empty: false,
      visibleKeys: ['butler', 'G1', 'f1'],
    });
    expect(model.search('绝不匹配的节点')).toMatchObject({ empty: true, visibleKeys: [] });
  });

  it('非 fresh、HTTP 失败和空 nodes 都必须清零旧节点且禁止成功徽标', () => {
    const previous = { scope: 'cecelia', valueStreams: [{ key: 'butler' }] };

    expect(emptyMapState('zenithjoy-workspace', { reason: 'stale', previous })).toMatchObject({
      valueStreams: [], staleDataVisible: false, freshBadgeVisible: false, status: 'stale',
    });
    expect(emptyMapState('zenithjoy-workspace', { reason: 'http_error', previous })).toMatchObject({
      valueStreams: [], staleDataVisible: false, freshBadgeVisible: false, status: 'error',
    });
    expect(emptyMapState('zenithjoy-workspace', { reason: 'empty_nodes', previous })).toMatchObject({
      valueStreams: [], staleDataVisible: false, freshBadgeVisible: false, status: 'empty',
    });
  });

  it('双 scope 响应竞态必须只提交最后一次选择', async () => {
    const commits: string[] = [];
    const controller = createScopeRequestController((scope) => commits.push(scope));
    const first = controller.load('cecelia', () => new Promise((resolve) => setTimeout(() => resolve({ scope_key: 'cecelia' }), 30)));
    const last = controller.load('zenithjoy-workspace', async () => ({ scope_key: 'zenithjoy-workspace' }));

    await Promise.all([first, last]);
    expect(commits).toEqual(['zenithjoy-workspace']);
  });
});
