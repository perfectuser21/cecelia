/**
 * nightly-regression-config.test.js
 * 守住 cecelia CI/CD 三把刀三件套，防被静默删改：
 *   刀A nightly-regression.yml（每晚全量回归闸，#3717）
 *   刀B integration-nightly.yml（跨组件 integration nightly，#3713）
 *   刀C promote-dashboard-prod.yml 的 nightly_gate + scripts/ci/check-nightly-green.sh（#3717）
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
});

describe('刀B integration-nightly workflow', () => {
  const WF = read('.github/workflows/integration-nightly.yml');
  it('有 schedule 定时且跑真 Postgres', () => {
    expect(WF).toMatch(/schedule:/);
    expect(WF).toMatch(/postgres/);
  });
});

describe('刀C Release Gate', () => {
  it('promote-dashboard-prod 有 nightly_gate 前置且 promote 依赖它', () => {
    const WF = read('.github/workflows/promote-dashboard-prod.yml');
    expect(WF).toMatch(/nightly_gate/);
    expect(WF).toMatch(/needs:\s*nightly_gate/);
    expect(WF).toMatch(/check-nightly-green\.sh/);
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
    '.github/workflows/promote-dashboard-prod.yml',
  ])('%s 可被 YAML 解析', async (p) => {
    const { load } = await import('js-yaml');
    expect(() => load(read(p))).not.toThrow();
  });
});
