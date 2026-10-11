// C2c：runner 固化的 cw-*-qa-smoke.sh 在 PR 的 Smoke Glob Runner 首跑失败 → runner 从 CI 日志 `FAIL: T-n` 定位失败条目、
// 剔除后重新固化一次（最多一次，smoke_note 留痕）；不派修复会话（它无权改 smoke，只会撞 protected_path 升级）。
// 剔除后零固化：API 类 PR 走 qa_smoke_missing（决策 4fe863c3）。
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../../__tests__/helpers/git.mjs';
import { startFakeBrain, makeSandbox, runnerEnv, runOnceProcess } from './helpers/sandbox.mjs';
import { buildQaSmoke } from '../../lib/qa-smoke.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_GH_CI = path.join(HERE, 'fixtures/fake-gh-ci.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude-cifix.mjs');
const TASK = 'c954ebfd-469f-4006-a95f-b277fa6564f6';
const BRANCH = 'cp-10081835-cw-c954ebfd';
const SPRINT = 'sprints/10081835-cw-c954ebfd';
const NAME = 'cw-c954ebfd-qa-smoke.sh';
const SMOKE = `packages/brain/scripts/smoke/${NAME}`;
const ALLOW = 'packages/quality/smoke-allowlist.txt';
const PREVIEW = 'http://localhost:5301';
const JOB = (id) => `https://github.com/perfectuser21/cecelia/actions/runs/9/job/${id}`;
const F = '```';
const reportOf = (ids) => `---\ntask_id: x\nstep: evaluate\nupstream: ["02-spec.md#Q-1"]\n---\n# QA 报告\n\n${
  ids.map((id, i) => `### ${id}\n对应: Q-${i + 1}\nverdict: PASS\n${F}command\ncurl -s ${PREVIEW}/api/brain/x${i} | jq -e '.ok'\n${F}\n${F}output\nok\n${F}\n`).join('\n')}`;

// Smoke Glob Runner job 日志（带 Actions 时间戳，同 gh api jobs/<id>/logs）
const ts = (lines) => lines.map((l, i) => `2026-10-12T01:00:${String(i).padStart(2, '0')}.1234567Z ${l}`).join('\n');
const smokeLog = (name, body) => ts(['🔬 Smoke Ratchet Gate', '── ▶  aaa-smoke.sh', '── ✅ PASS: aaa-smoke.sh', `── ▶  ${name}`, ...body,
  `::error::❌ BASELINE FAIL (exit 1): ${name}`, '❌ GATE FAILED']);

