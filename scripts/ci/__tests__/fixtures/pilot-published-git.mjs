/** 还原实际发布SHA的最小Git对象链；HEAD退役不改变历史caller的固定字节。 */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFixedLocalGitBlob} from '../../fixed-local-git.mjs';
const objects=JSON.parse(readFileSync(new URL('./pilot-published-git.json',import.meta.url),'utf8'));
export const PILOT_REVISION='0ed23d135ba1fa977db71d70bb742e8522c07917';
export const PILOT_BLOB='164862fa35e5fc9744762ec2bc58bc1a324ab5aa';
export const readPilotGitFixture=()=>structuredClone(objects);
export function createPublishedPilotGit({data=objects}={}){
 const directory=mkdtempSync(join(tmpdir(),'pilot-published-git-'));
 const close=()=>rmSync(directory,{recursive:true,force:true});
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 Object.assign(env,{GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_ALLOW_PROTOCOL:'',GIT_TERMINAL_PROMPT:'0'});
 const command=(args,input)=>execFileSync('git',['--no-replace-objects','-c','core.hooksPath=/dev/null',...args],{cwd:directory,env,input,stdio:['pipe','pipe','pipe'],timeout:10000});
 const git=(...args)=>command(args);
 try {
  assert.equal(data.schema_version,1);assert.equal(data.revision,PILOT_REVISION);assert.equal(data.objects.length,5);
  assert.deepEqual(data.objects.map(o=>o.type),['commit','tree','tree','tree','blob']);
  assert.equal(data.objects[0].sha1,PILOT_REVISION);assert.equal(data.objects.at(-1).sha1,PILOT_BLOB);
  git('init','--quiet');
  for(const object of data.objects){
   const bytes=Buffer.from(object.content_base64,'base64');
   assert.equal(createHash('sha1').update(`${object.type} ${bytes.length}\0`).update(bytes).digest('hex'),object.sha1);
   assert.equal(command(['hash-object','-w','-t',object.type,'--stdin'],bytes).toString().trim(),object.sha1);
  }
  assert.equal(git('rev-parse',PILOT_REVISION+':.github/workflows/pilot-release-verification.yml').toString().trim(),PILOT_BLOB);
  return {directory,git,close,read:()=>readFixedLocalGitBlob(directory,{revision:PILOT_REVISION,path:'.github/workflows/pilot-release-verification.yml'})};
 } catch(error){close();throw error;}
}
export function readPublishedPilotWorkflow(){const f=createPublishedPilotGit();try{return f.read();}finally{f.close();}}
