// coding commander（决策 c167d6e3）：runner 的 PR 被升级后，下一轮起 Opus 会话按规格逐条裁决并执行——
// 维持/修订规格（只许在 02-spec.md 末尾追加「commander 裁决」节）、自己 TDD 修代码、追加 CI 修复额度、解除升级；
// 不许改需求 01、不许削弱测试；每 PR 至多 3 次；裁决要上交 / 会话出错 / 超限 / 基础设施类升级 → Bark 主理人。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../__tests__/helpers/git.mjs';
import { useQaEnv, TASK, BRANCH, SPRINT } from './helpers/qa-env.mjs';

describe('coding commander（升级后自动裁决）', () => {
  let sb;
  let files;
  const E = useQaEnv({ onReady: (e) => ({ sb, files } = e) });
  const { pr, green, seedState, state, originLog, remoteHead } = E;
  const bark = { calls: [], server: null, url: null };

  beforeEach(async () => {
    bark.calls = [];
    bark.server = http.createServer((req, res) => { bark.calls.push(decodeURIComponent(req.url)); res.end('{"code":200}'); });
    await new Promise((r) => bark.server.listen(0, '127.0.0.1', r));
    bark.url = `http://127.0.0.1:${bark.server.address().port}/tok`;
  });
  afterEach(async () => { await new Promise((r) => bark.server.close(r)); });

  const go = (ghState, { mode = 'cmd-resume', extra = {}, tasks = [{ id: TASK, status: 'completed', result: {} }] } = {}) =>
    E.go(ghState, { tasks, extra: { CODING_WF_COMMANDER: '1', CODING_WF_BARK_URL: bark.url, FAKE_CIFIX_MODE: mode, ...extra } });
  const cmdState = () => JSON.parse(fs.readFileSync(path.join(sb.logDir, 'commander-77.json'), 'utf8'));
  const ciState = () => JSON.parse(fs.readFileSync(path.join(sb.logDir, 'cifix-77.json'), 'utf8'));
  const seedCi = (s) => { fs.mkdirSync(sb.logDir, { recursive: true }); fs.writeFileSync(path.join(sb.logDir, 'cifix-77.json'), JSON.stringify(s)); };
  const overrides = () => E.brain.patches.filter((p) => p.id === TASK && p.body.result?.commander_overrides).map((p) => p.body.result.commander_overrides).at(-1);
  const qaEscalated = (type, extra = {}) => seedState({ rounds: [{ round: 1, head: 'a'.repeat(40), verdict: 'PASS', fails: 1, judge: { verdict: 'FAIL', failure_class: 'contract_gap', file: '06-judge-r1.md' } }],
    escalated: { type, pr: 77, at: '2026-10-11T00:00:00.000Z', ...extra } });

  it('QA 门升级 judge_contract_gap + commander 维持规格并追加裁决节 → 规格追加、07 裁决记录提交推送；解除升级；Brain 记 commander_overrides；上报 commander span', async () => {
    qaEscalated('judge_contract_gap', { issues: ['J-1'], file: `${SPRINT}/06-judge-r1.md` });
    const r = await go(green(), { mode: 'cmd-amend' });
    expect(r.exitCode, r.stderr).toBe(0);
    const prompt = fs.readFileSync(files.prompt, 'utf8');
    for (const s of ['judge_contract_gap', `${SPRINT}/02-spec.md`, `${SPRINT}/01-intent.md`, 'RULING_PATH: ']) expect(prompt).toContain(s);
    expect(git(sb.origin, 'show', `${BRANCH}:${SPRINT}/02-spec.md`)).toContain('## commander 裁决（测试）');
    expect(originLog()[0]).toBe('docs(commander): 第 1 次 coding commander 裁决（judge_contract_gap）');
    expect(git(sb.origin, 'show', `${BRANCH}:${SPRINT}/07-commander-r1.md`)).toContain('J-1');
    expect(state().escalated).toBeUndefined();
    expect(cmdState().interventions).toMatchObject([{ n: 1, escalation: { type: 'judge_contract_gap' }, action: 'resume' }]);
    expect(overrides()).toEqual([expect.objectContaining({ by: 'coding-commander', escalation: expect.objectContaining({ type: 'judge_contract_gap' }) })]);
    expect(E.brain.spans).toContainEqual(expect.objectContaining({ occurrence_key: 'commander:77:c1', outcome: 'pass' }));
    expect(bark.calls).toEqual([]);
  });

  it('commander 自己修代码（提交在 PR 分支上）→ 与裁决记录一起推送', async () => {
    qaEscalated('qa_fix_failed', { reason: 'ruling_conflict' });
    const r = await go(green(), { mode: 'cmd-fix' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(git(sb.origin, 'show', `${BRANCH}:src/commander-fix.txt`)).toBe('fixed\n');
    expect(state().escalated).toBeUndefined();
  });

  it('CI 修复升级 ci_fix_exhausted + 裁决 reset_ci_budget → 旧尝试归档进 archived_attempts、解除升级', async () => {
    seedCi({ attempts: [{ head: 'a'.repeat(40), result: 'pushed' }, { head: 'b'.repeat(40), result: 'pushed' }], escalated: { type: 'ci_fix_exhausted', reason: 'attempts_exhausted', pr: 77 } });
    const ruling = { action: 'resume', rulings: [{ issue: 'brain-unit (3)', verdict: '追加额度', reason: '普通测试失败，可修' }], reset_ci_budget: true, summary: '再给一轮' };
    const r = await go(green(), { mode: 'cmd-resume', extra: { FAKE_CMD_RULING: JSON.stringify(ruling) } });
    expect(r.exitCode, r.stderr).toBe(0);
    const s = ciState();
    expect(s.escalated).toBeUndefined();
    expect(s.attempts).toEqual([]);
    expect(s.archived_attempts).toHaveLength(2);
  });

  it('qa_stalled 解除后从当前轮次重新计不收敛（stall_floor）', async () => {
    seedState({ rounds: [1, 2, 3].map((n) => ({ round: n, head: `${n}`.repeat(40), verdict: 'FAIL', fails: 1 })), escalated: { type: 'qa_stalled', fails: [1, 1, 1], pr: 77 } });
    const r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(state()).toMatchObject({ stall_floor: 3 });
    expect(state().escalated).toBeUndefined();
  });

  it('裁决要上交（action=human）→ Bark 主理人（带 PR 与原因），升级保留；下一轮不再起会话、不重复 Bark', async () => {
    qaEscalated('judge_contract_gap', { issues: ['J-1'] });
    let r = await go(green(), { mode: 'cmd-human' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(bark.calls).toHaveLength(1);
    expect(bark.calls[0]).toContain('PR #77');
    expect(bark.calls[0]).toContain('需求 I-3 与现有路由冲突');
    expect(state().escalated).toMatchObject({ type: 'judge_contract_gap' });
    expect(cmdState().human).toMatchObject({ reason: 'commander_human', notified: true });
    await E.closeBrain();
    fs.rmSync(files.prompt, { force: true });
    r = await go(green(), { mode: 'cmd-resume' });
    expect(fs.existsSync(files.prompt)).toBe(false);
    expect(bark.calls).toHaveLength(1);
  });

  it.each([
    ['cmd-garbage', 'commander_output_invalid'],
    ['cmd-intent', 'commander_protected_path'],
    ['cmd-rewrite', 'commander_spec_not_append'],
  ])('会话 %s → 不推送、不解除升级，Bark 主理人（%s）', async (mode, reason) => {
    qaEscalated('judge_contract_gap', { issues: ['J-1'] });
    const head = remoteHead();
    const r = await go(green(), { mode });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(remoteHead()).toBe(head);
    expect(state().escalated).toMatchObject({ type: 'judge_contract_gap' });
    expect(cmdState().human).toMatchObject({ reason });
    expect(bark.calls).toHaveLength(1);
  });

  it('本 PR 已介入 3 次 → 不再起会话，Bark 主理人（commander_limit）', async () => {
    qaEscalated('judge_contract_gap');
    fs.writeFileSync(path.join(sb.logDir, 'commander-77.json'), JSON.stringify({ interventions: [{ n: 1 }, { n: 2 }, { n: 3 }] }));
    const r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(fs.existsSync(files.prompt)).toBe(false);
    expect(cmdState().human).toMatchObject({ reason: 'commander_limit' });
    expect(bark.calls).toHaveLength(1);
  });

  it('基础设施类升级（预览环境起不来）→ 不起会话，直接 Bark 主理人', async () => {
    seedState({ rounds: [], escalated: { type: 'qa_preview_unavailable', pr: 77 } });
    const r = await go(green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(fs.existsSync(files.prompt)).toBe(false);
    expect(cmdState().human).toMatchObject({ reason: 'infra_escalation' });
    expect(bark.calls[0]).toContain('qa_preview_unavailable');
  });

  it('CODING_WF_COMMANDER=0 → 升级照旧挂着，不起会话、不 Bark', async () => {
    qaEscalated('judge_contract_gap');
    const r = await go(green(), { extra: { CODING_WF_COMMANDER: '0' } });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(fs.existsSync(files.prompt)).toBe(false);
    expect(bark.calls).toEqual([]);
  });
});
