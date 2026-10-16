import { beforeEach, afterEach, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { git } from '../../__tests__/helpers/git.mjs';
import { beginEvaluateIsolation, withRecordProvenance, captureNativeExecution, sealStageEvidence, controllerIdentity, beginRecordRegistration, observeRecordRegistration, finalizeRecordRegistration } from '../../lib/record-provenance.mjs';
import { registerRecordSources, RECORD_SOURCE_OWNER, RECORD_SOURCE_MANIFEST } from '../../lib/record-sources.mjs';
import { verifySourceHead, verifyMergeSource, judgeSourceFacts, sourceContext } from '../lib/source-provenance.mjs';
import { stageQaRecords } from '../lib/qa-records.mjs';
import { runJudge } from '../lib/judge-gate.mjs';

const taskId = '088c3431-57ca-4f2a-8a50-14601518e2a2', sprintDir = 'sprints/10121524-cw-088c3431', branch = 'cp-10121524-cw-088c3431';
let temp, worktree, options, cfg, controller;
const put = (p, text) => { fs.mkdirSync(path.dirname(path.join(worktree, p)), { recursive: true });fs.writeFileSync(path.join(worktree, p), text); };
const rel = name => `${sprintDir}/${name}`;
const fm = (stage, body = 'actual report') => `---\ntask_id: ${taskId}\nstep: ${stage}\nupstream: []\n---\n${body}\n`;
const head = () => git(worktree, 'rev-parse', 'HEAD').trim();
const commit = () => { git(worktree, 'add', '.');git(worktree, 'commit', '-qm', 'fixture actual commit');return head(); };
const native = () => captureNativeExecution({ provider: 'codex', code: 0, stdout: '{"type":"thread.started","thread_id":"fixture-controller-capture"}\n{"type":"turn.completed"}\n' });
function seal(stage, files, round = 0) {
  return withRecordProvenance({ ...options, stage, round }, () => {
    const isolated = stage === 'evaluate' ? beginEvaluateIsolation() : null;
    if (stage !== 'intent') native();
    if (isolated) expect(isolated.restore()).toBe(true);
    return sealStageEvidence({ files, result: { status: 'completed', ...(stage === 'evaluate' ? { outputs: { qa: { verdict: 'PASS', round } } } : {}) }, producer: stage === 'intent' ? 'controller' : 'model' });
  });
}
function publish(extra = []) {
  const files = [rel('01-intent.md'), rel('03-build.md'), rel('04-evidence.md'), ...extra], token = beginRecordRegistration({ ...options, stage: 'publish' }, files);
  observeRecordRegistration(token, registerRecordSources(worktree, { taskId, sprintDir, stage: 'publish' }, files));
  commit();finalizeRecordRegistration(token);return head();
}
beforeEach(() => {
  temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'runner-source-proof-')));worktree = path.join(temp, 'repo');fs.mkdirSync(worktree);
  git(worktree, 'init', '-qb', branch);git(worktree, 'config', 'user.name', 'fixture');git(worktree, 'config', 'user.email', 'fixture@example.invalid');
  git(worktree, 'remote', 'add', 'origin', 'https://github.com/perfectuser21/cecelia.git');
  put(RECORD_SOURCE_OWNER, '// fixture controller\n');put(RECORD_SOURCE_MANIFEST, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: [] }));commit();
  git(worktree, 'update-ref', 'refs/remotes/origin/main', 'HEAD');git(worktree, 'branch', 'main');
  controller = controllerIdentity(pathToFileURL(path.join(worktree, RECORD_SOURCE_OWNER)));
  options = { root: path.join(temp, 'protected'), worktree, taskId, sprintDir, controller };cfg = { repoSlug: 'perfectuser21/cecelia', repo: worktree };
  put(rel('01-intent.md'), fm('intent'));seal('intent', [rel('01-intent.md')]);
  put(rel('03-build.md'), fm('build', 'PRIVATE DEVELOPMENT BODY'));seal('build', [rel('03-build.md')]);
  put(rel('04-evidence.md'), fm('verify', 'PRIVATE VERIFY BODY'));seal('verify', [rel('04-evidence.md')]);
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));
it('真实登记链按精确PR对象验证，main检出与继承Git环境不误选仓', () => {
  const exact = publish();expect(git(worktree, 'ls-tree', '--name-only', exact, 'sprints/').trim()).toBe(sprintDir);
  withRecordProvenance({ ...options, stage: 'judge', round: 1 }, () => {
    git(worktree, 'checkout', '-q', 'main');
    const old = Object.fromEntries(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'].map(k => [k, process.env[k]]));
    try {
      process.env.GIT_DIR = '/does/not/exist';process.env.GIT_WORK_TREE = '/wrong/tree';process.env.GIT_INDEX_FILE = '/wrong/index';
      const proof = verifySourceHead(cfg, worktree, options, exact);expect(proof.head).toBe(exact);expect(proof.records).toHaveLength(3);
    } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k];else process.env[k] = v; } }
  });
});
it('裁判只见已登记事实与当前05封存，不泄露03正文；05篡改拒绝', () => {
  const exact = publish(), report = rel('05-qa-report-r1.md');put(report, fm('evaluate'));seal('evaluate', [report], 1);
  withRecordProvenance({ ...options, stage: 'judge', round: 1 }, () => {
    const facts = judgeSourceFacts(cfg, worktree, options, exact, report);
    expect(facts.committed.status).toBe('verified');expect(facts.current_qa.status).toBe('sealed_not_registered');expect(JSON.stringify(facts)).not.toContain('PRIVATE DEVELOPMENT BODY');
    put(report, fm('evaluate', 'forged'));expect(() => judgeSourceFacts(cfg, worktree, options, exact, report)).toThrow(/stage_missing/);
  });
});
it('QA真实登记同时覆盖报告和binary截图，截图不冒Markdown辅助关系', async () => {
  publish();const report = rel('05-qa-report-r1.md'), image = rel('qa-r1/screen.png');put(report, fm('evaluate'));put(image, Buffer.from([0, 255, 2]));seal('evaluate', [report, image], 1);
  await withRecordProvenance({ ...options, stage: 'evaluate', round: 1 }, async () => {
    const staged = await stageQaRecords(worktree, { taskId, sprintDir, round: 1 }, [report, rel('qa-r1')], { ...options, stage: 'qa', round: 1 });
    git(worktree, 'commit', '-qm', 'QA registration');finalizeRecordRegistration(staged.registration);
    expect(verifySourceHead(cfg, worktree, options, head()).records).toHaveLength(5);
    const rows = JSON.parse(fs.readFileSync(path.join(worktree, RECORD_SOURCE_MANIFEST))).relations;
    expect(rows.some(r => r.path === report)).toBe(true);expect(rows.some(r => r.path === image)).toBe(false);
  });
});
it('登记后新增未封存报告即使Markdown合法也不能改绑合并', () => {
  publish();put(rel('07-commander-r1.md'), '# forged');const exact = commit();
  withRecordProvenance({ ...options, stage: 'judge', round: 1 }, () => expect(() => verifyMergeSource(cfg, { headRefOid: exact, headRefName: branch }, 1)).toThrow(/relation_missing|registration_missing/));
});
it('仅可信仓库配置决定适用范围，不消费任务自称PASS或自带root', () => {
  expect(sourceContext({ repoSlug: 'x/y' }, worktree, options, 'qa', 1, controller)).toBeNull();
  const c = sourceContext(cfg, worktree, { ...options, provenance: { status: 'verified' }, root: '/fake' }, 'qa', 1, controller);
  expect(c).not.toHaveProperty('root');expect(c).not.toHaveProperty('runId');expect(c).not.toHaveProperty('provenance');
});
it('真实Codex裁判子进程接收隔离事实，06封存后与05同次真实登记提交', async () => {
  const spec = rel('02-spec.md'), report = rel('05-qa-report-r1.md');
  put(spec, fm('spec', '### S-1\n对应 I-1'));seal('spec', [spec]);publish([spec]);
  put(report, fm('evaluate'));seal('evaluate', [report], 1);
  const bin = path.join(temp, 'fake-codex.mjs'), prompt = path.join(temp, 'judge-input.txt');
  const answer = JSON.stringify({ coverage: [{ intent: 'I-1', satisfied: true, evidence: 'fixture evidence' }], issues: [], summary: 'PASS' });
  fs.writeFileSync(bin, `#!/usr/bin/env node\nimport fs from 'node:fs';const p=fs.readFileSync(0,'utf8');fs.writeFileSync(${JSON.stringify(prompt)},p);const a=process.argv.slice(2);fs.writeFileSync(a[a.indexOf('--output-last-message')+1],${JSON.stringify(answer)});console.log(JSON.stringify({type:'thread.started',thread_id:'actual-test-process'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(answer)}}}));console.log(JSON.stringify({type:'turn.completed'}));\n`, { mode: 0o755 });
  const testCfg = { ...cfg, logDir: path.join(temp, 'logs'), judgeTimeoutMs: 10000, judgeConn: { provider: 'codex', model: 'fixture', codexHome: temp, codexBin: bin } };
  await withRecordProvenance({ ...options, stage: 'judge', round: 1 }, async () => {
    const result = await runJudge(testCfg, worktree, { ...options, intentIds: ['I-1'] }, { round: 1, reportRel: report });
    expect(result.error).toBeUndefined();expect(result.verdict).toBe('PASS');
    const sent = fs.readFileSync(prompt, 'utf8');expect(sent).toContain('sealed_not_registered');expect(sent).toContain('controller_registration_and_stage_capture');expect(sent).not.toContain('PRIVATE DEVELOPMENT BODY');
    const staged = await stageQaRecords(worktree, { taskId, sprintDir, round: 1 }, [report, rel(result.file)], { ...options, stage: 'qa', round: 1 });
    git(worktree, 'commit', '-qm', 'real QA judge registration');finalizeRecordRegistration(staged.registration);
    const proof = verifySourceHead(cfg, worktree, options, head());
    expect(proof.records.find(r => r.path === rel(result.file))).toMatchObject({ stage: 'judge', producer: 'controller_render' });
    expect(verifyMergeSource(cfg, { headRefOid: head(), headRefName: branch }, 1).status).toBe('verified');
  });
});
it('仅开发publish凭证不能让伪造approved.round绕过真实QA和裁判', () => {
  const exact = publish();
  withRecordProvenance({ ...options, stage: 'judge', round: 1 }, () => {
    expect(() => verifyMergeSource(cfg, { headRefOid: exact, headRefName: branch }, 1)).toThrow(/qa|round|approval/);
    expect(() => verifyMergeSource(cfg, { headRefOid: exact, headRefName: branch })).toThrow(/round/);
  });
});
it('Commander真实spec先提交再封存，新07登记能绑定spec新字节而不能沿用旧凭证', () => {
  const spec = rel('02-spec.md');put(spec, fm('spec'));seal('spec', [spec]);publish([spec]);
  withRecordProvenance({ ...options, stage: 'commander', round: 1 }, () => {
    put(spec, fm('spec', 'new clarification'));commit();native();
    expect(() => verifySourceHead(cfg, worktree, options, head())).toThrow(/registration_missing/);
    sealStageEvidence({ files: [spec], result: { status: 'completed' } });
    const record = rel('07-commander-r1.md');put(record, '# actual rendered ruling');
    sealStageEvidence({ files: [record], producer: 'controller_render', result: { status: 'completed' }, controllerInput: { action: 'resume', commits: [head()] } });
    const token = beginRecordRegistration({ ...options, stage: 'commander', round: 1 }, [spec, record]);
    observeRecordRegistration(token, registerRecordSources(worktree, { taskId, sprintDir, stage: 'commander', round: 1 }, [record]));
    commit();finalizeRecordRegistration(token);
    const proof = verifySourceHead(cfg, worktree, options, head());expect(proof.records.find(r => r.path === spec).stage).toBe('commander');
  });
});

