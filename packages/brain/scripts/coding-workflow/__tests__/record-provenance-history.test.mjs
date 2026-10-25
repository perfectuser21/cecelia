import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { withRecordProvenance, controllerIdentity, beginEvaluateIsolation, sealStageEvidence, beginRecordRegistration, observeRecordRegistration, finalizeRecordRegistration } from '../lib/record-provenance.mjs';
import { runClaude } from '../lib/claude.mjs';
import { registerRecordSources } from '../lib/record-sources.mjs';
import { sourceFacts, judgeSourceFacts } from '../runner/lib/source-provenance.mjs';

const taskId = '088c3431-57ca-4f2a-8a50-14601518e2a2', sprintDir = 'sprints/10121524-cw-088c3431';
const owner = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs';
const cfg = { repoSlug: 'perfectuser21/cecelia' };
let temp, worktree, root, options, head, qa, stages;
const git = (...a) => execFileSync('git', ['-C', worktree, '-c', 'core.hooksPath=/dev/null', ...a], { encoding: 'utf8' }).trim();
const put = (p, s) => { fs.mkdirSync(path.dirname(path.join(worktree, p)), { recursive: true });fs.writeFileSync(path.join(worktree, p), s); };
const rel = p => `${sprintDir}/${p}`;
const fm = stage => `---\ntask_id: ${taskId}\nstep: ${stage}\nupstream: []\n---\nPRIVATE REPORT BODY ${stage}\n`;
const commit = () => { git('add', '.');git('commit', '-qm', 'real fixture commit');return git('rev-parse', 'HEAD'); };
const events = () => fs.readdirSync(path.join(root, taskId)).filter(p => p.endsWith('.json')).map(p => JSON.parse(fs.readFileSync(path.join(root, taskId, p), 'utf8')));
function mutate(id, fn) {
  const p = path.join(root, taskId, `${id}.json`), e = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(e);delete e.digest;e.digest = createHash('sha256').update(JSON.stringify(e)).digest('hex');fs.writeFileSync(p, JSON.stringify(e));
}
async function pipe(stage, commands, failed = false) {
  const bin = path.join(temp, `native-${stage}-${failed}.mjs`);
  // The CLI fixture really runs each shell command, then emits its actual result on stdout.
  fs.writeFileSync(bin, `#!/usr/bin/env node\nimport fs from 'node:fs';import{spawnSync}from'node:child_process';
const send=x=>console.log(JSON.stringify(x));send({type:'thread.started',thread_id:'actual-${stage}-${failed}'});
send({type:'item.completed',item:{id:'reasoning',type:'reasoning',text:'PRIVATE_REASONING_SENTINEL'}});
for(const [n,command]of ${JSON.stringify(commands)}.entries()){const r=spawnSync('/bin/sh',['-c',command],{encoding:'utf8'});send({type:'item.completed',item:{id:'item_'+n,type:'command_execution',command,aggregated_output:r.stdout+r.stderr,exit_code:r.status,status:r.status===0?'completed':'failed'}});}
const a=process.argv.slice(2),i=a.indexOf('--output-last-message');if(i>=0)fs.writeFileSync(a[i+1],'done');
if(${failed})send({type:'error',message:'PRIVATE_NATIVE_ERROR_SENTINEL'});
send(${JSON.stringify(failed ? { type: 'turn.failed', error: { message: 'actual failed fixture session' } } : { type: 'turn.completed' })});process.exit(${failed ? 1 : 0});\n`, { mode: 0o755 });
  return runClaude({ args: ['-p', 'fixture'], cwd: worktree, tag: stage, timeoutMs: 10000, provider: 'codex',
    codexEnv: { CODING_WF_CODEX_BIN: bin, CODING_WF_CODEX_MODEL: 'fixture', CODING_WF_CODEX_HOME: temp } });
}
const facts = () => withRecordProvenance({ ...options, stage: 'judge', round: 1 }, () =>
  judgeSourceFacts(cfg, worktree, options, head, rel('05-qa-report-r1.md'), { mode: 'pending', stageEventId: qa.id, testedHead: head, round: 1 }));
