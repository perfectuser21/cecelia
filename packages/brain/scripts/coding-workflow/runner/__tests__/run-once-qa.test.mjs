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

describe('runner QA 门（evaluator 真人 QA）', () => {
  let sb;
  let brain;
  let preview;
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
  });

  afterEach(async () => {
    if (brain) await brain.close();
    brain = null;
    await new Promise((r) => preview.server.close(r));
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
      ...extra,
    }));
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
  });

  it('CI 绿 + 预览 active + QA PASS：evaluate 拿到 sprint/I-n/01 哈希/轮次；QA 报告提交推送；开自动合并；记 passed；回写 Brain；本轮不认领新任务', async () => {
    const r = await go(green(), { tasks: [codingTask('dddddddd-0000-4000-8000-000000000004')] });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(qaCalls()).toEqual([expect.objectContaining({
      pr_number: 77, round: 1, task_id: TASK, sprint_dir: SPRINT, intent_ids: ['I-1'],
      intent_sha256: crypto.createHash('sha256').update(INTENT).digest('hex'),
    })]);
    expect(originLog()[0]).toBe('docs(qa): 第 1 轮真人 QA PASS');
    expect(git(sb.origin, 'show', '--name-only', '--format=', BRANCH).trim()).toBe(`${SPRINT}/05-qa-report-r1.md`);
    expect(ghCalls()).toContainEqual(['pr', 'merge', '77', '--auto', '--squash']);
    expect(state()).toMatchObject({ passed: true, rounds: [{ round: 1, head, verdict: 'PASS' }] });
    expect(brainQa().at(-1).qa).toMatchObject({ verdict: 'PASS', rounds: 1 });
    expect(brain.patches.some((p) => p.id.startsWith('dddddddd'))).toBe(false);
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
    seedState({ rounds: [{ round: 1, head: 'a'.repeat(40), verdict: 'FAIL', fails: 2 }, { round: 2, head: 'b'.repeat(40), verdict: 'FAIL', fails: 2 }] });
    fs.writeFileSync(path.join(sb.root, 'unused'), '');
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
