import {describe,it,expect} from 'vitest';
import {projectGpuObservation} from '../fleet-gpu-observation.js';
const now=1000000;
const raw=()=>({schema_version:'fleet-gpu-observation/v1',scope:'host',source:'macos-ioreg',observed_at:new Date(now).toISOString(),status:'present',devices:[{name:'Apple M4',utilization_percent:0,memory_kind:'unified',memory_used_bytes:128}]});
describe('GPU 观测在缓存读出时重验',()=>{
 it('90秒边界前保留，边界到达后降级未知',()=>{
  expect(projectGpuObservation(raw(),now+89999).status).toBe('present');
  expect(projectGpuObservation(raw(),now+90000).status).toBe('unknown');
 });
 it.each([r=>({...r,scope:'container'}),r=>({...r,source:'metadata'}),r=>({...r,observed_at:new Date(now+30001).toISOString()}),r=>({...r,devices:[{...r.devices[0],memory_used_bytes:-1}]}),r=>({...r,devices:[{...r.devices[0],name:'bad\nname'}]})])('非可信宿主或损坏字段整体降级',change=>{expect(projectGpuObservation(change(raw()),now).status).toBe('unknown');});
});
