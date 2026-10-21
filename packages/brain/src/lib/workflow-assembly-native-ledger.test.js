import {it,expect,vi} from 'vitest';
import {claimNativeRound} from './workflow-assembly-native-ledger.js';
it('未登记的固定版本不允许INSERT运行头；不能先干业务再补归属',async()=>{
  const db={query:vi.fn(async()=>({rows:[]}))};
  await expect(claimNativeRound(db,{runId:'x',requestKey:'one',trigger:'manual',source:{commit:'a'.repeat(40)}})).rejects.toMatchObject({status:409});
  expect(db.query.mock.calls.some(([sql])=>/INSERT|UPDATE/.test(sql))).toBe(false);
});
