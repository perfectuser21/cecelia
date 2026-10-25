// 真实Git及受保护来源链；网络/模型仅本地CLI替身，不mock来源核验。
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git } from '../../__tests__/helpers/git.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';
import { withRecordProvenance, verifyRecordProvenance, beginEvaluateIsolation, verifyRegisteredQaEvidence, controllerIdentity, captureNativeExecution, sealStageEvidence,
  beginRecordRegistration, observeRecordRegistration, finalizeRecordRegistration } from '../../lib/record-provenance.mjs';
import { registerRecordSources, RECORD_SOURCE_MANIFEST as MANIFEST, RECORD_SOURCE_OWNER as OWNER } from '../../lib/record-sources.mjs';
import { createSourceMerge, consumeSourceMerge } from '../lib/source-merge.mjs';
import { sourceMergePlan, verifySourceMerges } from '../lib/source-merge-proof.mjs';
import { checkFixCommits } from '../lib/pr-branch.mjs';
import { hash } from '../../lib/record-provenance-store.mjs';
import { verifySourceHead, sourceFacts, judgeSourceFacts } from '../lib/source-provenance.mjs';
import { runCiFix } from '../lib/cifix.mjs';

const TASK = '088c3431-57ca-4f2a-8a50-14601518e2a2', SPRINT = 'sprints/10121524-cw-088c3431', BRANCH = 'cp-10121524-cw-088c3431';
const README = 'packages/brain/scripts/coding-workflow/runner/README.md';
let sb, cfg, context, before, main, base, messages;
const put = (rel, value) => { const p = path.join(sb.seed, rel);fs.mkdirSync(path.dirname(p), { recursive: true });fs.writeFileSync(p, value); };
const head = () => git(sb.seed, 'rev-parse', 'HEAD').trim();
const commit = label => { git(sb.seed, 'add', '.');git(sb.seed, 'commit', '-qm', label);return head(); };
const report = step => `---\ntask_id: ${TASK}\nstep: ${step}\nupstream: []\n---\nactual ${step} fixture\n`;
const rel = name => `${SPRINT}/${name}`;
const proof = sha => withRecordProvenance({ ...context, stage: 'publish' }, () => verifySourceHead(cfg, sb.seed, context, sha));

