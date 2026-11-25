import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
const require=createRequire(import.meta.url);
const workflow=require('js-yaml').load(readFileSync(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8'));
test('只有main push源码通过后运行唯一Brain发布job',()=>{
  const job=workflow.jobs['brain-deploy'];assert.ok(job);
  assert.deepEqual(job.needs,['ci-passed']);
  for(const event of ['push','pull_request','workflow_dispatch','schedule'])for(const result of ['success','failure','cancelled','skipped'])for(const ref of ['refs/heads/main','refs/heads/feature/untrusted']) {
    const value=runInNewContext(job.if,{github:{event_name:event,ref},needs:{'ci-passed':{result}}});
    assert.equal(value,event==='push'&&result==='success'&&ref==='refs/heads/main');
  }
  assert.equal(job.env.GITHUB_SHA,'${{ github.sha }}');
  assert.equal(job.env.BRAIN_URL,'http://100.79.41.61:5221');
  assert.equal(job.env.REQUIRE_EXACT_SHA,'1');
  assert.equal(job['timeout-minutes'],100);
  assert.equal(job.steps.some(s=>s['continue-on-error']),false);
  const checkout=job.steps.find(s=>s.uses==='actions/checkout@v4');
  assert.equal(checkout.with.ref,'${{ github.sha }}');assert.equal(checkout.with['persist-credentials'],false);
  const route=job.steps.find(s=>s.run?.includes('run-brain-deploy.sh'));
  assert.equal(route.run,'bash scripts/ci/run-brain-deploy.sh "$BRAIN_URL" "$GITHUB_SHA" "$RUNNER_TEMP/brain-deploy-preflight/report.json"');
  const router=readFileSync(new URL('../run-brain-deploy.sh',import.meta.url),'utf8');
  assert.match(router,/gate3-trigger-deploy\.sh" "\$BRAIN_URL" "\$TARGET_SHA"/);
  assert.match(router,/202\|409/);
  assert.match(router,/\*\).*exit 1/s);
  assert.match(router,/gate3-wait-deploy\.sh" "\$BRAIN_URL" "\$TARGET_SHA"/);
  const evidence=job.steps.find(s=>s.uses==='actions/upload-artifact@v4');
  assert.equal(evidence.if,'always()');
  assert.equal(evidence.with['if-no-files-found'],'error');
});
