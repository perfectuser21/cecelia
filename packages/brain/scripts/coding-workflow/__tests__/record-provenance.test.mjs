import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { beginEvaluateIsolation, withRecordProvenance, captureNativeExecution, sealStageEvidence, beginRecordRegistration, observeRecordRegistration, finalizeRecordRegistration, verifyRecordProvenance, verifyPendingStageEvidence, provenanceProjection, provenanceRequired, controllerIdentity } from '../lib/record-provenance.mjs';

const taskId = '088c3431-57ca-4f2a-8a50-14601518e2a2', sprintDir = 'sprints/10121524-cw-088c3431';
const M = '.implementation-source-relations.json', owner = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs';
let temp, worktree, root, options, controller, lastQaStageId;
const git = (...args) => { const env = { ...process.env };for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];return execFileSync('git', ['-C', worktree, '-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', env }).trim(); };
const put = (p, text) => { fs.mkdirSync(path.dirname(path.join(worktree, p)), { recursive: true });fs.writeFileSync(path.join(worktree, p), text); };
const fm = (step, body = 'observed report') => `---\ntask_id: ${taskId}\nstep: ${step}\nupstream: []\n---\n${body}\n`;
const file = name => `${sprintDir}/${name}`;
const commit = () => { git('add', '.');git('commit', '-qm', 'actual fixture commit');return git('rev-parse', 'HEAD'); };
const native = () => captureNativeExecution({ provider: 'codex', model: 'fixture', tag: 'build', code: 0, timedOut: false, terminated: false, stdout: '{"type":"thread.started","thread_id":"real-fixture"}\n{"type":"turn.completed","usage":{"input_tokens":1}}\n' });
function seal(stage, files, extra = {}) { const sealed = withRecordProvenance({ ...options, stage, round: extra.round ?? 0 }, () => { const isolated = stage === 'evaluate' ? beginEvaluateIsolation() : null;if (stage !== 'intent') native();if (isolated) expect(isolated.restore()).toBe(true);return sealStageEvidence({ files, result: { status: 'completed' }, producer: stage === 'intent' ? 'controller' : 'model', ...extra }); });if (stage === 'evaluate') lastQaStageId = sealed.id;return sealed; }
function register(files) {
  const token = beginRecordRegistration({ ...options, stage: 'publish' }, files);
  const before = JSON.parse(fs.readFileSync(path.join(worktree, M), 'utf8'));
  for (const p of files.filter(x => x.endsWith('.md'))) if (!before.relations.some(r => r.path === p)) before.relations.push({ path: p, owner_path: owner, role: 'documentation' });
  put(M, JSON.stringify(before));observeRecordRegistration(token, [M]);commit();return finalizeRecordRegistration(token);
}
function prepareQa() {
  for (const [stage, name] of [['build', '03-build.md'], ['verify', '04-evidence.md']]) {
    put(file(name), fm(stage));seal(stage, [file(name)]);
  }
  register([file('01-intent.md'), file('03-build.md'), file('04-evidence.md')]);
}
beforeEach(() => {
  lastQaStageId = undefined;
  temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'provenance-core-'));worktree = path.join(temp, 'repo');root = path.join(temp, 'protected');fs.mkdirSync(worktree);
  git('init', '-qb', 'cp-10121524-cw-088c3431');git('config', 'user.name', 'fixture');git('config', 'user.email', 'fixture@example.invalid');git('remote', 'add', 'origin', 'https://github.com/perfectuser21/cecelia.git');
  put('README.md', 'base');put(owner, '// controller');put(M, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: [] }));commit();
  controller = controllerIdentity(new URL(`file://${path.join(worktree, owner)}`));options = { root, worktree, taskId, sprintDir, controller };
  put(file('01-intent.md'), fm('intent'));seal('intent', [file('01-intent.md')]);
});
afterEach(() => { vi.restoreAllMocks();fs.rmSync(temp, { recursive: true, force: true }); });
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
  prepareQa();
  put(file('05-qa-report-r2.md'), fm('evaluate'));
  expect(() => seal('evaluate', [file('05-qa-report-r2.md')], { round: 1 })).toThrow(/round/);
  put(file('03-build.md'), fm('build').replace(taskId, 'aaaaaaaa-0000-0000-0000-000000000000'));expect(() => seal('build', [file('03-build.md')])).toThrow(/identity/);
});
it('受保护根或文件symlink均失败且不写到外部目标', () => {
  fs.rmSync(root, { recursive: true });fs.symlinkSync(worktree, root);expect(() => seal('intent', [file('01-intent.md')])).toThrow(/path|symlink/);
});
it('未登记QA证据只能标sealed_not_registered，binary附件同hash覆盖', () => {
  prepareQa();const head = git('rev-parse', 'HEAD');put(file('05-qa-report-r1.md'), fm('evaluate'));put(file('qa-r1/screen.png'), Buffer.from([0, 255, 1]));
  seal('evaluate', [file('05-qa-report-r1.md'), file('qa-r1/screen.png')], { round: 1 });
  const pending = verifyPendingStageEvidence({ ...options, head, stageEventId: lastQaStageId }, [file('05-qa-report-r1.md'), file('qa-r1/screen.png')]);expect(pending.status).toBe('sealed_not_registered');expect(pending.records).toHaveLength(2);
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

it('同context后轮exit0无turn.completed不能借前轮成功封存', () => {
  put(file('02-review-r1.md'), fm('spec_review'));put(file('02-review-r2.md'), fm('spec_review'));
  withRecordProvenance({ ...options, stage: 'spec_review' }, () => {
    const first = native();sealStageEvidence({ files: [file('02-review-r1.md')], result: { status: 'completed' }, round: 1 });
    captureNativeExecution({ provider: 'codex', code: 0, stdout: '{"type":"thread.started","thread_id":"failed-second"}\n' });
    expect(() => sealStageEvidence({ files: [file('02-review-r2.md')], result: { status: 'completed' }, round: 2 })).toThrow(/native_missing/);
    expect(() => sealStageEvidence({ files: [file('02-review-r2.md')], result: { status: 'completed' }, round: 2, nativeIds: [first.id] })).toThrow(/native_missing/);
  });
});
it('已有真实receipt的push失败重试可无新commit复用，但不补造旧历史', () => {
  const first = register([file('01-intent.md')]);const token = beginRecordRegistration({ ...options, stage: 'publish' }, [file('01-intent.md')]);observeRecordRegistration(token, []);
  const reused = finalizeRecordRegistration(token);expect(reused.reused).toBe(true);expect(reused.event_ids).toEqual([first.id]);
});
it('commit成功但证据原子发布失败，重入不能从当前Git补造成功', () => {
  const token = beginRecordRegistration({ ...options, stage: 'publish' }, [file('01-intent.md')]);
  put(M, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: [{ path: file('01-intent.md'), owner_path: owner, role: 'documentation' }] }));observeRecordRegistration(token, [M]);commit();
  const link = vi.spyOn(fs, 'linkSync').mockImplementationOnce(() => { throw Error('injected disk failure'); });
  expect(() => finalizeRecordRegistration(token)).toThrow('injected disk failure');link.mockRestore();
  expect(() => finalizeRecordRegistration(token)).toThrow(/registration_unobserved/);
  const retry = beginRecordRegistration({ ...options, stage: 'publish' }, [file('01-intent.md')]);observeRecordRegistration(retry, []);expect(() => finalizeRecordRegistration(retry)).toThrow(/registration_missing/);
});
it('任意存在的精确Git提交可验证，不要求当前checkout等于目标head', () => {
  register([file('01-intent.md')]);const head = git('rev-parse', 'HEAD');put('README.md', 'later');commit();expect(verifyRecordProvenance({ ...options, head }).head).toBe(head);
});
it('publish上下文只传承受保护root，不允许伪造publish stage证明', () => {
  withRecordProvenance({ ...options, stage: 'publish' }, () => {
    expect(() => sealStageEvidence({ files: [file('01-intent.md')], result: { status: 'completed' }, producer: 'controller' })).toThrow(/stage_not_completed/);
    expect(beginRecordRegistration({ worktree, taskId, sprintDir, controller, stage: 'publish' }, [file('01-intent.md')])).toHaveProperty('id');
  });
});
it('已提交报告的native原文损坏、投影路径夹带内容均拒绝', () => {
  put(file('03-build.md'), fm('build'));seal('build', [file('03-build.md')]);register([file('01-intent.md'), file('03-build.md')]);const head = git('rev-parse', 'HEAD');
  const result = verifyRecordProvenance({ ...options, head });expect(() => provenanceProjection({ ...result, records: [{ ...result.records[0], path: 'developer text' }] })).toThrow();
  const dir = path.join(root, taskId), name = fs.readdirSync(dir).find(n => JSON.parse(fs.readFileSync(path.join(dir, n))).kind === 'native');
  const target = path.join(dir, name), data = JSON.parse(fs.readFileSync(target));data.stdout = 'tampered';fs.writeFileSync(target, JSON.stringify(data));expect(() => verifyRecordProvenance({ ...options, head })).toThrow(/event_invalid/);
});
it('已登记报告或binary附件不能通过缩小当前files静默删除', () => {
  put(file('03-build.md'), fm('build'));seal('build', [file('03-build.md')]);register([file('01-intent.md'), file('03-build.md')]);
  fs.unlinkSync(path.join(worktree, file('03-build.md')));commit();expect(() => verifyRecordProvenance({ ...options, head: git('rev-parse', 'HEAD') })).toThrow(/record_deleted/);
});
it('真实Git tree或parents与event不匹配即使重新算digest也拒绝', () => {
  register([file('01-intent.md')]);const dir = path.join(root, taskId), name = fs.readdirSync(dir).find(n => JSON.parse(fs.readFileSync(path.join(dir, n))).kind === 'registration');
  const target = path.join(dir, name), data = JSON.parse(fs.readFileSync(target));data.tree = '0'.repeat(40);delete data.digest;
  // 同UID写回只用于检验格式与Git绑定，不宣称攻击者可穿透sandbox。
  const sha = execFileSync(process.execPath, ['-e', "process.stdout.write(require('node:crypto').createHash('sha256').update(process.argv[1]).digest('hex'))", JSON.stringify(data)], { encoding: 'utf8' });
  fs.writeFileSync(target, JSON.stringify({ ...data, digest: sha }));expect(() => verifyRecordProvenance({ ...options, head: git('rev-parse', 'HEAD') })).toThrow(/registration_git_mismatch/);
});
it('register之后两次提交不能把末尾无关commit冒充登记commit', () => {
  const token = beginRecordRegistration({ ...options, stage: 'publish' }, [file('01-intent.md')]);
  put(M, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: [{ path: file('01-intent.md'), owner_path: owner, role: 'documentation' }] }));observeRecordRegistration(token, [M]);commit();put('README.md', 'intervening');commit();
  expect(() => finalizeRecordRegistration(token)).toThrow(/commit_parent/);
});
it('QA中文空格可执行附件保持mode且删除附件同样拒绝', () => {
  prepareQa();const report = file('05-qa-report-r1.md'), attachment = file('qa-r1/实跑 证据.sh');put(report, fm('evaluate'));put(attachment, '#!/bin/sh\nexit 0\n');fs.chmodSync(path.join(worktree, attachment), 0o755);
  seal('evaluate', [report, attachment], { round: 1 });const token = beginRecordRegistration({ ...options, stage: 'qa', round: 1, qaStageEventId: lastQaStageId }, [report, attachment]);
  const data = JSON.parse(fs.readFileSync(path.join(worktree, M)));data.relations.push({ path: report, owner_path: owner, role: 'documentation' });put(M, JSON.stringify(data));observeRecordRegistration(token, [M]);commit();finalizeRecordRegistration(token);
  expect(verifyRecordProvenance({ ...options, head: git('rev-parse', 'HEAD') }).records.find(r => r.path === attachment).mode).toBe('100755');
  fs.unlinkSync(path.join(worktree, attachment));commit();expect(() => verifyRecordProvenance({ ...options, head: git('rev-parse', 'HEAD') })).toThrow(/record_deleted/);
});
it('未受保护的Claude profile不能封存模型stage', () => {
  put(file('03-build.md'), fm('build'));withRecordProvenance({ ...options, stage: 'build' }, () => {
    captureNativeExecution({ provider: 'claude', code: 0, stdout: '{"type":"result","subtype":"success"}\n' });expect(() => sealStageEvidence({ files: [file('03-build.md')], result: { status: 'completed' } })).toThrow(/native_missing/);
  });
});
it('固定Git不受可写replace refs假树影响', () => {
  register([file('01-intent.md')]);const valid = git('rev-parse', 'HEAD');put(file('01-intent.md'), fm('intent', 'FORGED'));const forged = commit();const replacement = git('commit-tree', git('rev-parse', `${valid}^{tree}`), '-p', valid, '-m', 'replacement view');git('replace', forged, replacement);
  expect(() => verifyRecordProvenance({ ...options, head: forged })).toThrow();
});
it('info grafts不能隐藏报告篡改再恢复的历史', () => {
  register([file('01-intent.md')]);const valid = git('rev-parse', 'HEAD'), original = fs.readFileSync(path.join(worktree, file('01-intent.md')));
  put(file('01-intent.md'), fm('intent', 'FORGED'));commit();put(file('01-intent.md'), original);const restored = commit();put('.git/info/grafts', `${restored} ${valid}\n`);
  expect(() => verifyRecordProvenance({ ...options, head: restored })).toThrow();
});
it('最终合并要求真实同轮QA与judge凭证，publish前缀不冒充PASS', () => {
  register([file('01-intent.md')]);expect(() => verifyRecordProvenance({ ...options, head: git('rev-parse', 'HEAD'), requiredQaRound: 1 })).toThrow(/qa_proof_missing/);
});
it.each(['valid', 'legacy-proof', 'qa-fail', 'judge-fail', 'wrong-qa-event', 'wrong-tested-head', 'wrong-round'])('最终同轮QA/judge真实链：%s', kind => {
  prepareQa();const tested = git('rev-parse', 'HEAD'), report = file('05-qa-report-r1.md'), judged = file('06-judge-r1.md');
  put(report, fm('evaluate'));
  const qa = withRecordProvenance({ ...options, stage: 'evaluate', round: 1 }, () => { const isolated = beginEvaluateIsolation();native();expect(isolated.restore()).toBe(true);return sealStageEvidence({ files: [report], result: { status: 'completed', outputs: { qa: { verdict: kind === 'qa-fail' ? 'FAIL' : 'PASS', round: 1 } } } }); });
  put(judged, '# controller-rendered judge');
  withRecordProvenance({ ...options, stage: 'judge', round: 1 }, () => {
    native();sealStageEvidence({ files: [judged], producer: 'controller_render', result: { status: 'completed', outputs: { judge_verdict: kind === 'judge-fail' ? 'FAIL' : 'PASS' } }, controllerInput: { round: 1, decision: { verdict: kind === 'judge-fail' ? 'FAIL' : 'PASS' }, qa_stage_event_id: kind === 'wrong-qa-event' ? '00000000-0000-0000-0000-000000000000' : qa.id, tested_head: kind === 'wrong-tested-head' ? '0'.repeat(40) : tested } });
  });
  if (kind === 'wrong-qa-event') { expect(() => beginRecordRegistration({ ...options, stage: 'qa', round: 1, qaStageEventId: qa.id }, [report, judged])).toThrow(/stage_missing|qa_stage_binding/);return; }
  const token = beginRecordRegistration({ ...options, stage: 'qa', round: 1, qaStageEventId: qa.id }, [report, judged]);const data = JSON.parse(fs.readFileSync(path.join(worktree, M)));
  data.relations.push(...[report, judged].map(p => ({ path: p, owner_path: owner, role: 'documentation' })));put(M, JSON.stringify(data));observeRecordRegistration(token, [M]);const head = commit();finalizeRecordRegistration(token);
  if (kind === 'legacy-proof') {
    const target = path.join(root, taskId, `${qa.id}.json`), data = JSON.parse(fs.readFileSync(target));
    delete data.isolation_event_id;delete data.digest;
    fs.writeFileSync(target, JSON.stringify({ ...data, digest: createHash('sha256').update(JSON.stringify(data)).digest('hex') }));
    expect(verifyRecordProvenance({ ...options, head }).status).toBe('verified');
    expect(() => verifyRecordProvenance({ ...options, head, requiredQaRound: 1 })).toThrow(/isolation_missing/);return;
  }
  if (kind === 'valid') expect(verifyRecordProvenance({ ...options, head, requiredQaRound: 1 }).status).toBe('verified');
  else expect(() => verifyRecordProvenance({ ...options, head, requiredQaRound: kind === 'wrong-round' ? 2 : 1 })).toThrow(/qa_proof_missing|qa_pass_missing|judge_pass_missing/);
}, 15000);

