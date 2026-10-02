import {describe,expect,it} from 'vitest';
import {settleScriptRun,redactEnvValues} from '../script-settlement.js';
describe('脚本结算保持run身份',()=>{
  it('旧run的终态CAS不命中时不会落完成事件或修改run',async()=>{
    const writes=[];const pool={query:async(sql,args)=>{writes.push([sql,args]);return {rowCount:0,rows:[]};}};
    expect(await settleScriptRun(pool,{id:'task',payload:{}},{exit:0,stdout:'done'},
      {hostId:'us-mac-m4',runId:'old',reservationId:'old-reservation'})).toBe('skipped');
    expect(writes).toHaveLength(1);expect(writes[0][1]).toContain('old');expect(writes[0][1]).toContain('old-reservation');
  });
  it('输出沿用环境敏感值脱敏',()=>{
    expect(redactEnvValues('hello secret-value',{TASK_TOKEN:'secret-value'})).toBe('hello ***');
  });
});
it('旧失败run的回队CAS不命中时不写虚假重试事件',async()=>{
  const writes=[];const pool={query:async(sql,args)=>{writes.push([sql,args]);return {rowCount:0,rows:[]};}};
  expect(await settleScriptRun(pool,{id:'task',payload:{}},{exit:1,stderr:'failed'},
    {hostId:'us-mac-m4',runId:'old',reservationId:'old-reservation'})).toBe('skipped');
  expect(writes.filter(([sql])=>/INSERT INTO task_events/.test(sql))).toHaveLength(0);
});
