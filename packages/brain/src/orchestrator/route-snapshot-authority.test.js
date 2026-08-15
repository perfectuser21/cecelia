import { describe, expect, it } from 'vitest';

import {
  MAP_SCOPE_VALIDATION_VERSION,
  assertRouteSnapshotLaunchAuthority,
} from './route-snapshot-authority.js';

describe('route snapshot launch authority', () => {
  it('拒绝没有 v2 run 的活跃 legacy receipt', () => {
    expect(() => assertRouteSnapshotLaunchAuthority({
      taskStatus: 'queued',
      validationVersion: null,
      hasV2Run: false,
    })).toThrow('legacy_route_snapshot_unvalidated');
  });

  it('接受 server 验证过的 active business node receipt', () => {
    expect(assertRouteSnapshotLaunchAuthority({
      taskStatus: 'in_progress',
      validationVersion: MAP_SCOPE_VALIDATION_VERSION,
      hasV2Run: false,
    })).toBe(true);
  });

  it('已有 v2 run 的 legacy receipt 保持 grandfather 语义', () => {
    expect(assertRouteSnapshotLaunchAuthority({
      taskStatus: 'queued',
      validationVersion: null,
      hasV2Run: true,
    })).toBe(true);
  });
});
