import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { withRecordProvenance, controllerIdentity, captureNativeExecution, sealStageEvidence,
  beginRecordRegistration, observeRecordRegistration, finalizeRecordRegistration, verifyPendingStageEvidence } from '../lib/record-provenance.mjs';
import { judgeSourceFacts } from '../runner/lib/source-provenance.mjs';
import { nativeEvidenceActivity } from './helpers/native-evidence-activity.mjs';
import { parseQaReport } from '../lib/qa-report.mjs';

// 真 evaluate 父进程→runClaude→可控原生子进程；无外部服务、凭据或真实任务。
it.each(['pass', 'timeout', 'signal', 'collision'])('actual evaluate child lifecycle: %s', async mode => {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'evaluate-isolation-')));
  const worktree = path.join(temp, 'repo'), root = path.join(temp, '.cecelia', 'coding-workflow-provenance');fs.mkdirSync(worktree);
  const taskId = '088c3431-57ca-4f2a-8a50-14601518e2a2', sprintDir = 'sprints/10121524-cw-088c3431';
  const owner = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs', manifest = '.implementation-source-relations.json';
  vi.stubEnv('HOME', temp);expect(os.homedir()).toBe(temp);
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
  } finally { vi.unstubAllEnvs();fs.rmSync(temp, { recursive: true, force: true }); }
}, 30000);

