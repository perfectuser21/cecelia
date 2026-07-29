/**
 * nightly-regression-config.test.js
 * 守住 cecelia CI/CD 三把刀三件套，防被静默删改：
 *   刀A nightly-regression.yml（每晚全量回归闸，#3717）
 *   刀B integration-nightly.yml（跨组件 integration nightly，#3713）
 *   刀C durable ReleaseRun quality observation（迁移自 #3717）
 * 背景：PR CI 按路径过滤 + vitest --changed，回归靠 nightly 兜底；promote 靠 nightly 绿证据。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');

describe('刀A nightly-regression workflow', () => {
  const WF = read('.github/workflows/nightly-regression.yml');
  it('有 schedule 定时 + workflow_dispatch，无 pull_request（不阻塞 PR）', () => {
    expect(WF).toMatch(/schedule:/);
    expect(WF).toMatch(/cron:/);
    expect(WF).toMatch(/workflow_dispatch:/);
    expect(WF).not.toMatch(/pull_request:/);
  });
  it('红时开 Issue', () => {
    expect(WF).toMatch(/open-issue-on-failure/);
  });
  it('真 PostgreSQL integration 使用专用 config，不会被 unit exclude 静默跳过', () => {
    const integrationJob = WF.match(
      /brain-integration-nightly:[\s\S]*?(?=\n  [a-z][a-z0-9-]+:|\n# ─|$)/,
    )?.[0] ?? '';
    expect(integrationJob).toContain(
      '--config vitest.integration.config.js',
    );
    expect(integrationJob).toContain('src/__tests__/integration/');
  });
});

describe('刀B integration-nightly workflow', () => {
  const WF = read('.github/workflows/integration-nightly.yml');
  it('有 schedule 定时且跑真 Postgres', () => {
    expect(WF).toMatch(/schedule:/);
    expect(WF).toMatch(/postgres/);
  });
});

describe('刀C Release Gate', () => {
  it('ReleaseRun 在 production authority 前持久化固定 48h nightly 质量证据', () => {
    const QUALITY = read('packages/brain/src/orchestrator/release-run-quality.js');
    const EXECUTOR = read('packages/brain/src/orchestrator/release-run-executor.js');
    const RUN = read('packages/brain/src/orchestrator/run.js');
    const WF = read('.github/workflows/promote-dashboard-prod.yml');
    expect(QUALITY).toContain("RELEASE_QUALITY_WORKFLOW = 'nightly-regression.yml'");
    expect(QUALITY).toContain("RELEASE_QUALITY_BRANCH = 'main'");
    expect(QUALITY).toMatch(/RELEASE_QUALITY_MAX_AGE_MS\s*=\s*48\s*\*/);
    expect(EXECUTOR).toContain('observeReleaseQuality');
    expect(EXECUTOR).toContain('release_quality');
    expect(RUN).toContain('defaultReleaseAdapters.observeReleaseQuality');
    expect(WF).not.toMatch(/nightly_gate|BYPASS_NIGHTLY_GATE/);
    expect(() => read('scripts/ci/check-nightly-green.sh')).toThrow();
  });
});

describe('三把刀 workflow YAML 必须可解析（07-10 实锤：顶格 **markdown** 在 run 块里被当 alias，0-job startup failure，刀A/刀B 完全失效）', () => {
  it.each([
    '.github/workflows/nightly-regression.yml',
    '.github/workflows/integration-nightly.yml',
    '.github/workflows/promote-dashboard-prod.yml',
  ])('%s 可被 YAML 解析', async (p) => {
    const { load } = await import('js-yaml');
    expect(() => load(read(p))).not.toThrow();
  });
});
