import {it} from 'vitest';
// 持续浏览器验收夹具；显式运行，实际CLI、scratch与浏览器证据由独立检查保存。
it.runIf(process.env.INVOCATION_BROWSER_PREVIEW==='1')('受控scratch浏览器候选调用服务',async()=>{
 await import('../../../scripts/smoke/invocation-preview-fixture.mjs');
 await new Promise(resolve=>process.once('SIGUSR2',resolve));
},600000);
