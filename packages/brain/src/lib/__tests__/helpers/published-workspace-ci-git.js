/** 只还原固定已审测试Git对象；不联网，不认领候选或生产来源资格。 */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFixedLocalGitBlob} from '../../../../../../scripts/ci/fixed-local-git.mjs';
const require=createRequire(import.meta.url);
const publishedObjects=require('./published-workspace-ci-git.json');
export const PUBLISHED_CI_REVISION='b217cd52336767b9637410ef921397a0e9297f2b';
export const readPublishedGitFixture=()=>structuredClone(publishedObjects);
export function createPublishedGit({data=publishedObjects}={}){
 const directory=mkdtempSync(join(tmpdir(),'workspace-published-git-'));
 const close=()=>rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:20});
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 Object.assign(env,{GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:''});
 const command=(args,input)=>execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null','-c','maintenance.auto=false','-c','gc.auto=0',...args],{cwd:directory,env,input,stdio:['pipe','pipe','pipe']});
 const git=(...args)=>command(args);
 try{
  assert.equal(data.schema_version,1);assert.equal(data.revision,PUBLISHED_CI_REVISION);
  assert.equal(data.objects.length,8);
  assert.deepEqual(data.files,[
   {path:'.github/workflows/implementation-impact.yml',sha1:'5a43bfd48709018ee641952747b15f3c949099f2'},
   {path:'scripts/ci/implementation-skill-source.mjs',sha1:'2351ae6a69b066a7e15dbb17e2e6babc13a31305'},
  ]);
  git('init','--quiet');
  for(const object of data.objects){
   assert.ok(['commit','tree','blob'].includes(object.type));const bytes=Buffer.from(object.content_base64,'base64');
   assert.equal(createHash('sha1').update(`${object.type} ${bytes.length}\0`).update(bytes).digest('hex'),object.sha1);
   assert.equal(command(['hash-object','-w','-t',object.type,'--stdin'],bytes).toString().trim(),object.sha1);
  }
  assert.equal(git('rev-parse',PUBLISHED_CI_REVISION+'^{tree}').toString().trim(),data.tree);
  return {directory,git,env,close,revision:PUBLISHED_CI_REVISION,
   read:path=>readFixedLocalGitBlob(directory,{revision:PUBLISHED_CI_REVISION,path})};
 }catch(error){close();throw error;}
}
