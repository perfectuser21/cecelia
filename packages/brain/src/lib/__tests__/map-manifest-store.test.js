import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  MapManifestError,
  activateMapManifest,
  submitMapManifest,
} from '../map-manifest-store.js';

const fixtureUrl = new URL('../../../config/map-manifests/cecelia.v1.json', import.meta.url);
const loadManifest = () => JSON.parse(readFileSync(fixtureUrl, 'utf8'));

function fakePool(handler) {
  const client = {
    query: vi.fn(handler),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client) }, client };
}

describe('submitMapManifest', () => {
  it('非法 manifest 在连接数据库前返回全部校验错误', async () => {
    const pool = { connect: vi.fn() };

    await expect(submitMapManifest(pool, { scope_key: 'cecelia' })).rejects.toMatchObject({
      name: 'MapManifestError',
      code: 'MAP_MANIFEST_INVALID',
      status: 422,
      details: expect.any(Array),
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('同 scope/digest 在 advisory lock 内返回原版本，不执行 INSERT', async () => {
    const existing = {
      id: '54b9ec3d-9ad5-4db0-99b3-7bbbeec34bf9', scope_key: 'cecelia', version: 1,
      source_decision_id: '4bc109e9-3b70-4b17-a1b4-bcd01bfae776', digest: 'a'.repeat(64),
      status: 'draft', manifest: loadManifest(), created_at: new Date(), activated_at: null,
    };
    const { pool, client } = fakePool(async (sql, params) => {
      if (/FROM decisions/i.test(sql)) return { rows: [{ id: params[0] }] };
      if (/WHERE scope_key = \$1 AND digest = \$2/i.test(sql)) return { rows: [existing] };
      return { rows: [] };
    });

    const result = await submitMapManifest(pool, loadManifest());

    expect(result).toEqual({ manifest_version: existing, created: false });
    expect(client.query.mock.calls.map(([sql]) => sql.trim())).toEqual(expect.arrayContaining([
      'BEGIN', 'COMMIT',
    ]));
    expect(client.query.mock.calls).toEqual(expect.arrayContaining([
      [expect.stringMatching(/pg_advisory_xact_lock\(hashtext\(\$1::text\)\)/i), ['map-manifest:cecelia']],
    ]));
    expect(client.query.mock.calls.some(([sql]) => /INSERT INTO map_manifest_versions/i.test(sql))).toBe(false);
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe('activateMapManifest', () => {
  it('默认 projector unavailable 时 rollback，不切 active', async () => {
    const draft = {
      id: '54b9ec3d-9ad5-4db0-99b3-7bbbeec34bf9', scope_key: 'cecelia', version: 1,
      source_decision_id: '4bc109e9-3b70-4b17-a1b4-bcd01bfae776', digest: 'a'.repeat(64),
      status: 'draft', manifest: loadManifest(), created_at: new Date(), activated_at: null,
    };
    const { pool, client } = fakePool(async (sql, params) => {
      if (/FROM map_manifest_versions[\s\S]*WHERE id = \$1/i.test(sql)) return { rows: [draft] };
      if (/FROM decisions/i.test(sql)) return { rows: [{ id: params[0] }] };
      return { rows: [] };
    });

    await expect(activateMapManifest(pool, draft.id)).rejects.toMatchObject({
      code: 'MAP_PROJECTOR_UNAVAILABLE', status: 503,
    });
    const statements = client.query.mock.calls.map(([sql]) => sql.trim());
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/SET status = 'active'/i),
    ]));
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('MapManifestError 保留稳定 HTTP 合同', () => {
    const error = new MapManifestError('MAP_MANIFEST_STATE_CONFLICT', 'conflict', 409, { status: 'rejected' });
    expect(error).toMatchObject({
      name: 'MapManifestError', code: 'MAP_MANIFEST_STATE_CONFLICT', status: 409,
      details: { status: 'rejected' },
    });
  });
});
