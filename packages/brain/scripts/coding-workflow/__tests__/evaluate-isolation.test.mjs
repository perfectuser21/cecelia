import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { withRecordProvenance, controllerIdentity, captureNativeExecution, sealStageEvidence,
  beginRecordRegistration, observeRecordRegistration, finalizeRecordRegistration, verifyPendingStageEvidence } from '../lib/record-provenance.mjs';
import { judgeSourceFacts } from '../runner/lib/source-provenance.mjs';

// 真 evaluate 父进程→runClaude→可控原生子进程；无外部服务、凭据或真实任务。
it.each(['pass', 'timeout', 'signal', 'collision'])('actual evaluate child lifecycle: %s', async mode => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'evaluate-isolation-')));
  const worktree = path.join(temp, 'repo'), root = path.join(temp, 'protected');fs.mkdirSync(worktree);
  const taskId = '088c3431-57ca-4f2a-8a50-14601518e2a2', sprintDir = 'sprints/10121524-cw-088c3431';
  const owner = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs', manifest = '.implementation-source-relations.json';
  const env = { ...process.env };for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  const git = (...args) => execFileSync('git', ['-C', worktree, '-c', 'core.hooksPath=/dev/null', ...args], { env, encoding: 'utf8' }).trim();
  const put = (rel, text) => { const p = path.join(worktree, rel);fs.mkdirSync(path.dirname(p), { recursive: true });fs.writeFileSync(p, text); };
  const fm = (step, body) => `---\ntask_id: ${taskId}\nstep: ${step}\nupstream: []\n---\n${body}\n`;
  const inputText = fm('intent', '### I-1\nInspect actual workspace');
  try {
    git('init', '-qb', 'cp-10121524-cw-088c3431');git('config', 'user.name', 'fixture');git('config', 'user.email', 'fixture@example.invalid');
    git('remote', 'add', 'origin', 'https://github.com/perfectuser21/cecelia.git');
    put(owner, '// test controller');put(manifest, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: [] }));
    git('add', '.');git('commit', '-qm', 'base');
    const options = { root, worktree, taskId, sprintDir, controller: controllerIdentity(import.meta.url) };
    const entries = [['intent', '01-intent.md', inputText], ['spec', '02-spec.md', fm('spec', '### S-1\n对应 I-1\n## QA 场景\n### Q-1\n对应: I-1\n操作: 真实检查文件\n期望: 成功')],
      ['build', '03-build.md', fm('build', 'PRIVATE BUILD BODY')], ['verify', '04-evidence.md', fm('verify', 'PRIVATE EVIDENCE BODY')]];
    for (const [stage, name, text] of entries) {
      put(`${sprintDir}/${name}`, text);
      withRecordProvenance({ ...options, stage }, () => {
        if (stage !== 'intent') captureNativeExecution({ provider: 'codex', code: 0, stdout: '{"type":"thread.started","thread_id":"setup"}\n{"type":"turn.completed"}\n' });
        sealStageEvidence({ files: [`${sprintDir}/${name}`], result: { status: 'completed' }, producer: stage === 'intent' ? 'controller' : 'model' });
      });
    }
    const files = entries.map(([, name]) => `${sprintDir}/${name}`), token = beginRecordRegistration({ ...options, stage: 'publish' }, files);
    put(manifest, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: files.map(p => ({ path: p, owner_path: owner, role: 'documentation' })) }));
    observeRecordRegistration(token, [manifest]);git('add', '.');git('commit', '-qm', 'actual records');finalizeRecordRegistration(token);
    const head = git('rev-parse', 'HEAD'), bin = path.join(temp, 'native-fixture.mjs'), promptFile = path.join(temp, 'prompt.txt');
    const command = `node -e 'const fs=require("node:fs");for(const f of ["03-build.md","04-evidence.md"])if(fs.existsSync("${sprintDir}/"+f))process.exit(9);process.stdout.write("hidden workspace verified\\n")'`;
    fs.writeFileSync(bin, `#!/usr/bin/env node\nimport fs from 'node:fs';import {execFileSync} from 'node:child_process';
const prompt=fs.readFileSync(0,'utf8');fs.writeFileSync(${JSON.stringify(promptFile)},prompt);
const output=execFileSync('/bin/sh',['-c',${JSON.stringify(command)}],{encoding:'utf8'});
if(${JSON.stringify(mode)}==='timeout'||${JSON.stringify(mode)}==='signal'){console.error('ISOLATION_FIXTURE_READY');await new Promise(r=>setTimeout(r,10000));}
if(${JSON.stringify(mode)}==='collision')fs.writeFileSync(${JSON.stringify(path.join(worktree,sprintDir,'03-build.md'))},'unexpected native write');
const report=${JSON.stringify(fm('evaluate', '### T-1\n对应: Q-1\nverdict: PASS\n```command\n'+command+'\n```\n```output\nhidden workspace verified\n```'))};
fs.writeFileSync(${JSON.stringify(path.join(worktree, sprintDir, '05-qa-report-r1.md'))},report);
console.log(JSON.stringify({type:'thread.started',thread_id:'actual-native-process'}));
console.log(JSON.stringify({type:'item.completed',item:{id:'actual-command',type:'command_execution',command:${JSON.stringify(command)},aggregated_output:output,exit_code:0,status:'completed'}}));
console.log(JSON.stringify({type:'turn.completed'}));\n`, { mode: 0o755 });
    const core = new URL('../lib/record-provenance.mjs', import.meta.url).href, entry = new URL('../activities/evaluate.mjs', import.meta.url).href;
    const wrapper = `const {withRecordProvenance,controllerIdentity}=await import(${JSON.stringify(core)});const c=JSON.parse(process.argv[1]);c.controller=controllerIdentity(${JSON.stringify(entry)});await withRecordProvenance(c,()=>import(${JSON.stringify(entry)}));`;
    const context = { root, worktree, taskId, sprintDir, stage: 'judge', round: 1 };
    const input = { run_tag: 'test', task_id: taskId, worktree, sprint_dir: sprintDir, intent_ids: ['I-1'],
      intent_sha256: createHash('sha256').update(inputText).digest('hex'), round: 1, head_sha: head, repo_profile: { key: 'isolated-fixture', production_re: [], preview: { type: 'local' } } };
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', wrapper, JSON.stringify(context)], { env: { ...env, HOME: temp,
        CODING_WF_PROVIDER: 'codex', CODING_WF_CODEX_BIN: bin, CODING_WF_CODEX_HOME: temp, CODING_WF_EVALUATE_TIMEOUT_MS: mode === 'timeout' ? '1000' : '15000' }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
      let stdout = '', stderr = '';child.stdout.on('data', b => { stdout += b; });child.stderr.on('data', b => { stderr += b;if (mode === 'signal' && b.toString().includes('ISOLATION_FIXTURE_READY')) child.kill('SIGTERM'); });
      child.on('error', reject);child.on('close', code => resolve({ code, stdout, stderr }));child.stdin.end(JSON.stringify(input));
    });
    if (mode !== 'pass') {
      expect(result.code, result.stderr).toBe(2);expect(JSON.parse(result.stdout).status).toBe('failed');
      const events = fs.readdirSync(path.join(root, taskId)).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(root, taskId, n))));
      expect(events.some(e => e.kind === 'stage' && e.stage === 'evaluate')).toBe(false);
      expect(events.some(e => e.kind === 'native' && e.stage === 'evaluate')).toBe(true);
      expect(fs.readFileSync(path.join(worktree, sprintDir, '04-evidence.md'), 'utf8')).toBe(entries[3][2]);
      expect(fs.readFileSync(path.join(worktree, sprintDir, '03-build.md'), 'utf8')).toBe(mode === 'collision' ? 'unexpected native write' : entries[2][2]);
      const hidden = events.find(e => e.kind === 'isolation' && e.phase === 'hidden');
      if (mode === 'collision') expect(fs.readFileSync(hidden.files[0].holder_path, 'utf8')).toBe(entries[2][2]);
      expect(events.some(e => e.kind === 'isolation' && e.phase === 'restored')).toBe(false);
      return;
    }
    expect(result.code, result.stderr).toBe(0);expect(JSON.parse(result.stdout).outputs.qa.verdict).toBe('PASS');
    const stageEventId = JSON.parse(result.stdout).outputs.source_stage_event_id;expect(stageEventId).toMatch(/^[a-f0-9-]{36}$/);
    const prompt = fs.readFileSync(promptFile, 'utf8');
    expect(prompt).toContain('CONTROLLER_WORKSPACE_ISOLATION:');expect(prompt).toContain('"status":"hidden"');
    expect(prompt).not.toContain('"status":"restored"');expect(prompt).not.toMatch(/PRIVATE BUILD BODY|PRIVATE EVIDENCE BODY|holder_path/);
    for (const [, name, text] of entries) expect(fs.readFileSync(path.join(worktree, sprintDir, name), 'utf8')).toBe(text);
    withRecordProvenance({ ...options, stage: 'judge', round: 1 }, () => {
      const reportRel = `${sprintDir}/05-qa-report-r1.md`, pending = verifyPendingStageEvidence({ ...options, head, round: 1, stageEventId }, [reportRel]);
      const facts = judgeSourceFacts({ repoSlug: 'perfectuser21/cecelia' }, worktree, options, head, reportRel, { mode: 'pending', stageEventId, testedHead: head, round: 1 });
      expect(facts.current_qa.isolation).toEqual(pending.isolation);
      expect(facts.current_qa.isolation.status).toBe('restored');
      expect(Date.parse(facts.current_qa.isolation.hidden_at)).toBeLessThanOrEqual(Date.parse(facts.current_qa.isolation.restored_at));
      const events = fs.readdirSync(path.join(root, taskId)).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(root, taskId, n))));
      const native = events.find(e => e.id === facts.current_qa.isolation.native_event_id);
      expect(native.stdout).toContain('actual-native-process');expect(native.stdout).toContain('hidden workspace verified');
      expect(native.isolation_hidden_event_id).toBe(facts.current_qa.isolation.hidden_event_id);
    });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}, 30000);
