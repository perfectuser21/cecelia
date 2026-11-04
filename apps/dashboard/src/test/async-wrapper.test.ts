import {afterEach,expect,it,vi} from 'vitest';
import {getConfig} from '@testing-library/react';
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
it('等待异步结果不能暗中推进15秒业务轮询或耗尽循环计时器',async()=>{
  vi.useFakeTimers({loopLimit:20});
  const initial=Date.now();
  const poll=vi.fn();
  setInterval(poll,15000);
  const callback=vi.fn(async()=> 'settled');
  const result=getConfig().asyncWrapper(callback);
  // 只排空本轮微任务/零延迟封套，不推进任何业务时间。
  await vi.advanceTimersByTimeAsync(0);
  expect(await result).toBe('settled');
  expect(callback).toHaveBeenCalledTimes(1);
  expect(Date.now()).toBe(initial);
  expect(poll).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
});
