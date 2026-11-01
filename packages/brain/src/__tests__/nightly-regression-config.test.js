/**
 * nightly-regression-config.test.js
 * 守住现役深度回归、历史诊断与发布资格之间的边界。
 * 源码CI按完整组件执行，历史三把刀中的重复集成入口已改为按需诊断。
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
});

describe('历史 integration 诊断与现役深度回归', () => {
  const WF = read('.github/workflows/integration-nightly.yml');
  it('历史入口只允许按需调用，定时数据库回归由统一deep入口承担', async () => {
    const { load } = await import('js-yaml');
    expect(load(WF).on.workflow_dispatch).toBeDefined();
    expect(load(WF).on.schedule).toBeUndefined();
    expect(WF).toMatch(/postgres/);
    const deep = load(read('.github/workflows/nightly-regression.yml'));
    expect(deep.jobs['brain-integration'].services.postgres.env.POSTGRES_DB).toBe('cecelia_test');
    expect(deep.jobs['brain-integration'].env.POSTGRES_INTEGRATION).toBe('1');
  });
});

describe('刀C Release Gate', () => {
  it('现役 deploy 的两条发布路径都依赖 nightly_gate', async () => {
    const { load } = await import('js-yaml');
    const { jobs } = load(read('.github/workflows/deploy.yml'));
    expect(jobs.nightly_gate.steps.some((step) => step.run?.includes('bash scripts/ci/check-nightly-green.sh'))).toBe(true);
    expect(jobs.risk_gate.needs).toContain('nightly_gate');
    expect(jobs.staging_deploy.needs).toContain('nightly_gate');
    expect(jobs.deploy.needs).toEqual(expect.arrayContaining(['nightly_gate', 'risk_gate', 'staging_deploy']));
  });
  it('check-nightly-green.sh 指向存活的刀A workflow 文件', () => {
    const SH = read('scripts/ci/check-nightly-green.sh');
    const m = SH.match(/WORKFLOW_FILE="([^"]+)"/);
    expect(m).toBeTruthy();
    // 被守文件必须真实存在（防刀A改名后闸空转）
    expect(() => read(`.github/workflows/${m[1]}`)).not.toThrow();
  });
});

describe('三把刀 workflow YAML 必须可解析（07-10 实锤：顶格 **markdown** 在 run 块里被当 alias，0-job startup failure，刀A/刀B 完全失效）', () => {
  it.each([
    '.github/workflows/nightly-regression.yml',
    '.github/workflows/integration-nightly.yml',
    '.github/workflows/deploy.yml',
  ])('%s 可被 YAML 解析', async (p) => {
    const { load } = await import('js-yaml');
    expect(() => load(read(p))).not.toThrow();
  });
});
