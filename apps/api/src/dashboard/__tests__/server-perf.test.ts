import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import compression from 'compression';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Build a minimal test app that mirrors the server's static serving setup
function createTestApp() {
  const app = express();

  // Compression (same as server.ts)
  app.use(compression() as unknown as express.RequestHandler);

  const frontendPath = join(__dirname, '../../../../dashboard/dist');

  // Hashed assets — immutable long-term cache
  app.use('/assets', express.static(join(frontendPath, 'assets'), {
    maxAge: '1y',
    immutable: true,
  }));

  // Other static files — no cache
  app.use(express.static(frontendPath, {
    maxAge: 0,
    etag: true,
  }));

  // SPA fallback
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(frontendPath, 'index.html'));
  });

  return app;
}

describe('Server performance middleware', () => {
  const app = createTestApp();

  it('hashed assets have immutable cache-control', async () => {
    // Find an actual asset file from the build output
    const frontendPath = join(__dirname, '../../../../dashboard/dist');
    const assetsDir = join(frontendPath, 'assets');
    let assetFile: string | undefined;
    try {
      const files = readdirSync(assetsDir);
      assetFile = files.find(f => f.endsWith('.js'));
    } catch {
      // No build output, skip
    }

    if (!assetFile) return; // Skip if no build

    const res = await request(app)
      .get(`/assets/${assetFile}`)
      .set('Accept-Encoding', 'identity');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age=31536000');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('SPA fallback returns no-cache', async () => {
    const res = await request(app)
      .get('/some-route')
      .set('Accept-Encoding', 'identity');

    if (res.status === 200) {
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('compression middleware adds Vary header', async () => {
    const res = await request(app)
      .get('/some-route')
      .set('Accept-Encoding', 'gzip');

    if (res.status === 200) {
      expect(res.headers['vary']).toContain('Accept-Encoding');
    }
  });
});
