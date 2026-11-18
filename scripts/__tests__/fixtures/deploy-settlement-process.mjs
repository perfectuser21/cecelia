import {mkdtemp,realpath,rm,stat,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../../brain-image-retention/storage.mjs';
import {createDockerAdapter} from '../../brain-image-retention/docker.mjs';
import {createDeploymentLedger} from '../../brain-image-retention/ledger.mjs';
import {US_MACHINE_ID} from '../../brain-image-retention/policy.mjs';
export const image='sha256:'+'a'.repeat(64),container='b'.repeat(64),sha='c'.repeat(40);
export async function setup(t,{settlementTimeoutMs=8000}={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'settlement-process-')));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const executable=join(root,'docker.cjs'),statePath=join(root,'fixture.json');
 const state={mode:'ok',delay:0,info:0};
 await writeFile(executable,`#!${process.execPath}
const fs=require('node:fs'),{spawn}=require('node:child_process');
const root=__dirname,p=root+'/fixture.json',a=process.argv.slice(2),s=JSON.parse(fs.readFileSync(p));
fs.appendFileSync(root+'/calls',JSON.stringify(a)+'\\n');
if(s.mode==='hang'&&a[0]==='info'){
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','inherit','inherit',3]});
 fs.writeFileSync(root+'/descendant.pid',String(child.pid));setInterval(()=>{},1000);
}else setTimeout(()=>{
 const image={Id:${JSON.stringify(image)},RepoTags:['cecelia-brain:1.0.1'],RepoDigests:[],Created:'2026-01-01T00:00:00Z',Config:{Env:['GIT_SHA=${sha}']}};
 const container={Id:${JSON.stringify(container)},Image:image.Id,Name:'/cecelia-node-brain',State:{Running:true}};
 if(s.mode==='container-drift'&&a[0]==='exec')s.drift=true;
 if(s.drift)container.Id='d'.repeat(64);
 if(s.mode==='wrong-image')container.Image='sha256:'+'e'.repeat(64);
 if(s.mode==='image-sha')image.Config.Env=['GIT_SHA='+'f'.repeat(40)];
 if(s.mode==='ledger-drift'&&a[0]==='exec'){
  const p=root+'/ledger.json',ledger=JSON.parse(fs.readFileSync(p));ledger.generation++;fs.writeFileSync(p,JSON.stringify(ledger));
 }
 let value;
 if(a[0]==='info'){s.info++;value={ID:s.mode==='daemon-drift'&&s.info>1?'other':'daemon',DockerRootDir:'/mnt/data/docker',OSType:'linux'};}
 else if(a[0]==='image'&&a[1]==='ls')value=image.Id;
 else if(a[0]==='container'&&a[1]==='ls')value=container.Id;
 else if(a[0]==='image'&&a[1]==='inspect')value=[image];
 else if(a[0]==='container'&&a[1]==='inspect')value=[container];
 else if(a[0]==='inspect')value=[container,image];
 else if(a[0]==='exec')value=JSON.stringify({status:'healthy',version:'1.0.1',git_sha:s.mode==='bad-health'?'f'.repeat(40):${JSON.stringify(sha)}})+'\\n200';
 else process.exit(2);
 fs.writeFileSync(p,JSON.stringify(s));process.stdout.write(typeof value==='string'?value:JSON.stringify(value));
},s.delay);
`,{mode:0o700});
 const store=createStore(root),expected={machine_registry_id:US_MACHINE_ID,daemon_id:'daemon',docker_root_dir:'/mnt/data/docker',volume_dev:(await stat(root)).dev};
 const docker=createDockerAdapter({root,dataPath:root,expected,executable,timeoutMs:1500});
 const receipt={deployment_id:'11111111-1111-4111-8111-111111111111',outcome:'success',image_id:image,version:'1.0.1',git_sha:sha,confirmed_at:new Date().toISOString()};
 await store.withLock(async lease=>{
  await store.save('ledger.json',{schema_version:1,generation:1,pending:null,successes:[receipt]},lease);
  await store.save(`deployment-${receipt.deployment_id}.json`,{request:{deployment_id:receipt.deployment_id,version:receipt.version,git_sha:sha},receipt,target_image_id:image},lease);
 });
 const save=()=>writeFile(statePath,JSON.stringify(state));await save();
 return {root,state,save,store,ledger:createDeploymentLedger({store,docker,settlementTimeoutMs}),calls:async()=> (await readFile(join(root,'calls'),'utf8')).trim().split('\n').map(JSON.parse)};
}
