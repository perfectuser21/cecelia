// run-once.mjs 的 QA 门（evaluator 真人 QA，CI 绿后、合并前）：假 Brain、临时 origin 上的 cw PR、假 gh、假预览 API、假 evaluate、假修复 claude。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { git } from '../../__tests__/helpers/git.mjs';
import { FAKE_EXECUTOR, startFakeBrain, codingTask, makeSandbox, runnerEnv, runOnceProcess, readJsonLines } from './helpers/sandbox.mjs';
import { loadConfig } from '../lib/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_GH_CI = path.join(HERE, 'fixtures/fake-gh-ci.mjs');
const FAKE_EVALUATE = path.join(HERE, 'fixtures/fake-evaluate.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude-cifix.mjs');
const TASK = 'c954ebfd-469f-4006-a95f-b277fa6564f6';
const BRANCH = 'cp-10091835-cw-c954ebfd';
const SPRINT = 'sprints/10091835-cw-c954ebfd';
const INTENT = `---\ntask_id: ${TASK}\nstep: intent\nupstream: []\n---\n# x\n\n### I-1\n验收\n`;
const JUDGE_ISSUE = (type) => ({ id: 'J-1', type, severity: '阻断', covers: ['I-1'], detail: `${type} 问题`, where: 'src/feature.js:1' });
const JUDGE_REPLY = {
  pass: { coverage: [{ intent: 'I-1', satisfied: true, evidence: 'T-1 真实输出' }], issues: [], summary: 'ok' },
  ...Object.fromEntries([['product', 'product'], ['qa_gap', 'qa_gap'], ['contract', 'contract_gap']].map(([mode, type]) => [mode, {
    coverage: [{ intent: 'I-1', satisfied: false, evidence: '见 J-1' }], issues: [JUDGE_ISSUE(type)], summary: 'no',
  }])),
};

