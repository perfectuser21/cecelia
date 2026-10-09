// evaluate 活动（evaluator 真人 QA）：查 PR 预览环境 → 全新会话黑盒验收（看不到 03/04）→ 05-qa-report-rN.md → 程序判。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runActivityProcess } from './helpers/run-activity.mjs';
import { gitPlain } from './helpers/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, '../activities/evaluate.mjs');
const FAKE = path.join(HERE, 'fixtures/fake-claude-eval.mjs');
const TASK_ID = '11111111-2222-3333-4444-555555555555';
const INTENT_MD = `---\ntask_id: ${TASK_ID}\nstep: intent\nupstream: []\n---\n# 需求\n\n### I-1\n能查任务。\n`;
const SPEC_MD = `---\ntask_id: ${TASK_ID}\nstep: spec\nupstream: ["01-intent.md#I-1"]\n---\n# spec\n\n### S-1\n对应 I-1\n\n## QA 场景\n\n### Q-1\n对应: I-1\n操作: GET 任务\n期望: 200\n\n### Q-2\n对应: I-1\n操作: GET 不存在的任务\n期望: 404\n`;
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

describe('evaluate 活动（evaluator 真人 QA）', () => {
  let worktree;
  let server;
  let api;
  let preview = { status: 'active', port: 5302 };
  const sprint = () => path.join(worktree, 'sprints/s1');

  beforeAll(async () => {
    fs.chmodSync(FAKE, 0o755);
    server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (!preview) { res.statusCode = 404; return res.end('{}'); }
      return res.end(JSON.stringify({ pr_number: 77, ...preview }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    api = `http://127.0.0.1:${server.address().port}`;
  });
  beforeEach(() => {
    preview = { status: 'active', port: 5302 };
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'evaluate-test-'));
    gitPlain('init', '-q', worktree);
    fs.mkdirSync(sprint(), { recursive: true });
    fs.writeFileSync(path.join(sprint(), '01-intent.md'), INTENT_MD);
    fs.writeFileSync(path.join(sprint(), '02-spec.md'), SPEC_MD);
    fs.writeFileSync(path.join(sprint(), '03-build.md'), '开发自述\n');
    fs.writeFileSync(path.join(sprint(), '04-evidence.md'), '开发自测\n');
  });
  afterEach(() => fs.rmSync(worktree, { recursive: true, force: true }));

  const run = (mode, patch = {}, env = {}) => runActivityProcess(ENTRY, {
    run_tag: 'rt', task_id: TASK_ID, worktree, sprint_dir: 'sprints/s1', intent_ids: ['I-1'],
    intent_sha256: sha256(INTENT_MD), pr_number: 77, round: 1, ...patch,
  }, { CODING_WF_CLAUDE_BIN: FAKE, FAKE_EVAL_MODE: mode, CODING_WF_PREVIEW_API: api, CODING_WF_PREVIEW_WAIT_MS: '200', CODING_WF_PREVIEW_INTERVAL_MS: '20', ...env });

  it('全部 Q-n PASS → completed，qa.verdict PASS；用预览环境 URL；03/04 运行时被藏起、结束后放回', async () => {
    const r = await run('pass');
    expect(r.result.status, r.stderr).toBe('completed');
    expect(r.result.outputs).toMatchObject({
      qa_report_file: '05-qa-report-r1.md',
      qa: { verdict: 'PASS', round: 1, env: { kind: 'preview', url: 'http://localhost:5302' }, failed: [], blocking: [], cost_usd: 0.7 },
    });
    expect(r.stderr).toContain('FAKE_PREVIEW_URL: http://localhost:5302');
    expect(r.stderr).toContain('FAKE_HIDDEN_BUILD: true');
    expect(r.stderr).toContain('FAKE_HIDDEN_EVIDENCE: true');
    expect(fs.existsSync(path.join(sprint(), '03-build.md'))).toBe(true);
    expect(fs.existsSync(path.join(sprint(), '04-evidence.md'))).toBe(true);
  });

  it('上一轮独立裁判判 QA 没真验到：judge_feedback 指向的裁决交给 QA 补验；没有时写「无」；指向不存在/sprint 外 → fatal', async () => {
    fs.writeFileSync(path.join(sprint(), '06-judge-r1.md'), '# 独立裁判\n');
    let r = await run('pass', { judge_feedback: 'sprints/s1/06-judge-r1.md', round: 2 });
    expect(r.result.status, r.stderr).toBe('completed');
    expect(r.stderr).toContain(`FAKE_JUDGE_FEEDBACK: ${path.join(sprint(), '06-judge-r1.md')}`);
    r = await run('pass');
    expect(r.stderr).toContain('FAKE_JUDGE_FEEDBACK: 无');
    for (const bad of ['sprints/s1/06-judge-r9.md', 'package.json']) {
      r = await run('pass', { judge_feedback: bad });
      expect(r.result).toMatchObject({ status: 'failed', failure_class: 'fatal', reason_code: 'judge_feedback_invalid' });
    }
  });

  it('场景 FAIL / 阻断探索发现 → completed 但 qa.verdict FAIL，列出失败与发现（交给修复环）', async () => {
    let r = await run('fail');
    expect(r.result.outputs.qa).toMatchObject({ verdict: 'FAIL', failed: [expect.objectContaining({ id: 'T-2', covers: ['Q-2'] })] });
    r = await run('finding');
    expect(r.result.outputs.qa).toMatchObject({ verdict: 'FAIL', blocking: [expect.objectContaining({ id: 'X-1', severity: '阻断' })] });
  });

  it('拿单元测试当证据 → retryable qa_unit_test_evidence', async () => {
    const r = await run('unittest');
    expect(r.result.failure_class).toBe('retryable');
    expect(r.result.reason_code).toBe('qa_unit_test_evidence');
  });

  it('报告写了但没真跑 → retryable qa_evidence_unverified', async () => {
    const r = await run('fabricate');
    expect(r.result.reason_code).toBe('qa_evidence_unverified');
  });

  it('碰了生产 Brain → fatal evaluate_touched_production', async () => {
    const r = await run('prod');
    expect(r.result.failure_class).toBe('fatal');
    expect(r.result.reason_code).toBe('evaluate_touched_production');
  });

  it('漏测 Q-n → retryable qa_incomplete；报告没条目 → retryable qa_report_invalid', async () => {
    expect((await run('incomplete')).result.reason_code).toBe('qa_incomplete');
    expect((await run('badformat')).result.reason_code).toBe('qa_incomplete');
  });

  it('越界写 → fatal evaluate_out_of_scope_write', async () => {
    expect((await run('outside')).result.reason_code).toBe('evaluate_out_of_scope_write');
  });

  it('预览环境一直不 active / 不存在 → retryable preview_unavailable，不启动 claude', async () => {
    preview = { status: 'starting', port: 5302 };
    let r = await run('pass');
    expect(r.result.reason_code).toBe('preview_unavailable');
    expect(r.stderr).not.toContain('FAKE_PREVIEW_URL');
    preview = null;
    r = await run('pass');
    expect(r.result.reason_code).toBe('preview_unavailable');
  });

  it('规格没有 QA 场景 → fatal qa_missing', async () => {
    fs.writeFileSync(path.join(sprint(), '02-spec.md'), SPEC_MD.split('## QA 场景')[0]);
    expect((await run('pass')).result.reason_code).toBe('qa_missing');
  });

  it('prompt：真人 QA、黑盒、用预览环境、禁单元测试、禁碰 5221、探索式测试', () => {
    const p = fs.readFileSync(path.join(HERE, '../prompts/evaluate.md'), 'utf8');
    for (const s of ['真人', '黑盒', 'PREVIEW_URL', '单元测试', '5221', '探索', 'Playwright', '### T-n', '### X-n']) expect(p).toContain(s);
  });
});
