// run-once.mjs 的 QA 门（evaluator 真人 QA，CI 绿后、合并前）+ 独立裁判：共用测试环境见 helpers/qa-env.mjs。
// 合并门（绑定 head SHA）用例在 run-once-merge.test.mjs。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { git } from '../../__tests__/helpers/git.mjs';
import { codingTask } from './helpers/sandbox.mjs';
import { loadConfig } from '../lib/config.mjs';
import { useQaEnv, FAKE_EVALUATE, TASK, BRANCH, SPRINT, INTENT } from './helpers/qa-env.mjs';

describe('runner QA 门（evaluator 真人 QA）', () => {
  let sb;
  let head;
  let preview;
  let judge;
  let files;
  const E = useQaEnv({ onReady: (e) => ({ sb, head, preview, judge, files } = e) });
  const { pr, green, go, addToBranch, statePath, state, seedState, qaCalls, ghCalls, originLog } = E;
  const brainQa = () => E.brainResults();

  it('配置：QA 门默认开启；CODING_WF_QA_GATE=0 关闭；预览 API 与令牌从环境读', () => {
    expect(loadConfig({ HOME: '/h', DEPLOY_TOKEN: 't' })).toMatchObject({ qaGate: true, deployToken: 't', previewApi: 'http://100.71.151.105:5241' });
    expect(loadConfig({ HOME: '/h', CODING_WF_QA_GATE: '0' }).qaGate).toBe(false);
    expect(loadConfig({ HOME: '/h' })).toMatchObject({ judge: true, qaMaxJudgeBad: 3 });
    expect(loadConfig({ HOME: '/h', CODING_WF_JUDGE: '0' }).judge).toBe(false);
  });

  it('CI 绿 + 预览 active + QA PASS + 独立裁判 PASS：evaluate 拿到 sprint/I-n/01 哈希/轮次；QA 报告与裁决一起提交推送；批准绑定推送后的 head（不开 GitHub 自动合并）；回写 Brain；本轮不认领新任务', async () => {
    const r = await go(green(), { tasks: [codingTask('dddddddd-0000-4000-8000-000000000004')] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()).toEqual([expect.objectContaining({
      pr_number: 77, round: 1, task_id: TASK, sprint_dir: SPRINT, intent_ids: ['I-1'],
      intent_sha256: crypto.createHash('sha256').update(INTENT).digest('hex'),
    })]);
    expect(qaCalls()[0].judge_feedback).toBeUndefined();
    expect(originLog()[0]).toBe('docs(qa): 第 1 轮真人 QA PASS，独立裁判 PASS');
    expect(git(sb.origin, 'show', '--name-only', '--format=', BRANCH).trim().split('\n').sort()).toEqual([`${SPRINT}/05-qa-report-r1.md`, `${SPRINT}/06-judge-r1.md`]);
    expect(ghCalls().some((a) => a[1] === 'merge')).toBe(false);
    expect(state()).toMatchObject({
      passed: true, approved: { head: git(sb.origin, 'rev-parse', BRANCH).trim(), round: 1 },
      rounds: [{ round: 1, head, verdict: 'PASS', judge: { verdict: 'PASS', model: 'judge-m' } }],
    });
    expect(brainQa().at(-1).qa).toMatchObject({ verdict: 'PASS', rounds: 1, judge: 'PASS' });
    expect(E.brain.patches.some((p) => p.id.startsWith('dddddddd'))).toBe(false);
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

  it('独立裁判拿到：模型、Bearer 令牌、需求 01、合同 02、QA 报告 05、PR 代码改动（不含 sprints/）', async () => {
    const r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(judge.calls).toHaveLength(1);
    const call = judge.calls[0];
    expect(call).toMatchObject({ url: '/v1/chat/completions', auth: 'Bearer jk' });
    expect(call.body.model).toBe('judge-m');
    const user = call.body.messages.find((m) => m.role === 'user').content;
    for (const s of ['### I-1', '### Q-1', '# QA 报告 第 1 轮 pass', 'MARKER_CODE', 'I-1']) expect(user).toContain(s);
    expect(user).not.toContain('diff --git a/sprints/');
  });

  it('裁判判产品没做到（product）→ 不合并；报告与裁决提交 → 开发按裁决修复推送；修复 prompt 带裁决路径与 J-n', async () => {
    judge.mode = 'product';
    const r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(originLog().slice(0, 2)).toEqual(['fix(ci): 修复 CI 失败', 'docs(qa): 第 1 轮真人 QA PASS，独立裁判 FAIL']);
    expect(ghCalls().some((a) => a[1] === 'merge')).toBe(false);
    expect(state().passed).toBeFalsy();
    expect(state().rounds).toEqual([expect.objectContaining({
      round: 1, verdict: 'PASS', fails: 1, fix: 'pushed', judge: expect.objectContaining({ verdict: 'FAIL', failure_class: 'product_failure', file: '06-judge-r1.md' }),
    })]);
    const prompt = fs.readFileSync(files.prompt, 'utf8');
    expect(prompt).toContain(`${SPRINT}/06-judge-r1.md`);
    expect(prompt).toContain('J-1');
    expect(brainQa().at(-1).qa).toMatchObject({ judge: 'FAIL' });
  });

  it('裁判判 QA 没真验到（qa_gap）→ 不修代码、不合并；下一轮 QA 把裁决交给 evaluator 补验', async () => {
    judge.mode = 'qa_gap';
    let r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(originLog()[0]).toBe('docs(qa): 第 1 轮真人 QA PASS，独立裁判 FAIL');
    expect(ghCalls().some((a) => a[1] === 'merge')).toBe(false);
    expect(fs.existsSync(files.prompt)).toBe(false);
    expect(state().rounds[0]).toMatchObject({ judge: { failure_class: 'qa_insufficient' } });
    await E.closeBrain();
    // 裁决提交后 head 变了、CI 再绿 → 第 2 轮 QA
    const newHead = git(sb.origin, 'rev-parse', BRANCH).trim();
    judge.mode = 'pass';
    r = await go(green({ prs: [pr({ headRefOid: newHead })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls().at(-1)).toMatchObject({ round: 2, judge_feedback: `${SPRINT}/06-judge-r1.md` });
    expect(state().passed).toBe(true);
  });

  it('裁判判合同没覆盖需求（contract_gap）→ 升级给 coding commander，不自动修、不合并', async () => {
    judge.mode = 'contract';
    const r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toContain('[coding-qa][P1]');
    expect(state().escalated).toMatchObject({ type: 'judge_contract_gap', issues: ['J-1'] });
    expect(originLog()[0]).toBe('docs(qa): 第 1 轮真人 QA PASS，独立裁判 FAIL');
    expect(ghCalls().some((a) => a[1] === 'merge')).toBe(false);
    expect(brainQa().at(-1).escalations).toEqual([expect.objectContaining({ type: 'judge_contract_gap', pr: 77 })]);
  });

  it('裁判调用失败 → QA 报告照常提交（裁判待定），不合并；下一轮只重跑裁判（不重跑 QA），PASS 后提交裁决并批准', async () => {
    judge.mode = 'http500';
    let r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(originLog()[0]).toBe('docs(qa): 第 1 轮真人 QA PASS，独立裁判待定');
    expect(ghCalls().some((a) => a[1] === 'merge')).toBe(false);
    expect(state()).toMatchObject({ judge_pending: true, judge_bad: 1 });
    await E.closeBrain();
    judge.mode = 'pass';
    const newHead = git(sb.origin, 'rev-parse', BRANCH).trim();
    r = await go(green({ prs: [pr({ headRefOid: newHead })], required: { 77: [{ name: 'ci-passed', bucket: 'pending' }] } }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()).toHaveLength(1);
    expect(originLog()[0]).toBe('docs(qa): 第 1 轮独立裁判 PASS');
    expect(ghCalls().some((a) => a[1] === 'merge')).toBe(false);
    expect(state()).toMatchObject({
      passed: true, judge_pending: false, judge_bad: 0, approved: { head: git(sb.origin, 'rev-parse', BRANCH).trim() }, rounds: [{ judge: { verdict: 'PASS' } }],
    });
  });

  it('裁判连续 3 次不可用/输出不合格 → 升级 qa_judge_unavailable', async () => {
    addToBranch(`${SPRINT}/05-qa-report-r1.md`, '# QA 报告 第 1 轮 pass\n');
    seedState({ rounds: [{ round: 1, head: 'a'.repeat(40), verdict: 'PASS', fails: 0, report: `${SPRINT}/05-qa-report-r1.md`, judge: { state: 'error' } }], judge_pending: true, judge_bad: 2 });
    judge.mode = 'garbage';
    const r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()).toEqual([]);
    expect(judge.calls).toHaveLength(1);
    expect(state().escalated).toMatchObject({ type: 'qa_judge_unavailable', reason: 'judge_output_invalid' });
  });

  // 审计 #32：裁判是合并的必要条件，关掉裁判不能变成「QA PASS 就合并」
  // 审计 #43：裁判必须看到完整改动；超过上限不截断照判，直接升级
  it('PR 改动超过裁判上限 → 不调裁判、不批准，升级 judge_input_truncated', async () => {
    addToBranch('src/huge.js', `${'x'.repeat(151000)}\n`);
    const r = await go(green({ prs: [pr({ headRefOid: git(sb.origin, 'rev-parse', BRANCH).trim() })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(judge.calls).toEqual([]);
    expect(state().passed).toBeFalsy();
    expect(state().escalated).toMatchObject({ type: 'judge_input_truncated' });
  });

  // 审计 #41：「完成但有疑虑」要可见——裁判的建议级问题写进 Brain result.qa.concerns
  it('裁判 PASS 但有建议级问题 → 照常批准，Brain result.qa.concerns 列出', async () => {
    judge.mode = 'pass-concern';
    const r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(state().passed).toBe(true);
    expect(brainQa().at(-1).qa.concerns).toEqual([expect.objectContaining({ id: 'J-1', severity: '建议', detail: '错误提示可以更具体' })]);
  });

  it('CODING_WF_JUDGE=0：QA PASS 也不批准，升级 judge_disabled 交人审', async () => {
    const r = await go(green(), { extra: { CODING_WF_JUDGE: '0' } });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(judge.calls).toEqual([]);
    expect(originLog()[0]).toBe('docs(qa): 第 1 轮真人 QA PASS');
    expect(r.stderr).toContain('[coding-qa][P1]');
    expect(state().passed).toBeFalsy();
    expect(state().escalated).toMatchObject({ type: 'judge_disabled' });
  });

  it('QA FAIL：报告提交 → 开发按报告修复提交 → 推送；不开自动合并；修复 prompt 带报告路径与失败条目', async () => {
    const r = await go(green(), { mode: 'fail' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(originLog().slice(0, 2)).toEqual(['fix(ci): 修复 CI 失败', 'docs(qa): 第 1 轮真人 QA FAIL']);
    expect(ghCalls().some((a) => a[1] === 'merge')).toBe(false);
    expect(state().rounds).toEqual([expect.objectContaining({ round: 1, verdict: 'FAIL', fails: 1, fix: 'pushed' })]);
    const prompt = fs.readFileSync(files.prompt, 'utf8');
    expect(prompt).toContain(`${SPRINT}/05-qa-report-r1.md`);
    expect(prompt).toContain('T-1');
  });

  it('必需检查还没出结果 / 有失败 / 已 passed / 同一 head 已验过 FAIL：不跑 QA', async () => {
    for (const [gh, seed] of [
      [green({ required: { 77: [{ name: 'ci-passed', bucket: 'pending' }] } }), null],
      [green({ required: { 77: [{ name: 'ci-passed', bucket: 'fail' }] } }), null],
      // 4ac5fa39 首跑实证：ci-passed 还没登记出来时只有 Harness 门是绿的，不能当成「必需检查全绿」
      [green({ required: { 77: [{ name: 'Harness V5 Gate Passed', bucket: 'pass' }] }, requiredContexts: ['ci-passed', 'Harness V5 Gate Passed'] }), null],
      [green({ rulesetContexts: ['Smoke Glob Runner Passed'] }), null],
      [green({ requiredContextsFail: true }), null],
      [green(), { passed: true, rounds: [] }],
      [green(), { rounds: [{ round: 1, head, verdict: 'FAIL', fails: 1, fix: 'no_commit' }] }],
    ]) {
      if (seed) seedState(seed); else fs.rmSync(statePath(), { force: true });
      const r = await go(gh, { extra: { CODING_WF_CIFIX: '0' } });
      expect(r.exitCode, r.stderr).toBe(0);
      expect(qaCalls()).toEqual([]);
      await E.closeBrain();
    }
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

  it('失败数连续 3 轮不降（不收敛）→ 升级，不再自动修', async () => {
    // 假 evaluate 每轮 1 个失败：1 → 1 → 1 连续 3 轮不降
    seedState({ rounds: [{ round: 1, head: 'a'.repeat(40), verdict: 'FAIL', fails: 1 }, { round: 2, head: 'b'.repeat(40), verdict: 'FAIL', fails: 1 }] });
    const r = await go(green(), { mode: 'fail' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()[0].round).toBe(3);
    expect(state().escalated).toMatchObject({ type: 'qa_stalled' });
    expect(originLog()[0]).toBe('docs(qa): 第 3 轮真人 QA FAIL');
  });

  it('评估会话连续 3 次出错 → 升级；致命错误立刻升级', async () => {
    seedState({ rounds: [], bad: 2 });
    let r = await go(green(), { mode: 'retry' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(state().escalated).toMatchObject({ type: 'qa_evaluator_broken', reason_code: 'preview_unavailable' });
    fs.rmSync(statePath(), { force: true });
    await E.closeBrain();
    r = await go(green(), { mode: 'fatal' });
    // 升级记录带上触发的证据（金丝雀 3e8414f6：只有原因码、无从判断真越界还是误判）；evaluate 拿到落盘执行记录的路径
    expect(state().escalated).toMatchObject({
      type: 'qa_evaluator_broken', reason_code: 'evaluate_touched_production',
      evidence: [{ commands: ['curl -s http://localhost:5221/api/brain/tasks'] }],
      transcript: path.join(sb.logDir, 'qa-77-r1.jsonl'),
    });
    expect(qaCalls().at(-1).transcript_path).toBe(path.join(sb.logDir, 'qa-77-r1.jsonl'));
  });

  // 审计 #33：评估报告不合格（金丝雀 #6160：T-5 的命令执行记录里查不到）→ 下一次评估带上次的问题；通过后清掉
  it('评估出错 → 记下原因；下一次 evaluate 拿到 prev_errors；评估成功后清掉', async () => {
    let r = await go(green(), { mode: 'unverified' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()[0].prev_errors).toBeUndefined();
    expect(state().last_eval_error).toMatchObject({ reason_code: 'qa_evidence_unverified' });
    await E.closeBrain();
    r = await go(green(), { mode: 'pass' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls().at(-1).prev_errors).toContain('qa_evidence_unverified');
    expect(qaCalls().at(-1).prev_errors).toContain('T-5');
    expect(state().last_eval_error).toBeUndefined();
  });

  // 审计 #38/#19：验不了 ≠ 产品不合格——不进修复环（否则无限修），报告照常提交，升级给 coding commander 带上验不了的条目
  it('QA 报告 CANNOT_VERIFY → 报告提交、不修代码、不批准，升级 qa_cannot_verify（带条目与原因）', async () => {
    const r = await go(green(), { mode: 'cannot' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(originLog()[0]).toBe('docs(qa): 第 1 轮真人 QA CANNOT_VERIFY');
    expect(state()).toMatchObject({ escalated: { type: 'qa_cannot_verify', cannot_verify: [{ id: 'T-2', reason: '工具缺失：预览环境没有 ffprobe' }] } });
    expect(state().passed).toBeFalsy();
    expect(r.stderr).toContain('[coding-qa][P1]');
  });

  // 审计 #35：QA 门里 evaluate 会话的花费累加进状态（随状态同步进 Brain，合并时汇总）
  it('每轮 evaluate 的花费累加进状态 cost_usd', async () => {
    const r = await go(green(), { mode: 'fail' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(state().cost_usd).toBeGreaterThanOrEqual(0.5);
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
