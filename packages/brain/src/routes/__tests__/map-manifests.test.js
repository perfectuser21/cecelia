import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { MapManifestError } from '../../lib/map-manifest-store.js';
import { createMapManifestRouter } from '../map-manifests.js';

const fixtureUrl = new URL('../../../config/map-manifests/cecelia.v1.json', import.meta.url);
const loadManifest = () => JSON.parse(readFileSync(fixtureUrl, 'utf8'));

function createApp({ services, pool = { connect: vi.fn(), query: vi.fn() }, projector } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/brain/map/manifests', createMapManifestRouter({ pool, projector, services }));
  return { app, pool };
}

const draft = {
  id: '54b9ec3d-9ad5-4db0-99b3-7bbbeec34bf9',
  scope_key: 'cecelia',
  version: 1,
  source_decision_id: '4bc109e9-3b70-4b17-a1b4-bcd01bfae776',
  manifest: loadManifest(),
  digest: 'a'.repeat(64),
  status: 'draft',
  created_at: '2026-08-11T00:00:00.000Z',
  activated_at: null,
};

describe('POST /api/brain/map/manifests/validate', () => {
  it('纯校验完整 manifest，不连接或查询数据库', async () => {
    const services = {
      validate: vi.fn(() => ({ valid: true, errors: [], manifest: loadManifest() })),
      submit: vi.fn(),
      activate: vi.fn(),
    };
    const { app, pool } = createApp({ services });

    const response = await request(app)
      .post('/api/brain/map/manifests/validate')
      .send(loadManifest())
      .expect(200);

    expect(response.body).toMatchObject({ valid: true, errors: [] });
    expect(services.validate).toHaveBeenCalledWith(loadManifest());
    expect(pool.connect).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('非法输入以 422 一次返回全部 errors', async () => {
    const { app } = createApp();
    const response = await request(app)
      .post('/api/brain/map/manifests/validate')
      .send({ scope_key: 'cecelia', consumer_color: 'green' })
      .expect(422);

    expect(response.body.valid).toBe(false);
    expect(response.body.errors.length).toBeGreaterThan(1);
    expect(response.body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'consumer_color', code: 'unrecognized_keys' }),
    ]));
  });
});

describe('POST /api/brain/map/manifests', () => {
  it('首次完整 draft 返回 201；重复 digest 返回同一 id/version 与 200', async () => {
    const submit = vi.fn()
      .mockResolvedValueOnce({ manifest_version: draft, created: true })
      .mockResolvedValueOnce({ manifest_version: draft, created: false });
    const services = {
      validate: vi.fn(), submit, activate: vi.fn(),
    };
    const { app } = createApp({ services });

    const first = await request(app)
      .post('/api/brain/map/manifests')
      .send(loadManifest())
      .expect(201);
    const duplicate = await request(app)
      .post('/api/brain/map/manifests')
      .send(loadManifest())
      .expect(200);

    expect(first.body).toEqual({ manifest_version: draft, created: true });
    expect(duplicate.body).toEqual({ manifest_version: draft, created: false });
    expect(submit).toHaveBeenNthCalledWith(1, expect.anything(), loadManifest());
  });

  it('不存在局部 PATCH 或逐实体创建端点', async () => {
    const { app } = createApp();
    await request(app).patch(`/api/brain/map/manifests/${draft.id}`).send({ status: 'active' }).expect(404);
    await request(app).post('/api/brain/map/manifests/capabilities').send({ key: 'F0' }).expect(404);
    await request(app).post('/api/brain/map/manifests/boundaries').send({ key: 'F0_TO_G1' }).expect(404);
    await request(app).post('/api/brain/map/manifests/crosscuts').send({ key: 'heartbeat_bus' }).expect(404);
  });
});

describe('POST /api/brain/map/manifests/:id/activate', () => {
  it('projector unavailable 映射为 503 与稳定 reason code', async () => {
    const services = {
      validate: vi.fn(),
      submit: vi.fn(),
      activate: vi.fn(async () => {
        throw new MapManifestError(
          'MAP_PROJECTOR_UNAVAILABLE', 'Map projector is not installed; manifest remains draft', 503,
        );
      }),
    };
    const { app } = createApp({ services });

    const response = await request(app)
      .post(`/api/brain/map/manifests/${draft.id}/activate`)
      .expect(503);

    expect(response.body).toEqual({
      error: {
        code: 'MAP_PROJECTOR_UNAVAILABLE',
        message: 'Map projector is not installed; manifest remains draft',
      },
    });
  });

  it('把注入 projector 传给 store，成功返回 active version', async () => {
    const projector = vi.fn();
    const active = { ...draft, status: 'active', activated_at: '2026-08-11T00:01:00.000Z' };
    const activate = vi.fn(async () => ({ manifest_version: active, activated: true }));
    const services = { validate: vi.fn(), submit: vi.fn(), activate };
    const { app, pool } = createApp({ services, projector });

    const response = await request(app)
      .post(`/api/brain/map/manifests/${draft.id}/activate`)
      .expect(200);

    expect(response.body).toEqual({ manifest_version: active, activated: true });
    expect(activate).toHaveBeenCalledWith(pool, draft.id, { projector });
  });
});