beforeEach(() => {
  sb = makeSandbox();messages = [];
  // 本地bare是真实读写对象，仅canonical身份查询沿用既有self来源fixture。
  const bin = path.join(sb.root, 'bin');fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\ncase "$*" in *" remote get-url origin") echo https://github.com/perfectuser21/cecelia.git; exit 0;; esac\nexec /usr/bin/git "$@"\n', { mode: 0o755 });
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);vi.stubEnv('HOME', sb.root);
  vi.stubEnv('CODING_WF_PROVIDER', 'codex');vi.stubEnv('CODING_WF_CODEX_HOME', sb.root);vi.stubEnv('FAKE_GH_LOG', sb.ghLog);
  put(OWNER, '// fixture controller\n');put(README, '# existing manual\n');
  put('docs/retired.md', 'retired\n');put('docs/retained.md', 'retained\n');
  const rows = ['docs/retired.md', 'docs/retained.md'].map(p => ({ owner_path: OWNER, path: p, role: 'documentation' }));
  put(MANIFEST, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: rows }, null, 2) + '\n');
  base = commit('fixture trusted base');git(sb.seed, 'push', '-q', 'origin', 'main');
  git(sb.seed, 'checkout', '-qb', BRANCH);put(README, '# existing manual\n\n## task addition\n');commit('fixture product');
  context = { root: path.join(sb.root, '.cecelia', 'coding-workflow-provenance'), worktree: sb.seed, taskId: TASK, sprintDir: SPRINT, controller: controllerIdentity(import.meta.url) };
  const files = [];
  for (const [stage, name] of [['intent', '01-intent.md'], ['build', '03-build.md'], ['verify', '04-evidence.md']]) {
    put(rel(name), report(stage));files.push(rel(name));
    withRecordProvenance({ ...context, stage }, () => {
      if (stage !== 'intent') {
        const stdout = execFileSync(process.execPath, ['-e', `console.log(JSON.stringify({type:'thread.started',thread_id:'actual-fixture-child'}));console.log(JSON.stringify({type:'turn.completed'}));`], { encoding: 'utf8' });
        captureNativeExecution({ provider: 'codex', code: 0, stdout });
      }
      sealStageEvidence({ files: [rel(name)], result: { status: 'completed' }, producer: stage === 'intent' ? 'controller' : 'model' });
    });
  }
  const token = beginRecordRegistration({ ...context, stage: 'publish' }, files);
  observeRecordRegistration(token, registerRecordSources(sb.seed, { taskId: TASK, sprintDir: SPRINT, stage: 'publish' }, files));
  before = commit('fixture real registration');finalizeRecordRegistration(token);git(sb.seed, 'push', '-q', 'origin', BRANCH);
  git(sb.seed, 'checkout', '-q', 'main');
  put(MANIFEST, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: rows.slice(1) }, null, 2) + '\n');
  fs.unlinkSync(path.join(sb.seed, 'docs/retired.md'));main = commit('fixture legitimate upstream retirement');
  git(sb.seed, 'push', '-q', 'origin', 'main');git(sb.seed, 'checkout', '-q', BRANCH);git(sb.clone, 'fetch', '-q', 'origin');
  cfg = { repo: sb.clone, repoSlug: 'perfectuser21/cecelia', repoKey: 'cecelia', logDir: sb.logDir, worktreeBase: sb.worktreeBase,
    skipNpmCi: true, ghBin: fileURLToPath(new URL('./fixtures/fake-gh-ci.mjs', import.meta.url)), ciFixTimeoutMs: 20000, ciFixMaxAttempts: 2 };
  const state = path.join(sb.root, 'gh.json');fs.writeFileSync(state, JSON.stringify({ prs: [{ number: 77, headRefName: BRANCH, headRefOid: before, url: 'https://github.com/perfectuser21/cecelia/pull/77', isDraft: false, mergeable: 'CONFLICTING', baseRefName: 'main', isCrossRepository: false, autoMergeRequest: null }] }));
  vi.stubEnv('FAKE_GH_CI', state);
  // 旧流程调用这个真实子进程；它合成语义正确的manifest并提交，旧guard仍误拒。
  const model = path.join(sb.root, 'model.mjs');
  fs.writeFileSync(model, `#!/usr/bin/env node\nimport fs from 'node:fs';import{execFileSync as x}from'node:child_process';fs.readFileSync(0,'utf8');fs.appendFileSync(${JSON.stringify(path.join(sb.root, 'model-called'))},'called\\n');const git=(...a)=>x('/usr/bin/git',a,{encoding:'utf8'});const file=${JSON.stringify(MANIFEST)},before=${JSON.stringify(before)},base=${JSON.stringify(base)};const a=JSON.parse(git('show',before+':'+file)),b=JSON.parse(git('show',base+':'+file)),m=JSON.parse(git('show','origin/main:'+file));const known=new Set(b.relations.map(r=>r.path));m.relations=[...a.relations.filter(r=>!known.has(r.path)),...m.relations];fs.writeFileSync(file,JSON.stringify(m,null,2)+'\\n');git('add',file);git('-c','user.name=fixture-model','-c','user.email=fixture@example.invalid','commit','--no-edit');console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-conflict-model'}));console.log(JSON.stringify({type:'turn.completed'}));\n`, { mode: 0o755 });
  vi.stubEnv('CODING_WF_CODEX_BIN', model);
});
afterEach(() => { vi.unstubAllEnvs();sb?.cleanup(); });

it.each(['无文本冲突', '真实文本冲突'])('真实已登记任务遇上游合法manifest删除（%s）：控制器合并推送，不误拒protected_path且模型不提交manifest', async layout => {
  if (layout === '真实文本冲突') {
    git(sb.seed, 'checkout', '-q', 'main');
    put(MANIFEST, JSON.stringify(JSON.parse(fs.readFileSync(path.join(sb.seed, MANIFEST)))) + '\n');
    main = commit('fixture upstream manifest formatting');git(sb.seed, 'push', '-q', 'origin', 'main');git(sb.seed, 'checkout', '-q', BRANCH);
  }
  expect(proof(before).status).toBe('verified');expect(proof(before).records).toHaveLength(3);
  fs.mkdirSync(sb.logDir, { recursive: true });
  fs.writeFileSync(path.join(sb.logDir, 'qa-77.json'), JSON.stringify({ passed: true, approved: { head: before, round: 1 }, judge_pending: { round: 1 }, rounds: [{ round: 1, judge: 'PASS' }] }));
  const ctx = { cfg, log: s => messages.push(s), brain: { patch: async () => ({ ok: true }), postSpans: async () => ({ ok: true }) } };
  await withRecordProvenance({ ...context, stage: 'publish' }, () => runCiFix(ctx));
  const state = JSON.parse(fs.readFileSync(path.join(sb.logDir, 'cifix-77.json')));
  expect(state.attempts.at(-1).result, messages.join('\n')).toBe('pushed');
  expect(fs.existsSync(path.join(sb.root, 'model-called'))).toBe(false);
  const qa = JSON.parse(fs.readFileSync(path.join(sb.logDir, 'qa-77.json')));
  expect(qa.passed).toBe(false);expect(qa).not.toHaveProperty('approved');expect(qa).not.toHaveProperty('judge_pending');expect(qa.rounds).toHaveLength(1);
  expect(qa.revoked.at(-1)).toMatchObject({ automerge_disabled: true, reason: 'source_merge_new_head' });
  const merged = git(sb.origin, 'rev-parse', BRANCH).trim();expect(merged).not.toBe(before);
  expect(git(sb.origin, 'show', '-s', '--format=%P', merged).trim().split(' ')).toEqual([before, main]);
  git(sb.seed, 'fetch', '-q', 'origin');expect(proof(merged).status).toBe('verified');
  const rows = JSON.parse(git(sb.origin, 'show', `${merged}:${MANIFEST}`)).relations;
  expect(rows.map(r => r.path)).toEqual([rel('01-intent.md'), rel('03-build.md'), rel('04-evidence.md'), 'docs/retained.md']);
  expect(rows.some(r => r.path === 'docs/retired.md')).toBe(false);
  expect(git(sb.origin, 'show', `${merged}:${README}`)).toBe(git(sb.seed, 'show', `${before}:${README}`));
}, 120000);

