import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DOC_PATH = 'docs/fire-drills/kernel-v1-mixed-20260724-r7.md';
const DELIVERY_BRANCH = 'cp-07250025-892405df';
const TASK_ID = '2255a63a-2152-47c3-aa89-301cae2445ad';
const RUN_ID = 'e9ef9dde-fab9-47ff-b5b3-61d519af2ac6';
const PRIOR_TASK_ID = '50bd54d0-b160-4d5d-97cb-98adeaeb8990';
const PRIOR_RUN_ID = '61d67ca8-22f5-4ca6-afa7-7b4030d148b8';
const RED_SHA = '50291fbba314a3fd736249b4cb2014277dccff41';
const GREEN_SHA = 'd6fce4971c40b67c2fb793290949fc1b2a664ae7';
const ANCESTOR_SHA1 = '19887912bbb581597f12c714a9ed187f051e2850';
const ANCESTOR_SHA2 = '2a96f975ecf1ce1ddfb818030f7642a08e2860b8';
const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

function readDeliveryDoc(): string {
  try {
    return readFileSync(DOC_PATH, 'utf8');
  } catch {
    execSync(`git fetch origin ${DELIVERY_BRANCH} --quiet`, { encoding: 'utf8' });
    return execSync(`git show FETCH_HEAD:${DOC_PATH}`, { encoding: 'utf8' });
  }
}

describe('Kernel v1 mixed provider fire drill R9 [BEHAVIOR]', () => {
  it('目标文档 pr-state check 段已替换为显式 PR 号命令且 exit_code 不再是占位符', () => {
    const c = readDeliveryDoc();
    expect(c.includes('pending_until_pr_created')).toBe(false);
    expect(c.includes('gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup')).toBe(true);
    expect(/check:\s*pr-state[\s\S]{0,600}?exit_code:\s*0/.test(c)).toBe(true);
  });

  it('目标文档新增 R9 续跑证据段含当前与 prior 的 task_id/run_id 四值', () => {
    const c = readDeliveryDoc();
    for (const mark of [TASK_ID, RUN_ID, PRIOR_TASK_ID, PRIOR_RUN_ID]) {
      expect(c.includes(mark)).toBe(true);
    }
  });

  it('目标文档记录 CI 结构化判据的三态枚举集合', () => {
    const c = readDeliveryDoc();
    for (const token of ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STALE', 'STARTUP_FAILURE', 'SKIPPED', 'NEUTRAL']) {
      expect(c.includes(token)).toBe(true);
    }
  });

  it('目标文档历史标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7 与两个祖先 SHA 仍完整保留', () => {
    const c = readDeliveryDoc();
    for (const mark of ['KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7', '1.267.67', ANCESTOR_SHA1, ANCESTOR_SHA2]) {
      expect(c.includes(mark)).toBe(true);
    }
  });

  it('gh pr view 4317 真实返回 OPEN 未合并且分支与CI结论集合匹配', () => {
    const out = execSync(
      'gh pr view 4317 --json state,mergedAt,headRefName,headRefOid,statusCheckRollup',
      { encoding: 'utf8' }
    );
    const pr = JSON.parse(out);
    expect(pr.state).toBe('OPEN');
    expect(pr.mergedAt).toBeNull();
    expect(pr.headRefName).toBe(DELIVERY_BRANCH);
    const runs = (pr.statusCheckRollup || []).filter((x: any) => x.__typename === 'CheckRun');
    expect(runs.every((r: any) => r.status === 'COMPLETED')).toBe(true);
    const failSet = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STALE', 'STARTUP_FAILURE']);
    expect(runs.some((r: any) => failSet.has(r.conclusion))).toBe(false);
  });

  it('生产 health 响应 git_sha 满足两个历史 SHA 祖先判据', () => {
    const resp = execSync(`curl -sf -m 10 "${BRAIN_URL}/api/brain/health"`, { encoding: 'utf8' });
    const health = JSON.parse(resp);
    expect(typeof health.git_sha).toBe('string');
    expect(/^[0-9a-f]{40}$/.test(health.git_sha)).toBe(true);
    for (const sha of [ANCESTOR_SHA1, ANCESTOR_SHA2]) {
      execSync(`git merge-base --is-ancestor ${sha} ${health.git_sha}`);
    }
  });

  it('批准合同真实物化且本轮 relay-runs 未命中两个历史失败 reason', () => {
    const detailOut = execSync(
      `curl -sf -m 10 "${BRAIN_URL}/api/brain/harness/initiative/${TASK_ID}/detail"`,
      { encoding: 'utf8' }
    );
    const detail = JSON.parse(detailOut);
    expect(detail.contract_content).not.toBeNull();
    expect(detail.prd_content).not.toBeNull();

    const relayOut = execSync(
      `curl -sf -m 10 "${BRAIN_URL}/api/brain/orchestrator/relay-runs?task_id=${TASK_ID}&limit=100"`,
      { encoding: 'utf8' }
    );
    const relayRuns = JSON.parse(relayOut);
    const reasons = relayRuns.map((r: any) => r.failure_reason);
    expect(reasons.includes('approved_but_contract_artifacts_missing')).toBe(false);
    expect(reasons.includes('no_progress_same_sha')).toBe(false);
    expect(relayRuns.some((r: any) => r.id === RUN_ID)).toBe(true);
  });

  it('Red 与 Green 两个历史 SHA 在提交历史中保留可查', () => {
    const redType = execSync(`git cat-file -t ${RED_SHA}`, { encoding: 'utf8' }).trim();
    const greenType = execSync(`git cat-file -t ${GREEN_SHA}`, { encoding: 'utf8' }).trim();
    expect(redType).toBe('commit');
    expect(greenType).toBe('commit');
  });
});
