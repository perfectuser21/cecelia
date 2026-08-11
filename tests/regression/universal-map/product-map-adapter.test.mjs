import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const script = join(repoRoot, 'scripts/map/product-map-adapter.mjs');
const fixtureDir = mkdtempSync(join(tmpdir(), 'product-map-adapter-'));
const fixture = join(fixtureDir, 'product-map.yaml');
const decisionId = '3f56ff26-0784-4c82-8890-607d0a10b489';

const paths = Array.from({ length: 18 }, (_, index) => ({
  id: `gp_${String(index + 1).padStart(2, '0')}`,
  line: ['line01', 'line02', 'line04', 'line00'][index % 4],
  status: index >= 16 ? 'deprecated' : (index >= 13 ? 'proposed' : 'active'),
}));

writeFileSync(fixture, `
apps:
  - id: customer_app
    name: 客户端
    lines:
      - { id: line01, name: 首次成功 }
      - { id: line02, name: 智能获客 }
      - { id: line04, name: 私域接管 }
  - id: staff_app
    name: 员工后台
    lines:
      - { id: line00, name: 运营与系统 }
golden_paths:
${paths.map(({ id, line, status }) => `  - { id: ${id}, app_id: ${line === 'line00' ? 'staff_app' : 'customer_app'}, line_id: ${line}, name: ${id}, status: ${status} }`).join('\n')}
`);

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

describe('product-map.yaml adapter', () => {
  it('把真实 apps/lines/golden_paths 形状转换为 4×16 的通用 Manifest', () => {
    const result = spawnSync(process.execPath, [
      script,
      '--input', fixture,
      '--scope', 'zenithjoy-workspace',
      '--decision-id', decisionId,
    ], { encoding: 'utf8', cwd: repoRoot });

    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(result.stdout);
    expect(manifest.scope_key).toBe('zenithjoy-workspace');
    expect(manifest.value_streams).toHaveLength(4);
    expect(manifest.capabilities).toHaveLength(16);
    expect(manifest.capabilities.map(({ key }) => key)).not.toContain('gp_17');
    expect(manifest.value_streams.find(({ key }) => key === 'line00')?.perceiver).toBe('员工后台');
    expect(manifest.boundaries).toEqual([]);
    expect(manifest.crosscut_pool).toEqual([]);
    expect(manifest.shared_prerequisites).toEqual({
      applicable: false,
      items: [],
      reason: 'product-map.yaml 未声明跨价值流共享前置',
    });
  });
});