const runFix = async () => {
  await withRecordProvenance({ ...context, stage: 'publish' }, () => runCiFix({ cfg, log: s => messages.push(s), brain: { patch: async () => ({ ok: true }), postSpans: async () => ({ ok: true }) } }));
  return JSON.parse(fs.readFileSync(path.join(sb.logDir, 'cifix-77.json'))).attempts.at(-1);
};
const editGh = fn => { const p = process.env.FAKE_GH_CI, d = JSON.parse(fs.readFileSync(p));fn(d);fs.writeFileSync(p, JSON.stringify(d)); };
const mergeLocally = () => createSourceMerge(cfg, sb.seed, context, before, main, { number: 77, headRefName: BRANCH, headRefOid: before });
const eventFile = id => path.join(context.root, TASK, `${id}.json`);
const rewriteEvent = (p, edit) => { const e = JSON.parse(fs.readFileSync(p));edit(e);delete e.digest;e.digest = hash(JSON.stringify(e));fs.writeFileSync(p, JSON.stringify(e) + '\n'); };

it.each(['product', 'report', 'unknown-field', 'duplicate-path', 'manifest-mode'])('完整固定Git拒绝 %s，未产生merge事件或远端变化', kind => {
  expect(proof(before).status).toBe('verified');
  git(sb.seed, 'checkout', '-q', 'main');
  if (kind === 'product') put(README, 'upstream changed task product');
  if (kind === 'report') put(rel('03-build.md'), report('build'));
  if (kind === 'manifest-mode') fs.chmodSync(path.join(sb.seed, MANIFEST), 0o755);
  if (['unknown-field', 'duplicate-path'].includes(kind)) {
    const d = JSON.parse(fs.readFileSync(path.join(sb.seed, MANIFEST)));
    if (kind === 'unknown-field') d.claim = 'safe';else d.relations.push(d.relations[0]);
    put(MANIFEST, JSON.stringify(d));
  }
  main = commit(`invalid fixture ${kind}`);git(sb.seed, 'checkout', '-q', BRANCH);
  expect(() => sourceMergePlan(sb.seed, context, before, main)).toThrow(/source_merge_|record_provenance_git_file_invalid/);
  expect(head()).toBe(before);expect(git(sb.origin, 'rev-parse', BRANCH).trim()).toBe(before);
  expect(fs.readdirSync(path.join(context.root, TASK)).map(n => JSON.parse(fs.readFileSync(path.join(context.root, TASK, n)))).filter(e => e.kind === 'merge')).toHaveLength(0);
}, 60000);

