import {it,expect} from 'vitest';
import {redactFailureText,sanitizeWorkflowFailure} from '../workflow-failure.js';

it('普通日志夹JSON行时仍逐行解开嵌套JSON秘密，保留普通诊断',()=>{
 const json=JSON.stringify({failure:{message:JSON.stringify({password:'fake alpha beta'})}});
 const mixed=`probe started\n${json}\nAuthorization: Basic ZmFrZTpwYXNz\nprobe ended`;
 const safe=redactFailureText(mixed);
 expect(safe).not.toContain('fake alpha beta');expect(safe).not.toContain('ZmFrZTpwYXNz');
 expect(safe).toContain('probe started');expect(safe).toContain('probe ended');
 expect(JSON.parse(safe.split('\n')[1]).failure.message).not.toContain('fake alpha beta');
});
it('实际失败settlement写入任务stdout和Run快照时，混合日志均不泄露嵌套秘密',async()=>{
 const {settleScriptRun}=await import('../../script-settlement.js');
 const writes=[];const pool={query:async(sql,args)=>{writes.push([sql,args]);return {rowCount:1,rows:[{id:'task',task_id:'task',status:'failed',result:{}}]};}};
 const receipt={task_id:'task',run_id:'run',status:'failed',failure:{stage:'probe',message:JSON.stringify({password:'fake alpha beta'})}};
 await settleScriptRun(pool,{id:'task',payload:{script_attempts:[{},{}]}},{exit:1,stdout:'probe started\n'+JSON.stringify(receipt)},{hostId:'fixture',runId:'run'});
 expect(JSON.stringify(writes)).not.toContain('fake alpha beta');
 expect(writes.some(([sql])=>sql.includes('UPDATE task_runs'))).toBe(true);
 expect(writes.some(([sql])=>sql.startsWith('UPDATE tasks'))).toBe(true);
});
it('混合日志的多行PEM不能因逐行处理而泄露内部字节',()=>{
 expect(redactFailureText('probe\n-----BEGIN PRIVATE KEY-----\nfake-private-material\n-----END PRIVATE KEY-----\ndone')).not.toContain('fake-private-material');
});
it('保留有限超时秒数、限长脱敏错误类型及上游截断标记',()=>{
 expect(sanitizeWorkflowFailure({stage:'probe',timeout_sec:'90.5',error_type:'TimeoutExpired',truncated:true})).toMatchObject({timeout_sec:90.5,error_type:'TimeoutExpired',truncated:true});
 expect(sanitizeWorkflowFailure({stage:'probe',timeout_sec:30,truncated:false})).toMatchObject({timeout_sec:30,truncated:false});
 for(const timeout_sec of [-1,Infinity,NaN,'Infinity',{},604801])expect(sanitizeWorkflowFailure({stage:'probe',timeout_sec})).not.toHaveProperty('timeout_sec');
 const safe=sanitizeWorkflowFailure({error_type:'TOKEN=hide-me '+ 't'.repeat(300)});
 expect(safe.error_type).not.toContain('hide-me');expect(safe.error_type.length).toBeLessThanOrEqual(128);expect(safe.truncated).toBe(true);
});
it('Brain截断任一文本或证据数量/引用长度时必须标记truncated=true',()=>{
 for(const value of [{message:'x'.repeat(1001)},{stderr:'x'.repeat(2001)},{stdout:'x'.repeat(2001)},
  {evidence:Array.from({length:11},()=>'/evidence')},{evidence:['x'.repeat(501)]}]){
  expect(sanitizeWorkflowFailure({stage:'probe',truncated:false,...value}).truncated).toBe(true);
 }
 expect(sanitizeWorkflowFailure({stage:'probe',message:'short'})).not.toHaveProperty('truncated');
});
