import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterEach,it,expect} from 'vitest';
import fixtureModule from '../../scripts/fleet-worker/linux-script-test-fixture.cjs';
import {createLinuxDeploymentWriter} from './deployment-writer.js';
const roots=[];afterEach(()=>{for(const p of roots.splice(0))fs.rmSync(p,{recursive:true,force:true});});
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'linux-deploy-'));roots.push(root);const r=fixtureModule.fixture().record;
 const input={pool:r.pool,revision:'a'.repeat(40),host_boot_id:randomUUID(),worker_boot_id:r.identity.worker_boot_id,daemon_id:r.daemon_id,profiles:{safe:{profile:r.profile,image_id:r.image_id}},
  worker_credential_file:path.join(root,'worker.token'),execution_credential_file:path.join(root,'root.key'),parent_task_id:randomUUID()};
 fs.writeFileSync(input.worker_credential_file,'b'.repeat(64),{mode:0o600});fs.writeFileSync(input.execution_credential_file,'e'.repeat(64),{mode:0o600});
 const filename=path.join(root,'scripts.json'),options={env:{CECELIA_LINUX_SCRIPT_DEPLOYMENTS_FILE:filename},owner:process.getuid(),pathRoot:root,readProtected:(p,o)=>{
  const s=fs.lstatSync(p);if(s.isSymbolicLink()||(s.mode&0o777)!==o.mode||s.size>o.maxBytes)throw Error('untrusted');return fs.readFileSync(p,'utf8');}};
 return {root,input,filename,options,writer:createLinuxDeploymentWriter(options)};
}
it('受信凭据引用写入实际0600部署文件，无secret；同内容幂等、更新须CAS摘要',()=>{
 const x=setup(),first=x.writer.runtime(x.input,null);expect(first.machine_registry_id).toBe(x.input.pool.machine_registry_id);
 const bytes=fs.readFileSync(x.filename,'utf8');expect(bytes).not.toContain('e'.repeat(64));expect(fs.statSync(x.filename).mode&0o777).toBe(0o600);
 expect(x.writer.runtime(x.input,null)).toEqual(first);x.input.worker_boot_id=randomUUID();expect(()=>x.writer.runtime(x.input,null)).toThrow('linux_pool_deployment_write_conflict');
 const second=x.writer.runtime(x.input,first.policy_digest);expect(second.policy_digest).not.toBe(first.policy_digest);
 expect(JSON.parse(fs.readFileSync(x.filename)).deployments[0].worker_boot_id).toBe(x.input.worker_boot_id);
});
it('符号链接、宽权限、其他写入锁、未知字段或缺凭据均拒绝且不覆盖文件',()=>{
 for(const mode of ['symlink','permissions','lock','field','credential']){
  const x=setup();x.writer.runtime(x.input,null);const before=fs.readFileSync(x.filename);
  if(mode==='symlink'){fs.renameSync(x.filename,x.filename+'.real');fs.symlinkSync(x.filename+'.real',x.filename);}
  if(mode==='permissions')fs.chmodSync(x.filename,0o644);if(mode==='lock')fs.mkdirSync(x.filename+'.lock');
  if(mode==='field')x.input.token='bad';if(mode==='credential')fs.unlinkSync(x.input.execution_credential_file);
  expect(()=>x.writer.runtime(x.input,null)).toThrow();expect(fs.readFileSync(x.filename)).toEqual(before);
  if(mode==='lock')expect(fs.existsSync(x.filename+'.lock')).toBe(true);
 }
});
it('部署文档有界，CAS失败不遗留锁或临时文件',()=>{
 const x=setup();x.writer.runtime(x.input,null);x.input.worker_boot_id=randomUUID();expect(()=>x.writer.runtime(x.input,'f'.repeat(64))).toThrow();
 expect(fs.readdirSync(x.root).sort()).toEqual(['root.key','scripts.json','worker.token']);
 fs.writeFileSync(x.filename,'x'.repeat(65537),{mode:0o600});expect(()=>x.writer.runtime(x.input,null)).toThrow();
});
it('池验收与脚本部署分开写入，各自读取既有凭据且保持同一机器UUID',()=>{
 const x=setup(),d=x.input;x.options.env.CECELIA_LINUX_POOL_DEPLOYMENTS_FILE=path.join(x.root,'pools.json');
 const input={profile:d.pool,revision:d.revision,host_boot_id:d.host_boot_id,worker_boot_id:d.worker_boot_id,daemon_id:d.daemon_id,image_id:d.profiles.safe.image_id,script_profiles:['safe'],credential_file:d.worker_credential_file};
 expect(x.writer.pool(input,null).machine_registry_id).toBe(d.pool.machine_registry_id);expect(x.writer.runtime(d,null).machine_registry_id).toBe(d.pool.machine_registry_id);
 expect(JSON.parse(fs.readFileSync(x.options.env.CECELIA_LINUX_POOL_DEPLOYMENTS_FILE)).deployments).toEqual([input]);
});