it('持久merge凭证实际读回；missing/tampered/cross-task/unknown/duplicate/parents/tree/main/input IDs/controller逐一拒绝', async () => {
  const t = await mergeLocally(), file = eventFile(t.eventId), original = fs.readFileSync(file);
  expect(proof(t.commit).status).toBe('verified');
  expect(verifySourceMerges(sb.seed, context, t.commit)[0]).toMatchObject({ before, main, base, commit: t.commit, parents: [before, main], evidence_scope: 'local_controller_merge_only' });
  fs.unlinkSync(file);expect(() => proof(t.commit)).toThrow(/receipt_missing/);fs.writeFileSync(file, original);
  for (const edit of [e => { e.digest = '0'.repeat(64); }, e => { e.task_id = '188c3431-57ca-4f2a-8a50-14601518e2a2'; }]) {
    const e = JSON.parse(original);edit(e);fs.writeFileSync(file, JSON.stringify(e));expect(() => proof(t.commit)).toThrow(/event_invalid/);fs.writeFileSync(file, original);
  }
  for (const edit of [e => { e.unknown = true; }, e => { e.parents.reverse(); }, e => { e.tree = base; }, e => { e.main = base; }, e => { e.input_ids.registration = []; }, e => { e.controller.modules[0].sha256 = '0'.repeat(64); }, e => { e.controller.revision = main; },
    e => { e.remote_before.unknown = true; }, e => { e.remote_after_commit.pr.argv.push('--unsafe'); },
    e => { e.remote_before.refs.stdout = e.remote_before.refs.stdout.replace(main, base);e.remote_before.refs.stdout_sha256 = hash(e.remote_before.refs.stdout); },
    e => { const pr = JSON.parse(e.remote_before.pr.stdout);pr.baseRefName = 'other';e.remote_before.pr.stdout = JSON.stringify(pr);e.remote_before.pr.stdout_sha256 = hash(e.remote_before.pr.stdout); }]) {
    rewriteEvent(file, edit);expect(() => proof(t.commit)).toThrow(/source_merge_/);fs.writeFileSync(file, original);
  }
  const copy = eventFile('11111111-2222-4333-8444-555555555555');fs.writeFileSync(copy, original);rewriteEvent(copy, e => { e.id = path.basename(copy, '.json'); });
  expect(() => proof(t.commit)).toThrow(/duplicate/);fs.unlinkSync(copy);
  expect(proof(t.commit).status).toBe('verified');
}, 180000);

it('manifest字符串allow和假token无权；真token严格绑定index/head/main且仅单次消费', async () => {
  const t = await mergeLocally();
  await expect(checkFixCommits(sb.seed, before, { mainRef: main, allow: [MANIFEST] })).rejects.toThrow('protected_path');
  await expect(checkFixCommits(sb.seed, before, { mainRef: main, sourceMergeToken: {} })).rejects.toThrow('source_merge_token');
  expect(consumeSourceMerge(t.token, sb.seed, before, main)).toBe(MANIFEST);
  expect(() => consumeSourceMerge(t.token, sb.seed, before, main)).toThrow('source_merge_token');
}, 120000);

it('auto关闭失败不push，不冒称旧QA已撤销', async () => {
  editGh(d => { d.mergeExit = 1; });
  fs.mkdirSync(sb.logDir, { recursive: true });fs.writeFileSync(path.join(sb.logDir, 'qa-77.json'), JSON.stringify({ passed: true, approved: { head: before, round: 1 } }));
  expect((await runFix()).result).toBe('source_merge_disable_auto_failed');
  expect(git(sb.origin, 'rev-parse', BRANCH).trim()).toBe(before);
  expect(JSON.parse(fs.readFileSync(path.join(sb.logDir, 'qa-77.json'))).passed).toBe(true);
}, 120000);

it('PR实际head已变拒绝，不运行模型', async () => {
  editGh(d => { d.prDetails = { 77: { ...d.prs[0], headRefOid: main } }; });
  expect((await runFix()).result).toBe('source_merge_pr_changed');
  expect(git(sb.origin, 'rev-parse', BRANCH).trim()).toBe(before);expect(fs.existsSync(path.join(sb.root, 'model-called'))).toBe(false);
}, 60000);

it('推送前main移动，精确远端guard拒绝；已撤旧QA不恢复', async () => {
  git(sb.seed, 'checkout', '-q', 'main');put('upstream-new.txt', 'new main');const moved = commit('fixture concurrent main');git(sb.seed, 'checkout', '-q', BRANCH);
  const wrapper = path.join(sb.root, 'race-gh.mjs');
  fs.writeFileSync(wrapper, `#!/usr/bin/env node\nimport{spawnSync,execFileSync}from'node:child_process';const a=process.argv.slice(2);const r=spawnSync(${JSON.stringify(cfg.ghBin)},a,{stdio:'inherit'});if(a.includes('--disable-auto'))execFileSync('/usr/bin/git',['--git-dir',${JSON.stringify(sb.origin)},'update-ref','refs/heads/main',${JSON.stringify(moved)},${JSON.stringify(main)}]);process.exit(r.status);\n`, { mode: 0o755 });
  // 对象需先发送到bare，但不更新main；独立临时fixture引用保留。
  git(sb.seed, 'push', '-q', 'origin', `${moved}:refs/heads/race-object`);cfg.ghBin = wrapper;
  expect((await runFix()).result).toBe('source_merge_remote_changed');
  expect(git(sb.origin, 'rev-parse', BRANCH).trim()).toBe(before);
  expect(JSON.parse(fs.readFileSync(path.join(sb.logDir, 'qa-77.json'))).passed).toBe(false);
}, 120000);

