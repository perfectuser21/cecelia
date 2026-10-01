import { describe,it,expect } from 'vitest';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);let api={};try{api=require('./app-server-docker.cjs');}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
const id='d'.repeat(64),key='b'.repeat(64),workspace='c'.repeat(64);
const profile={image:'sha256:'+'a'.repeat(64),cpus:2,memoryBytes:1073741824,pidsLimit:128,user:'1000:1000',tmpBytes:67108864,network:'none',homeKey:key,workspaceKey:workspace};
const name='cecelia-appserver-00000000-0000-4000-8000-000000000001-g1';
function adapter(options={}){expect(api).toHaveProperty('createAppServerDocker');return api.createAppServerDocker(options);}
const resources=async(_command,args)=>({stdout:JSON.stringify([{Name:args[2],Labels:{'cecelia.appserver.kind':args[2].includes('-home-')?'home':'workspace','cecelia.appserver.key':args[2].includes('-home-')?key:workspace}}])});
describe('专用 app-server Docker 合同',()=>{
 it('真实执行 argv 固定无TTY无聊天日志，无任意env/宿主挂载',async()=>{
  const calls=[];const d=adapter({run:async(cmd,args)=>{calls.push([cmd,args]);return args[0]==='create'?{stdout:id+'\n'}:resources(cmd,args)}});
  expect(await d.create({name,profile,identity:{reservation_id:'00000000-0000-4000-8000-000000000001',intent_id:'00000000-0000-4000-8000-000000000002',launch_generation:1}})).toBe(id);
  const args=calls.find(([,a])=>a[0]==='create')[1];
  expect(args).toEqual(expect.arrayContaining(['--interactive','--log-driver=none','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=1073741824','--memory-swap=1073741824','--pids-limit=128','--user=1000:1000']));
  expect(args).not.toContain('--tty');expect(args.join(' ')).not.toMatch(/docker.sock|--privileged|--network=host/);
  expect(args.slice(-6)).toEqual([profile.image,'-c','cli_auth_credentials_store="ephemeral"','app-server','--listen','stdio://']);
  expect(args.filter(a=>a.startsWith('--mount='))).toEqual(['--mount=type=volume,src=cecelia-appserver-home-'+key+',dst=/home/runner','--mount=type=volume,src=cecelia-appserver-workspace-'+workspace+',dst=/workspace']);
 });
 it('未知卷或归属标签不匹配，在create前拒绝',async()=>{
  let created=false;const d=adapter({run:async(_cmd,args)=>{if(args[0]==='create')created=true;return {stdout:'[{"Labels":{}}]'}}});
  await expect(d.create({name,profile,identity:{}})).rejects.toThrow('appserver_resource_untrusted');expect(created).toBe(false);
 });
 it('inspect只将明确不存在视为缺失，连接错误不当清理成功',async()=>{
  const missing=adapter({run:async()=>{throw Object.assign(new Error('unknown'),{stderr:'Error: No such object: '+id})}});
  expect(await missing.inspect(id)).toBe(null);
  const offline=adapter({run:async()=>{throw Error('daemon offline')}});await expect(offline.inspect(id)).rejects.toThrow('appserver_docker_unavailable');
 });
 it('移除仅接受完整容器ID，不会删除HOME卷',async()=>{
  const calls=[];const d=adapter({run:async(_cmd,args)=>{calls.push(args);return {stdout:''}}});
  await expect(d.remove(name)).rejects.toThrow('appserver_container_id_invalid');await d.remove(id);expect(calls).toEqual([['rm','--force',id]]);
 });
 it('attach使用明确context优先于DOCKER_HOST，拒绝远程端点且不spawn CLI',async()=>{
  const calls=[];const d=adapter({env:{DOCKER_CONTEXT:'trusted',DOCKER_HOST:'unix:///ignored.sock'},run:async(cmd,args)=>{calls.push([cmd,args]);return {stdout:JSON.stringify([{Endpoints:{docker:{Host:'tcp://127.0.0.1:2375'}}}])};}});
  await expect(d.attach(id)).rejects.toThrow('appserver_attach_endpoint_denied');
  expect(calls).toEqual([['docker',['context','inspect','trusted']]]);
 });
});
it('聊天Docker最终create/start边界读取维护闸，清理保持可用',async()=>{
 let drain=false;const calls=[];const d=adapter({assertCanLaunch:()=>{if(drain)throw Error('worker_draining');},run:async(cmd,args)=>{
  calls.push(args);if(args[0]==='volume'){const result=await resources(cmd,args);drain=true;return result;}return {stdout:id};
 }});
 await expect(d.create({name,profile,identity:{reservation_id:'00000000-0000-4000-8000-000000000001',intent_id:'00000000-0000-4000-8000-000000000002',launch_generation:1}})).rejects.toThrow('worker_draining');
 await expect(d.start(id)).rejects.toThrow('worker_draining');await d.remove(id);
 expect(calls.some(a=>['create','start'].includes(a[0]))).toBe(false);expect(calls.at(-1)).toEqual(['rm','--force',id]);
});
