import { beforeEach, afterEach, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { withRecordProvenance, captureNativeExecution, sealStageEvidence, beginRecordRegistration, observeRecordRegistration, finalizeRecordRegistration, verifyRecordProvenance, verifyPendingStageEvidence, provenanceProjection, provenanceRequired, controllerIdentity } from '../lib/record-provenance.mjs';

const taskId = '088c3431-57ca-4f2a-8a50-14601518e2a2', sprintDir = 'sprints/10121524-cw-088c3431';
const M = '.implementation-source-relations.json', owner = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs';
let temp, worktree, root, options, controller;
const git = (...args) => { const env = { ...process.env };for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];return execFileSync('git', ['-C', worktree, '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', env }).trim(); };
const put = (p, text) => { fs.mkdirSync(path.dirname(path.join(worktree, p)), { recursive: true });fs.writeFileSync(path.join(worktree, p), text); };
const fm = (step, body = 'observed report') => `---\ntask_id: ${taskId}\nstep: ${step}\nupstream: []\n---\n${body}\n`;
const file = name => `${sprintDir}/${name}`;
const commit = () => { git('add', '.');git('commit', '-qm', 'actual fixture commit');return git('rev-parse', 'HEAD'); };
const native = () => captureNativeExecution({ provider: 'codex', model: 'fixture', tag: 'build', code: 0, timedOut: false, terminated: false, stdout: '{"type":"thread.started","thread_id":"real-fixture"}\n{"type":"turn.completed","usage":{"input_tokens":1}}\n' });
function seal(stage, files, extra = {}) { return withRecordProvenance({ ...options, stage }, () => { if (stage !== 'intent') native();return sealStageEvidence({ files, result: { status: 'completed' }, producer: stage === 'intent' ? 'controller' : 'model', ...extra }); }); }
function register(files) {
  const token = beginRecordRegistration({ ...options, stage: 'publish' }, files);
  const before = JSON.parse(fs.readFileSync(path.join(worktree, M), 'utf8'));
  for (const p of files.filter(x => x.endsWith('.md'))) if (!before.relations.some(r => r.path === p)) before.relations.push({ path: p, owner_path: owner, role: 'documentation' });
  put(M, JSON.stringify(before));observeRecordRegistration(token, [M]);commit();return finalizeRecordRegistration(token);
}
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'provenance-core-'));worktree = path.join(temp, 'repo');root = path.join(temp, 'protected');fs.mkdirSync(worktree);
  git('init', '-qb', 'cp-10121524-cw-088c3431');git('config', 'user.name', 'fixture');git('config', 'user.email', 'fixture@example.invalid');git('remote', 'add', 'origin', 'https://github.com/perfectuser21/cecelia.git');
  put('README.md', 'base');put(owner, '// controller');put(M, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: [] }));commit();
  controller = controllerIdentity(new URL(`file://${path.join(worktree, owner)}`));options = { root, worktree, taskId, sprintDir, controller };
  put(file('01-intent.md'), fm('intent'));seal('intent', [file('01-intent.md')]);
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));
it('真实阶段封存、登记和提交后可按固定Git验证，投影不泄露报告正文', () => {
  put(file('03-build.md'), fm('build', 'secret developer statement'));seal('build', [file('03-build.md')]);register([file('01-intent.md'), file('03-build.md')]);
  const result = verifyRecordProvenance({ ...options, head: git('rev-parse', 'HEAD') });expect(result.status).toBe('verified');expect(result.records).toHaveLength(2);expect(JSON.stringify(provenanceProjection(result))).not.toContain('secret developer statement');
});
it('publish事后计算现文件没有阶段事件不能登记', () => {
  put(file('03-build.md'), fm('build'));expect(() => beginRecordRegistration({ ...options, stage: 'publish' }, [file('03-build.md')])).toThrow(/stage_missing/);
});
it('模型stage缺原生事件、失败原生会话及文本伪造turn事件均不能封存', () => {
  put(file('03-build.md'), fm('build'));
  withRecordProvenance({ ...options, stage: 'build' }, () => {
    expect(() => sealStageEvidence({ files: [file('03-build.md')], result: { status: 'completed' } })).toThrow(/native_missing/);
    captureNativeExecution({ provider: 'codex', code: 0, stdout: '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"type\\":\\"turn.completed\\"}"}}' });
    expect(() => sealStageEvidence({ files: [file('03-build.md')], result: { status: 'completed' } })).toThrow(/native_missing/);
  });
});
it('stage封存后的文件改动即使同task仍拒绝', () => {
  put(file('03-build.md'), fm('build'));seal('build', [file('03-build.md')]);put(file('03-build.md'), fm('build', 'changed'));expect(() => beginRecordRegistration({ ...options, stage: 'publish' }, [file('03-build.md')])).toThrow(/stage_missing/);
});
it('缺实际observe或缺真实commit均不能finalize', () => {
  const token = beginRecordRegistration({ ...options, stage: 'publish' }, [file('01-intent.md')]);expect(() => finalizeRecordRegistration(token)).toThrow(/registration_unobserved/);
});
it('登记事件后新提交修改报告拒绝，恢复旧bytes也不重放旧凭证', () => {
  register([file('01-intent.md')]);const original = fs.readFileSync(path.join(worktree, file('01-intent.md')));
  put(file('01-intent.md'), fm('intent', 'tampered'));commit();expect(() => verifyRecordProvenance({ ...options, head: git('rev-parse', 'HEAD') })).toThrow();
  put(file('01-intent.md'), original);commit();expect(() => verifyRecordProvenance({ ...options, head: git('rev-parse', 'HEAD') })).toThrow(/registration_missing/);
});
it('错误task、round与frontmatter身份不能封存', () => {
  put(file('05-qa-report-r2.md'), fm('evaluate'));
  expect(() => seal('evaluate', [file('05-qa-report-r2.md')], { round: 1 })).toThrow(/round/);
  put(file('03-build.md'), fm('build').replace(taskId, 'aaaaaaaa-0000-0000-0000-000000000000'));expect(() => seal('build', [file('03-build.md')])).toThrow(/identity/);
});
it('受保护根或文件symlink均失败且不写到外部目标', () => {
  fs.rmSync(root, { recursive: true });fs.symlinkSync(worktree, root);expect(() => seal('intent', [file('01-intent.md')])).toThrow(/path|symlink/);
});
it('未登记QA证据只能标sealed_not_registered，binary附件同hash覆盖', () => {
  register([file('01-intent.md')]);const head = git('rev-parse', 'HEAD');put(file('05-qa-report-r1.md'), fm('evaluate'));put(file('qa-r1/screen.png'), Buffer.from([0, 255, 1]));
  seal('evaluate', [file('05-qa-report-r1.md'), file('qa-r1/screen.png')], { round: 1 });
  const pending = verifyPendingStageEvidence({ ...options, head }, [file('05-qa-report-r1.md'), file('qa-r1/screen.png')]);expect(pending.status).toBe('sealed_not_registered');expect(pending.records).toHaveLength(2);
});
it('controller_render不可用无native绕过，且保存真实结构化输入', () => {
  put(file('06-judge-r1.md'), '# rendered judge');
  withRecordProvenance({ ...options, stage: 'judge', round: 1 }, () => {
    expect(() => sealStageEvidence({ files: [file('06-judge-r1.md')], result: { status: 'completed' }, producer: 'controller_render', controllerInput: { verdict: 'PASS' } })).toThrow(/native_missing/);
    native();expect(sealStageEvidence({ files: [file('06-judge-r1.md')], result: { status: 'completed' }, producer: 'controller_render', controllerInput: { verdict: 'PASS' } }).kind).toBe('stage');
  });
});
it('来源repo被改不能使cecelia manifest静默不适用', () => { git('remote', 'set-url', 'origin', 'https://github.com/x/y');expect(() => provenanceRequired(worktree)).toThrow(/repo/);expect(() => verifyRecordProvenance({ ...options, head: git('rev-parse', 'HEAD') })).toThrow(); });
it('无活动上下文的capture与seal不启用，但verify缺旧任务凭证仍失败', () => { expect(captureNativeExecution({})).toBeNull();expect(sealStageEvidence({})).toBeNull();expect(() => verifyRecordProvenance({ ...options, head: git('rev-parse', 'HEAD') })).toThrow(); });