it('self落后main也必须走可信事务，不能gh update-branch制造无凭证merge', async () => {
  expect(proof(before).status).toBe('verified');
  editGh(d => { d.prs[0].mergeable = 'MERGEABLE';d.required = { 77: [{ name: 'ci-passed', bucket: 'fail' }] };d.checks = { 77: [{ name: 'lint-base-fresh', bucket: 'fail' }] }; });
  await withRecordProvenance({ ...context, stage: 'publish' }, () => runCiFix({ cfg, log: s => messages.push(s), brain: { patch: async () => ({ ok: true }), postSpans: async () => ({ ok: true }) } }));
  const state = JSON.parse(fs.readFileSync(path.join(sb.logDir, 'cifix-77.json')));
  expect(state.attempts.at(-1)?.result, messages.join('\n')).toBe('pushed');
  expect(fs.readFileSync(sb.ghLog, 'utf8')).not.toContain('update-branch');
  const merged = git(sb.origin, 'rev-parse', BRANCH).trim();git(sb.seed, 'fetch', '-q', 'origin');
  expect(proof(merged).status).toBe('verified');expect(verifySourceMerges(sb.seed, context, merged)).toHaveLength(1);
}, 120000);

it.each(['upstream-revert', 'upstream-side-branch-revert', 'task-revert'])('完整DAG曾触产品即拒，即使最终diff看不见：%s', mode => {
  if (mode.startsWith('upstream-')) {
    git(sb.seed, 'checkout', '-q', 'main');
    if (mode === 'upstream-side-branch-revert') git(sb.seed, 'checkout', '-qb', 'upstream-side');
    put(README, 'transient upstream change');commit('fixture upstream touch');
    put(README, git(sb.seed, 'show', `${base}:${README}`));main = commit('fixture upstream revert');
    if (mode === 'upstream-side-branch-revert') { git(sb.seed, 'checkout', '-q', 'main');git(sb.seed, 'merge', '--no-ff', '--no-edit', 'upstream-side');main = head(); }
  } else {
    put('docs/retained.md', 'transient task change');commit('fixture task touch');
    put('docs/retained.md', 'retained\n');before = commit('fixture task revert');
    git(sb.seed, 'checkout', '-q', 'main');put('docs/retained.md', 'upstream retained changed');main = commit('fixture overlapping reverted task product');
  }
  git(sb.seed, 'checkout', '-q', BRANCH);expect(proof(before).status).toBe('verified');
  expect(() => sourceMergePlan(sb.seed, context, before, main)).toThrow('source_merge_upstream_task_overlap');
}, 60000);

it.each(['retarget', 'fork'])('远端身份% s不可进入可信自仓同步'.replace('% s', '%s'), async kind => {
  editGh(d => { d.prDetails = { 77: { ...d.prs[0], ...(kind === 'retarget' ? { baseRefName: 'release' } : { isCrossRepository: true }) } }; });
  expect((await runFix()).result).toBe('source_merge_pr_identity');
  expect(git(sb.origin, 'rev-parse', BRANCH).trim()).toBe(before);
}, 120000);

it('merge持久凭证包含控制器原生远端ref/PR观测，不只main自述SHA', async () => {
  const t = await mergeLocally(), e = JSON.parse(fs.readFileSync(eventFile(t.eventId)));
  expect(e.remote_before).toMatchObject({ repo: 'perfectuser21/cecelia', before, main });
  expect(e.remote_after_commit).toMatchObject({ repo: 'perfectuser21/cecelia', before, main });
  expect(e.remote_before.pr.stdout_sha256).toBe(hash(e.remote_before.pr.stdout));
  expect(e.remote_before.refs.stdout_sha256).toBe(hash(e.remote_before.refs.stdout));
}, 120000);

