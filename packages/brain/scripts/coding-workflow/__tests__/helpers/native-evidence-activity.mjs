import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { withRecordProvenance, controllerIdentity, captureNativeExecution, sealStageEvidence,
  beginRecordRegistration, observeRecordRegistration, finalizeRecordRegistration } from '../../lib/record-provenance.mjs';

// Only the external CLI is replaced. Activity/provenance/Git/isolation are real.
export async function nativeEvidenceActivity({ empty = false, verdict = 'PASS', nativePatch = null, patchIndex = 4,
  draftOutput, selectedItem = 'native-5', selectRepeated = false, corruptJson = false,
  nativeText, controllerSource = false, finding = false, draftScreenshot = null, otherScreenshot = false } = {}) {
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'native-evidence-activity-')));
  const worktree = path.join(temp, 'repo'), root = path.join(temp, '.cecelia/coding-workflow-provenance');
  fs.mkdirSync(worktree);
  const taskId = '088c3431-57ca-4f2a-8a50-14601518e2a2', sprintDir = 'sprints/10121524-cw-088c3431';
  const owner = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs', manifest = '.implementation-source-relations.json';
  const env = { ...process.env, HOME: temp };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  const git = (...args) => execFileSync('git', ['-C', worktree, '-c', 'core.hooksPath=/dev/null', ...args], { env, encoding: 'utf8' }).trim();
  const put = (rel, text) => { const full = path.join(worktree, rel);fs.mkdirSync(path.dirname(full), { recursive: true });fs.writeFileSync(full, text); };
  const fm = (step, body) => `---\ntask_id: ${taskId}\nstep: ${step}\nupstream: []\n---\n${body}\n`;
  try {
    git('init', '-qb', 'cp-10121524-cw-088c3431');git('config', 'user.name', 'fixture');git('config', 'user.email', 'fixture@example.invalid');
    git('remote', 'add', 'origin', 'https://github.com/perfectuser21/cecelia.git');
    put(owner, '// fixture controller');put(manifest, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: [] }));
    git('add', '.');git('commit', '-qm', 'base');
    const options = { root, worktree, taskId, sprintDir, controller: controllerIdentity(import.meta.url) };
    const inputText = fm('intent', '### I-1\nObserve a real command');
    const reports = [['intent', '01-intent.md', inputText], ['spec', '02-spec.md', fm('spec', '### S-1\n对应 I-1\n## QA 场景\n### Q-1\n对应: I-1\n操作: 真实运行命令\n期望: 真实输出')],
      ['build', '03-build.md', fm('build', 'PRIVATE BUILD BODY')], ['verify', '04-evidence.md', fm('verify', 'PRIVATE EVIDENCE BODY')]];
    for (const [stage, name, text] of reports) {
      put(`${sprintDir}/${name}`, text);
      withRecordProvenance({ ...options, stage }, () => {
        if (stage !== 'intent') captureNativeExecution({ provider: 'codex', code: 0, stdout: '{"type":"thread.started","thread_id":"setup"}\n{"type":"turn.completed"}\n' });
        sealStageEvidence({ files: [`${sprintDir}/${name}`], result: { status: 'completed' }, producer: stage === 'intent' ? 'controller' : 'model' });
      });
    }
    const files = reports.map(([, name]) => `${sprintDir}/${name}`), token = beginRecordRegistration({ ...options, stage: 'publish' }, files);
    put(manifest, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: files.map(p => ({ path: p, owner_path: owner, role: 'documentation' })) }));
    observeRecordRegistration(token, [manifest]);git('add', '.');git('commit', '-qm', 'actual source records');finalizeRecordRegistration(token);
    const head = git('rev-parse', 'HEAD');
    const repeatedScript = path.join(temp, 'repeat.cjs'), counter = path.join(temp, 'counter');
    fs.writeFileSync(repeatedScript, `const fs=require('node:fs');const p=${JSON.stringify(counter)};const n=fs.existsSync(p)?2:1;fs.writeFileSync(p,String(n));process.stdout.write(n===1?'first failed attempt\\n':'second actual attempt\\n');process.exit(n===1?7:0);`);
    const repeat = `${JSON.stringify(process.execPath)} ${JSON.stringify(repeatedScript)}`;
    const authoritative = nativeText ?? (empty ? '' : 'verified Ω\nline two\nline three\nline four\nline five\nauthoritative sixth line\n');
    const finalCommand = `node -e 'process.stdout.write(Buffer.from("${Buffer.from(authoritative).toString('base64')}","base64"))'`;
    const commands = [repeat, repeat, `node -e 'process.exit(0)'`, `node -e 'process.stdout.write(" \\n\\t")'`, finalCommand];
    const outputs = ['first failed attempt\n', 'second actual attempt\n', '', ' \n\t', authoritative];
    const expected = commands.map((command, i) => ({ item_id: `native-${i + 1}`, command, output: outputs[i], exit_code: i === 0 ? 7 : 0 }));
    const reportRel = `${sprintDir}/05-qa-report-r1.md`;
    const body = `# 原始模型草稿 Ω\n### T-1\n对应: Q-1\nverdict: ${verdict}\n${draftScreenshot ? `截图: ${draftScreenshot}\n` : ''}${selectedItem ? `native_item_id: ${selectedItem}\n` : ''}${controllerSource ? '证据来源: controller_native\n' : ''}\`\`\`command\n${selectRepeated ? repeat : finalCommand}\n\`\`\`${controllerSource && draftOutput === undefined ? '' : `\n\`\`\`output\n${draftOutput ?? (selectRepeated ? outputs[1] : outputs[4])}\`\`\``}`;
    const draft = Buffer.from(fm('evaluate', body + (finding ? `\n### X-1\n对应: I-1\nverdict: FAIL\n严重度: 阻断\n场景: outer finding\nnative_item_id: native-5\n\`\`\`command\n${finalCommand}\n\`\`\`\n\`\`\`output\n${outputs[4]}\`\`\`` : '')));
    const bin = path.join(temp, 'native-cli.mjs'), promptFile = path.join(temp, 'prompt.txt');
    fs.writeFileSync(bin, `#!/usr/bin/env node
import fs from 'node:fs';import {spawnSync} from 'node:child_process';
fs.writeFileSync(${JSON.stringify(promptFile)},fs.readFileSync(0,'utf8'));
console.log(JSON.stringify({type:'thread.started',thread_id:'actual-compiler-session'}));
for(const [i,command] of ${JSON.stringify(commands)}.entries()){
 const run=spawnSync('/bin/sh',['-c',command],{encoding:'utf8'});
 if(run.error)throw run.error;
 const item={id:'native-'+(i+1),type:'command_execution',command,aggregated_output:run.stdout+run.stderr,exit_code:run.status,status:run.status===0?'completed':'failed'};
 if(i===${patchIndex}&&${JSON.stringify(nativePatch)}!==null){const patch=${JSON.stringify(nativePatch)};for(const [k,v] of Object.entries(patch)){if(v==='__DELETE__')delete item[k];else item[k]=v;}}
 console.log(JSON.stringify({type:'item.completed',item}));
}
fs.writeFileSync(${JSON.stringify(path.join(worktree, reportRel))},Buffer.from(${JSON.stringify(draft.toString('base64'))},'base64'));
if(${otherScreenshot}){fs.mkdirSync(${JSON.stringify(path.join(worktree,sprintDir,'qa-r1'))},{recursive:true});fs.writeFileSync(${JSON.stringify(path.join(worktree,sprintDir,'qa-r1/other.png'))},Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=','base64'));}
if(${corruptJson})process.stdout.write('{invalid native JSON\\n');
console.log(JSON.stringify({type:'turn.completed'}));
`, { mode: 0o755 });
    const entry = new URL('../../activities/evaluate.mjs', import.meta.url).href, core = new URL('../../lib/record-provenance.mjs', import.meta.url).href;
    const wrapper = `const {withRecordProvenance,controllerIdentity}=await import(${JSON.stringify(core)});const c=JSON.parse(process.argv[1]);c.controller=controllerIdentity(${JSON.stringify(entry)});await withRecordProvenance(c,()=>import(${JSON.stringify(entry)}));`;
    const input = { run_tag: 'compiler-red', task_id: taskId, worktree, sprint_dir: sprintDir, intent_ids: ['I-1'],
      intent_sha256: createHash('sha256').update(inputText).digest('hex'), round: 1, head_sha: head,
      repo_profile: { key: 'fixture', production_re: [], preview: { type: 'local' } } };
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', wrapper, JSON.stringify({ root, worktree, taskId, sprintDir, stage: 'judge', round: 1 })],
        { env: { ...env, CODING_WF_PROVIDER: 'codex', CODING_WF_CODEX_BIN: bin, CODING_WF_CODEX_HOME: temp, CODING_WF_EVALUATE_TIMEOUT_MS: '15000' }, stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
      let stdout = '', stderr = '';child.stdout.on('data', d => { stdout += d; });child.stderr.on('data', d => { stderr += d; });
      child.on('error', reject);child.on('close', code => resolve({ code, stdout, stderr }));child.stdin.end(JSON.stringify(input));
    });
    const events = fs.readdirSync(path.join(root, taskId)).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(root, taskId, n))));
    return { temp, worktree, root, options, head, reportRel, reports, draft, expected, result: { ...result, parsed: JSON.parse(result.stdout) }, events, prompt: fs.readFileSync(promptFile, 'utf8') };
  } catch (error) { fs.rmSync(temp, { recursive: true, force: true });throw error; }
}
