import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {admissionFixture} from './ci-admission-envelope.mjs';

const repo='perfectuser21/cecelia',prefix=`repos/${repo}/actions`;
export async function baselineFixture(t){
 const f=await admissionFixture(t),parent=mkdtempSync(join(tmpdir(),'ci-baseline-candidate-')),candidate=join(parent,'head');
 f.git('worktree','add','--quiet','--detach',candidate,f.control);
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null',...args],{cwd:candidate,encoding:'utf8'}).trim();
 writeFileSync(join(candidate,'pr-input'),'actual candidate change');git('add','pr-input');git('commit','-qm','candidate');const head=git('rev-parse','HEAD');
 const pr={base:{sha:f.control,ref:'main',repo:{full_name:repo}},head:{sha:head,repo:{full_name:repo}}},calls=[];
 const artifact=f.data.get(`${prefix}/artifacts/77`),name=`implementation-ci-admission-baseline-${f.source}`;
 f.data.set(`${prefix}/artifacts?name=${name}&per_page=100`,{total_count:1,artifacts:[structuredClone(artifact)]});
 const api=async path=>{
  calls.push(path);if(path===`repos/${repo}/pulls/42`)return structuredClone(pr);
  if(path.includes('/artifacts?name=')&&!f.data.has(path))return {total_count:0,artifacts:[]};return f.api(path);
 };
 return {...f,calls,artifact,candidate,options:{repoRoot:candidate,toolingRoot:f.root,repository:repo,eventName:'pull_request',event:{number:42,pull_request:pr},toolingRevision:f.control},deps:{api,download:async p=>Buffer.from(f.data.get(p))}};
}
