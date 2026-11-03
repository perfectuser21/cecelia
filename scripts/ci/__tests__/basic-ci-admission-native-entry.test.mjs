import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildCiAdmissionDraft} from '../ci-admission-builder.mjs';
import {baselineFixture} from './fixtures/ci-admission-pr.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
function fixture(t){
 const directory=mkdtempSync(join(tmpdir(),'ci-admission-native-entry-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));return directory;
}

test('轻入口真实builder核对私有Git checkout身份，在scratch前拒绝',async t=>{
 const f=await baselineFixture(t);let writes=0;
 const actualHead=f.options.event.pull_request.head.sha;assert.notEqual(actualHead,f.control);
 await assert.rejects(buildCiAdmissionDraft({sourceRoot:f.candidate,controlRoot:f.root,sourceRevision:f.control,controlRevision:f.control},{openScratch:async()=>{writes++;throw Error('must not create scratch');}}),{code:'CI_ADMISSION_CHECKOUT_MISMATCH'});
 assert.equal(writes,0);assert.equal(f.options.event.pull_request.base.sha,f.control);assert.equal(existsSync(join(f.candidate,'pr-input')),true);
});

test('轻入口真实worker进程拒绝错误argv，不写draft且不继承线上环境',async t=>{
 const directory=fixture(t),output=join(directory,'draft.json');
 const result=await new Promise(resolve=>execFile('node',['scripts/ci/ci-admission-worker.mjs',directory,root,'a'.repeat(40),'b'.repeat(40),output,'unexpected'],{
  cwd:root,env:{PATH:dirname(process.execPath)+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:directory,TMPDIR:directory,CI:'true',NODE_ENV:'test',DB_HOST:'127.0.0.1',DB_PORT:'1',DB_NAME:'cecelia_scratch',DB_USER:'ci',DB_PASSWORD:'isolated-ci'},timeout:5000,maxBuffer:1024*1024,
 },(error,stdout,stderr)=>resolve({error,stdout,stderr})));
 assert.equal(result.error?.code,1);assert.match(result.stderr,/CI_ADMISSION_WORKER_ARGUMENTS/);assert.equal(result.stdout.includes('ci_worker_format'),false);assert.equal(existsSync(output),false);
});
