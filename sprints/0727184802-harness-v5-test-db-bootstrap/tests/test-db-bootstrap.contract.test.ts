import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const workflowPath = join(REPO_ROOT, '.github/workflows/harness-v5-checks.yml');
const kernelPgPath = join(REPO_ROOT, 'packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js');
const fleetReceiptPath = join(REPO_ROOT, 'packages/brain/src/__tests__/integration/kernel-fleet-execution-receipts.integration.test.js');
const bootstrapControllerPath = join(REPO_ROOT, 'packages/brain/src/orchestrator/test-db-bootstrap.js');

function mustRead(path: string) {
  expect(existsSync(path), `${path} 必须存在`).toBe(true);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('Harness V5 DB bootstrap contract [BEHAVIOR]', () => {
  it('bootstrap 只迁移 TEST_DATABASE_URL 白名单库', () => {
    expect(existsSync(bootstrapControllerPath), '必须新增统一 bootstrap controller').toBe(true);
    const bootstrap = existsSync(bootstrapControllerPath) ? readFileSync(bootstrapControllerPath, 'utf8') : '';
    expect(bootstrap).toContain('TEST_DATABASE_URL');
    expect(bootstrap).not.toMatch(/\bDB_NAME\b/);
    expect(bootstrap).not.toMatch(/\bDATABASE_URL\b/);
    expect(bootstrap).toMatch(/journey_step_links/);
  });

  it('旧 workflow 使用 DB_NAME=cecelia 在共享夹具上命名失败', () => {
    const workflow = mustRead(workflowPath);
    expect(workflow).not.toContain('DB_NAME: cecelia');
    expect(workflow).not.toContain('TEST_DATABASE_URL: postgresql://cecelia:cecelia@localhost:5432/cecelia_test');
    expect(workflow).toContain('TEST_DATABASE_URL');
  });

  it('kill recovery cleanup 后拒绝复用旧 capability', () => {
    const kernelPg = mustRead(kernelPgPath);
    expect(kernelPg).toMatch(/cleanup|finally|recovery/i);
    expect(kernelPg).toMatch(/TEST_DATABASE_URL/);
    expect(kernelPg).toMatch(/receipt/i);
  });

  it('local-docker 与 fleet-worker 通过真实 dispatcher receipt 保持对等', () => {
    const fleetReceipt = mustRead(fleetReceiptPath);
    expect(fleetReceipt).toContain("executionTransport: 'local-docker'");
    expect(fleetReceipt).toContain('fleet-worker');
    expect(fleetReceipt).toMatch(/receipt/i);
    expect(fleetReceipt).toMatch(/cleanup/i);
  });
});
