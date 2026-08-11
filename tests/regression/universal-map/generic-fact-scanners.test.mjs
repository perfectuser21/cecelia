import { readFileSync } from 'node:fs';
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
