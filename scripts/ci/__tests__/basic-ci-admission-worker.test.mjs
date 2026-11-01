import {test} from 'node:test';
import {spawn,execFile} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractSpawnEdges} from '../../../packages/brain/src/lib/graph-extract.js';
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

test('worker拦截SIGTERM也必须在短预算内返回，owned进程组及HOME/TMP都收尾',{timeout:5000},async t=>{
 const directory=mkdtempSync(join(tmpdir(),'ci-admission-worker-timeout-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 mkdirSync(join(directory,'scripts/ci'),{recursive:true});
 writeFileSync(join(directory,'scripts/ci/ci-admission-worker.mjs'),`import {writeFileSync} from 'node:fs';
 writeFileSync('owned-worker.json',JSON.stringify({pid:process.pid,home:process.env.HOME,tmp:process.env.TMPDIR}));
 process.on('SIGTERM',()=>writeFileSync('term-intercepted','true'));setInterval(()=>{},1000);`);
 const moduleURL=new URL('../ci-admission-worker-runner.mjs',import.meta.url).href;
 writeFileSync(join(directory,'harness.mjs'),`import {runCiAdmissionWorker} from ${JSON.stringify(moduleURL)};
 try{await runCiAdmissionWorker({sourceRoot:process.cwd(),controlRoot:process.cwd(),sourceRevision:'a'.repeat(40),controlRevision:'b'.repeat(40)},{timeoutMs:200});process.exitCode=9;}
 catch(error){process.stdout.write(JSON.stringify({code:error.code,message:error.message}));}`);
 const child=spawn(process.execPath,[join(directory,'harness.mjs')],{cwd:directory,detached:true,env:{PATH:process.env.PATH,HOME:directory},stdio:['ignore','pipe','pipe']});
 let watchdog=false,stdout='',stderr='';child.stdout.on('data',bytes=>{stdout+=bytes;});child.stderr.on('data',bytes=>{stderr+=bytes;});
 const kill=pid=>{try{process.kill(-pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}};
 const owned=()=>JSON.parse(readFileSync(join(directory,'owned-worker.json')));
 const alarm=setTimeout(()=>{watchdog=true;if(existsSync(join(directory,'owned-worker.json')))kill(owned().pid);else kill(child.pid);},1500);
 try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}
 finally{clearTimeout(alarm);if(existsSync(join(directory,'owned-worker.json')))kill(owned().pid);kill(child.pid);}
 assert.equal(watchdog,false,`sync调用被SIGTERM阻塞，需外层救援；stderr=${stderr}; term_intercepted=${existsSync(join(directory,'term-intercepted'))}`);
 const result=JSON.parse(stdout);assert.equal(result.code,'CI_ADMISSION_WORKER_FAILED');assert.match(result.message,/signal=SIGKILL error=ETIMEDOUT/);
 assert.equal(existsSync(join(directory,'term-intercepted')),false);
 assert.equal(existsSync(owned().home),false);assert.equal(existsSync(owned().tmp),false);
 assert.throws(()=>process.kill(owned().pid,0),error=>error.code==='ESRCH');
});
test('worker预算接缝只能缩短既有25分钟，不接受无限或更大预算',async()=>{
 for(const timeoutMs of [0,-1,1500001,Infinity,1.5])await assert.rejects(runCiAdmissionWorker({sourceRoot:'/does/not/exist',controlRoot:'/does/not/exist',sourceRevision:'a'.repeat(40),controlRevision:'b'.repeat(40)},{timeoutMs}),/CI_ADMISSION_WORKER_TIMEOUT_INVALID/);
});

test('正式spawn抽取器必须识别实际worker入口回归的脚本目标',()=>{
 const file='scripts/ci/__tests__/basic-ci-admission-worker.test.mjs',target='scripts/ci/ci-admission-worker.mjs';
 assert.ok(extractSpawnEdges(readFileSync(new URL(import.meta.url),'utf8'),file).some(edge=>edge.src_path===file&&edge.dst_path===target&&edge.edge_type==='spawn'));
});

test('真实worker错误argv子进程拒绝且不写draft，只给私有HOME与最小env',{timeout:10000},async t=>{
 const directory=mkdtempSync(join(tmpdir(),'ci-admission-worker-argv-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const output=join(directory,'draft.json'),root=fileURLToPath(new URL('../../../',import.meta.url));
 const result=await new Promise(resolve=>execFile('node',['scripts/ci/ci-admission-worker.mjs',directory,root,'a'.repeat(40),'b'.repeat(40),output,'unexpected'],{
  cwd:root,env:{PATH:dirname(process.execPath)+':/usr/bin:/bin:/usr/sbin:/sbin',HOME:directory,TMPDIR:directory,CI:'true',NODE_ENV:'test',DB_HOST:'127.0.0.1',DB_NAME:'cecelia_scratch',DB_USER:'ci',DB_PASSWORD:'isolated-ci'},timeout:5000,maxBuffer:1024*1024,
 },(error,stdout,stderr)=>resolve({error,stdout,stderr})));
 assert.equal(result.error?.code,1);assert.match(result.stderr,/CI_ADMISSION_WORKER_ARGUMENTS/);assert.equal(result.stdout.includes('ci_worker_format'),false);assert.equal(existsSync(output),false);
});
