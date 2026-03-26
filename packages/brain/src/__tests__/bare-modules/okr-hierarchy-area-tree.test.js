/**
 * Bare Module Test: okr-hierarchy.js GET /area-tree endpoint
 * Verifies the route module exports a router with area-tree support.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_PATH = resolve(__dirname, '../../routes/okr-hierarchy.js');

describe('okr-hierarchy GET /area-tree endpoint', () => {
  it('路由文件存在', () => {
    expect(() => readFileSync(ROUTE_PATH, 'utf8')).not.toThrow();
  });

  it('包含 /area-tree 路由注册', () => {
    const content = readFileSync(ROUTE_PATH, 'utf8');
    expect(content).toContain('/area-tree');
  });

  it('area-tree 端点查询 objectives 表', () => {
    const content = readFileSync(ROUTE_PATH, 'utf8');
    expect(content).toContain('FROM objectives');
  });

  it('按 area_id 分组 objectives', () => {
    const content = readFileSync(ROUTE_PATH, 'utf8');
    expect(content).toContain('area_id');
    expect(content).toContain('objsByArea');
  });

  it('can be imported as ESM module', async () => {
    const mod = await import('../../routes/okr-hierarchy.js');
    expect(mod).toBeDefined();
  });

  it('exports default as a router (function)', async () => {
    const mod = await import('../../routes/okr-hierarchy.js');
    expect(typeof mod.default).toBe('function');
  });
});
