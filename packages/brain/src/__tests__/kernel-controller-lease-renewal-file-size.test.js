import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MAX_LINES = 500;
const RELATED_TEST_ASSETS = [
  './integration/kernel-controller-lease-renewal.pg.integration.test.js',
  './integration/kernel-controller-lease-renewal.pg-fixture.js',
  './integration/migration-416-controller-session-nonblank.pg.integration.test.js',
  './integration/kernel-cli-ownership-preaction.pg.integration.test.js',
  './controller-session-passthrough.test.js',
  './kernel-controller-lease-renewal-e2e-oracle.test.js',
  './kernel-controller-lease-renewal-file-size.test.js',
  '../../../../sprints/08132021-controller-lease-renewal-r2/tests/controller-session-passthrough.test.js',
  '../../../../sprints/08132021-controller-lease-renewal-r2/tests/kernel-controller-lease-renewal.pg.integration.test.js',
];

function physicalLineCount(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const trailingNewline = source.endsWith('\n') ? 1 : 0;
  return source.split(/\r?\n/u).length - trailingNewline;
}

describe('Controller lease sprint 测试资产单文件行数门禁', () => {
  it.each(RELATED_TEST_ASSETS)('%s 存在且不超过 500 行', (relativePath) => {
    const filePath = fileURLToPath(new URL(relativePath, import.meta.url));
    expect(existsSync(filePath), `${relativePath} 必须存在`).toBe(true);
    if (!existsSync(filePath)) return;
    expect(physicalLineCount(filePath), `${relativePath} 超过 ${MAX_LINES} 行`)
      .toBeLessThanOrEqual(MAX_LINES);
  });
});
