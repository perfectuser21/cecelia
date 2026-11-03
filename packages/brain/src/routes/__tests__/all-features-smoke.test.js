import {it,expect} from 'vitest';
import {fixture} from '../../../scripts/smoke/__tests__/fixtures/smoke-production-guard-fixture.mjs';

it.each([['exit 0','passing',0],['exit 7','failing',1]])('真实脚本执行%s并PATCH真实状态%s/退出%d',async(cmd,status,code)=>{
 const patches=[];
 await fixture(async({smoke,requests})=>{
  const r=await smoke('all-features',{SMOKE_ALLOW_WRITE:'1'});
  expect(r.code,r.output).toBe(code);
  expect(requests).toContainEqual({method:'GET',url:'/api/brain/features?limit=500'});
  expect(patches,r.output).toHaveLength(1);expect(patches[0]).toEqual({id:'feature-1',body:{smoke_status:status,smoke_last_run:expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)}});
 },{respond:({req,res,body})=>{
  if(req.url==='/api/brain/features?limit=500'){res.end(JSON.stringify({features:[{id:'feature-1',smoke_cmd:cmd},{id:'empty',smoke_cmd:null}]}));return true;}
  if(req.method==='PATCH'){patches.push({id:req.url.split('/').at(-1),body:JSON.parse(body)});res.end('{}');return true;}
 }});
});
it('未授权写入真实guard拒绝，零HTTP与零业务命令',async()=>{
 await fixture(async({smoke,requests})=>{const r=await smoke('all-features');expect(r.code).toBe(0);expect(requests).toEqual([]);});
});
it('畸形features数据真实脚本非零退出，零PATCH',async()=>{
 const patches=[];
 await fixture(async({smoke})=>{const r=await smoke('all-features',{SMOKE_ALLOW_WRITE:'1'});expect(r.code,r.output).toBe(1);expect(patches).toEqual([]);},{respond:({req,res})=>{
  if(req.url==='/api/brain/features?limit=500'){res.end('{"features":null}');return true;}
  if(req.method==='PATCH'){patches.push(req.url);res.end('{}');return true;}
 }});
});
