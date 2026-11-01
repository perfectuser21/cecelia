import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCiAdmissionWorker} from '../ci-admission-worker-runner.mjs';
for(const failWorker of [false,true])test(`真实Node worker没有发布凭据/私有HOME，失败/成功均清理：failure=${failWorker}`,async t=>{
 const directory=mkdtempSync(join(tmpdir(),'ci-admission-worker-fixture-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 mkdirSync(join(directory,'scripts/ci'),{recursive:true});
 writeFileSync(join(directory,'scripts/ci/ci-admission-worker.mjs'),`import {writeFileSync} from 'node:fs';
 const env=process.env;writeFileSync('observed.json',JSON.stringify({env,args:process.argv.slice(2)}));
 if(${failWorker})process.exit(7);
 writeFileSync(process.argv[6],JSON.stringify({ci_worker_format:'cecelia.ci-worker/v1',draft:{ci_format:'draft-test',source:process.argv[4],control:process.argv[5]},readback:{schema:'ci_admission_'+ 'a'.repeat(32),cells:121}}));`);
 const options={sourceRoot:directory,controlRoot:directory,sourceRevision:'a'.repeat(40),controlRevision:'b'.repeat(40)};
 let readback;const before=process.env.GH_TOKEN;process.env.GH_TOKEN='synthetic-parent-token-must-not-inherit';
 try{if(failWorker)await assert.rejects(runCiAdmissionWorker(options),/CI_ADMISSION_WORKER_FAILED exit=7/);
 else assert.deepEqual(await runCiAdmissionWorker(options,{observe:value=>{readback=value;}}),{ci_format:'draft-test',source:'a'.repeat(40),control:'b'.repeat(40)});}
 finally{if(before===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=before;}
 const observed=JSON.parse(readFileSync(join(directory,'observed.json')));
 for(const key of ['GH_TOKEN','GITHUB_TOKEN','SKILLS_SOURCE_SSH_KEY','NODE_OPTIONS','NODE_PATH','SSH_AUTH_SOCK','DOCKER_HOST'])assert.equal(observed.env[key],undefined,key);
 assert.notEqual(observed.env.HOME,process.env.HOME);assert.equal(existsSync(observed.env.HOME),false);assert.equal(existsSync(observed.env.TMPDIR),false);
 if(!failWorker)assert.equal(readback.cells,121);
 assert.equal(observed.env.NODE_ENV,'test');assert.equal(observed.env.CI,'true');
});
