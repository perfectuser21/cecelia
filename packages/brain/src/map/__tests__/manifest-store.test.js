/**
 * 刀1: manifest-store.js 纯函数测试（无需 DB）
 * 覆盖：computeManifestDigest 确定性和格式
 */
import { describe, it, expect, vi } from 'vitest';

const mockPool = vi.hoisted(() => ({
  connect: vi.fn(),
}));
vi.mock('../../db.js', () => ({ default: mockPool }));

import { activateManifest, computeManifestDigest } from '../manifest-store.js';

const SAMPLE = {
  scope_key: 'test',
  schema_version: 1,
  value_streams: [{ key: 'vs1', name: 'VS1', perceiver: 'user', order: 1 }],
  capabilities: [{ key: 'C1', name: 'Cap1', value_stream_key: 'vs1', order: 1 }],
  boundaries: [],
  crosscut_pool: [],
  shared_prerequisites: { applicable: false, items: [], reason: 'test' },
};

describe('computeManifestDigest', () => {
  it('相同输入 → 相同 digest（确定性）', () => {
    expect(computeManifestDigest(SAMPLE)).toBe(computeManifestDigest(SAMPLE));
  });

  it('输出为 64 位十六进制（SHA-256）', () => {
    expect(computeManifestDigest(SAMPLE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('key 排序：字段顺序不同时 digest 相同', () => {
    const m1 = { scope_key: 'test', schema_version: 1, value_streams: [], capabilities: [], boundaries: [], crosscut_pool: [], shared_prerequisites: { applicable: false, items: [], reason: 'r' } };
    const m2 = { schema_version: 1, scope_key: 'test', value_streams: [], capabilities: [], boundaries: [], crosscut_pool: [], shared_prerequisites: { applicable: false, items: [], reason: 'r' } };
    expect(computeManifestDigest(m1)).toBe(computeManifestDigest(m2));
  });

  it('不同内容 → 不同 digest', () => {
    const other = { ...SAMPLE, scope_key: 'other' };
    expect(computeManifestDigest(SAMPLE)).not.toBe(computeManifestDigest(other));
  });

  it('嵌套 Capability 内容变化必须改变 digest', () => {
    const changed = structuredClone(SAMPLE);
    changed.capabilities[0].name = 'Changed nested capability';

    expect(computeManifestDigest(SAMPLE)).not.toBe(computeManifestDigest(changed));
  });
});

describe('activateManifest 原子投影', () => {
  it('projector 失败时回滚，manifest 不得提前切 active', async () => {
    const queries = [];
    const client = {
      query: vi.fn(async (sql) => {
        queries.push(sql.trim());
        if (/SELECT id, scope_key/i.test(sql)) {
          return { rows: [{
            id: 'manifest-1', scope_key: 'cecelia', version: 2,
            digest: 'a'.repeat(64), status: 'draft', manifest: SAMPLE,
          }] };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(client);
    const projector = vi.fn(async () => { throw new Error('projection failed'); });

    await expect(activateManifest(
      { manifestId: 'manifest-1', scopeKey: 'cecelia' },
      { projector },
    )).rejects.toThrow('projection failed');

    expect(queries).toContain('ROLLBACK');
    expect(queries.some((sql) => /SET status = 'active'/.test(sql))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
