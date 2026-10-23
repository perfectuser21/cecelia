import {afterEach,expect,it,vi} from 'vitest';
import {createReleaseValidationBudget,releaseValidationTransaction} from '../release-validation-budget.js';

const budgets=[];
const makeError=(code,message,status)=>Object.assign(new Error(message),{code,status});
const budget=options=>{const value=createReleaseValidationBudget(options,makeError);budgets.push(value);return value;};
afterEach(()=>{for(const value of budgets.splice(0))value.close();vi.useRealTimers();});
function clientFixture(query=async()=>({rows:[]})){
  const client={query:vi.fn(query),release:vi.fn(),on:vi.fn(),off:vi.fn()};
  return {client,pool:{connect:vi.fn(async()=>client)}};
}

it('拒绝无效预算，调用者不能将整体上限扩大至25秒以上',()=>{
  vi.useFakeTimers();
  for(const timeoutMs of [0,-1,Infinity,NaN])expect(()=>budget({timeoutMs})).toThrow('发布验证时限无效');
  const value=budget({timeoutMs:90000});expect(value.deadline-Date.now()).toBe(25000);
});

it('不合作的来源等待仍按总预算拒绝，并向真实依赖传播超时原因',async()=>{
  vi.useFakeTimers();const value=budget({timeoutMs:20});
  const pending=expect(value.wait(new Promise(()=>{}))).rejects.toMatchObject({code:'VALIDATION_TIMEOUT',status:504});
  await vi.advanceTimersByTimeAsync(20);await pending;
  expect(value.signal.aborted).toBe(true);expect(()=>value.check()).toThrow('发布来源验证超时');
});

it('连接池迟到连接被销毁，不开启事务或调用写入回调',async()=>{
  vi.useFakeTimers();let connect;const client={release:vi.fn(),query:vi.fn()};
  const pool={connect:vi.fn(()=>new Promise(resolve=>{connect=resolve;}))},fn=vi.fn();
  const pending=expect(releaseValidationTransaction(pool,budget({timeoutMs:20}),fn)).rejects.toMatchObject({code:'VALIDATION_TIMEOUT'});
  await vi.advanceTimersByTimeAsync(20);await pending;connect(client);await vi.advanceTimersByTimeAsync(0);
  expect(client.release.mock.calls).toEqual([[true]]);expect(client.query).not.toHaveBeenCalled();expect(fn).not.toHaveBeenCalled();
});

it('已经断开的请求不领取连接',async()=>{
  const controller=new AbortController();controller.abort();const {pool}=clientFixture();
  await expect(releaseValidationTransaction(pool,budget({signal:controller.signal}),vi.fn())).rejects.toMatchObject({code:'REQUEST_ABORTED',status:499});
  expect(pool.connect).not.toHaveBeenCalled();
});

it('只读快照事务启用服务端边界并提交后归还一次连接',async()=>{
  const {pool,client}=clientFixture();
  await expect(releaseValidationTransaction(pool,budget(),async db=>{await db.query('SELECT 1');return 'snapshot';},{readOnly:true})).resolves.toBe('snapshot');
  expect(client.query.mock.calls.map(call=>call[0])).toEqual(['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',expect.stringContaining('statement_timeout'),'SELECT 1','COMMIT']);
  expect(client.query.mock.calls[1][1]).toEqual(['2000ms','1000ms','3000ms']);
  expect(client.release.mock.calls).toEqual([[]]);
});

it('COMMIT已经确认后同步取消保留成功，不伪报回滚且连接仅释放一次',async()=>{
  const controller=new AbortController();
  const {pool,client}=clientFixture(async sql=>{if(sql==='COMMIT')controller.abort();return {rows:[]};});
  await expect(releaseValidationTransaction(pool,budget({signal:controller.signal}),async()=>({id:'committed'}))).resolves.toEqual({id:'committed'});
  expect(client.query.mock.calls.some(([sql])=>sql==='ROLLBACK')).toBe(false);
  expect(client.release.mock.calls).toEqual([[true]]);
});

it.each(['55P03','57014','25P03'])('服务端%s失败回滚并返回有界事务错误',async code=>{
  const {pool,client}=clientFixture(async sql=>{if(sql==='SELECT blocked')throw Object.assign(new Error('database timeout'),{code});return {rows:[]};});
  await expect(releaseValidationTransaction(pool,budget(),db=>db.query('SELECT blocked'))).rejects.toMatchObject({code:'TRANSACTION_TIMEOUT',status:503});
  expect(client.query.mock.calls.map(call=>call[0])).toContain('ROLLBACK');
  expect(client.query.mock.calls.map(call=>call[0])).not.toContain('COMMIT');
  expect(client.release.mock.calls).toEqual([[]]);
});
