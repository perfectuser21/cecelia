import {it,expect,vi} from 'vitest';
import {registerNativeReconcile} from './workflow-assembly-native-registration.js';
it('伪造固定Git来源不能获取写连接或登记对象',async()=>{
  const pool={connect:vi.fn()};
  await expect(registerNativeReconcile(pool,{repo:'perfectuser21/cecelia',commit:'a'.repeat(40)})).rejects.toThrow('unprepared');
  expect(pool.connect).not.toHaveBeenCalled();
});
