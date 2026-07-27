import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const dispatcherPath = join(REPO_ROOT, 'packages/brain/src/orchestrator/dispatcher.js');
const requirementsPath = join(REPO_ROOT, 'packages/brain/src/orchestrator/preflight/requirements.js');
const dbConfigPath = join(REPO_ROOT, 'packages/brain/src/db-config.js');
const baselineModulePath = join(REPO_ROOT, 'packages/brain/src/kernel-harness-f1-baseline.js');

function mustRead(path: string) {
  expect(existsSync(path), `${path} 必须存在`).toBe(true);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('Harness V5 DB capability contract [BEHAVIOR]', () => {
  it('DB capability 只发给声明 DB-backed B1-B5 的角色', () => {
    const dispatcher = mustRead(dispatcherPath);
    const requirements = mustRead(requirementsPath);

    expect(dispatcher).toContain("expectedOutput: 'harness-result/proposer-v1'");
    expect(requirements).toMatch(/postgres:\s*contract\.postgres/);
    expect(requirements).toMatch(/GITHUB_ROLES/);
    expect(requirements).not.toMatch(/judge[\s\S]{0,120}postgres:\s*true/);
  });

  it('import kernel-harness-f1-baseline 不改 env 不 spawn psql 不隐式迁移', () => {
    expect(existsSync(baselineModulePath), '必须新增 kernel-harness-f1-baseline 纯净入口模块').toBe(true);
    const baseline = existsSync(baselineModulePath) ? readFileSync(baselineModulePath, 'utf8') : '';
    expect(baseline).not.toMatch(/process\.env\.[A-Z0-9_]+\s*=/);
    expect(baseline).not.toMatch(/spawn|execFile|execSync|psql/);
    expect(baseline).not.toMatch(/migrate|bootstrap/i);
  });

  it('缺失过期跨 attempt loopback production capability 在 Brain import 前 fail closed', () => {
    const dbConfig = mustRead(dbConfigPath);

    expect(dbConfig).toContain('TEST_DATABASE_URL');
    expect(dbConfig).not.toContain("process.env.DB_NAME || (isTest ? 'cecelia_test' : 'cecelia')");
    expect(dbConfig).not.toMatch(/process\.env\.DATABASE_URL/);
    expect(dbConfig).toMatch(/loopback|default socket|fail-closed|fail closed/i);
  });
});
