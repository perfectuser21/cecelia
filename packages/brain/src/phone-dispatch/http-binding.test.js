import {it,expect} from 'vitest';
import {endpoint,node} from '../__tests__/fixtures/phone-http.js';
import {phoneHubEndpointValid,resolvePhoneHubBinding,isPhoneHubBinding} from './http-binding.js';
it('仅持久版本导出不可变HTTP身份，caller复制品不能取得信任',async()=>{
 const n=node(),calls=[];const pool={query:async(sql,args)=>{calls.push({sql,args});return {rows:[n]};}};
 const b=await resolvePhoneHubBinding(pool,{executionVersionId:n.id,machineId:n.canonical_id});
 expect(b).toMatchObject({execution_version_id:n.id,...endpoint()});expect(isPhoneHubBinding(b)).toBe(true);expect(isPhoneHubBinding({...b})).toBe(false);
 expect(Object.isFrozen(b.physical)).toBe(true);expect(calls[0].args).toEqual([n.id]);expect(calls[0].sql).not.toContain('current_version_id');
 n.endpoints.phone_hub.http_endpoint='http://evil:3459/';expect(b.http_endpoint).toBe(endpoint().http_endpoint);
});
it('缺boot/hash/物理身份、多余键和非固定HTTP入口拒绝',()=>{
 expect(phoneHubEndpointValid(endpoint(),'fixture-machine')).toBe(true);
 for(const key of Object.keys(endpoint())){const e=endpoint();delete e[key];expect(phoneHubEndpointValid(e,'fixture-machine')).toBe(false);}
 for(const key of Object.keys(endpoint().physical)){const e=endpoint();delete e.physical[key];expect(phoneHubEndpointValid(e,'fixture-machine')).toBe(false);}
 for(const url of ['http://u:p@host:3459/','http://host:3459/path','http://host:3459/?x=1','https://host:3459/','http://host:3458/'])expect(phoneHubEndpointValid({...endpoint(),http_endpoint:url},'fixture-machine')).toBe(false);
 expect(phoneHubEndpointValid({...endpoint(),available:1},'fixture-machine')).toBe(false);expect(phoneHubEndpointValid(endpoint(),'foreign')).toBe(false);
});
it('旧版本精确查询；错误machine、缺端点、callerURL和env不替代目录',async()=>{
 const n=node();process.env.PHONE_HUB_URL='http://evil:3459/';
 try{
  for(const rows of [[],[{...n,canonical_id:'foreign'}],[{...n,endpoints:{worker:'http://old:5231/',phone_ssh:{host:'old'}}}]])await expect(resolvePhoneHubBinding({query:async()=>({rows})},{executionVersionId:n.id,machineId:n.canonical_id})).rejects.toThrow('phone_http_binding_unavailable');
  await expect(resolvePhoneHubBinding({query:async()=>{throw Error('should not query');}},{executionVersionId:n.id,machineId:n.canonical_id,url:'http://evil:3459/'})).rejects.toThrow('phone_http_binding_invalid');
 }finally{delete process.env.PHONE_HUB_URL;}
});
