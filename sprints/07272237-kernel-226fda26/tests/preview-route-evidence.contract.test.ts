import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mockQuery = vi.fn();
const mockAdmitPreview = vi.fn();
const mockSpawn = vi.fn(() => ({ unref: vi.fn() }));

vi.mock('../../../packages/brain/src/db.js', () => ({
  default: { query: mockQuery },
}));

vi.mock('../../../packages/brain/src/capacity-gate.js', () => ({
  admitPreview: mockAdmitPreview,
}));

vi.mock('../../../packages/brain/src/preview-manager.js', () => ({
  markPreviewInactive: vi.fn(),
  getPreview: vi.fn(),
  allocatePort: vi.fn(),
}));

vi.mock('../../../packages/brain/src/preview-destroyer.js', () => ({
  destroyPreview: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

async function makeApp() {
  const { default: router } = await import('../../../packages/brain/src/routes/preview.js');
  const express = (await import('../../../packages/brain/node_modules/express/index.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/', router);
  return app;
}

describe('preview route evidence seam contract [BEHAVIOR]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preview workflow uses real curl to POST /api/brain/preview/start without swallowing failure', () => {
    const workflowPath = fileURLToPath(new URL('../../../.github/workflows/preview-deploy.yml', import.meta.url));
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('/api/brain/preview/start');
    expect(workflow).toContain('curl -sf');
    expect(workflow).not.toContain('|| true');
  });

  it('preview failure persists http status response body and error', async () => {
    mockAdmitPreview.mockResolvedValue({
      admitted: false,
      reason: 'preview admission rejected',
      free_bytes: 64,
      projected_cost_bytes: 128,
      need_release_bytes: 0,
    });

    const request = (await import('../../../packages/brain/node_modules/supertest/index.js')).default;
    const res = await request(await makeApp())
      .post('/start')
      .send({ pr_number: 42, branch_name: 'cp-preview-fail', base_repo: 'perfectuser21/cecelia' });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('preview admission rejected');
    expect(JSON.stringify(res.body).length).toBeGreaterThan(0);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO preview_failure_evidence/i),
      expect.arrayContaining([
        42,
        503,
        expect.stringContaining('preview admission rejected'),
        expect.stringContaining('preview admission rejected'),
      ]),
    );
  });

  it('preview success path stays separate', async () => {
    mockAdmitPreview.mockResolvedValue({
      admitted: true,
      port: 5300,
      db_name: 'cecelia_preview_42',
    });

    const request = (await import('../../../packages/brain/node_modules/supertest/index.js')).default;
    const res = await request(await makeApp())
      .post('/start')
      .send({ pr_number: 42, branch_name: 'cp-preview-ok', base_repo: 'perfectuser21/cecelia' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      port: 5300,
      db_name: 'cecelia_preview_42',
      status: 'starting',
    });
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO preview_failure_evidence/i),
      expect.anything(),
    );
    expect(mockSpawn).toHaveBeenCalled();
  });
});
