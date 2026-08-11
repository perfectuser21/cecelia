import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const smokeUrl = new URL('../smoke/map-engine-smoke.sh', import.meta.url);
const unifiedSmokeUrl = new URL('../smoke/unified-map-api-smoke.sh', import.meta.url);

describe('map-engine smoke contract', () => {
  it('只请求现行路由，并用冻结 Manifest 验证 schema', async () => {
    const source = await readFile(smokeUrl, 'utf8');

    expect(source).not.toContain('/api/brain/map/manifests?');
    expect(source).toContain('/api/brain/map/manifests/validate');
    expect(source).toContain('config/map-manifests/cecelia.v1.json');
    expect(source).toContain('/api/brain/map/health');
    expect(source).not.toContain('/api/brain/map/unclaimed');
  });

  it('宿主 smoke 从共享 credentials SSOT 给受保护写入口附加 token', async () => {
    const [source, unifiedSource] = await Promise.all([
      readFile(smokeUrl, 'utf8'),
      readFile(unifiedSmokeUrl, 'utf8'),
    ]);

    for (const script of [source, unifiedSource]) {
      expect(script).toContain('scripts/lib/internal-auth-token.sh');
      expect(script).toContain('load_cecelia_internal_token');
      expect(script).toContain('Authorization: Bearer ${CECELIA_INTERNAL_TOKEN}');
    }
    expect(source).toContain('brain_curl -fsS -X POST');
    expect(unifiedSource).toContain('brain_curl -fsS -X POST');
  });
});