describe('runner QA 门（evaluator 真人 QA）', () => {
  let sb;
  let brain;
  let preview;
  let judge;
  let head;
  const files = {};

  beforeAll(async () => {
    for (const f of [FAKE_GH_CI, FAKE_EVALUATE, FAKE_CLAUDE, FAKE_EXECUTOR]) fs.chmodSync(f, 0o755);
  });

  beforeEach(async () => {
    sb = makeSandbox();
    git(sb.seed, 'checkout', '-q', '-b', BRANCH);
    fs.mkdirSync(path.join(sb.seed, SPRINT), { recursive: true });
    fs.writeFileSync(path.join(sb.seed, SPRINT, '01-intent.md'), INTENT);
    fs.writeFileSync(path.join(sb.seed, SPRINT, '02-spec.md'), '### S-1\n\n## QA 场景\n\n### Q-1\n对应: I-1\n操作: x\n期望: y\n');
    fs.mkdirSync(path.join(sb.seed, 'src'), { recursive: true });
    fs.writeFileSync(path.join(sb.seed, 'src/feature.js'), 'export const MARKER_CODE = 1;\n');
    git(sb.seed, 'add', '.');
    git(sb.seed, 'commit', '-q', '-m', 'feat: cw');
    git(sb.seed, 'push', '-q', 'origin', BRANCH);
    head = git(sb.seed, 'rev-parse', 'HEAD').trim();
    git(sb.clone, 'config', 'core.hooksPath', path.join(sb.root, 'no-hooks'));
    files.gh = path.join(sb.root, 'gh-ci.json');
    files.qaLog = path.join(sb.root, 'qa.log');
    files.prompt = path.join(sb.root, 'prompt.txt');
    preview = { status: { 77: { status: 'active', port: 5302 } }, start: 200, calls: [] };
    preview.server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        preview.calls.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, raw });
        res.setHeader('content-type', 'application/json');
        const st = /\/api\/brain\/preview\/status\/(\d+)$/.exec(req.url);
        if (st) {
          const p = preview.status[st[1]];
          if (!p) { res.statusCode = 404; return res.end('{}'); }
          return res.end(JSON.stringify({ pr_number: Number(st[1]), ...p }));
        }
        if (req.url === '/api/brain/preview/start') { res.statusCode = preview.start; return res.end(JSON.stringify({ port: 5309, reason: 'disk' })); }
        if (/\/api\/brain\/preview\/stop\/\d+$/.test(req.url)) return res.end('{"ok":true}');
        res.statusCode = 404;
        return res.end('{}');
      });
    });
    await new Promise((r) => preview.server.listen(0, '127.0.0.1', r));
    preview.api = `http://127.0.0.1:${preview.server.address().port}`;
    // 假独立裁判（OpenAI 兼容 chat/completions）：按 judge.mode 回放
    judge = { mode: 'pass', calls: [] };
    judge.server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => { raw += d; });
      req.on('end', () => {
        judge.calls.push({ url: req.url, auth: req.headers.authorization ?? null, body: JSON.parse(raw || '{}') });
        if (judge.mode === 'http500') { res.statusCode = 500; return res.end('boom'); }
        const content = judge.mode === 'garbage' ? '我觉得没问题' : JSON.stringify(JUDGE_REPLY[judge.mode]);
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 1234 } }));
      });
    });
    await new Promise((r) => judge.server.listen(0, '127.0.0.1', r));
    judge.api = `http://127.0.0.1:${judge.server.address().port}/v1`;
  });

  afterEach(async () => {
    if (brain) await brain.close();
    brain = null;
    await new Promise((r) => preview.server.close(r));
    await new Promise((r) => judge.server.close(r));
    sb.cleanup();
  });

  const pr = (extra = {}) => ({ number: 77, headRefName: BRANCH, headRefOid: head, url: 'https://github.com/x/y/pull/77', isDraft: false, ...extra });
  const green = (extra = {}) => ({ prs: [pr()], required: { 77: [{ name: 'ci-passed', bucket: 'pass' }] }, checks: { 77: [] }, ...extra });
  const go = async (ghState, { mode = 'pass', extra = {}, tasks = [] } = {}) => {
    fs.writeFileSync(files.gh, JSON.stringify(ghState));
    brain = await startFakeBrain({ tasks });
    return runOnceProcess(runnerEnv(sb, brain.url, {
      CODING_WF_QA_GATE: '1',
      CODING_WF_GH_BIN: FAKE_GH_CI,
      FAKE_GH_CI: files.gh,
      CODING_WF_EVALUATE: FAKE_EVALUATE,
      FAKE_QA_MODE: mode,
      FAKE_QA_LOG: files.qaLog,
      CODING_WF_PREVIEW_API: preview.api,
      DEPLOY_TOKEN: 'tok-1',
      CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CIFIX_MODE: 'fix',
      FAKE_CIFIX_PROMPT: files.prompt,
      CODING_WF_JUDGE_API: judge.api,
      CODING_WF_JUDGE_MODEL: 'judge-m',
      CODING_WF_JUDGE_CREDS: path.join(sb.root, 'no-creds.env'),
      TOAPIS_API_KEY: 'jk',
      ...extra,
    }));
  };
  // 往 PR 分支追加一个文件（模拟上一轮已提交的 QA 报告）
  const addToBranch = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(sb.seed, rel)), { recursive: true });
    fs.writeFileSync(path.join(sb.seed, rel), content);
    git(sb.seed, 'add', '.');
    git(sb.seed, 'commit', '-q', '-m', `docs: ${rel}`);
    git(sb.seed, 'push', '-q', 'origin', BRANCH);
  };
  const statePath = () => path.join(sb.logDir, 'qa-77.json');
  const state = () => JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  const seedState = (s) => { fs.mkdirSync(sb.logDir, { recursive: true }); fs.writeFileSync(statePath(), JSON.stringify(s)); };
  const qaCalls = () => readJsonLines(files.qaLog);
  const ghCalls = () => readJsonLines(sb.ghLog);
  const originLog = () => git(sb.origin, 'log', '--format=%s', BRANCH).trim().split('\n');
  const brainQa = () => brain.patches.filter((p) => p.id === TASK).map((p) => p.body.result);

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
    expect(brain.patches.some((p) => p.id.startsWith('dddddddd'))).toBe(false);
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
    await brain.close();
    brain = null;
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
    await brain.close();
    brain = null;
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

  it('CODING_WF_JUDGE=0：QA PASS 直接批准（不调裁判）', async () => {
    const r = await go(green(), { extra: { CODING_WF_JUDGE: '0' } });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(judge.calls).toEqual([]);
    expect(originLog()[0]).toBe('docs(qa): 第 1 轮真人 QA PASS');
    expect(state()).toMatchObject({ passed: true, approved: { head: git(sb.origin, 'rev-parse', BRANCH).trim() } });
  });

  // 合并门（决策 a1fdbc51）：runner 亲自合并，且只合并「被批准的那个 head」——必需检查全部登记全绿 + QA 与裁判在该 head 上通过。
  // 批准后分支上再出现的提交：只是记录（changes/ 碎片、sprints/ 验收记录）或从 main 合进来的 merge 提交 → 改绑到新 head；
  // 动了别的文件 → 撤销批准，新 head 重新 QA + 裁判。
  describe('合并门（绑定 head SHA）', () => {
    const approve = (h = git(sb.origin, 'rev-parse', BRANCH).trim()) => seedState({ passed: true, approved: { head: h, round: 1 }, rounds: [{ round: 1, head: 'a'.repeat(40), verdict: 'PASS', fails: 0 }] });
    const remoteHead = () => git(sb.origin, 'rev-parse', BRANCH).trim();
    const mergeCalls = () => ghCalls().filter((a) => a[1] === 'merge');

    it('批准的 head 上必需检查全部登记全绿 → gh pr merge --squash --match-head-commit <该 head>；记 merged', async () => {
      approve();
      const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })] }));
      expect(r.exitCode, r.stderr).toBe(0);
      expect(mergeCalls()).toEqual([['pr', 'merge', '77', '--squash', '--match-head-commit', remoteHead()]]);
      expect(state()).toMatchObject({ merged: { head: remoteHead() } });
      expect(qaCalls()).toEqual([]);
    });

    it('必需检查未全部登记 / 还在跑 / 有红 → 不合并', async () => {
      for (const gh of [
        green({ prs: [pr({ headRefOid: remoteHead() })], requiredContexts: ['ci-passed', 'Smoke Glob Runner Passed'] }),
        green({ prs: [pr({ headRefOid: remoteHead() })], required: { 77: [{ name: 'ci-passed', bucket: 'pending' }] } }),
        green({ prs: [pr({ headRefOid: remoteHead() })], required: { 77: [{ name: 'ci-passed', bucket: 'fail' }] } }),
      ]) {
        approve();
        const r = await go(gh, { extra: { CODING_WF_CIFIX: '0' } });
        expect(r.exitCode, r.stderr).toBe(0);
        expect(mergeCalls()).toEqual([]);
        await brain.close();
        brain = null;
      }
    });

    it('批准后分支上出现改代码的提交 → 撤销批准、不合并（新 head 重新 QA）', async () => {
      const approvedHead = remoteHead();
      approve(approvedHead);
      addToBranch('src/feature.js', 'export const MARKER_CODE = 2;\n');
      const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })] }));
      expect(r.exitCode, r.stderr).toBe(0);
      expect(mergeCalls()).toEqual([]);
      // 撤销本身算本轮动作：同一轮不立刻重跑 QA
      expect(qaCalls()).toEqual([]);
      expect(state()).toMatchObject({ passed: false, revoked: [expect.objectContaining({ reason: 'head_changed_after_approval', from: approvedHead, files: ['src/feature.js'] })] });
    });

    it('记录范围只认本 PR 的版本碎片与本 sprint 的 QA 报告/裁决/截图：批准后改 01 需求、或写别的 sprint → 撤销批准', async () => {
      for (const rel of [`${SPRINT}/01-intent.md`, 'sprints/other-sprint/x.md', 'changes/sub/x.md']) {
        approve();
        addToBranch(rel, `改了 ${rel}\n`);
        const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })] }));
        expect(r.exitCode, r.stderr).toBe(0);
        expect(mergeCalls(), rel).toEqual([]);
        expect(state().passed, rel).toBe(false);
        await brain.close();
        brain = null;
        fs.rmSync(sb.ghLog, { force: true });
      }
    });

    it('批准后补的是本 sprint 的 QA 报告/裁决/截图 → 改绑并合并', async () => {
      approve();
      addToBranch(`${SPRINT}/05-qa-report-r2.md`, '# r2\n');
      addToBranch(`${SPRINT}/06-judge-r2.md`, '# j2\n');
      addToBranch(`${SPRINT}/qa-r2/a.png`, 'png');
      const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })] }));
      expect(r.exitCode, r.stderr).toBe(0);
      expect(mergeCalls()).toEqual([['pr', 'merge', '77', '--squash', '--match-head-commit', remoteHead()]]);
    });

    it('批准后只补了 changes/ 碎片 → 改绑新 head 并按新 head 合并', async () => {
      approve();
      addToBranch('changes/frag.md', '## Brain {VERSION} — x\n');
      const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })] }));
      expect(r.exitCode, r.stderr).toBe(0);
      expect(mergeCalls()).toEqual([['pr', 'merge', '77', '--squash', '--match-head-commit', remoteHead()]]);
      expect(state()).toMatchObject({ passed: true, approved: { head: remoteHead() } });
    });

    it('批准后只是把 main 合进分支（merge 提交）→ 不算 PR 自身改动，改绑并合并', async () => {
      approve();
      git(sb.seed, 'checkout', '-q', 'main');
      fs.writeFileSync(path.join(sb.seed, 'other.txt'), 'main moved\n');
      git(sb.seed, 'add', '.');
      git(sb.seed, 'commit', '-q', '-m', 'chore: main moved');
      git(sb.seed, 'push', '-q', 'origin', 'main');
      git(sb.seed, 'checkout', '-q', BRANCH);
      git(sb.seed, 'merge', '-q', '--no-edit', 'main');
      git(sb.seed, 'push', '-q', 'origin', BRANCH);
      const r = await go(green({ prs: [pr({ headRefOid: remoteHead() })] }));
      expect(r.exitCode, r.stderr).toBe(0);
      expect(mergeCalls()).toEqual([['pr', 'merge', '77', '--squash', '--match-head-commit', remoteHead()]]);
    });
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
      await brain.close();
      brain = null;
    }
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
    await brain.close();
    brain = null;
    r = await go(green(), { mode: 'fatal' });
    expect(state().escalated).toMatchObject({ type: 'qa_evaluator_broken', reason_code: 'evaluate_touched_production' });
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
  });
});
