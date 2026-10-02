import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {it,expect,afterEach} from 'vitest';
import {createOnboardingSSH} from './onboarding-ssh.js';
const roots=[];afterEach(()=>roots.splice(0).forEach(p=>fs.rmSync(p,{recursive:true,force:true})));
function setup(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'linux-ssh-'));roots.push(root);const calls=[];
 const request={name:'new-linux',address:'100.64.1.2',ssh_user:'root',ssh_port:22,credential_ref:'op://CS/example/private key',host_key_fingerprint:'SHA256:'+'a'.repeat(43),role:'worker',region:'HK'};
 const run=async(command,args,options)=>{calls.push({command,args,options});if(command.endsWith('ssh-keyscan'))return '100.64.1.2 ssh-ed25519 ABC\n';
  if(command.endsWith('ssh-keygen'))return '256 '+request.host_key_fingerprint+' (ED25519)';if(command.endsWith('/ssh'))return '{"signed":true}';throw Error('unexpected');};
 const options={root,pathRoot:root,run,readKey:async()=> 'PRIVATE-SSH-KEY',source:'def dispatch(p): return p'};
 return {root,calls,request,options,send:createOnboardingSSH(options)};
}
it('固定SSH通道校验指纹且只有stdin带源码/动作/secret，工作文件600并最终清除',async()=>{
 const x=setup();expect(await x.send(randomUUID(),x.request,{action:'bootstrap',token:'private-token'})).toEqual({signed:true});
 const call=x.calls.find(c=>c.command.endsWith('/ssh'));expect(call.args).toContain('StrictHostKeyChecking=yes');expect(call.args).toContain('IdentityAgent=none');
 expect(call.args).toContain('ClearAllForwardings=yes');expect(JSON.stringify(call.args)).not.toContain('private-token');expect(call.options.input).not.toContain('PRIVATE-SSH-KEY');
 const body=JSON.parse(Buffer.from(call.options.input.split('\n')[1],'base64'));expect(body.token).toBe('private-token');expect(fs.readdirSync(x.root)).toEqual([]);
});
it('接入恢复通过stdin使用原工件远端程序，不混入新镜像控制源码',async()=>{
 const x=setup();await x.send(randomUUID(),x.request,{action:'probe'},{source:'fixed old remote program'});
 const call=x.calls.find(c=>c.command.endsWith('/ssh')),body=JSON.parse(Buffer.from(call.options.input.split('\n')[1],'base64'));
 expect(body.remote_source).toBe('fixed old remote program');expect(JSON.stringify(call.args)).not.toContain('fixed old remote program');
});
it.each(['fingerprint','symlink','timeout','field'])('%s失败不透出密钥且清理本地工作目录',async kind=>{
 const x=setup();let run=x.options.run;
 if(kind==='fingerprint')run=async(c,a,o)=>c.endsWith('ssh-keygen')?'256 SHA256:wrong':x.options.run(c,a,o);
 if(kind==='timeout')run=async(c,a,o)=>c.endsWith('/ssh')?Promise.reject(Error('secret-output')):x.options.run(c,a,o);
 if(kind==='field')x.request.worker_boot_id=randomUUID();
 let root=x.root;if(kind==='symlink'){root=path.join(x.root,'link');fs.symlinkSync(x.root,root);}
 const send=createOnboardingSSH({...x.options,root,run});await expect(send(randomUUID(),x.request,{action:'bootstrap'})).rejects.toThrow('linux_pool_ssh_unavailable');
 expect(x.calls.filter(c=>c.command.endsWith('/ssh'))).toHaveLength(0);
 if(kind!=='symlink')expect(fs.readdirSync(x.root)).toEqual([]);
});
