// QA准入与预览门：每个必需检查分支使用独立沙箱与原30秒单测预算。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../__tests__/helpers/git.mjs';
import { codingTask } from './helpers/sandbox.mjs';
import { loadConfig } from '../lib/config.mjs';
import { useQaEnv, FAKE_EVALUATE, BRANCH } from './helpers/qa-env.mjs';

describe('runner QA准入与预览门', () => {
  let sb, head, preview;
  const E = useQaEnv({ onReady: e => ({ sb, head, preview } = e) });
  const { pr, green, go, addToBranch, statePath, state, seedState, qaCalls, ghCalls } = E;
  const brainQa = () => E.brainResults();

  it('配置：QA 门默认开启；CODING_WF_QA_GATE=0 关闭；预览 API 与令牌从环境读', () => {
    expect(loadConfig({ HOME: '/h', DEPLOY_TOKEN: 't' })).toMatchObject({ qaGate: true, deployToken: 't', previewApi: 'http://100.71.151.105:5241' });
    expect(loadConfig({ HOME: '/h', CODING_WF_QA_GATE: '0' }).qaGate).toBe(false);
    expect(loadConfig({ HOME: '/h' })).toMatchObject({ judge: true, qaMaxJudgeBad: 3 });
    expect(loadConfig({ HOME: '/h', CODING_WF_JUDGE: '0' }).judge).toBe(false);
  });

  it('evaluate 入口来自 runner 专用 clone（main），不用 PR 分支里可能被改过的 evaluate.mjs（审计 P0 #1）', async () => {
    const rel = 'packages/brain/scripts/coding-workflow/activities/evaluate.mjs';
    // PR 分支里放一个「被改过的」evaluate：一跑就留下 poison 记录并判 PASS
    addToBranch(rel, `import fs from 'node:fs';\nfs.appendFileSync(process.env.FAKE_QA_LOG, '{"poison":true}\\n');\nprocess.stdout.write(JSON.stringify({ status: 'failed', failure_class: 'fatal', reason_code: 'poison' }) + '\\n');\n`);
    fs.mkdirSync(path.dirname(path.join(sb.clone, rel)), { recursive: true });
    fs.copyFileSync(FAKE_EVALUATE, path.join(sb.clone, rel));
    const r = await go(green({ prs: [pr({ headRefOid: git(sb.origin, 'rev-parse', BRANCH).trim() })] }), { extra: { CODING_WF_EVALUATE: '' } });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()).toEqual([expect.objectContaining({ pr_number: 77, round: 1 })]);
  });

  it.each(['pending', 'failed', 'missing-ci-passed', 'ruleset', 'unknown-required', 'passed', 'same-head-fail'])('必需检查分支%s：不跑 QA', async key => {
    const cases = {
      pending: () => [green({ required: { 77: [{ name: 'ci-passed', bucket: 'pending' }] } }), null],
      failed: () => [green({ required: { 77: [{ name: 'ci-passed', bucket: 'fail' }] } }), null],
      // ci-passed尚未登记时，仅Harness绿不能代替全部必需检查。
      'missing-ci-passed': () => [green({ required: { 77: [{ name: 'Harness V5 Gate Passed', bucket: 'pass' }] }, requiredContexts: ['ci-passed', 'Harness V5 Gate Passed'] }), null],
      ruleset: () => [green({ rulesetContexts: ['Smoke Glob Runner Passed'] }), null],
      'unknown-required': () => [green({ requiredContextsFail: true }), null],
      passed: () => [green(), { passed: true, rounds: [] }],
      'same-head-fail': () => [green(), { rounds: [{ round: 1, head, verdict: 'FAIL', fails: 1, fix: 'no_commit' }] }],
    };
    const [gh, seed] = cases[key]();
    if (seed) seedState(seed); else fs.rmSync(statePath(), { force: true });
    const r = await go(gh, { extra: { CODING_WF_CIFIX: '0' } });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()).toEqual([]);
    await E.closeBrain();
  });

  // 审计 P0 #2：QA 验的必须正是待合并 head 的构建
  it('预览环境还是旧版本（git_sha ≠ PR head，推送后还没重新部署）→ 不验，记 stale_since；超时升级 qa_preview_stale', async () => {
    preview.sha = 'a'.repeat(40);
    let r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()).toEqual([]);
    expect(state().preview).toMatchObject({ stale_since: expect.any(String), stale_sha: 'a'.repeat(40) });
    await E.closeBrain();
    r = await go(green(), { extra: { CODING_WF_QA_PREVIEW_ESCALATE_MS: '0' } });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()).toEqual([]);
    expect(state().escalated).toMatchObject({ type: 'qa_preview_stale', preview_sha: 'a'.repeat(40), head });
  });

  it('列表里的 head 已过时（检出的分支比它新）→ 本轮不验、不计坏', async () => {
    addToBranch('src/later.js', 'export const later = 1;\n');
    const r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()).toEqual([]);
    expect(fs.existsSync(statePath()) ? state().bad ?? 0 : 0).toBe(0);
  });

  it('evaluate 拿到要验的 head（head_sha），活动开跑前自己再核一次预览版本', async () => {
    const r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()[0]).toMatchObject({ head_sha: head });
  });

  it('预览环境不存在 → 带令牌请求启动，本轮不验', async () => {
    preview.status = {};
    const r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    const start = preview.calls.find((c) => c.url === '/api/brain/preview/start');
    expect(start).toMatchObject({ method: 'POST', auth: 'Bearer tok-1' });
    expect(JSON.parse(start.raw)).toMatchObject({ pr_number: 77, branch_name: BRANCH });
    expect(qaCalls()).toEqual([]);
    expect(state().preview).toMatchObject({ requested_at: expect.any(String) });
  });

  it('预览启动被容量拒绝且超过等待时限 → 升级给 coding commander（P1，回写 Brain escalations）', async () => {
    preview.status = {};
    preview.start = 503;
    const r = await go(green(), { extra: { CODING_WF_QA_PREVIEW_ESCALATE_MS: '0' } });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toContain('[coding-qa][P1]');
    expect(state()).toMatchObject({ escalated: { type: 'qa_preview_unavailable' } });
    expect(brainQa().at(-1).escalations).toEqual([expect.objectContaining({ type: 'qa_preview_unavailable', pr: 77 })]);
  });

  it('已合并且 QA 通过过的 PR → 停掉它的预览环境释放容量（只停一次）', async () => {
    seedState({ passed: true, rounds: [] });
    const r = await go({ prs: [], mergedPrs: [pr()] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(preview.calls.filter((c) => c.url === '/api/brain/preview/stop/77')).toEqual([expect.objectContaining({ method: 'POST', auth: 'Bearer tok-1' })]);
    expect(state().preview_stopped).toBe(true);
  });

  it('QA 门开启时新任务开出 PR 后只 ready、不开自动合并（等 QA 通过）', async () => {
    const r = await go({ prs: [] }, { tasks: [codingTask('eeeeeee5-0000-4000-8000-000000000005')] });
    expect(r.exitCode, r.stderr).toBe(0);
    const calls = ghCalls();
    expect(calls).toContainEqual(['pr', 'ready', 'https://github.com/example/repo/pull/9']);
    expect(calls.some((a) => a[1] === 'merge')).toBe(false);
    // 审计 #7：开出 PR 不等于完成，结果里标明阶段
    const completed = E.brain.patches.find((p) => p.id.startsWith('eeeeeee5') && p.body.status === 'completed');
    expect(completed.body.result.runner.phase).toBe('awaiting_qa');
  });
});