it('同head同正文的两次QA与裁判按明确QA阶段选择，第二次可真实登记', () => {
  prepareQa();const tested = git('rev-parse', 'HEAD'), report = file('05-qa-report-r1.md'), judged = file('06-judge-r1.md');
  put(report, fm('evaluate'));put(judged, '# identical judge report');
  const attempts = [1, 2].map(() => {
    const qa = seal('evaluate', [report], { round: 1 });
    const judge = withRecordProvenance({ ...options, stage: 'judge', round: 1 }, () => {
      native();return sealStageEvidence({ files: [judged], result: { status: 'completed' }, producer: 'controller_render', controllerInput: { qa_stage_event_id: qa.id, tested_head: tested, round: 1 } });
    });return { qa, judge };
  });
  for (const { qa } of attempts) expect(() => beginRecordRegistration({ ...options, stage: 'qa', round: 1, qaStageEventId: qa.id }, [report, judged])).not.toThrow();
  const token = beginRecordRegistration({ ...options, stage: 'qa', round: 1, qaStageEventId: attempts[1].qa.id }, [report, judged]);
  const data = JSON.parse(fs.readFileSync(path.join(worktree, M)));data.relations.push(...[report, judged].map(p => ({ path: p, owner_path: owner, role: 'documentation' })));
  put(M, JSON.stringify(data));observeRecordRegistration(token, [M]);const head = commit();finalizeRecordRegistration(token);
  const records = verifyRecordProvenance({ ...options, head }).records;
  expect(records.find(r => r.path === report).stage_event_id).toBe(attempts[1].qa.id);
  expect(records.find(r => r.path === judged).stage_event_id).toBe(attempts[1].judge.id);
}, 15000);
