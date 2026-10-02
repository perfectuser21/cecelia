import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {it,expect,afterEach,vi} from 'vitest';
import {createOnboardingCredentials,createPrivateOp} from './onboarding-credentials.js';
const roots=[];afterEach(()=>{vi.restoreAllMocks();roots.splice(0).forEach(p=>fs.rmSync(p,{recursive:true,force:true}));});
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'linux-credentials-'));roots.push(root);
 const id=randomUUID(),item='a'.repeat(26),calls=[];let state=null,stored=null,failCreate=false;
 const save=async value=>{state=structuredClone(value);};
 const run=async(args,input)=>{calls.push({args,input});
  if(args[1]==='list')return JSON.stringify(stored?[{id:item,title:'Cecelia Linux '+id,tags:['cecelia-linux:'+id]}]:[]);
  if(args[1]==='create'){expect(state).toEqual({phase:'creating'});stored=JSON.parse(input);if(failCreate)throw Error('transport lost');return JSON.stringify({id:item});}
  if(args[0]==='read')return stored.fields.find(f=>f.id===args[1].split('/').at(-1)).value;
  throw Error('unexpected');};
 const ensure=createOnboardingCredentials({root,run,pathRoot:root});
 return {root,id,calls,ensure,save,get state(){return state;},get stored(){return stored;},set failCreate(v){failCreate=v;},clear(){stored=null;}};
}
it('UUID独立256bit凭据先落创建意图，再1Password创建和读回，双写600且结果无secret',async()=>{
 const x=setup(),result=await x.ensure(x.id,x.state,x.save);
 const a=fs.readFileSync(result.worker_credential_file,'utf8'),b=fs.readFileSync(result.execution_credential_file,'utf8');
 expect(a).toMatch(/^[a-f0-9]{64}$/);expect(b).toMatch(/^[a-f0-9]{64}$/);expect(a).not.toBe(b);
 expect(fs.statSync(result.worker_credential_file).mode&0o777).toBe(0o600);expect(JSON.stringify(result)).not.toContain(a);
 expect(JSON.stringify(x.calls.map(c=>c.args))).not.toContain(a);expect(x.state).toEqual({phase:'ready',item_id:'a'.repeat(26)});
 expect(await x.ensure(x.id,x.state,x.save)).toEqual(result);expect(x.calls.filter(c=>c.args[1]==='create')).toHaveLength(1);
});
it('create回执未知只重读已创建项；查无记录也不重建/轮换',async()=>{
 const x=setup();x.failCreate=true;
 await expect(x.ensure(x.id,x.state,x.save)).rejects.toThrow('linux_pool_credentials_unconfirmed');
 expect(x.state).toEqual({phase:'creating'});x.failCreate=false;
 const result=await x.ensure(x.id,x.state,x.save);expect(result.worker_credential_file).toContain(x.id);
 x.clear();await expect(x.ensure(x.id,{phase:'creating'},x.save)).rejects.toThrow('linux_pool_credentials_unconfirmed');
 expect(x.calls.filter(c=>c.args[1]==='create')).toHaveLength(1);
});
it('意图落盘失败零创建，重复匹配、宽权限目录和符号链接拒绝',async()=>{
 const x=setup();await expect(x.ensure(x.id,null,async()=>{throw Error('db unavailable');})).rejects.toThrow();
 expect(x.calls.some(c=>c.args[1]==='create')).toBe(false);
 const duplicate=createOnboardingCredentials({root:x.root,pathRoot:x.root,run:async()=>JSON.stringify([1,2].map(()=>({id:'a'.repeat(26),title:'Cecelia Linux '+x.id,tags:['cecelia-linux:'+x.id]})))});
 await expect(duplicate(x.id,null,x.save)).rejects.toThrow();
 fs.chmodSync(path.join(x.root,x.id),0o755);await expect(x.ensure(x.id,null,x.save)).rejects.toThrow();
 fs.rmdirSync(path.join(x.root,x.id));fs.symlinkSync(x.root,path.join(x.root,x.id));await expect(x.ensure(x.id,null,x.save)).rejects.toThrow();
});
it('受保护机器绑定复用既有CS item，零创建且无新凭据',async()=>{
 const x=setup(),item='hggqzux4bkd6obcjp44zko6ywm';
 fs.writeFileSync(path.join(x.root,'credential-bindings.json'),JSON.stringify({schema_version:1,items:{[x.id]:item}}),{mode:0o600});
 const calls=[],ensure=createOnboardingCredentials({root:x.root,pathRoot:x.root,run:async args=>{calls.push(args);if(args[0]!=='read')throw Error('must only read');return args[1].endsWith('worker_token')?'b'.repeat(64):'c'.repeat(64);}});
 const result=await ensure(x.id,null,x.save);expect(result.item_id).toBe(item);expect(calls).toHaveLength(2);expect(x.state.item_id).toBe(item);
});

it('默认私有OP只读独立root控制挂载，拒绝后不回退共享凭据路径',async()=>{
 const reads=[];
 const run=createPrivateOp({read:(file,options)=>{reads.push({file,options});throw Error('read-refused');}});
 await expect(run(['--version'])).rejects.toThrow('read-refused');
 expect(reads).toEqual([{file:'/run/cecelia-fleet-control/1password.env',options:{mode:0o600,owner:0,maxBytes:16384}}]);
});
it('凭据、SSH与固定制品默认从同一个root控制目录开始校验',async()=>{
 const {createOnboardingSSH}=await import('./onboarding-ssh.js');
 const {createOnboardingArtifacts}=await import('./onboarding-artifact.js');
 const reads=[];vi.spyOn(fs,'lstatSync').mockImplementation(p=>{reads.push(p);throw Error('parent-refused');});
 await expect(createOnboardingCredentials()(randomUUID(),null,async()=>{})).rejects.toThrow('linux_pool_credentials_unconfirmed');
 const request={name:'vps-test',address:'192.0.2.42',ssh_user:'root',ssh_port:22,credential_ref:'op://CS/test/private key',host_key_fingerprint:'SHA256:'+ 'a'.repeat(43),role:'worker',region:'HK'};
 await expect(createOnboardingSSH()(randomUUID(),request,{})).rejects.toThrow('linux_pool_ssh_unavailable');
 expect(()=>createOnboardingArtifacts({revision:'a'.repeat(40)}).capture()).toThrow('linux_pool_artifact_unavailable');
 expect(reads).toEqual(Array(3).fill('/run/cecelia-fleet-control'));
});
it('生产compose保留共享凭据只读，私有控制挂载和部署文件统一到root父目录',()=>{
 const compose=fs.readFileSync(new URL('../../../../docker-compose.us-vps.yml',import.meta.url),'utf8');
 expect(compose).toContain('- /root/.credentials:/root/.credentials:ro');
 expect(compose).toMatch(/source: \/root\/\.credentials\/fleet-control\s+target: \/run\/cecelia-fleet-control\s+bind:\s+create_host_path: false/);
 for(const [kind,name] of [['POOL','pools'],['SCRIPT','scripts']])expect(compose).toContain(`CECELIA_LINUX_${kind}_DEPLOYMENTS_FILE=/run/cecelia-fleet-control/${name}.json`);
});
