// 真实 run-once、临时 Git origin、假 Brain HTTP；仅 GitHub CLI 外部边界替身，不操作真实 PR。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runMergeGate } from '../lib/merge-gate.mjs';
import { useQaEnv, FAKE_GH_CI } from './helpers/qa-env.mjs';

describe('merge-gate：批准后的草稿恢复', () => {
  const E = useQaEnv();
  const actions = () => E.ghCalls().filter(a => ['ready', 'merge'].includes(a[1]));
  const approve = () => E.seedState({ passed: true, approved: { head: E.remoteHead(), round: 1 }, rounds: [] });
  // 原 fake-gh-ci 保留其它真实 runner 契约。此临时 shim 只刻画 GitHub draft/ready 边界与竞态。
  function boundary(options = {}) {
    const file = path.join(E.sb.root, 'draft-boundary.json');
    const bin = path.join(E.sb.root, 'gh-draft.mjs');
    fs.writeFileSync(file, JSON.stringify({ ready: false, ...options }));
    fs.writeFileSync(bin, `#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const a=process.argv.slice(2),file=${JSON.stringify(file)},s=JSON.parse(fs.readFileSync(file,'utf8'));
const log=()=>fs.appendFileSync(process.env.FAKE_GH_LOG,JSON.stringify(a)+'\\n');
if(a[0]==='pr'&&a[1]==='ready'){
 log(); if(s.readyExit){process.stderr.write('ready failed\\n');process.exit(s.readyExit);}
 s.ready=true;fs.writeFileSync(file,JSON.stringify(s));process.exit(0);
}
if(a[0]==='pr'&&a[1]==='view'&&a.at(-1).includes('isDraft')){
 log();if(s.viewExit)process.exit(s.viewExit);
 if(s.badView){process.stdout.write('{}');process.exit(0);}
 const pr=JSON.parse(fs.readFileSync(process.env.FAKE_GH_CI,'utf8')).prs[0];
 process.stdout.write(JSON.stringify({headRefOid:(s.ready?s.afterHead:s.beforeHead)||pr.headRefOid,isDraft:s.ready?Boolean(s.stillDraft):true,state:'OPEN'}));process.exit(0);
}
if(a[0]==='pr'&&a[1]==='merge'&&!a.includes('--disable-auto')){
 const pr=JSON.parse(fs.readFileSync(process.env.FAKE_GH_CI,'utf8')).prs[0];
 if(pr.isDraft&&!s.ready){log();process.stderr.write('Pull Request is still a draft\\n');process.exit(1);}
}
const r=spawnSync(${JSON.stringify(FAKE_GH_CI)},a,{stdio:'inherit'});if(r.signal)process.kill(process.pid,r.signal);else process.exit(r.status??1);
`, { mode: 0o755 });
    return bin;
  }
  async function go(options = {}, state = E.green({ prs: [E.pr({ isDraft: true })] })) {
    return E.go(state, { extra: { CODING_WF_GH_BIN: boundary(options), CODING_WF_CIFIX: '0' } });
  }
  it('exact 已批准 head、required 全绿后先 ready、重新核头，再 match-head 合并', async () => {
    approve();const head=E.remoteHead();const r=await go();
    expect(r.exitCode,r.stderr).toBe(0);
    expect(actions()).toEqual([['pr','ready','77'],['pr','merge','77','--squash','--delete-branch','--match-head-commit',head]]);
    expect(E.state().merged?.head,r.stderr).toBe(head);
    const calls=E.ghCalls(),ready=calls.findIndex(a=>a[1]==='ready'),merge=calls.findIndex(a=>a[1]==='merge');
    expect(calls.slice(0,ready).some(a=>a[1]==='checks'&&a.includes('--required'))).toBe(true);
    expect(calls.slice(ready+1,merge).some(a=>a[1]==='view'&&a.at(-1).includes('headRefOid'))).toBe(true);
  });
  it('ready 失败不得尝试 merge 或记录已合并', async () => {
    approve();const r=await go({readyExit:1});expect(r.exitCode,r.stderr).toBe(0);
    expect(actions()).toEqual([['pr','ready','77']]);expect(E.state().merged).toBeUndefined();
  });
  it('fresh head 在 ready 前已变化，不能解除草稿', async () => {
    approve();const r=await go({beforeHead:'b'.repeat(40)});expect(r.exitCode,r.stderr).toBe(0);
    expect(actions()).toEqual([]);expect(E.state().merged).toBeUndefined();
  });
  it('ready 后 head 变化，不得合并旧批准', async () => {
    approve();const r=await go({afterHead:'c'.repeat(40)});expect(r.exitCode,r.stderr).toBe(0);
    expect(actions()).toEqual([['pr','ready','77']]);expect(E.state().merged).toBeUndefined();
  });
  it('ready 返回零但仍为 draft，不能当解除成功', async () => {
    approve();const r=await go({stillDraft:true});expect(r.exitCode,r.stderr).toBe(0);
    expect(actions()).toEqual([['pr','ready','77']]);expect(E.state().merged).toBeUndefined();
  });
  it.each([{viewExit:1},{badView:true}])('fresh PR 查询失败或身份缺失时不能 ready：%j',async options=>{
    approve();const r=await go(options);expect(r.exitCode,r.stderr).toBe(0);expect(actions()).toEqual([]);
  });
  it('required 尚未通过不得 ready', async () => {
    approve();const r=await go({},E.green({prs:[E.pr({isDraft:true})],required:{77:[{name:'ci-passed',bucket:'pending'}]}}));
    expect(r.exitCode,r.stderr).toBe(0);expect(actions()).toEqual([]);
  });
  it('没有 QA 与裁判批准不得 ready', async () => {
    E.seedState({passed:false,rounds:[],escalated:{type:'test_wait'}});
    const r=await go();expect(r.exitCode,r.stderr).toBe(0);expect(actions()).toEqual([]);
  });
  it('非 draft 保持原合并路径，不额外调用 ready 或 draft 查询', async () => {
    approve();const head=E.remoteHead();const r=await go({},E.green({prs:[E.pr({isDraft:false})]}));
    expect(r.exitCode,r.stderr).toBe(0);
    expect(actions()).toEqual([['pr','merge','77','--squash','--delete-branch','--match-head-commit',head]]);
    expect(E.ghCalls().some(a=>a[1]==='view'&&a.at(-1).includes('isDraft'))).toBe(false);
  });
  it('Cecelia 真来源验证拒绝无注册链时，即便批准+绿检查也不得 ready',async()=>{
    approve();const head=E.remoteHead();fs.writeFileSync(E.files.gh,JSON.stringify(E.green({prs:[E.pr({isDraft:true})]})));
    const old={FAKE_GH_CI:process.env.FAKE_GH_CI,FAKE_GH_LOG:process.env.FAKE_GH_LOG};
    process.env.FAKE_GH_CI=E.files.gh;process.env.FAKE_GH_LOG=E.sb.ghLog;
    const logs=[];
    try {
      await runMergeGate({cfg:{repo:E.sb.clone,repoSlug:'perfectuser21/cecelia',repoKey:'cecelia',logDir:E.sb.logDir,ghBin:boundary()},log:x=>logs.push(x),brain:{patch:async()=>({ok:true})}});
    } finally {for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
    expect(E.state().escalated?.type,logs.join('\n')).toBe('source_provenance_missing');
    expect(E.state().approved.head).toBe(head);expect(actions()).toEqual([]);
  });
});
