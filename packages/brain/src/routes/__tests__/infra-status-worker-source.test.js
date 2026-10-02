import {describe,it,expect,vi,beforeEach} from 'vitest';
import express from 'express';
import request from 'supertest';
const {fleet,localProbe,ssh}=vi.hoisted(()=>({fleet:vi.fn(),localProbe:vi.fn(),ssh:vi.fn()}));
vi.mock('../../fleet-resource-cache.js',()=>({getFleetStatus:fleet}));
vi.mock('../../machine-registry.js',()=>({
 MACHINES:[
  {id:'us-mac-m4',name:'MMV',isLocal:true,machineRole:'primary',tailscaleIp:'100.64.0.1',sshUser:'fixture'},
  {id:'xian-mac-m1',name:'M1',machineRole:'secondary',tailscaleIp:'100.64.0.2',sshUser:'fixture'},
  {id:'us-vps',name:'US VPS',machineRole:'scheduler',tailscaleIp:'100.64.0.3',sshUser:'fixture'}],
 listComputeWorkerIds:()=>['us-mac-m4','xian-mac-m1']
}));
vi.mock('os',()=>({default:{cpus:()=>[{model:'DO-Regular'},{model:'DO-Regular'}],totalmem:()=>3.8*1024**3,freemem:()=>1024**3,loadavg:()=>[1,1,1],type:()=> 'Linux',arch:()=> 'x64',hostname:()=> 'us-brain-host',uptime:()=>100,homedir:()=>'/fixture'}}));
vi.mock('child_process',()=>({execSync:localProbe,exec:ssh}));
import router from '../infra-status.js';
const app=express().use(router);
const row=(id)=>({id,online:true,observed_at:new Date().toISOString(),cpu:{cores:id==='us-mac-m4'?10:8,usagePercent:12},memory:{totalGB:16,usagePercent:25},disk:{freeBytes:10*1024**3,usagePercent:95},gpu:{status:'unknown',source:'unavailable',observed_at:null,devices:[]}});
beforeEach(()=>{
 vi.clearAllMocks();fleet.mockReturnValue([row('us-mac-m4'),row('xian-mac-m1')]);
 localProbe.mockReturnValue('Filesystem Size Used Avail Capacity Mounted on\n/dev/root 50G 32G 18G 65% /');
 ssh.mockImplementation((_command,_options,callback)=>callback(null,{stdout:[
  '---HOSTNAME---','ssh-host','---UNAME---','Linux x86_64','---UPTIME---','100 10',
  '---CPUCOUNT---','2','---LOADAVG---','1 1 1','---MEMINFO---','MemTotal: 4194304 kB','MemAvailable: 2097152 kB',
  '---DISK---','/dev/root 50G 32G 18G 65% /'].join('\n')}));
});
describe('资源看板真实HTTP必须按Worker身份采用统一缓存',()=>{
 it('MMV虽isLocal也不得标成Brain宿主2核3.8GB',async()=>{
  const response=await request(app).get('/servers');const m=response.body.servers.find(x=>x.id==='us-mac-m4');
  expect(m.cpu.cores).toBe(10);expect(m.memory.totalGB).toBe(16);expect(m.cpu.model).not.toBe('DO-Regular');
  expect(localProbe).not.toHaveBeenCalled();
 });
 it('M1磁盘采用执行数据路径最差95%，不采用SSH根卷65%',async()=>{
  const response=await request(app).get('/servers');const m=response.body.servers.find(x=>x.id==='xian-mac-m1');
  expect(m.disk.usagePercent).toBe(95);expect(m.disk.freeBytes).toBe(10*1024**3);
  expect(ssh.mock.calls.some(([command])=>command.includes('100.64.0.2'))).toBe(false);
 });
 it.each(['missing','stale'])('Worker %s不能回退到本机或SSH伪装在线',async mode=>{
  fleet.mockReturnValue(mode==='missing'?[]:[{...row('us-mac-m4'),online:false,admission_reason:'worker_health_stale'}]);
  const response=await request(app).get('/servers');
  for(const m of response.body.servers.filter(x=>x.id!=='us-vps')){expect(m.status).not.toBe('online');expect(m.cpu).toBeNull();expect(m.memory).toBeNull();expect(m.disk).toBeNull();}
  expect(localProbe).not.toHaveBeenCalled();expect(ssh).toHaveBeenCalledTimes(1);
 });
 it('非Worker US VPS保留原SSH数据源',async()=>{
  const response=await request(app).get('/servers');const m=response.body.servers.find(x=>x.id==='us-vps');
  expect(m.status).toBe('online');expect(m.cpu.cores).toBe(2);expect(m.memory.totalGB).toBe(4);
  expect(ssh.mock.calls.some(([command])=>command.includes('100.64.0.3'))).toBe(true);
 });
});
