import {it,expect} from 'vitest';
import {headedTaskMutation} from '../task-headed-takeover.js';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
it('真实relay smoke的精确PATCH接线检查仍通过授权afterCommit参数',()=>{
 const brain=fileURLToPath(new URL('../../../',import.meta.url));
 const smoke=readFileSync(new URL('../../../scripts/smoke/relay-baton-smoke.sh',import.meta.url),'utf8');
 const check=smoke.split('\n').find(line=>line.startsWith('grep -q ')&&line.includes('afterTerminalTransition(pool, task_id'));
 expect(check).toBeDefined();
 const result=spawnSync('/bin/bash',['-c',`fail(){ exit 1; }; ${check}`],{env:{...process.env,BRAIN_DIR:brain},encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);
});
it('headed PATCH提交后才以独立pool运行接棒事务，失败响应不运行接棒',async()=>{
 const saved=process.env.CECELIA_INTERNAL_TOKEN;process.env.CECELIA_INTERNAL_TOKEN='transaction-fixture';
 try{
  for(const failed of [false,true]){
   const calls=[];
   const db={query:async sql=>{calls.push(sql);if(sql.includes('headed_task_takeovers'))return {rows:[{generation:'generation',session_id:'session'}]};return {rows:[{headed_takeover:{}}]};},release:()=>calls.push('RELEASE')};
   const pool={query:async()=>({rows:[{headed_takeover:{}}]}),connect:async()=>db};
   const req={headers:{authorization:'Bearer transaction-fixture','x-session-id':'session'},params:{id:'task'}};
   const res={statusCode:200,status(code){this.statusCode=code;return this;},json(){calls.push('RESPONSE');return this;}};
   await headedTaskMutation(pool,async(_req,response,scoped)=>{
    await scoped.query('SELECT status FROM tasks WHERE id=$1',['task']);
    await scoped.afterCommit(async original=>{expect(original).not.toBe(scoped);calls.push('RELAY');});
    response.status(failed?400:200).json({ok:!failed});
   })(req,res);
   expect(res.statusCode).toBe(failed?400:200);
   if(failed){expect(calls).toContain('ROLLBACK');expect(calls).not.toContain('RELAY');}
   else{expect(calls.indexOf('COMMIT')).toBeLessThan(calls.indexOf('RELAY'));expect(calls.indexOf('RELAY')).toBeLessThan(calls.indexOf('RESPONSE'));}
  }
 }finally{if(saved===undefined)delete process.env.CECELIA_INTERNAL_TOKEN;else process.env.CECELIA_INTERNAL_TOKEN=saved;}
});