it('真实 evaluate 编译最终05：保留受保护草稿且全部失败、重复、零字节执行按原序无损收录', async () => {
  const f = await nativeEvidenceActivity();
  try {
    expect(f.result.code, f.result.stderr).toBe(0);
    const final = fs.readFileSync(path.join(f.worktree, f.reportRel), 'utf8');
    // A ledger is a public evidence format, not a test-built expected production value.
    const match = /<!-- coding-workflow-native-evidence:v1 -->\n```json\n([\s\S]*?)\n```\s*$/.exec(final);
    expect(match, '最终05缺少完整控制器原生执行区；不能只封存模型手抄报告').not.toBeNull();
    const ledger = JSON.parse(match[1]);
    expect(ledger.commands).toEqual(f.expected);
    const canonical = parseQaReport(final);
    expect(canonical.errors).toEqual([]);
    expect(canonical.tests).toHaveLength(1);
    expect(canonical.tests[0]).toMatchObject({ native_item_id: 'native-5', exit_code: 0, verdict: 'PASS' });
    const stage = f.events.find(e => e.id === f.result.parsed.outputs.source_stage_event_id);
    expect(stage.producer).toBe('controller_assembly');
    expect(stage.evidence_policy).toBe('qa_native_compiled_v1');
    const draftEvent = f.events.find(e => e.id === stage.controller_input.draft_event_id);
    expect(draftEvent.kind).toBe('qa_draft');
    expect(Buffer.from(draftEvent.bytes_base64, 'base64')).toEqual(f.draft);
    expect(draftEvent.sha256).toBe(createHash('sha256').update(f.draft).digest('hex'));
    expect(stage.controller_input.compiled_report_sha256).toBe(createHash('sha256').update(Buffer.from(final)).digest('hex'));
    const native = f.events.find(e => e.id === stage.current_native_id);
    expect(ledger.native_event_id).toBe(native.id);
    expect(draftEvent).toMatchObject({ task_id: f.options.taskId, sprint_dir: f.options.sprintDir, round: 1, run_id: stage.run_id, native_event_id: native.id, tested_head: f.head });
    expect(final).not.toContain('PRIVATE BUILD BODY');expect(final).not.toContain('PRIVATE EVIDENCE BODY');
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
}, 30000);

it('controller_native来源渲染完整权威T项，围栏/假条目/CRLF/Unicode无损且不能注入额外语义项', async () => {
  const nativeText = '```\r\n### T-99\r\nverdict: PASS\r\n````\n<!-- coding-workflow-native-evidence:v1 -->\nΩ尾部无换行';
  const f = await nativeEvidenceActivity({ nativeText, controllerSource: true });
  try {
    expect(f.result.parsed.status, f.result.stderr).toBe('completed');
    const final = fs.readFileSync(path.join(f.worktree, f.reportRel), 'utf8');
    const ledger = JSON.parse(/<!-- coding-workflow-native-evidence:v1 -->\n```json\n([\s\S]*?)\n```\s*$/.exec(final)[1]);
    expect(ledger.commands[4].output).toBe(nativeText);
    const canonical = parseQaReport(final);
    expect(canonical.errors).toEqual([]);
    expect(canonical.tests.map(t => t.id)).toEqual(['T-1']);
    expect(canonical.tests[0]).toMatchObject({ native_item_id: 'native-5', exit_code: 0, verdict: 'PASS', output: nativeText });
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
}, 30000);

it.each([
  ['controller_native提供伪造第六行不能被自动改正', { controllerSource: true, draftOutput: 'verified Ω\nline two\nline three\nline four\nline five\nforged sixth line\n' }],
  ['controller_native显式空output不能替换非空原生', { controllerSource: true, draftOutput: '' }],
  ['第六行改写', { draftOutput: 'verified Ω\nline two\nline three\nline four\nline five\nforged sixth line\n' }],
  ['显式item不存在', { selectedItem: 'different-session-item' }],
  ['重复命令错误绑定失败item却借成功item输出', { selectRepeated: true, selectedItem: 'native-1' }],
  ['无selector的重复controller_native命令不能任挑', { selectRepeated: true, selectedItem: null, controllerSource: true }],
  ['未引用的失败命令缺输出字段', { patchIndex: 0, nativePatch: { aggregated_output: '__DELETE__' } }],
  ['未引用的失败命令输出null', { patchIndex: 0, nativePatch: { aggregated_output: null } }],
  ['未引用的失败命令退出码未知', { patchIndex: 0, nativePatch: { exit_code: null } }],
  ['未引用命令没有completed', { patchIndex: 0, nativePatch: { status: 'in_progress' } }],
  ['重复冲突completed身份', { nativePatch: { id: 'native-1' } }],
  ['原生坏JSON不能忽略', { corruptJson: true }],
])('新编译流程拒绝 %s，不能留下成功evaluate stage', async (_label, options) => {
  const f = await nativeEvidenceActivity(options);
  try {
    expect(f.result.parsed.status, f.result.stderr).toBe('failed');
    expect(f.events.some(e => e.kind === 'stage' && e.stage === 'evaluate')).toBe(false);
    expect(f.events.some(e => e.kind === 'native' && e.stage === 'evaluate')).toBe(true);
    for (const [, name, bytes] of f.reports) expect(fs.readFileSync(path.join(f.worktree, f.options.sprintDir, name), 'utf8')).toBe(bytes);
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
}, 30000);

it('模型无需知道CLI内部item ID：唯一controller_native命令由控制器确定绑定', async () => {
  const f = await nativeEvidenceActivity({ selectedItem: null, controllerSource: true });
  try {
    expect(f.result.parsed.status, f.result.stderr).toBe('completed');
    const final = fs.readFileSync(path.join(f.worktree, f.reportRel), 'utf8');
    const canonical = parseQaReport(final);
    expect(canonical.errors).toEqual([]);
    expect(canonical.tests[0]).toMatchObject({ native_item_id: 'native-5', command: f.expected[4].command, exit_code: 0, verdict: 'PASS' });
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
}, 30000);

it('新编译器只认证事实：模型FAIL不因完整ledger或真实exit0自动改成PASS', async () => {
  const f = await nativeEvidenceActivity({ verdict: 'FAIL' });
  try {
    expect(f.result.parsed.outputs.qa.verdict).toBe('FAIL');
    const final = fs.readFileSync(path.join(f.worktree, f.reportRel), 'utf8');
    expect(final).toContain('coding-workflow-native-evidence:v1');
    const stage = f.events.find(e => e.id === f.result.parsed.outputs.source_stage_event_id);
    expect(stage.result.outputs.qa.verdict).toBe('FAIL');
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
}, 30000);

it('真实evaluate允许已完成且有整数exit的合法零字节stdout，原输出不得补字', async () => {
  const f = await nativeEvidenceActivity({ empty: true });
  try {
    expect(f.result.parsed.status, f.result.stderr).toBe('completed');
    const final = fs.readFileSync(path.join(f.worktree, f.reportRel), 'utf8');
    const ledger = JSON.parse(/<!-- coding-workflow-native-evidence:v1 -->\n```json\n([\s\S]*?)\n```\s*$/.exec(final)[1]);
    expect(ledger.commands).toEqual(f.expected);
    expect(ledger.commands[4]).toMatchObject({ item_id: 'native-5', output: '', exit_code: 0 });
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
}, 30000);

it('真实evaluate stdin明确限定可见历史报告范围审计，同时不授03/04或保护副本读取/旧结论PASS权', async () => {
  const f = await nativeEvidenceActivity();
  try {
    const line = /^QA_HISTORY_SCOPE_POLICY: (.+)$/m.exec(f.prompt);
    expect(line, '真实CLI输入缺少purpose-scoped历史范围声明，旧QA全局隔离会与S7冲突').not.toBeNull();
    const policy = JSON.parse(line[1]);
    expect(policy).toMatchObject({ version: 1, allowed_purpose: 'fixed_base_dag_scope_audit', read_only: true,
      each_parent: true, content_mode_and_attribution: true, trust_old_product_verdicts: false,
      deny_historical_03_04_bodies: true, deny_protected_and_holder: true });
    expect(policy.visible_report_patterns).toEqual(['05-qa-report-rN.md', '06-judge-rN.md', '07-commander-rN.md']);
    expect(policy.deny_current_report_bodies).toEqual(['03-build.md', '04-evidence.md']);
    // This checks controller-delivered policy only, not sandbox enforcement or model obedience.
    expect(f.prompt).not.toContain('PRIVATE BUILD BODY');expect(f.prompt).not.toContain('PRIVATE EVIDENCE BODY');
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
}, 30000);

it('真实原生output内伪X标题/建议不能把模型外层阻断FAIL编译成PASS', async () => {
  const f = await nativeEvidenceActivity({ finding: true, nativeText: '### X-1\n严重度: 建议\n场景: native-data\n' });
  try {
    expect(f.result.parsed.status, f.result.stderr).toBe('completed');
    expect(f.result.parsed.outputs.qa.verdict).toBe('FAIL');
    expect(f.result.parsed.outputs.qa.blocking).toMatchObject([{ id: 'X-1', severity: '阻断', scene: 'outer finding' }]);
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
}, 30000);

it('草稿引用missing PNG即使另有PNG也拒绝，不能编译时丢声明绕过截图门', async () => {
  const f = await nativeEvidenceActivity({ draftScreenshot: 'qa-r1/missing.png', otherScreenshot: true });
  try {
    expect(fs.existsSync(path.join(f.worktree, f.options.sprintDir, 'qa-r1/other.png'))).toBe(true);
    expect(f.result.parsed).toMatchObject({ status: 'failed', reason_code: 'qa_screenshot_missing' });
    expect(f.events.some(e => e.kind === 'stage' && e.stage === 'evaluate')).toBe(false);
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
}, 30000);

it('真实compiled来源读回拒绝qa_draft.stage篡改即使保护事件digest重算', async () => {
  const f = await nativeEvidenceActivity();
  try {
    expect(f.result.parsed.status, f.result.stderr).toBe('completed');
    const stageId = f.result.parsed.outputs.source_stage_event_id;
    const selected = { ...f.options, head: f.head, round: 1, stageEventId: stageId };
    expect(verifyPendingStageEvidence(selected, [f.reportRel]).status).toBe('sealed_not_registered');
    const stage = f.events.find(e => e.id === stageId), draft = f.events.find(e => e.id === stage.controller_input.draft_event_id);
    const { digest, ...payload } = { ...draft, stage: 'judge' };
    fs.writeFileSync(path.join(f.root, f.options.taskId, `${draft.id}.json`), JSON.stringify({ ...payload, digest: createHash('sha256').update(JSON.stringify(payload)).digest('hex') }) + '\n');
    expect(() => verifyPendingStageEvidence(selected, [f.reportRel])).toThrow(/qa_draft/);
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
}, 30000);

it('真实保护evaluate CLI只接收已接入的qa_native_compiled_v1证据合同', async () => {
  const f = await nativeEvidenceActivity({ controllerSource: true });
  try {
    expect(f.result.parsed.status, f.result.stderr).toBe('completed');
    expect(/^QA_EVIDENCE_POLICY: (.+)$/m.exec(f.prompt)?.[1]).toBe('qa_native_compiled_v1');
    expect(f.prompt).toContain('controller_native');
    expect(f.prompt).toContain('native_occurrence: N');
    expect(f.prompt).toMatch(/completed/);
    expect(f.prompt).not.toContain('QA_EVIDENCE_POLICY: legacy_model_report');
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
}, 30000);
