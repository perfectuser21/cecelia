import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { git } from '../../__tests__/helpers/git.mjs';
import { withRecordProvenance, controllerIdentity, captureNativeExecution, sealStageEvidence, beginRecordRegistration, observeRecordRegistration, finalizeRecordRegistration } from '../../lib/record-provenance.mjs';
import { registerRecordSources, RECORD_SOURCE_MANIFEST, RECORD_SOURCE_OWNER } from '../../lib/record-sources.mjs';
import { useQaEnv, SPRINT, TASK } from './helpers/qa-env.mjs';

// 真实 runner 子进程、临时裸仓和本地服务；不会触碰真实任务或凭证库。
describe('Cecelia 来源凭证为 QA / 合并的独立前置', () => {
  const E = useQaEnv();
  const go = (state, options = {}) => {
    const file = path.join(E.sb.root, 'self-repos.json');
    fs.copyFileSync(fileURLToPath(new URL('../../repos.json', import.meta.url)), file);
    // 仅测试包装器注入显式临时凭证根；生产无环境变量/任务payload逃生口。
    // 只替身远端身份查询；fetch/push/read/commit均走真实临时裸仓。
    const bin = path.join(E.sb.root, 'git-identity-bin');fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\ncase "$*" in *" remote get-url origin") echo https://github.com/perfectuser21/cecelia.git; exit 0;; esac\nexec /usr/bin/git "$@"\n', { mode: 0o755 });
    options.prepare?.(bin, state);
    const processRunner = env => new Promise((resolve, reject) => {
      const core = new URL('../../lib/record-provenance.mjs', import.meta.url).href;
      const entry = new URL('../run-once.mjs', import.meta.url).href;
      const context = { root: path.join(E.sb.root, 'protected'), worktree: E.sb.seed, taskId: TASK, sprintDir: SPRINT, stage: 'judge', round: 1 };
      const code = `const {withRecordProvenance,controllerIdentity}=await import(${JSON.stringify(core)});const {main}=await import(${JSON.stringify(entry)});const c=JSON.parse(process.argv[1]);c.controller=controllerIdentity(${JSON.stringify(entry)});process.exitCode=await withRecordProvenance(c,()=>main());`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', code, JSON.stringify(context)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';child.stdout.on('data', b => { stdout += b; });child.stderr.on('data', b => { stderr += b; });
      child.on('error', reject);child.on('close', exitCode => resolve({ exitCode, stdout, stderr }));
    });
    return E.go(state, { ...options, processRunner, extra: { ...options.extra, PATH: `${bin}:${process.env.PATH}`, CODING_WF_REPOS_FILE: file } });
  };
  it('旧 self PR 只有合法文件、没有历史凭证时不启动 QA、不批准', async () => {
    const r = await go(E.green());
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.qaCalls(), r.stderr).toHaveLength(0);
    expect(E.judge.calls).toHaveLength(0);
    expect(E.state().approved).toBeUndefined();
    expect(E.state().escalated.type).toBe('source_provenance_missing');
  });
  it('旧 QA 批准和全绿 CI 不豁免缺失历史凭证', async () => {
    const head = E.remoteHead();
    E.seedState({ passed: true, approved: { head, round: 1 }, rounds: [] });
    const r = await go(E.green({ prs: [E.pr({ headRefOid: head })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.ghCalls().filter(a => a[1] === 'merge')).toHaveLength(0);
    expect(E.state().merged).toBeUndefined();
    expect(E.state().escalated.type).toBe('source_provenance_missing');
  });
  it('仅增加报告的 HEAD 也不能在缺凭证时沿用批准改绑', async () => {
    const approved = E.remoteHead();
    E.seedState({ passed: true, approved: { head: approved, round: 1 }, rounds: [] });
    E.addToBranch(`${SPRINT}/07-commander-r9.md`, '# forged record\n');
    const head = E.remoteHead();
    const r = await go(E.green({ prs: [E.pr({ headRefOid: head })] }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.ghCalls().filter(a => a[1] === 'merge')).toHaveLength(0);
    expect(E.state().approved.head).toBe(approved);
    expect(E.state().escalated.type).toBe('source_provenance_missing');
  });
  it('Commander resume 文本不能为旧无凭证链解除升级', async () => {
    E.seedState({ rounds: [], escalated: { type: 'qa_cannot_verify', pr: 77, at: '2026-10-15T00:00:00Z' } });
    const r = await go(E.green(), { mode: 'cmd-resume', extra: { CODING_WF_COMMANDER: '1' } });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(E.state().escalated.type).toBe('qa_cannot_verify');
    expect(E.state().approved).toBeUndefined();
  });
  it('受保护QA原判CANNOT_VERIFY不能被Commander状态接受洗成PASS，批准失败当轮升级并留完整轮次', async () => {
    const root = path.join(E.sb.root, 'protected'), evaluate = path.join(E.sb.root, 'evaluate-proof.mjs'), codex = path.join(E.sb.root, 'judge-proof.mjs');
    const core = new URL('../../lib/record-provenance.mjs', import.meta.url).href, entry = import.meta.url;
    const native = '{"type":"thread.started","thread_id":"fixture-native"}\n{"type":"turn.completed"}\n';
    fs.writeFileSync(evaluate, `import fs from 'node:fs';import path from 'node:path';import {withRecordProvenance,controllerIdentity,captureNativeExecution,sealStageEvidence,beginEvaluateIsolation} from ${JSON.stringify(core)};
const i=JSON.parse(fs.readFileSync(0,'utf8'));const f='05-qa-report-r'+i.round+'.md';const result={status:'completed',outputs:{qa_report_file:f,qa:{verdict:'CANNOT_VERIFY',round:i.round,failed:[],blocking:[],cannot_verify:[{id:'T-2',covers:['Q-1'],reason:'fixture missing proof'}],env:{kind:'preview',url:process.env.FAKE_QA_PREVIEW_URL}}}};
withRecordProvenance({root:${JSON.stringify(root)},worktree:i.worktree,taskId:i.task_id,sprintDir:i.sprint_dir,stage:'evaluate',round:i.round,controller:controllerIdentity(${JSON.stringify(entry)})},()=>{const isolation=beginEvaluateIsolation();fs.writeFileSync(path.join(i.worktree,i.sprint_dir,f),'---\\ntask_id: '+i.task_id+'\\nstep: evaluate\\nupstream: []\\n---\\n### T-2\\n对应: Q-1\\nverdict: CANNOT_VERIFY\\n');captureNativeExecution({provider:'codex',code:0,stdout:${JSON.stringify(native)}});if(!isolation.restore())throw Error('isolation_restore');const sealed=sealStageEvidence({files:[i.sprint_dir+'/'+f],result});result.outputs.source_stage_event_id=sealed.id;});console.log(JSON.stringify(result));\n`);
    const answer = JSON.stringify({ coverage: [{ intent: 'I-1', satisfied: true, evidence: 'fixture judge accepts' }], issues: [], summary: 'PASS' });
    fs.writeFileSync(codex, `#!/usr/bin/env node\nimport fs from 'node:fs';fs.readFileSync(0,'utf8');const a=process.argv.slice(2);fs.writeFileSync(a[a.indexOf('--output-last-message')+1],${JSON.stringify(answer)});console.log(JSON.stringify({type:'thread.started',thread_id:'judge-proof'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:${JSON.stringify(answer)}}}));console.log(JSON.stringify({type:'turn.completed'}));\n`, { mode: 0o755 });
    const prepare = (bin, state) => {
      const previous = process.env.PATH;process.env.PATH = `${bin}:${previous}`;
      try {
        const put = (file, text) => { const p = path.join(E.sb.seed, file);fs.mkdirSync(path.dirname(p), { recursive: true });fs.writeFileSync(p, text); };
        put(RECORD_SOURCE_OWNER, '// fixture controller');put(RECORD_SOURCE_MANIFEST, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: [] }));
        git(E.sb.seed, 'add', '.');git(E.sb.seed, 'commit', '-qm', 'fixture trusted base');git(E.sb.seed, 'push', '-q', 'origin', 'HEAD:main');git(E.sb.seed, 'fetch', '-q', 'origin', 'main');git(E.sb.clone, 'fetch', '-q', 'origin', 'main');
        const c = { root, worktree: E.sb.seed, taskId: TASK, sprintDir: SPRINT, controller: controllerIdentity(import.meta.url) };
        put(`${SPRINT}/02-spec.md`, `---\ntask_id: ${TASK}\nstep: spec\nupstream: []\n---\n### S-1\n## QA 场景\n### Q-1\n对应: I-1\n操作: x\n期望: y\n`);
        put(`${SPRINT}/03-build.md`, `---\ntask_id: ${TASK}\nstep: build\nupstream: []\n---\nActual fixture build\n`);
        put(`${SPRINT}/04-evidence.md`, `---\ntask_id: ${TASK}\nstep: verify\nupstream: []\n---\nActual fixture verify\n`);
        for (const [stage, file] of [['intent', '01-intent.md'], ['spec', '02-spec.md'], ['build', '03-build.md'], ['verify', '04-evidence.md']]) withRecordProvenance({ ...c, stage }, () => {
          if (stage !== 'intent') captureNativeExecution({ provider: 'codex', code: 0, stdout: native });
          sealStageEvidence({ files: [`${SPRINT}/${file}`], result: { status: 'completed' }, producer: stage === 'intent' ? 'controller' : 'model' });
        });
        const files = [`${SPRINT}/01-intent.md`, `${SPRINT}/02-spec.md`, `${SPRINT}/03-build.md`, `${SPRINT}/04-evidence.md`], token = beginRecordRegistration({ ...c, stage: 'publish' }, files);
        observeRecordRegistration(token, registerRecordSources(E.sb.seed, { taskId: TASK, sprintDir: SPRINT, stage: 'publish' }, files));git(E.sb.seed, 'add', '.');git(E.sb.seed, 'commit', '-qm', 'fixture genuine registration');finalizeRecordRegistration(token);git(E.sb.seed, 'push', '-q', 'origin', 'HEAD');
        E.head = E.remoteHead();state.prs[0].headRefOid = E.head;
      } finally { process.env.PATH = previous; }
    };
    fs.mkdirSync(E.sb.logDir, { recursive: true });
    fs.writeFileSync(path.join(E.sb.logDir, 'commander-77.json'), JSON.stringify({ interventions: [{ action: 'resume', escalation: { type: 'qa_cannot_verify', cannot_verify: [{ id: 'T-2', covers: ['Q-1'] }] }, rulings: [{ issue: 'T-2', verdict: '采纳' }] }] }));
    const r = await go(E.green(), { prepare, extra: { CODING_WF_EVALUATE: evaluate, CODING_WF_JUDGE_PROVIDER: 'codex', CODING_WF_CODEX_BIN: codex, CODING_WF_CODEX_HOME: E.sb.root } });
    expect(r.exitCode, r.stderr).toBe(0);expect(E.state().rounds, JSON.stringify(E.state()) + r.stderr).toHaveLength(1);
    expect(E.state().rounds[0]).toMatchObject({ qa_verdict: 'CANNOT_VERIFY', judge: { verdict: 'PASS' } });
    expect(E.state().approved).toBeUndefined();expect(E.state().escalated?.type, r.stderr).toBe('source_provenance_missing');
    expect(E.ghCalls().filter(a => a[1] === 'merge')).toHaveLength(0);
  });
});
