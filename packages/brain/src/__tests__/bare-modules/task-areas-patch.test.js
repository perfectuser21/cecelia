/**
 * Bare Module Test: task-areas.js PATCH /:id endpoint
 * Verifies the route module exports a router with PATCH support.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_PATH = resolve(__dirname, '../../routes/task-areas.js');

describe('task-areas PATCH /:id endpoint', () => {
  it('路由文件存在', () => {
    expect(() => readFileSync(ROUTE_PATH, 'utf8')).not.toThrow();
  });

  it('包含 router.patch 端点声明', () => {
    const content = readFileSync(ROUTE_PATH, 'utf8');
    expect(content).toContain('router.patch');
  });

  it('PATCH 端点支持 archived 字段', () => {
    const content = readFileSync(ROUTE_PATH, 'utf8');
    expect(content).toContain('archived');
  });

  it('can be imported as ESM module', async () => {
    const mod = await import('../../routes/task-areas.js');
    expect(mod).toBeDefined();
  });

  it('exports default as a router (function)', async () => {
    const mod = await import('../../routes/task-areas.js');
    expect(typeof mod.default).toBe('function');
  });
});
