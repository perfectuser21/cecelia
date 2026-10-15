import {it,expect} from 'vitest';
import {findInvocation,publicResolution} from './store.js';
it('对外resolve结果保留schema和缺口，隐藏固定Skill全文内部快照',()=>{
 const visible={target:{kind:'activity',id:'a'},readiness:'blocked',gaps:[{code:'offline'}],input_schema:{type:'object'}};
 expect(publicResolution({...visible,plan:{internal:true},envelope:{skill_content:'private-source'}})).toEqual(visible);
});
it('原请求键回读必须绑定服务端租户，不能跨租户返回任务',async()=>{
 const calls=[];const db={query:async(sql,args)=>{calls.push({sql,args});return {rows:[{id:'foreign',payload:{invocation:{tenant_id:'foreign'}}}]};}};
 await expect(findInvocation(db,{requestKey:'stable-key',tenantId:'mine'})).rejects.toThrow('调用不存在');
 expect(calls[0].args).toEqual(['stable-key','mine']);
 expect(calls[0].sql).toContain("payload->'invocation'->>'tenant_id'=$2");
});
