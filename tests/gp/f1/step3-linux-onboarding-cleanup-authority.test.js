import {it,expect} from 'vitest';
import canary from '../../../packages/brain/scripts/fleet-worker/linux-script-canary.cjs';
it('F1造完真验：清理回执恢复入口也必须持宿主root锁，不能由普通请求发起',async()=>{
 for(const change of [{platform:'darwin'},{getuid:()=>1000},{lockHeld:false}]){
  let reads=0;
  await expect(canary.runLinuxScriptCanary({nonce:'a'.repeat(64),cleanupReceipt:true},
   {platform:'linux',getuid:()=>0,lockHeld:true,loadConfiguration:async()=>{reads++;throw Error('unexpected credential read');},...change})).rejects.toThrow('linux_script_canary_unconfirmed');
  expect(reads).toBe(0);
 }
});