it('registered judge retry uses original stage in a fresh worktree; product drift cannot reuse it', () => {
  const tested = publish(), report = rel('05-qa-report-r1.md');put(report, fm('evaluate'));
  const qa = seal('evaluate', [report], 1);
  const token = beginRecordRegistration({ ...options, stage: 'qa', round: 1, qaStageEventId: qa.id }, [report]);
  observeRecordRegistration(token, registerRecordSources(worktree, { taskId, sprintDir, stage: 'qa', round: 1 }, [report]));
  const registered = commit();finalizeRecordRegistration(token);
  const retryTree = path.join(temp, 'qa-retry');git(worktree, 'worktree', 'add', '-q', '--detach', retryTree, registered);
  withRecordProvenance({ ...options, stage: 'judge', round: 1 }, () => {
    const selector = { mode: 'registered', stageEventId: qa.id, testedHead: tested, round: 1 };
    const facts = judgeSourceFacts(cfg, retryTree, options, registered, report, selector);
    expect(facts.current_qa.status).toBe('verified');expect(facts.current_qa.isolation.qa_stage_event_id).toBe(qa.id);
    expect(facts.current_qa.isolation.tested_head).toBe(tested);
    expect(() => judgeSourceFacts(cfg, retryTree, options, registered, report, { ...selector, mode: 'pending' })).toThrow();
    put('product.txt', 'unreviewed');const drifted = commit();
    expect(() => judgeSourceFacts(cfg, worktree, options, drifted, report, selector)).toThrow(/isolation|retry|scope/);
    fs.unlinkSync(path.join(worktree, 'product.txt'));const reverted = commit();
    expect(() => judgeSourceFacts(cfg, worktree, options, reverted, report, selector)).toThrow(/isolation|retry|scope/);
  });
}, 20000);
