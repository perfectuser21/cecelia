// 真实Git及受保护来源链；网络/模型仅本地CLI替身，不mock来源核验。
import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git } from '../../__tests__/helpers/git.mjs';
import { withRecordProvenance, captureNativeExecution, sealStageEvidence, beginRecordRegistration, observeRecordRegistration, finalizeRecordRegistration } from '../../lib/record-provenance.mjs';
import { registerRecordSources } from '../../lib/record-sources.mjs';
import { hash } from '../../lib/record-provenance-store.mjs';
import { sourceFacts, judgeSourceFacts } from '../lib/source-provenance.mjs';
import { sourceMergeFixture, TASK, SPRINT, BRANCH, README } from './helpers/source-merge-fixture.mjs';

const f = sourceMergeFixture(import.meta.url);
const { put, commit, report, rel, editGh, mergeLocally, eventFile, rewriteEvent } = f;

it.each(['verified', 'missing-receipt', 'tampered-receipt'])('actual evaluate child只消费真实merge链并交给native stdin：%s', async mode => {
  const spec = rel('02-spec.md');
  put(spec, report('spec') + '\n### S-1\n对应 I-1\n## QA 场景\n### Q-1\n对应: I-1\n操作: 读取产品文件并检查03/04隐藏\n期望: 字节相同且隐藏成立\n');
  withRecordProvenance({ ...f.context, stage: 'spec' }, () => {
    captureNativeExecution({ provider: 'codex', code: 0, stdout: execFileSync(process.execPath, ['-e', `console.log(JSON.stringify({type:'thread.started',thread_id:'actual-spec-child'}));console.log(JSON.stringify({type:'turn.completed'}));`], { encoding: 'utf8' }) });
    sealStageEvidence({ files: [spec], result: { status: 'completed' }, producer: 'model' });
  });
  const registration = beginRecordRegistration({ ...f.context, stage: 'publish' }, [spec]);
  observeRecordRegistration(registration, registerRecordSources(f.sb.seed, { taskId: TASK, sprintDir: SPRINT, stage: 'publish' }, [spec]));
  f.before = commit('fixture spec registration for actual evaluate');finalizeRecordRegistration(registration);
  git(f.sb.seed, 'push', '-q', 'origin', BRANCH);editGh(d => { d.prs[0].headRefOid = f.before; });
  const merged = await mergeLocally(), expected = sourceFacts(f.sb.seed, f.context, merged.commit);
  const nativeFile = path.join(f.sb.root, 'actual-evaluate-native.json'), bin = path.join(f.sb.root, 'actual-evaluate-native.mjs');
  const command = `node -e 'const fs=require("node:fs");for(const f of ["03-build.md","04-evidence.md"])if(fs.existsSync("${SPRINT}/"+f))process.exit(9);if(fs.readFileSync("${README}","utf8")!=="# existing manual\\n\\n## task addition\\n")process.exit(10);process.stdout.write("actual product and hidden reports verified\\n")'`;
  const qaText = report('evaluate') + '\n### T-1\n对应: Q-1\nverdict: PASS\n```command\n' + command + '\n```\n```output\nactual product and hidden reports verified\n```\n';
  fs.writeFileSync(bin, `#!/usr/bin/env node\nimport fs from 'node:fs';import{execFileSync}from'node:child_process';const prompt=fs.readFileSync(0,'utf8');fs.writeFileSync(${JSON.stringify(nativeFile)},JSON.stringify({argv:process.argv.slice(2),prompt}));const output=execFileSync('/bin/sh',['-c',${JSON.stringify(command)}],{encoding:'utf8'});fs.writeFileSync(${JSON.stringify(path.join(f.sb.seed, rel('05-qa-report-r1.md')))},${JSON.stringify(qaText)});console.log(JSON.stringify({type:'thread.started',thread_id:'actual-evaluate-sync-child'}));console.log(JSON.stringify({type:'item.completed',item:{id:'actual',type:'command_execution',command:${JSON.stringify(command)},aggregated_output:output,exit_code:0,status:'completed'}}));console.log(JSON.stringify({type:'turn.completed'}));\n`, { mode: 0o755 });
  const input = { run_tag: 'actual-source-sync-fixture', task_id: TASK, worktree: f.sb.seed, sprint_dir: SPRINT, intent_ids: ['I-1'],
    intent_sha256: hash(fs.readFileSync(path.join(f.sb.seed, rel('01-intent.md')))), round: 1, head_sha: merged.commit,
    repo_profile: { key: 'cecelia', production_re: [], preview: { type: 'local' } }, source_provenance: { sync: ['FORGED_CALLER_FACTS'] } };
  if (mode === 'missing-receipt') fs.unlinkSync(eventFile(merged.eventId));
  if (mode === 'tampered-receipt') rewriteEvent(eventFile(merged.eventId), e => { e.tree = f.base; });
  const entry = fileURLToPath(new URL('../../activities/evaluate.mjs', import.meta.url));
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], { env: { ...process.env, CODING_WF_CODEX_BIN: bin, CODING_WF_EVALUATE_TIMEOUT_MS: '15000' }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 90000 });
    let stdout = '', stderr = '';child.stdout.on('data', b => { stdout += b; });child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject);child.on('close', code => resolve({ code, stdout, stderr }));child.stdin.end(JSON.stringify(input));
  });
  const native = fs.existsSync(nativeFile) ? JSON.parse(fs.readFileSync(nativeFile)) : null;
  const protectedEvents = fs.readdirSync(path.join(f.context.root, TASK)).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(f.context.root, TASK, n))));
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
  expect(facts.sync).toHaveLength(1);expect(facts.sync[0]).toMatchObject({ event_id: merged.eventId, before: f.before, main: f.main, base: f.base, commit: merged.commit, parents: [f.before, f.main] });
  expect(native.prompt).not.toContain('FORGED_CALLER_FACTS');expect(native.prompt).not.toContain('holder_path');
  expect(native.argv).toContain('exec');expect(native.argv).toContain('--json');
  const factsForJudge = withRecordProvenance({ ...f.context, worktree: f.sb.seed, stage: 'judge', round: 1 }, () => judgeSourceFacts(f.cfg, f.sb.seed, f.context, merged.commit, rel('05-qa-report-r1.md'), { mode: 'pending', round: 1, testedHead: merged.commit, stageEventId: output.outputs.source_stage_event_id }));
  expect(factsForJudge.sync).toEqual(facts.sync);expect(factsForJudge.current_qa.isolation.status).toBe('restored');
  const nativeEvent = protectedEvents.find(e => e.kind === 'native' && e.stage === 'evaluate');expect(nativeEvent.stdout).toContain('actual-evaluate-sync-child');
  expect(nativeEvent.stdout).toContain('actual product and hidden reports verified');
  expect(git(f.sb.seed, 'rev-parse', 'HEAD').trim()).toBe(merged.commit);
  for (const [name, stage] of [['03-build.md', 'build'], ['04-evidence.md', 'verify']]) expect(fs.readFileSync(path.join(f.sb.seed, rel(name)), 'utf8')).toBe(report(stage));
}, 180000);
