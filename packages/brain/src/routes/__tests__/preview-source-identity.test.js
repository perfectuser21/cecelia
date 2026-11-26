import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { execFileSync } from 'node:child_process';

const io = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), spawn: vi.fn(), allocate: vi.fn(), get: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: io.query, connect: io.connect } }));
vi.mock('child_process', async importOriginal => ({ ...await importOriginal(), spawn: io.spawn }));
vi.mock('../../preview-manager.js', () => ({ markPreviewInactive: vi.fn(), getPreview: io.get, allocatePort: io.allocate }));
vi.mock('../../preview-destroyer.js', () => ({ destroyPreview: vi.fn() }));
import router from '../preview.js';

const sha = 'a'.repeat(40);
describe('preview HTTP source and runtime identity', () => {
  let app;
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('DEPLOY_TOKEN', 'fixture-token');
    io.query.mockReset(); io.connect.mockReset(); io.spawn.mockReset(); io.allocate.mockReset(); io.get.mockReset();
    io.spawn.mockReturnValue({ unref() {} });
    app = express(); app.use(express.json()); app.use('/api/brain/preview', router);
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([
    ['start', { pr_number: 42, branch_name: 'feature/fixture', expected_sha: sha }],
    ['start', {}], ['start', []], ['start', {expected_sha: 'bad', pr_number: 'invalid'}],
    ['allocate', { pr_number: 42, branch_name: 'feature/fixture', base_repo: 'cecelia' }],
    ['allocate', {}], ['allocate', []], ['allocate', {pr_number: {nested: true}}],
  ])('已退役HTTP %s对已解析请求返回410且不接触任何资源：%j', async (method, body) => {
    await request(app).post('/api/brain/preview/' + method).auth('fixture-token', {type: 'bearer'})
      .send(body).expect(410, {error: 'PR_PREVIEW_RETIRED'});
    for (const fn of [io.query, io.connect, io.spawn, io.allocate, io.get]) expect(fn).not.toHaveBeenCalled();
  });
  it.each(['start', 'allocate'])('无body的%s也返回410且无副作用', async method => {
    await request(app).post('/api/brain/preview/' + method).auth('fixture-token', {type: 'bearer'})
      .expect(410, {error: 'PR_PREVIEW_RETIRED'});
    for (const fn of [io.query, io.connect, io.spawn, io.allocate, io.get]) expect(fn).not.toHaveBeenCalled();
  });
  it('start先校验既有鉴权，非法token仍401且零副作用', async () => {
    await request(app).post('/api/brain/preview/start').auth('wrong', {type: 'bearer'})
      .send({pr_number: 42, branch_name: 'owned'}).expect(401, {error: 'Unauthorized'});
    for (const fn of [io.query, io.connect, io.spawn, io.allocate]) expect(fn).not.toHaveBeenCalled();
  });
  it('dev无服务token也不能恢复旧start生产者', async () => {
    vi.stubEnv('DEPLOY_TOKEN', '');
    await request(app).post('/api/brain/preview/start').send({pr_number: 42, branch_name: 'owned'})
      .expect(410, {error: 'PR_PREVIEW_RETIRED'});
    for (const fn of [io.query, io.connect, io.spawn, io.allocate]) expect(fn).not.toHaveBeenCalled();
  });
  it('保持既有严格JSON解析边界，不将非法语法或顶层scalar伪称为退役请求', async () => {
    for (const body of ['{broken', '42', 'null', '"scalar"']) {
      await request(app).post('/api/brain/preview/start').auth('fixture-token', {type: 'bearer'})
        .set('Content-Type', 'application/json').send(body).expect(400);
    }
    for (const fn of [io.query, io.connect, io.spawn, io.allocate]) expect(fn).not.toHaveBeenCalled();
  });
  it('does not expose preview identity outside a preview instance', async () => {
    vi.stubEnv('BRAIN_PREVIEW', '');
    await request(app).get('/api/brain/preview/identity').expect(404);
    expect(io.query).not.toHaveBeenCalled();
  });
  it('reads database and tick state, and actual git HEAD rather than GIT_SHA claim', async () => {
    vi.stubEnv('BRAIN_PREVIEW', '1'); vi.stubEnv('BRAIN_PREVIEW_PR', '42');
    vi.stubEnv('GIT_SHA', 'f'.repeat(40)); vi.stubEnv('DB_NAME', 'false-db-claim');
    vi.stubEnv('CECELIA_TICK_HARD_OFF', '0');
    io.query.mockResolvedValueOnce({ rows: [{ db_name: 'cecelia_preview_42' }] })
      .mockResolvedValueOnce({ rows: [{ value_json: { enabled: false } }] });
    const response = await request(app).get('/api/brain/preview/identity').expect(200);
    expect(response.body).toEqual({ pr_number: 42, git_sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), db_name: 'cecelia_preview_42', tick_enabled: false });
    expect(io.query.mock.calls[0][0]).toMatch(/current_database\(\)/);
    expect(io.query.mock.calls[1]).toEqual(['SELECT value_json FROM working_memory WHERE key=$1', ['tick_enabled']]);
  });
  it('missing tick record is enabled, not an isolated success', async () => {
    vi.stubEnv('BRAIN_PREVIEW', '1'); vi.stubEnv('BRAIN_PREVIEW_PR', '42'); vi.stubEnv('CECELIA_TICK_HARD_OFF', '0');
    io.query.mockResolvedValueOnce({ rows: [{ db_name: 'cecelia_preview_42' }] }).mockResolvedValueOnce({ rows: [] });
    const response = await request(app).get('/api/brain/preview/identity').expect(200);
    expect(response.body.tick_enabled).toBe(true);
  });
  it('database identity unavailable fails closed', async () => {
    vi.stubEnv('BRAIN_PREVIEW', '1'); io.query.mockRejectedValue(new Error('fixture unavailable'));
    await request(app).get('/api/brain/preview/identity').expect(503);
  });
});
