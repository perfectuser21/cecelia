import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { execFileSync } from 'node:child_process';

const io = vi.hoisted(() => ({ query: vi.fn(), spawn: vi.fn(), admit: vi.fn() }));
vi.mock('../../db.js', () => ({ default: { query: io.query } }));
vi.mock('child_process', async importOriginal => ({ ...await importOriginal(), spawn: io.spawn }));
vi.mock('../../capacity-gate.js', () => ({ admitPreview: io.admit }));
vi.mock('../../preview-manager.js', () => ({ markPreviewInactive: vi.fn(), getPreview: vi.fn(), allocatePort: vi.fn() }));
vi.mock('../../preview-destroyer.js', () => ({ destroyPreview: vi.fn() }));
import router from '../preview.js';

const sha = 'a'.repeat(40);
describe('preview HTTP source and runtime identity', () => {
  let app;
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('DEPLOY_TOKEN', 'fixture-token');
    io.query.mockReset(); io.spawn.mockReset(); io.admit.mockReset();
    io.spawn.mockReturnValue({ unref() {} });
    io.admit.mockResolvedValue({ admitted: true, port: 5311, db_name: 'cecelia_preview_42' });
    app = express(); app.use(express.json()); app.use('/api/brain/preview', router);
  });
  it('passes exact SHA as a separate launcher argument', async () => {
    await request(app).post('/api/brain/preview/start').auth('fixture-token', { type: 'bearer' })
      .send({ pr_number: 42, branch_name: 'feature/fixture', expected_sha: sha }).expect(200);
    expect(io.spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['42', 'feature/fixture', '5311', 'cecelia_preview_42', sha]));
  });
  it.each(['bad', '-'.repeat(40), 'a'.repeat(39), 'a'.repeat(40) + ';touch /tmp/no', 42])('rejects invalid SHA before admission: %s', async value => {
    await request(app).post('/api/brain/preview/start').auth('fixture-token', { type: 'bearer' })
      .send({ pr_number: 42, branch_name: 'feature/fixture', expected_sha: value }).expect(400);
    expect(io.admit).not.toHaveBeenCalled(); expect(io.spawn).not.toHaveBeenCalled();
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
