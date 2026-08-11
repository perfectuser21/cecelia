import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const smokeUrl = new URL('../smoke/map-engine-smoke.sh', import.meta.url);

describe('map-engine smoke contract', () => {
  it('只请求现行路由，并用冻结 Manifest 验证 schema', async () => {
    const source = await readFile(smokeUrl, 'utf8');

    expect(source).not.toContain('/api/brain/map/manifests?');
    expect(source).toContain('/api/brain/map/manifests/validate');
    expect(source).toContain('config/map-manifests/cecelia.v1.json');
    expect(source).toContain('/api/brain/map/health');
    expect(source).not.toContain('/api/brain/map/unclaimed');
  });
});
