import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '../../../..');
const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const dynamicJob = workflow.match(
  /^\s{2}checks:[\s\S]*?(?=^\s{2}[a-zA-Z0-9_-]+:)/m,
)?.[0] ?? '';
const runner = readFileSync(join(repoRoot, 'scripts/ci/run-basic-check.mjs'), 'utf8');

// 旧 DoD 文档命令执行器退役，原有隔离与空执行保护由真实组件入口承接。
describe('basic CI PostgreSQL evidence gate', () => {
  it('passes the isolated PostgreSQL URL through the explicit test-only variable', () => {
    expect(dynamicJob).toContain(
      "DATABASE_URL: ${{ matrix.component == 'brain-integration' && 'postgresql://ci:isolated-ci@127.0.0.1:5432/cecelia_scratch' || '' }}",
    );
    expect(dynamicJob).toContain("POSTGRES_INTEGRATION: ${{ matrix.component == 'brain-integration' && '1' || '0' }}");
  });

  it('rejects a successful vitest process that executed zero tests', () => {
    // Vitest 原生空集合非零必须原样传播，不再通过解析日志估算测试数量。
    expect(runner).not.toContain('--passWithNoTests');
    expect(runner).toContain('if (result.status !== 0) return result.status || 1');
  });
});
