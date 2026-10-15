import {it,expect} from 'vitest';
// 持续浏览器验收夹具；显式运行，实际CLI、scratch与浏览器证据由独立检查保存。
it.runIf(process.env.INVOCATION_BROWSER_PREVIEW==='1')('受控scratch浏览器候选调用服务',async()=>{
 const {previewPort,previewStopped}=await import('../../../scripts/smoke/invocation-preview-fixture.mjs');
 const response=await fetch(`http://127.0.0.1:${previewPort}/api/brain/map/registry`);
 const registry=await response.json();
 expect(response.status).toBe(200);
 expect(registry.preview_candidate_only).toBe(true);
 expect(registry.workflows).toHaveLength(1);
 await previewStopped;
},600000);
