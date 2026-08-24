import { describe, expect, it } from 'vitest';

import { buildMapViewModel, emptyMapState } from '../../../apps/core/features/planning/pages/map-view-model';

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
});
