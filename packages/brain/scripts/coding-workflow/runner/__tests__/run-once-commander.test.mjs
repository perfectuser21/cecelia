// coding commander（决策 c167d6e3）：runner 的 PR 被升级后，下一轮起 Opus 会话按规格逐条裁决并执行——
// 维持/修订规格（只许在 02-spec.md 末尾追加「commander 裁决」节）、自己 TDD 修代码、追加 CI 修复额度、解除升级；
// 不许改需求 01、不许削弱测试；每 PR 至多 3 次；裁决要上交 / 会话出错 / 超限 / 基础设施类升级 → Bark 主理人。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../__tests__/helpers/git.mjs';
import { useQaEnv, TASK, BRANCH, SPRINT } from './helpers/qa-env.mjs';
import { expectSessionOnlyInFile } from './helpers/session-quiet.mjs';

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

  it('Commander仅授权本次ruling独享目录，不授整个QA合并状态目录，控制器另存canonical裁决', async () => {
    qaEscalated('judge_contract_gap');
    const argsFile = path.join(sb.root, 'commander-args.json');
    const r = await go(green(), { extra: { FAKE_CIFIX_ARGS: argsFile } });
    expect(r.exitCode, r.stderr).toBe(0);
    const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
    const dirs = args.flatMap((v, i) => v === '--add-dir' ? [args[i + 1]] : []);
    expect(dirs).toHaveLength(1);expect(dirs).not.toContain(sb.logDir);
    expect(path.dirname(dirs[0])).toBe(sb.logDir);
    const prompt = fs.readFileSync(files.prompt, 'utf8');
    const ruling = /^RULING_PATH: (.+)$/m.exec(prompt)[1].trim();expect(path.dirname(ruling)).toBe(dirs[0]);
    expect(JSON.parse(fs.readFileSync(path.join(sb.logDir, 'commander-77-1-ruling.json'), 'utf8')).action).toBe('resume');
    expect(cmdState().interventions).toHaveLength(1);
  });

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

  it('Cecelia commander 独立07提交同时登记来源，真实裸仓回读无孤立记录', async () => {
    const owner = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs', manifest = '.implementation-source-relations.json';
    fs.mkdirSync(path.join(sb.seed,path.dirname(owner)),{recursive:true});
    fs.writeFileSync(path.join(sb.seed,owner),'// fixture runner\n');
    fs.writeFileSync(path.join(sb.seed,manifest),JSON.stringify({schema_version:1,repo:'perfectuser21/cecelia',relations:[]}));
    git(sb.seed,'add','--',owner,manifest);git(sb.seed,'commit','-qm','fixture source');
    git(sb.seed,'push','-q','origin',`${BRANCH}:main`,BRANCH);git(sb.clone,'fetch','origin','main');
    E.head=git(sb.seed,'rev-parse','HEAD').trim();
    // Git transport仍为本地裸仓；只替身仓库标识查询，避免任何GitHub网络请求。
    const bin=path.join(sb.root,'git-identity-bin');fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin,'git'),'#!/bin/sh\nif [ "$3" = remote ] && [ "$4" = get-url ] && [ "$5" = origin ]; then echo https://github.com/perfectuser21/cecelia.git; exit 0; fi\nexec /usr/bin/git "$@"\n',{mode:0o755});
    qaEscalated('judge_contract_gap',{issues:['J-1']});
    const r=await go(green(),{mode:'cmd-resume',extra:{PATH:`${bin}:${process.env.PATH}`}});
    expect(r.exitCode,r.stderr).toBe(0);
    const rows=JSON.parse(git(sb.origin,'show',`${BRANCH}:${manifest}`)).relations;
    expect(rows,r.stderr).toContainEqual({owner_path:owner,path:`${SPRINT}/07-commander-r1.md`,role:'documentation'});
    const files=git(sb.origin,'show','--name-only','--format=',BRANCH).trim().split('\n');
    expect(files).toEqual([manifest,`${SPRINT}/07-commander-r1.md`]);
    expect(cmdState().interventions).toHaveLength(1);expect(state().escalated).toBeUndefined();
  });

  // 真实 Opus 演练（金丝雀 5 r2 重放）：裁决文件在 logDir（worktree 外），Write 工具被 permission_denials 拒，会话碰巧改用 Bash 写成
  it('commander会话只授权本轮裁决子目录，裁决路径位于该精确目录', async () => {
    qaEscalated('judge_contract_gap', { issues: ['J-1'] });
    const argsFile = path.join(sb.root, 'claude-args.json');
    const r = await go(green(), { mode: 'cmd-resume', extra: { FAKE_CIFIX_ARGS: argsFile } });
    expect(r.exitCode, r.stderr).toBe(0);
    const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
    const granted = args[args.indexOf('--add-dir') + 1];
    expect(path.dirname(granted)).toBe(sb.logDir);expect(granted).not.toBe(sb.logDir);
    expect(fs.readFileSync(files.prompt, 'utf8')).toContain(`RULING_PATH: ${granted}/ruling.json`);
  });

  it('commander 会话输出只落 commander-<pr>-<n>.log，主日志只一行摘要', async () => {
    qaEscalated('judge_contract_gap', { issues: ['J-1'] });
    const r = await go(green(), { mode: 'cmd-resume', extra: { FAKE_CIFIX_COST: '0.5' } });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(cmdState().interventions).toMatchObject([{ n: 1, action: 'resume' }]);
    const file = expectSessionOnlyInFile(r.stderr, sb.logDir, { tag: 'commander', kind: 'commander', pr: 77, cost: 0.5 });
    expect(path.basename(file)).toBe('commander-77-1.log');
  });

  it('commander 自己修代码（提交在 PR 分支上）→ 与裁决记录一起推送', async () => {
    qaEscalated('qa_fix_failed', { reason: 'ruling_conflict' });
    const r = await go(green(), { mode: 'cmd-fix' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(git(sb.origin, 'show', `${BRANCH}:src/commander-fix.txt`)).toBe('fixed\n');
    expect(state().escalated).toBeUndefined();
  });

  // C3：commander 会话跑到一半 PR 被关 → 不推送裁决、不解除升级、不 Bark 主理人（交给外部关闭收尾）
  it('commander 会话跑到一半 PR 被关 → 不推送、升级保留、不 Bark', async () => {
    qaEscalated('qa_fix_failed', { reason: 'ruling_conflict' });
    const before = remoteHead();
    const r = await go(green({ prStates: { 77: 'CLOSED' } }), { mode: 'cmd-fix' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(remoteHead()).toBe(before);
    expect(state().escalated).toMatchObject({ type: 'qa_fix_failed' });
    expect(bark.calls).toEqual([]);
    expect(r.stderr).not.toContain('[coding-commander][P1]');
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

  // 决策 4fe863c3：API 类 PR 一条回归 smoke 都没固化 → commander 裁决放行（必须写理由）或要求 QA 重跑
  describe('qa_smoke_missing', () => {
    const seedSmokeMissing = () => seedState({
      rounds: [{ round: 1, head: 'a'.repeat(40), verdict: 'PASS', fails: 0, judge: { verdict: 'PASS' } }], smoke_missing: true,
      smoke_note: '本任务无回归 smoke（第 1 轮）；剔除 T-1(preflight_failed:22)',
      escalated: { type: 'qa_smoke_missing', round: 1, api_items: ['T-1'], skipped: [{ id: 'T-1', reason: 'preflight_failed:22' }], pr: 77, at: '2026-10-11T00:00:00.000Z' },
    });

    it('commander 裁决「放行」（带理由、不改代码）→ 批准绑定裁决记录推送后的 head，记 smoke_waived；提示词说明该类型怎么裁', async () => {
      seedSmokeMissing();
      const ruling = { action: 'resume', rulings: [{ issue: 'T-1', verdict: '放行', reason: '只依赖预览库已有数据，已由单测覆盖' }], summary: '放行合并' };
      const r = await go(green(), { mode: 'cmd-resume', extra: { FAKE_CMD_RULING: JSON.stringify(ruling) } });
      expect(r.exitCode, r.stderr).toBe(0);
      const prompt = fs.readFileSync(files.prompt, 'utf8');
      expect(prompt).toContain('qa_smoke_missing：');
      expect(state().escalated).toBeUndefined();
      expect(state()).toMatchObject({ passed: true, approved: { head: remoteHead(), round: 1 }, smoke_waived: { n: 1, reason: expect.stringContaining('单测覆盖') } });
      expect(state().smoke_note).toContain('commander 第 1 次裁决放行');
      expect(bark.calls).toEqual([]);
    });

    it('commander 没有放行（维持规格，要求 QA 重跑）→ 只解除升级，不批准（裁决记录推送后 head 变了，QA 下一轮重跑）', async () => {
      seedSmokeMissing();
      const ruling = { action: 'resume', rulings: [{ issue: 'T-1', verdict: '维持规格', reason: 'Q-1 要求自己造数据，QA 应重写命令' }], summary: '要求 QA 重跑' };
      const r = await go(green(), { mode: 'cmd-resume', extra: { FAKE_CMD_RULING: JSON.stringify(ruling) } });
      expect(r.exitCode, r.stderr).toBe(0);
      expect(state().escalated).toBeUndefined();
      expect(state().passed).toBeFalsy();
      expect(state().smoke_waived).toBeUndefined();
    });
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