it('初次publish以前的未证明merge也拒绝，不能用登记commit截断历史', () => {
  const product = git(sb.seed, 'show', '-s', '--format=%P', before).trim();
  git(sb.seed, 'reset', '--hard', product);git(sb.seed, 'merge', '--no-ff', '--no-edit', main);
  const files = ['01-intent.md', '03-build.md', '04-evidence.md'];
  for (const [name, stage] of files.map((n, i) => [n, ['intent', 'build', 'verify'][i]])) put(rel(name), report(stage));
  const paths = files.map(rel), token = beginRecordRegistration({ ...context, stage: 'publish' }, paths);
  observeRecordRegistration(token, registerRecordSources(sb.seed, { taskId: TASK, sprintDir: SPRINT, stage: 'publish' }, paths));
  const published = commit('fixture lawful registration after unproved merge');finalizeRecordRegistration(token);
  expect(verifyRecordProvenance({ ...context, head: published }).status).toBe('verified');
  expect(() => proof(published)).toThrow(/receipt_missing/);
}, 120000);

function freshQa(round) {
  const tested = head(), qaFile = rel(`05-qa-report-r${round}.md`), judgeFile = rel(`06-judge-r${round}.md`);
  const capture = () => captureNativeExecution({ provider: 'codex', code: 0, stdout: execFileSync(process.execPath, ['-e', `console.log(JSON.stringify({type:'thread.started',thread_id:'real-qa-fixture-child'}));console.log(JSON.stringify({type:'turn.completed'}));`], { encoding: 'utf8' }) });
  const qa = withRecordProvenance({ ...context, stage: 'evaluate', round }, () => {
    const isolation = beginEvaluateIsolation();put(qaFile, report('evaluate'));capture();expect(isolation.restore()).toBe(true);
    return sealStageEvidence({ files: [qaFile], result: { status: 'completed', outputs: { qa: { verdict: 'PASS', round } } }, producer: 'model' });
  });
  withRecordProvenance({ ...context, stage: 'judge', round }, () => {
    capture();put(judgeFile, '# fixture judge PASS');
    sealStageEvidence({ files: [judgeFile], producer: 'controller_render', result: { status: 'completed', outputs: { judge_verdict: 'PASS' } },
      controllerInput: { round, qa_stage_event_id: qa.id, tested_head: tested, decision: { verdict: 'PASS' } } });
  });
  const files = [qaFile, judgeFile], token = beginRecordRegistration({ ...context, stage: 'qa', round, qaStageEventId: qa.id }, files);
  observeRecordRegistration(token, registerRecordSources(sb.seed, { taskId: TASK, sprintDir: SPRINT, stage: 'qa', round }, files));
  commit(`fixture new QA round ${round}`);finalizeRecordRegistration(token);
  return { head: head(), testedHead: tested, stageEventId: qa.id, reportRel: qaFile, round };
}

it('连续两次可信同步完整链可读；每次必须新HEAD新QA，旧approved与registered重试都不能跨merge', async () => {
  const first = await mergeLocally();expect(proof(first.commit).status).toBe('verified');
  const qa1 = freshQa(1);expect(verifySourceHead(cfg, sb.seed, context, qa1.head, 1).status).toBe('verified');
  before = qa1.head;git(sb.seed, 'push', '-q', 'origin', BRANCH);
  editGh(d => { d.prs[0].headRefOid = before; });
  git(sb.seed, 'checkout', '-q', 'main');put('upstream-next.txt', 'second unrelated upstream commit');main = commit('fixture second main');
  git(sb.seed, 'push', '-q', 'origin', 'main');git(sb.seed, 'checkout', '-q', BRANCH);
  const second = await mergeLocally();expect(verifySourceMerges(sb.seed, context, second.commit)).toHaveLength(2);
  // 旧core仅ancestor判据还成立，完整sync链必须额外拒绝旧QA。
  expect(verifyRecordProvenance({ ...context, head: second.commit, requiredQaRound: 1 }).status).toBe('verified');
  expect(() => verifySourceHead(cfg, sb.seed, context, second.commit, 1)).toThrow('source_merge_qa_before_sync');
  expect(() => verifyRegisteredQaEvidence({ ...context, ...qa1, head: second.commit }, qa1.reportRel)).toThrow(/qa_retry_history/);
  const qa2 = freshQa(2);
  expect(verifySourceHead(cfg, sb.seed, context, qa2.head, 2).status).toBe('verified');
  expect(verifySourceMerges(sb.seed, context, qa2.head, 2).map(e => e.commit)).toEqual([first.commit, second.commit]);
  expect(fs.existsSync(path.join(sb.root, 'model-called'))).toBe(false);
}, 300000);

it('disable-auto返回成功但实际auto仍开启也不可push', async () => {
  editGh(d => { d.prs[0].autoMergeRequest = { enabledAt: new Date().toISOString() }; });
  expect((await runFix()).result).toBe('source_merge_auto_still_enabled');
  expect(git(sb.origin, 'rev-parse', BRANCH).trim()).toBe(before);
}, 120000);

