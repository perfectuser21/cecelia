import { afterEach,expect,it,vi } from 'vitest';
import { mkdtempSync,writeFileSync,mkdirSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync,spawnSync } from 'node:child_process';
import { runImplementationGate } from '../../../../../scripts/ci/implementation-gate.mjs';

const roots=[];
afterEach(()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'implementation-ci-'));roots.push(root);
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  git('init','-q');git('config','user.email','ci@example.invalid');git('config','user.name','ci');git('remote','add','origin','https://github.com/example/repo.git');
  mkdirSync(join(root,'scripts/smoke'),{recursive:true});writeFileSync(join(root,'scripts/smoke/lock.sh'),'#!/bin/bash\nset -e\nprintf tested > actual-output\n');
  writeFileSync(join(root,'controller.js'),'old');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
  writeFileSync(join(root,'controller.js'),'new');git('add','.');git('commit','-qm','head');const head=git('rev-parse','HEAD');
  const side=revision=>({revision,graph_snapshot:{digest:'a'.repeat(64)},projection:{projection_digest:'b'.repeat(64)},definition_versions:['version'],gaps:[],traversal:{truncated:false}});
  const report={source:{repo:'example/repo',base_revision:base,head_revision:head,changed_files:[{path:'controller.js'}]},base:side(base),head:side(head),mapping_status:'verified',gaps:[],affected_usages:[{workflow_id:'workflow',reference_id:'usage',capability_id:'capability'}],required_assertions:[{assertion_ref:'scripts/smoke/lock.sh',source_repo:'example/repo',capability_ids:['capability'],source_bindings:[{journey_step_link_id:'link',assertion_revision:1,activity_id:'activity'}],command:'touch MUST_NOT_EXECUTE'}]};
  return {root,report,git};
}
it('真git diff与固定报告对账，只执行本仓测试，HTTP command不执行并保留来源收据',async()=>{
  const {root,report}=fixture();const receipt=await runImplementationGate({repoRoot:root,report});
  expect(receipt.verdict).toBe('PASS');expect(readFileSync(join(root,'actual-output'),'utf8')).toBe('tested');
  expect(receipt.assertions[0]).toMatchObject({assertion_ref:'scripts/smoke/lock.sh',exit_code:0,source_bindings:report.required_assertions[0].source_bindings});
  expect(receipt.report_sha256).toMatch(/^[a-f0-9]{64}$/);expect(receipt.assertions[0].test_sha256).toMatch(/^[a-f0-9]{64}$/);
});
it.each(['unknown','gap','truncated','empty-tests','foreign-test','wrong-head','missing-diff'])('证据缺口或串版本不能放行：%s',async reason=>{
  const {root,report}=fixture();
  if(reason==='unknown')report.mapping_status='unknown';
  if(reason==='gap')report.gaps.push({code:'registration_missing'});
  if(reason==='truncated')report.base.traversal.truncated=true;
  if(reason==='empty-tests')report.required_assertions=[];
  if(reason==='foreign-test')report.required_assertions[0].source_repo='another/repo';
  if(reason==='wrong-head')report.source.head_revision='0'.repeat(40);
  if(reason==='missing-diff')report.source.changed_files=[];
  await expect(runImplementationGate({repoRoot:root,report})).rejects.toThrow();
});
it('本地测试内容已改不能冒充提交时的测试',async()=>{
  const {root,report}=fixture();writeFileSync(join(root,'scripts/smoke/lock.sh'),'exit 0');
  await expect(runImplementationGate({repoRoot:root,report})).rejects.toThrow(/SOURCE_STATE|DIRTY/);
});
it('真实CLI输出可回读收据，测试非零时进程非零退出',()=>{
  const {root,report,git}=fixture();
  const cli=fileURLToPath(new URL('../../../../../scripts/ci/implementation-gate.mjs',import.meta.url));
  const input=join(root,'report.json'),output=join(root,'receipt.json');
  writeFileSync(input,JSON.stringify(report));
  const run=()=>spawnSync(process.execPath,[cli,'--repo-root',root,'--report',input,'--output',output],{encoding:'utf8'});
  expect(run().status).toBe(0);expect(JSON.parse(readFileSync(output,'utf8')).verdict).toBe('PASS');
  writeFileSync(join(root,'scripts/smoke/lock.sh'),'exit 9\n');git('add','scripts/smoke/lock.sh');git('commit','-qm','fail-test');
  report.source.head_revision=git('rev-parse','HEAD');report.head.revision=report.source.head_revision;report.source.changed_files.push({path:'scripts/smoke/lock.sh'});
  writeFileSync(input,JSON.stringify(report));expect(run().status).toBe(1);expect(JSON.parse(readFileSync(output,'utf8')).assertions[0].exit_code).toBe(9);
});
it('测试进程不继承外部BASH_ENV启动脚本',async()=>{
  const {root,report}=fixture();const startup=join(root,'foreign-startup.sh');writeFileSync(startup,'exit 73\n');vi.stubEnv('BASH_ENV',startup);
  const receipt=await runImplementationGate({repoRoot:root,report});expect(receipt.verdict).toBe('PASS');expect(receipt.assertions[0].exit_code).toBe(0);
});
it('测试篡改后续测试时立即FAIL并停止，不能以旧字节hash记录PASS',async()=>{
  const {root,report,git}=fixture();
  writeFileSync(join(root,'scripts/smoke/lock.sh'),"printf 'exit 0\\n' > scripts/smoke/next.sh\n");writeFileSync(join(root,'scripts/smoke/next.sh'),'exit 88\n');
  git('add','scripts/smoke');git('commit','-qm','two-tests');report.source.head_revision=git('rev-parse','HEAD');report.head.revision=report.source.head_revision;
  report.source.changed_files.push({path:'scripts/smoke/lock.sh'},{path:'scripts/smoke/next.sh'});
  report.required_assertions.push({...report.required_assertions[0],assertion_ref:'scripts/smoke/next.sh'});
  const receipt=await runImplementationGate({repoRoot:root,report});expect(receipt.verdict).toBe('FAIL');expect(receipt.assertions).toHaveLength(1);
  expect(receipt.assertions[0].error).toBe('IMPACT_SOURCE_CHANGED_DURING_TEST');
});
it('真测试非零退出保留FAIL收据而不是映射成功冒充验证成功',async()=>{
  const {root,report,git}=fixture();writeFileSync(join(root,'scripts/smoke/lock.sh'),'exit 7\n');git('add','.');git('commit','-qm','fail-test');
  report.source.head_revision=git('rev-parse','HEAD');report.head.revision=report.source.head_revision;report.source.changed_files.push({path:'scripts/smoke/lock.sh'});
  const receipt=await runImplementationGate({repoRoot:root,report});expect(receipt.verdict).toBe('FAIL');expect(receipt.assertions[0].exit_code).toBe(7);
});