describe('runner：QA 回归 smoke 在 CI 首跑失败，剔除失败条目重新固化一次（C2c）', () => {
  let sb;
  let brain;
  let head;

  beforeAll(() => {
    fs.chmodSync(FAKE_GH_CI, 0o755);
    fs.chmodSync(FAKE_CLAUDE, 0o755);
  });

  afterEach(async () => {
    if (brain) await brain.close();
    brain = null;
    sb?.cleanup();
  });

  /** PR 分支：sprint 链 + runner 固化的 smoke（items 条）+ allowlist 登记；api=true 时改了 API 面。 */
  const seed = ({ items = ['T-1', 'T-2', 'T-3'], api = false } = {}) => {
    sb = makeSandbox();
    git(sb.seed, 'checkout', '-q', '-b', BRANCH);
    fs.mkdirSync(path.join(sb.seed, SPRINT), { recursive: true });
    fs.writeFileSync(path.join(sb.seed, SPRINT, '01-intent.md'), `---\ntask_id: ${TASK}\nstep: intent\nupstream: []\n---\n# x\n\n### I-1\n验收\n`);
    const smoke = buildQaSmoke({ taskId: TASK, previewUrl: PREVIEW, reportText: reportOf(items) });
    fs.mkdirSync(path.join(sb.seed, path.dirname(SMOKE)), { recursive: true });
    fs.writeFileSync(path.join(sb.seed, SMOKE), smoke.content, { mode: 0o755 });
    fs.mkdirSync(path.join(sb.seed, 'packages/quality'), { recursive: true });
    fs.writeFileSync(path.join(sb.seed, ALLOW), `base-smoke.sh\n${NAME}\n`);
    if (api) {
      fs.mkdirSync(path.join(sb.seed, 'packages/brain/src/routes'), { recursive: true });
      fs.writeFileSync(path.join(sb.seed, 'packages/brain/src/routes/x.js'), 'export default 1;\n');
    }
    git(sb.seed, 'add', '.');
    git(sb.seed, 'commit', '-q', '-m', 'feat: cw + qa smoke');
    git(sb.seed, 'push', '-q', 'origin', BRANCH);
    head = git(sb.seed, 'rev-parse', 'HEAD').trim();
    git(sb.clone, 'config', 'core.hooksPath', path.join(sb.root, 'no-hooks'));
    fs.mkdirSync(sb.logDir, { recursive: true });
    fs.writeFileSync(path.join(sb.logDir, 'qa-77.json'), JSON.stringify({
      passed: true, approved: { head, round: 1, at: '2026-10-12T00:00:00.000Z' },
      rounds: [{ round: 1, head, verdict: 'PASS', fails: 0, report: `${SPRINT}/05-qa-report-r1.md`, env_url: PREVIEW, judge: { verdict: 'PASS' } }],
      smoke: { round: 1, file: SMOKE, items, at: '2026-10-12T00:00:00.000Z' },
      smoke_note: `第 1 轮固化 ${SMOKE}（${items.join(',')}）`,
    }));
  };

  const ghState = (logBody, extra = {}) => ({
    prs: [{ number: 77, headRefName: BRANCH, headRefOid: head, url: 'https://github.com/x/y/pull/77', isDraft: false }],
    required: { 77: [{ name: 'ci-passed', bucket: 'fail' }, { name: 'Smoke Glob Runner Passed', bucket: 'fail' }] },
    checks: { 77: [
      { name: 'Smoke Glob Runner', bucket: 'fail', link: JOB(5001) },
      { name: 'Smoke Glob Runner Passed', bucket: 'fail', link: JOB(5002) },
      { name: 'ci-passed', bucket: 'fail', link: JOB(5003) },
    ] },
    logs: { 5001: logBody, 5002: '❌ smoke-glob-runner 未成功完成（result=failure）', 5003: 'ci-passed failed' },
    ...extra,
  });

  const go = async (state) => {
    const file = path.join(sb.root, 'gh-ci.json');
    fs.writeFileSync(file, JSON.stringify(state));
    brain = await startFakeBrain({ tasks: [{ id: TASK, status: 'completed', result: {} }] });
    return runOnceProcess(runnerEnv(sb, brain.url, {
      CODING_WF_CIFIX: '1', CODING_WF_GH_BIN: FAKE_GH_CI, FAKE_GH_CI: file,
      CODING_WF_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CIFIX_MODE: 'tamper-smoke', FAKE_CIFIX_PROMPT: path.join(sb.root, 'prompt.txt'),
    }));
  };
  const remoteHead = () => git(sb.origin, 'rev-parse', BRANCH).trim();
  const remoteFile = (rel) => {
    try {
      return git(sb.origin, 'show', `${BRANCH}:${rel}`);
    } catch {
      return null;
    }
  };
  const qa = () => JSON.parse(fs.readFileSync(path.join(sb.logDir, 'qa-77.json'), 'utf8'));
  const cifix = () => {
    const p = path.join(sb.logDir, 'cifix-77.json');
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { attempts: [] };
  };
  const sessionRan = () => fs.existsSync(path.join(sb.root, 'prompt.txt'));

  it('首跑 T-2 失败 → runner 剔除 T-2 重新固化并推送（不派修复会话、不计 CI 修复尝试）；smoke_note 留痕，批准改绑到新 head', async () => {
    seed();
    const r = await go(ghState(smokeLog(NAME, ['== T-1（对应 Q-1）', '== T-2（对应 Q-2）', 'FAIL: T-2'])));
    expect(r.exitCode, r.stderr).toBe(0);

    expect(sessionRan()).toBe(false);
    const now = remoteHead();
    expect(now).not.toBe(head);
    expect(git(sb.origin, 'merge-base', '--is-ancestor', head, BRANCH)).toBe('');
    expect(git(sb.origin, 'log', '-1', '--format=%an', BRANCH).trim()).toBe('coding-workflow-runner');
    const script = remoteFile(SMOKE);
    expect(script).toContain('FAIL: T-1');
    expect(script).toContain('FAIL: T-3');
    expect(script).not.toContain('T-2');
    expect(remoteFile(ALLOW)).toContain(NAME);

    const s = qa();
    expect(s.smoke).toMatchObject({ file: SMOKE, items: ['T-1', 'T-3'] });
    expect(s.smoke_refit).toMatchObject({ removed: ['T-2'], items: ['T-1', 'T-3'], from: head, to: now });
    expect(s.smoke_note).toContain('CI 首跑');
    expect(s.smoke_note).toContain('T-2(ci_failed)');
    expect(s).toMatchObject({ passed: true, approved: { head: now, rebound_from: head } });
    expect(s.escalated).toBeUndefined();

    expect(cifix().attempts).toEqual([]);
    expect(cifix().escalated).toBeUndefined();
    const qaPatch = brain.patches.filter((p) => p.id === TASK && p.body.result?.qa).at(-1);
    expect(qaPatch.body.result.qa.smoke_note).toContain('T-2(ci_failed)');
    expect(brain.spans.map((x) => x.occurrence_key)).toContain('ci_fix:77:smoke_refit');
  });

  it('已剔除过一次、smoke 仍红 → 不再剔、不派修复会话，升级 ci_fix_exhausted（qa_smoke_refit_exhausted）', async () => {
    seed();
    const s = qa();
    fs.writeFileSync(path.join(sb.logDir, 'qa-77.json'), JSON.stringify({ ...s, smoke_refit: { removed: ['T-4'], items: ['T-1', 'T-2', 'T-3'], at: 'x' } }));
    const r = await go(ghState(smokeLog(NAME, ['== T-1（对应 Q-1）', 'FAIL: T-1'])));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(sessionRan()).toBe(false);
    expect(remoteHead()).toBe(head);
    expect(cifix().escalated).toMatchObject({ type: 'ci_fix_exhausted', reason: 'qa_smoke_refit_exhausted' });
  });

  it('本 PR 的 smoke 失败但日志里定位不到 FAIL: T-n → 不派修复会话，升级 ci_fix_exhausted（qa_smoke_fail_unlocated）', async () => {
    seed();
    const r = await go(ghState(smokeLog(NAME, ['line 3: syntax error'])));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(sessionRan()).toBe(false);
    expect(remoteHead()).toBe(head);
    expect(cifix().escalated).toMatchObject({ type: 'ci_fix_exhausted', reason: 'qa_smoke_fail_unlocated' });
  });

  it('剔除后零固化且 PR 改了 API 面 → 删脚本、撤 allowlist 登记并推送，撤销批准，升级 qa_smoke_missing（决策 4fe863c3）', async () => {
    seed({ items: ['T-1'], api: true });
    const r = await go(ghState(smokeLog(NAME, ['== T-1（对应 Q-1）', 'FAIL: T-1'])));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(sessionRan()).toBe(false);
    expect(remoteHead()).not.toBe(head);
    expect(remoteFile(SMOKE)).toBeNull();
    expect(remoteFile(ALLOW)).toBe('base-smoke.sh\n');
    const s = qa();
    expect(s.passed).toBe(false);
    expect(s.smoke_missing).toBe(true);
    expect(s.escalated).toMatchObject({ type: 'qa_smoke_missing', pr: 77, api_items: ['T-1'], skipped: [{ id: 'T-1', reason: 'ci_failed' }] });
    const esc = brain.patches.filter((p) => p.id === TASK && p.body.result?.escalations).at(-1);
    expect(esc.body.result.escalations).toEqual([expect.objectContaining({ type: 'qa_smoke_missing' })]);
    expect(cifix().escalated).toBeUndefined();
  });

  it('剔除后零固化、PR 没改 API 面 → 删脚本并推送，批准改绑，不升级（smoke_note 写明无回归 smoke）', async () => {
    seed({ items: ['T-1'] });
    const r = await go(ghState(smokeLog(NAME, ['FAIL: T-1'])));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(remoteFile(SMOKE)).toBeNull();
    const s = qa();
    expect(s).toMatchObject({ passed: true, approved: { head: remoteHead() } });
    expect(s.escalated).toBeUndefined();
    expect(s.smoke).toBeNull();
    expect(s.smoke_note).toContain('无回归 smoke');
  });

  it('失败的是别的 smoke（本 PR 的 cw 脚本通过）→ 照常派 CI 修复会话', async () => {
    seed();
    const log = ts(['── ▶  base-smoke.sh', 'boom', '::error::❌ BASELINE FAIL (exit 1): base-smoke.sh', `── ▶  ${NAME}`, `── ✅ PASS: ${NAME}`]);
    const r = await go(ghState(log));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(sessionRan()).toBe(true);
    expect(qa().smoke_refit).toBeUndefined();
  });
});
