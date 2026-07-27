import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('preview route evidence seam contract [BEHAVIOR]', () => {
  it('preview failure persists http status response body and error', async () => {
    const mod: any = await import('../../../packages/brain/src/routes/preview.js');
    expect(typeof mod.capturePreviewFailureEvidence).toBe('function');

    const evidence = await mod.capturePreviewFailureEvidence({
      pr_number: 42,
      branch_name: 'cp-preview-fail',
      http_status: 503,
      response_body: '{"error":"preview admission rejected"}',
      error: 'preview admission rejected',
    });

    expect(evidence.http_status).toBe(503);
    expect(evidence.response_body).toContain('preview admission rejected');
    expect(evidence.error).toContain('preview admission rejected');
    expect(String(evidence.response_body).length).toBeGreaterThan(0);
    expect(String(evidence.error).length).toBeGreaterThan(0);
  });

  it('preview success path stays separate', async () => {
    const workflow = readFileSync('.github/workflows/preview-deploy.yml', 'utf8');
    expect(workflow).toContain('/api/brain/preview/start');
    expect(workflow).toContain('curl -sf');

    const mod: any = await import('../../../packages/brain/src/routes/preview.js');
    expect(typeof mod.normalizePreviewStartSuccess).toBe('function');
    const result = mod.normalizePreviewStartSuccess({
      port: 5300,
      db_name: 'cecelia_preview_42',
      status: 'starting',
    });
    expect(result).toEqual({
      port: 5300,
      db_name: 'cecelia_preview_42',
      status: 'starting',
    });
  });
});
