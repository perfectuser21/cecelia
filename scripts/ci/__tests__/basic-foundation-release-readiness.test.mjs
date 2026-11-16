import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import {fetchFoundationSnapshot} from '../foundation-release-snapshot.mjs';
import {commandsFor} from '../run-basic-check.mjs';

test('快照安全回归由实际scripts默认入口收集',()=>{
 const path='scripts/ci/__tests__/'+new URL(import.meta.url).pathname.split('/').at(-1);
 assert.ok(commandsFor('scripts').some(step=>step.command==='node'&&step.args[0]==='--test'&&step.args.includes(path)));
});

const revision='a'.repeat(40),scope='foundation-release-readiness',repo='perfectuser21/cecelia';
const snapshot={scope,repo,revision,status:'verified',gaps:[]};
async function withServer(handler,run){
 const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await run(`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(resolve=>server.close(resolve));}
}
test('从真实HTTP接口只读取得固定源码快照，凭据不进入URL',async()=>{
 await withServer((req,res)=>{
  assert.equal(req.method,'GET');assert.equal(req.headers['x-internal-token'],'local-test-token');
  const url=new URL(req.url,'http://localhost');assert.equal(url.pathname,'/api/brain/implementation-ci/snapshot');
  assert.deepEqual(Object.fromEntries(url.searchParams),{scope,repo,revision});
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({snapshot}));
 },async base=>assert.deepEqual(await fetchFoundationSnapshot({revision,base,token:'local-test-token'}),snapshot));
});
test('未知、跨版本、跨仓或跨scope快照拒绝生成发布输入',async()=>{
 for(const patch of [{status:'unknown'},{gaps:[{code:'unverified'}]},{revision:'b'.repeat(40)},{repo:'another/repo'},{scope:'another'}]){
  await withServer((_req,res)=>res.end(JSON.stringify({snapshot:{...snapshot,...patch}})),async base=>{
   await assert.rejects(fetchFoundationSnapshot({revision,base,token:'local-test-token'}),/FOUNDATION_RELEASE_SNAPSHOT_UNVERIFIED/);
  });
 }
});
test('无凭据、非固定SHA、外部地址及重定向均拒绝，错误不泄露响应正文',async()=>{
 for(const options of [{revision,base:'http://127.0.0.1',token:''},{revision:'main',base:'http://127.0.0.1',token:'secret'},
  {revision,base:'http://untrusted.example',token:'secret'},{revision,base:'http://secret@127.0.0.1',token:'secret'}]){
  await assert.rejects(fetchFoundationSnapshot(options),/FOUNDATION_RELEASE_CONFIG_INVALID/);
 }
 await withServer((_req,res)=>{res.statusCode=403;res.end('must-not-expose-secret');},async base=>{
  await assert.rejects(fetchFoundationSnapshot({revision,base,token:'local-test-token'}),error=>error.message==='FOUNDATION_RELEASE_HTTP_403');
 });
 await withServer((_req,res)=>{res.statusCode=302;res.setHeader('Location','http://untrusted.example');res.end();},async base=>{
  await assert.rejects(fetchFoundationSnapshot({revision,base,token:'local-test-token'}));
 });
});
test('实际CI只在main显式触发正式验证，原PR源码门不持有生产凭据',()=>{
 const yaml=createRequire(import.meta.url)('js-yaml');
 const workflow=yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8'));
 const input=workflow.on.workflow_dispatch.inputs.foundation_release_verification;
 assert.equal(input.type,'boolean');assert.equal(input.default,false);
 const job=workflow.jobs['foundation-release-verification'];
 assert.equal(job.if,"github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.foundation_release_verification == true");
 assert.deepEqual(job.needs,['ci-passed']);assert.deepEqual(job.permissions,{contents:'read'});
 const fetch=job.steps.find(s=>s.run?.includes('foundation-release-snapshot.mjs'));
 assert.equal(fetch.env.CECELIA_INTERNAL_TOKEN,'${{ secrets.CECELIA_INTERNAL_TOKEN }}');
 const verify=job.steps.find(s=>s.run?.includes('pilot-release-verification.mjs'));
 assert.ok(verify.run.includes('--event workflow_dispatch --ref refs/heads/main'));
 assert.doesNotMatch(JSON.stringify(verify),/CECELIA_INTERNAL_TOKEN|secrets\./);
 assert.ok(job.steps.some(s=>s.uses==='actions/upload-artifact@v4'&&s.if==='always()'));
 for(const id of ['security','checks','runtime-integration','pwa-upgrade','codeql','ci-passed'])assert.doesNotMatch(JSON.stringify(workflow.jobs[id]),/CECELIA_INTERNAL_TOKEN/);
});