it('第二次PR读取后再retarget，推前第三次原生读取仍拒绝', async () => {
  const wrapper = path.join(sb.root, 'pr-race-gh.mjs');
  fs.writeFileSync(wrapper, `#!/usr/bin/env node\nimport fs from 'node:fs';import{spawnSync}from'node:child_process';const a=process.argv.slice(2);const r=spawnSync(${JSON.stringify(cfg.ghBin)},a,{stdio:'inherit'});if(a.includes('--disable-auto')){const p=process.env.FAKE_GH_CI,d=JSON.parse(fs.readFileSync(p));d.prDetails={77:{...d.prs[0],baseRefName:'release'}};fs.writeFileSync(p,JSON.stringify(d));}process.exit(r.status);\n`, { mode: 0o755 });
  cfg.ghBin = wrapper;
  expect((await runFix()).result).toBe('source_merge_pr_identity');
  expect(git(sb.origin, 'rev-parse', BRANCH).trim()).toBe(before);
}, 120000);

it('真token在index被更改后不能豁免保护路径，失败后不能重复消费', async () => {
  const t = await mergeLocally();
  git(sb.seed, 'update-index', '--force-remove', '--', README);
  expect(() => consumeSourceMerge(t.token, sb.seed, before, main)).toThrow('source_merge_token_binding');
  git(sb.seed, 'reset', '--hard', t.commit);
  expect(() => consumeSourceMerge(t.token, sb.seed, before, main)).toThrow('source_merge_token');
}, 120000);

it('底层实际native被篡改时，不能凭完整manifest或merge字段代替来源核验', () => {
  const file = fs.readdirSync(path.join(context.root, TASK)).map(n => path.join(context.root, TASK, n)).find(p => JSON.parse(fs.readFileSync(p)).kind === 'native');
  rewriteEvent(file, e => { e.stdout = 'model says PASS without native stream'; });
  expect(() => sourceMergePlan(sb.seed, context, before, main)).toThrow(/record_provenance_/);
  expect(head()).toBe(before);
}, 60000);