beforeEach(async () => {
  temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'history-producer-'));worktree = path.join(temp, 'repo');root = path.join(temp, '.cecelia', 'coding-workflow-provenance');fs.mkdirSync(worktree);vi.stubEnv('HOME', temp);
  git('init', '-qb', 'cp-10121524-cw-088c3431');git('config', 'user.name', 'fixture');git('config', 'user.email', 'fixture@example.invalid');git('remote', 'add', 'origin', 'https://github.com/perfectuser21/cecelia.git');
  put('README.md', 'base');put(owner, '// actual test controller');put('.implementation-source-relations.json', JSON.stringify({ schema_version: 1, repo: cfg.repoSlug, relations: [] }));commit();git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  options = { root, worktree, taskId, sprintDir, controller: controllerIdentity(pathToFileURL(path.join(worktree, owner))) };
  put(rel('01-intent.md'), fm('intent'));
  withRecordProvenance({ ...options, stage: 'intent' }, () => sealStageEvidence({ files: [rel('01-intent.md')], result: { status: 'completed' }, producer: 'controller' }));
  stages = {};
  for (const [stage, file] of [['build', '03-build.md'], ['verify', '04-evidence.md']]) {
    put(rel(file), fm(stage));
    stages[stage] = await withRecordProvenance({ ...options, stage }, async () => {
      if (stage === 'verify') expect((await pipe(stage, ["printf 'ORIGINAL_FAILED_SESSION_OUTPUT'; exit 9"], true)).code).toBe(1);
      expect((await pipe(stage, ["printf 'HISTORICAL_ORIGINAL_OUTPUT\\n'", "printf 'HISTORICAL_ORIGINAL_OUTPUT\\n'", 'exit 7', "printf ''", `cat ${rel(file)}`])).code).toBe(0);
      return sealStageEvidence({ files: [rel(file)], result: { status: 'completed' } });
    });
  }
  const files = ['01-intent.md', '03-build.md', '04-evidence.md'].map(rel);
  const token = beginRecordRegistration({ ...options, stage: 'publish' }, files);
  observeRecordRegistration(token, registerRecordSources(worktree, { taskId, sprintDir, stage: 'publish' }, files));head = commit();finalizeRecordRegistration(token);
  put(rel('05-qa-report-r1.md'), fm('evaluate'));
  qa = await withRecordProvenance({ ...options, stage: 'evaluate', round: 1 }, async () => {
    const isolation = beginEvaluateIsolation();expect((await pipe('evaluate', ["printf 'CURRENT_QA_ONLY' "])).code).toBe(0);expect(isolation.restore()).toBe(true);
    return sealStageEvidence({ files: [rel('05-qa-report-r1.md')], result: { status: 'completed' } });
  });
});
afterEach(() => { vi.unstubAllEnvs();fs.rmSync(temp, { recursive: true, force: true }); });
it('真实producer原管道保留失败/重复/空输出，只向judge投影历史而非公开sourceFacts', () => {
  const h = facts().historical_execution;
  expect(h).toMatchObject({ schema_version: 1, evidence_scope: 'historical_registered_stage_execution', task_id: taskId, sprint_dir: sprintDir, head });
  expect(h.stages.map(s => s.stage)).toEqual(['build', 'verify']);
  const build = h.stages[0], verify = h.stages[1];
  expect(build.stage_event_id).toBe(stages.build.id);expect(verify.stage_event_id).toBe(stages.verify.id);
  expect(build.natives).toHaveLength(1);expect(verify.natives).toHaveLength(2);
  for (const stage of h.stages) for (const n of stage.natives) {
    const original = events().find(e => e.id === n.native_event_id);
    expect(n).toMatchObject({ stdout_sha256: createHash('sha256').update(original.stdout).digest('hex'), stdout_bytes: Buffer.byteLength(original.stdout), error_event_seen: original.stdout.includes('"type":"error"') });
    expect(n).not.toHaveProperty('stdout');expect(n).not.toHaveProperty('stderr');
  }
  expect(build.natives[0].executions.map(x => [x.command, x.output, x.exit_code])).toEqual([
    ["printf 'HISTORICAL_ORIGINAL_OUTPUT\\n'", 'HISTORICAL_ORIGINAL_OUTPUT\n', 0],
    ["printf 'HISTORICAL_ORIGINAL_OUTPUT\\n'", 'HISTORICAL_ORIGINAL_OUTPUT\n', 0], ['exit 7', '', 7], ["printf ''", '', 0], [`cat ${rel('03-build.md')}`, fm('build'), 0],
  ]);
  expect(verify.natives[0]).toMatchObject({ success: false, execution_complete: false, code: 1, executions: [expect.objectContaining({ output: 'ORIGINAL_FAILED_SESSION_OUTPUT', exit_code: 9 })] });
  expect(verify.natives[1]).toMatchObject({ success: true, execution_complete: true });
  expect(JSON.stringify(h)).not.toContain('PRIVATE_REASONING_SENTINEL');expect(JSON.stringify(h)).not.toContain('PRIVATE_NATIVE_ERROR_SENTINEL');expect(JSON.stringify(h)).toContain('PRIVATE REPORT BODY build');expect(JSON.stringify(h)).toContain('PRIVATE REPORT BODY verify');
  const publicFacts = withRecordProvenance({ ...options, stage: 'judge', round: 1 }, () => sourceFacts(worktree, options, head));
  expect(publicFacts).not.toHaveProperty('historical_execution');expect(JSON.stringify(publicFacts)).not.toContain('HISTORICAL_ORIGINAL_OUTPUT');expect(JSON.stringify(publicFacts)).not.toContain('PRIVATE REPORT BODY');expect(JSON.stringify(publicFacts)).not.toContain(`cat ${rel('03-build.md')}`);
});
it.each(['run_id', 'stage', 'round', 'controller', 'provider', 'kind'])('非current失败native的%s绑定被篡改也拒绝，不能只验证成功末次', key => {
  mutate(stages.verify.native_ids[0], e => {
    if (key === 'controller') e.controller.modules[0].sha256 = '0'.repeat(64);
    else if (key === 'round') e.round = 42;
    else e[key] = key === 'run_id' ? '11111111-2222-4333-8444-555555555555' : 'foreign';
  });
  expect(facts).toThrow(/history|native|provenance/);
});
it.each(['bad-json', 'missing-output', 'missing-exit', 'duplicate-id', 'unfinished-command'])('失败session的%s不能被略过再声称历史完整', kind => {
  mutate(stages.verify.native_ids[0], e => {
    const rows = e.stdout.trimEnd().split('\n').map(JSON.parse), cmd = rows.find(r => r.item?.type === 'command_execution');
    if (kind === 'bad-json') { e.stdout += 'not json\n';return; }
    if (kind === 'missing-output') delete cmd.item.aggregated_output;
    if (kind === 'missing-exit') delete cmd.item.exit_code;
    if (kind === 'duplicate-id') rows.splice(rows.length - 1, 0, cmd);
    if (kind === 'unfinished-command') rows.splice(rows.length - 1, 0, { type: 'item.started', item: { id: 'unfinished', type: 'command_execution', command: 'never completed' } });
    e.stdout = rows.map(JSON.stringify).join('\n') + '\n';
  });
  expect(facts).toThrow(/history|native|provenance/);
});
it('非judge上下文不能通过调用judgeSourceFacts取得历史原件', () => {
  expect(() => withRecordProvenance({ ...options, stage: 'verify' }, () => judgeSourceFacts(cfg, worktree, options, head, rel('05-qa-report-r1.md'), { mode: 'pending', stageEventId: qa.id, testedHead: head, round: 1 }))).toThrow(/history|judge|context|provenance/);
});
