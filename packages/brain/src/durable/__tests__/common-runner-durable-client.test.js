import {afterEach,expect,test,vi} from 'vitest';
afterEach(()=>{delete process.env.DBOS_DURABLE_ENABLED;vi.resetModules();vi.doUnmock('../common-runner-durable.js');});
test('未启用DBOS的路由加载与拒绝调用均不注册工作流',async()=>{
 delete process.env.DBOS_DURABLE_ENABLED;const load=vi.fn(()=>{throw Error('must not register during route import');});
 vi.doMock('../common-runner-durable.js',load);
 const {startDurableCommonRunner}=await import('../common-runner-durable-client.js');
 expect(load).not.toHaveBeenCalled();
 await expect(startDurableCommonRunner({})).rejects.toThrow('common_runner_durable_unavailable');
 expect(load).not.toHaveBeenCalled();
});