it.each(['verified', 'missing-receipt', 'tampered-receipt'])('actual evaluate child只消费真实merge链并交给native stdin：%s', async mode => {
  const spec = rel('02-spec.md');
  put(spec, report('spec') + '\n### S-1\n对应 I-1\n## QA 场景\n### Q-1\n对应: I-1\n操作: 读取产品文件并检查03/04隐藏\n期望: 字节相同且隐藏成立\n');
  withRecordProvenance({ ...context, stage: 'spec' }, () => {
    captureNativeExecution({ provider: 'codex', code: 0, stdout: execFileSync(process.execPath, ['-e', `console.log(JSON.stringify({type:'thread.started',thread_id:'actual-spec-child'}));console.log(JSON.stringify({type:'turn.completed'}));`], { encoding: 'utf8' }) });
    sealStageEvidence({ files: [spec], result: { status: 'completed' }, producer: 'model' });
  });
  const registration = beginRecordRegistration({ ...context, stage: 'publish' }, [spec]);
  observeRecordRegistration(registration, registerRecordSources(sb.seed, { taskId: TASK, sprintDir: SPRINT, stage: 'publish' }, [spec]));
  before = commit('fixture spec registration for actual evaluate');finalizeRecordRegistration(registration);
  git(sb.seed, 'push', '-q', 'origin', BRANCH);editGh(d => { d.prs[0].headRefOid = before; });
  const merged = await mergeLocally(), expected = sourceFacts(sb.seed, context, merged.commit);
  const nativeFile = path.join(sb.root, 'actual-evaluate-native.json'), bin = path.join(sb.root, 'actual-evaluate-native.mjs');
  const command = `node -e 'const fs=require("node:fs");for(const f of ["03-build.md","04-evidence.md"])if(fs.existsSync("${SPRINT}/"+f))process.exit(9);if(fs.readFileSync("${README}","utf8")!=="# existing manual\\n\\n## task addition\\n")process.exit(10);process.stdout.write("actual product and hidden reports verified\\n")'`;
  const qaText = report('evaluate') + '\n### T-1\n对应: Q-1\nverdict: PASS\n```command\n' + command + '\n```\n```output\nactual product and hidden reports verified\n```\n';
  fs.writeFileSync(bin, `#!/usr/bin/env node\nimport fs from 'node:fs';import{execFileSync}from'node:child_process';const prompt=fs.readFileSync(0,'utf8');fs.writeFileSync(${JSON.stringify(nativeFile)},JSON.stringify({argv:process.argv.slice(2),prompt}));const output=execFileSync('/bin/sh',['-c',${JSON.stringify(command)}],{encoding:'utf8'});fs.writeFileSync(${JSON.stringify(path.join(sb.seed, rel('05-qa-report-r1.md')))},${JSON.stringify(qaText)});console.log(JSON.stringify({type:'thread.started',thread_id:'actual-evaluate-sync-child'}));console.log(JSON.stringify({type:'item.completed',item:{id:'actual',type:'command_execution',command:${JSON.stringify(command)},aggregated_output:output,exit_code:0,status:'completed'}}));console.log(JSON.stringify({type:'turn.completed'}));\n`, { mode: 0o755 });
  const input = { run_tag: 'actual-source-sync-fixture', task_id: TASK, worktree: sb.seed, sprint_dir: SPRINT, intent_ids: ['I-1'],
    intent_sha256: hash(fs.readFileSync(path.join(sb.seed, rel('01-intent.md')))), round: 1, head_sha: merged.commit,
    repo_profile: { key: 'cecelia', production_re: [], preview: { type: 'local' } }, source_provenance: { sync: ['FORGED_CALLER_FACTS'] } };
  if (mode === 'missing-receipt') fs.unlinkSync(eventFile(merged.eventId));
  if (mode === 'tampered-receipt') rewriteEvent(eventFile(merged.eventId), e => { e.tree = base; });
  const entry = fileURLToPath(new URL('../../activities/evaluate.mjs', import.meta.url));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], { env: { ...process.env, CODING_WF_CODEX_BIN: bin, CODING_WF_EVALUATE_TIMEOUT_MS: '15000' }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 90000 });
    let stdout = '', stderr = '';child.stdout.on('data', b => { stdout += b; });child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject);child.on('close', code => resolve({ code, stdout, stderr }));child.stdin.end(JSON.stringify(input));
  });
  const native = fs.existsSync(nativeFile) ? JSON.parse(fs.readFileSync(nativeFile)) : null;
  const protectedEvents = fs.readdirSync(path.join(context.root, TASK)).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(context.root, TASK, n))));
  if (process.env.SOURCE_MERGE_TEST_ARTIFACTS) {
    const out = path.join(process.env.SOURCE_MERGE_TEST_ARTIFACTS, mode);fs.mkdirSync(out, { recursive: true });
    for (const [name, value] of Object.entries({ input, result, native, expected, protectedEvents })) fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
  }
  if (mode !== 'verified') {
    expect(result.code, result.stderr).toBe(2);expect(JSON.parse(result.stdout).reason_code).toBe(mode === 'missing-receipt' ? 'source_merge_receipt_missing_or_duplicate' : 'source_merge_event_binding');
    expect(native).toBe(null);expect(protectedEvents.some(e => e.kind === 'native' && e.stage === 'evaluate')).toBe(false);return;
  }
  expect(result.code, result.stderr).toBe(0);const output = JSON.parse(result.stdout);expect(output.outputs.qa.verdict).toBe('PASS');
  const facts = JSON.parse(/^SOURCE_PROVENANCE: (.+)$/m.exec(native.prompt)[1]);expect(facts).toEqual(expected);
  expect(facts.sync).toHaveLength(1);expect(facts.sync[0]).toMatchObject({ event_id: merged.eventId, before, main, base, commit: merged.commit, parents: [before, main] });
  expect(native.prompt).not.toContain('FORGED_CALLER_FACTS');expect(native.prompt).not.toContain('holder_path');
  expect(native.argv).toContain('exec');expect(native.argv).toContain('--json');
  const factsForJudge = withRecordProvenance({ ...context, worktree: sb.seed, stage: 'judge', round: 1 }, () => judgeSourceFacts(cfg, sb.seed, context, merged.commit, rel('05-qa-report-r1.md'), { mode: 'pending', round: 1, testedHead: merged.commit, stageEventId: output.outputs.source_stage_event_id }));
  expect(factsForJudge.sync).toEqual(facts.sync);expect(factsForJudge.current_qa.isolation.status).toBe('restored');
  const nativeEvent = protectedEvents.find(e => e.kind === 'native' && e.stage === 'evaluate');expect(nativeEvent.stdout).toContain('actual-evaluate-sync-child');
  expect(nativeEvent.stdout).toContain('actual product and hidden reports verified');
  expect(git(sb.seed, 'rev-parse', 'HEAD').trim()).toBe(merged.commit);
  for (const [name, stage] of [['03-build.md', 'build'], ['04-evidence.md', 'verify']]) expect(fs.readFileSync(path.join(sb.seed, rel(name)), 'utf8')).toBe(report(stage));
}, 180000);
