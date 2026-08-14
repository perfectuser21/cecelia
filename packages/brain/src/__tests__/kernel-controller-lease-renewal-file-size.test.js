import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MAX_LINES = 500;

function physicalLineCount(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const trailingNewline = source.endsWith('\n') ? 1 : 0;
  return source.split(/\r?\n/u).length - trailingNewline;
}

function expectAssetWithinLimit(relativePath) {
  const filePath = fileURLToPath(new URL(relativePath, import.meta.url));
  expect(existsSync(filePath), `${relativePath} 必须存在`).toBe(true);
  if (!existsSync(filePath)) return;
  expect(physicalLineCount(filePath), `${relativePath} 超过 ${MAX_LINES} 行`)
    .toBeLessThanOrEqual(MAX_LINES);
}

describe('Controller lease sprint 测试资产单文件行数门禁', () => {
  it('本 sprint 新增/拆出相关测试与 helper 均 ≤500 行：lease 真 PG', () => {
    expectAssetWithinLimit('./integration/kernel-controller-lease-renewal.pg.integration.test.js');
  });
  it('lease 真 PG fixture 不超过 500 行', () => {
    expectAssetWithinLimit('./integration/kernel-controller-lease-renewal.pg-fixture.js');
  });
  it('migration 416 真 PG 不超过 500 行', () => {
    expectAssetWithinLimit('./integration/migration-416-controller-session-nonblank.pg.integration.test.js');
  });
  it('actual CLI 真 PG 不超过 500 行', () => {
    expectAssetWithinLimit('./integration/kernel-cli-ownership-preaction.pg.integration.test.js');
  });
  it('永久 session 透传测试不超过 500 行', () => {
    expectAssetWithinLimit('./controller-session-passthrough.test.js');
  });
  it('永久 E2E oracle 测试不超过 500 行', () => {
    expectAssetWithinLimit('./kernel-controller-lease-renewal-e2e-oracle.test.js');
  });
  it('行数门禁自身不超过 500 行', () => {
    expectAssetWithinLimit('./kernel-controller-lease-renewal-file-size.test.js');
  });
  it('冻结 session 透传测试不超过 500 行', () => {
    expectAssetWithinLimit('../../../../sprints/08132021-controller-lease-renewal-r2/tests/controller-session-passthrough.test.js');
  });
  it('冻结 lease 真 PG 测试不超过 500 行', () => {
    expectAssetWithinLimit('../../../../sprints/08132021-controller-lease-renewal-r2/tests/kernel-controller-lease-renewal.pg.integration.test.js');
  });
});
