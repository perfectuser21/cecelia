import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path) => readFileSync(`${repoRoot}/${path}`, 'utf8');

describe('通用事实扫描器合同', () => {
  it.each([
    'scripts/scan/scan-api-registry.js',
    'scripts/scan/scan-test-registry.js',
    'scripts/scan/scan-db-schema.js',
  ])('%s 从环境读取 repo 名与 repo root', (path) => {
    const source = read(path);
    expect(source).toContain('SCAN_REPO_NAME');
    expect(source).toContain('SCAN_REPO_ROOT');
    expect(source).toContain('fact-snapshot-store.js');
    expect(source).toContain('git-revision.js');
  });

  it('DB scanner 把事实写入库与被扫描源库分开', () => {
    expect(read('scripts/scan/scan-db-schema.js')).toContain('SOURCE_DATABASE_URL');
  });

  it('统一 runner 用 repo spec 为每个仓库运行四类 scanner', () => {
    const source = read('scripts/scan/run-all-scans.sh');
    expect(source).toContain('SCAN_REPO_SPECS');
    expect(source).toContain('SCAN_REPO_NAME');
    expect(source).toContain('SCAN_REPO_ROOT');
    expect(source).toContain('GRAPH_REPOS');
  });
});

const require = createRequire(import.meta.url);
function withScannerFixture(repo, dirs, check) {
  const root = mkdtempSync(join(tmpdir(), 'scanner-roots-'));
  const previous = { ...process.env };
  const scannerPath = `${repoRoot}/scripts/scan/scan-api-registry.js`;
  try {
    for (const [file, route] of [
      ['packages/brain/src/routes.js', '/brain-live'],
      ['apps/api/src/routes.js', '/retired-core'],
      ['apps/api/features/routes.ts', '/frontend-only'],
      ['service/routes.js', '/generic-service'],
    ]) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), `router.get('${route}', handler);\n`);
    }
    process.env.SCAN_REPO_ROOT = root;
    process.env.SCAN_REPO_NAME = repo;
    delete process.env.SCAN_SOURCE_REPO_NAME;
    if (dirs === undefined) delete process.env.SCAN_API_DIRS;
    else process.env.SCAN_API_DIRS = dirs;
    delete require.cache[require.resolve(scannerPath)];
    return check(require(scannerPath), root);
  } finally {
    process.env = previous;
    delete require.cache[require.resolve(scannerPath)];
    rmSync(root, { recursive: true, force: true });
  }
}

describe('现役扫描根的真实文件选择', () => {
  it('Cecelia API 默认只提取 Brain 路由，排除退役Core与前端features', () => {
    withScannerFixture('cecelia', undefined, (scanner) => {
      const rows = scanner.selectedRoots().flatMap(scanner.scanDir);
      expect(rows.map(row => row.path)).toEqual(['/brain-live']);
    });
  });

  it('Cecelia缺少Brain目录时不将前端退回服务端扫描', () => {
    withScannerFixture('cecelia', undefined, (scanner, root) => {
      rmSync(join(root, 'packages/brain'), { recursive: true });
      expect(scanner.selectedRoots().flatMap(scanner.scanDir)).toEqual([]);
    });
  });

  it('sourceName别名仍按Cecelia服务端目录选择', () => {
    withScannerFixture('ci-alias', undefined, (scanner) => {
      process.env.SCAN_SOURCE_REPO_NAME = 'cecelia';
      expect(scanner.selectedRoots().flatMap(scanner.scanDir).map(row => row.path))
        .toEqual(['/brain-live']);
    });
  });

  it('跨仓显式 SCAN_API_DIRS 仍只提取指定服务目录', () => {
    withScannerFixture('external-service', 'service', (scanner) => {
      expect(scanner.selectedRoots().flatMap(scanner.scanDir).map(row => row.path))
        .toEqual(['/generic-service']);
    });
  });

  it('通用仓默认遍历根目录，不受 Cecelia 专属目录约束', () => {
    withScannerFixture('external-service', undefined, (scanner) => {
      expect(scanner.selectedRoots().flatMap(scanner.scanDir).map(row => row.path).sort())
        .toEqual(['/brain-live', '/frontend-only', '/generic-service', '/retired-core']);
    });
  });

  it('Cecelia graph 选择共享features作为输入，排除退役Core', async () => {
    const { getCeceliaScanDirs } = await import('../../../scripts/scan/scan-graph.mjs');
    withScannerFixture('cecelia', undefined, (_scanner, root) => {
      const dirs = getCeceliaScanDirs(root);
      expect(dirs).toContain('apps/api/features');
      expect(dirs).not.toContain('apps/api/src');
    });
  });
});
