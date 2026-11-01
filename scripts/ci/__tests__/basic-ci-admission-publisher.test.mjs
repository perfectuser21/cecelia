import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {admissionFixture} from './fixtures/ci-admission-envelope.mjs';
import {createCiAdmissionDraft} from '../ci-admission-envelope.mjs';
import {publishCiAdmissionBaseline} from '../ci-admission-publisher.mjs';
async function fixture(t){
 const f=await admissionFixture(t),parent=mkdtempSync(join(tmpdir(),'ci-admission-publisher-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const sourceRoot=join(parent,'source');f.git('worktree','add','--quiet','--detach',sourceRoot,f.source);
 f.data.get('repos/perfectuser21/cecelia/actions/runs/22').status='in_progress';
 const draft=await createCiAdmissionDraft({controlRoot:f.root,controlRevision:f.control,sourceRevision:f.source,sourceTree:f.git('rev-parse',`${f.source}^{tree}`),snapshots:f.snapshots,executions:f.executions});
 const options={repository:'perfectuser21/cecelia',eventName:'workflow_run',event:{action:'completed',workflow_run:structuredClone(f.data.get('repos/perfectuser21/cecelia/actions/runs/11'))},
  sourceRoot,controlRoot:f.root,sourceRevision:f.source,controlRevision:f.control,sourceRunId:11,publisherRunId:22,publisherAttempt:1,outputDir:join(parent,'publication')};
 let workers=0;const deps={api:f.api,runWorker:async()=>{workers++;return structuredClone(draft);}};
 return {...f,options,deps,workers:()=>workers};
}
test('publisher只接受实际main CI成功与独立protected control，最终只产专用2文件',async t=>{
 const f=await fixture(t),result=await publishCiAdmissionBaseline(f.options,f.deps);
 assert.equal(result.purpose,'ci_admission_only');assert.equal(result.source_revision,f.source);assert.equal(result.control_revision,f.control);assert.equal(f.workers(),1);
 assert.deepEqual(readdirSync(f.options.outputDir).sort(),['assertions.json','ci-admission.json']);
});
for(const variant of ['manual','pr-ci','wrong-sha','failed-ci','wrong-app','control-pr','worker-missing-assertion'])test('publisher拒绝无授权/不完整草稿：'+variant,async t=>{
 const f=await fixture(t),o=f.options;
 if(variant==='manual')o.eventName='workflow_dispatch';if(variant==='pr-ci')o.event.workflow_run.event='pull_request';
 if(variant==='wrong-sha')o.event.workflow_run.head_sha=f.control;if(variant==='failed-ci')f.data.get('repos/perfectuser21/cecelia/actions/runs/11').conclusion='failure';
 if(variant==='wrong-app')f.data.get('repos/perfectuser21/cecelia/check-runs/34').app.id=1;
 if(variant==='control-pr')o.controlRevision=f.source;
 if(variant==='worker-missing-assertion'){const old=f.deps.runWorker;f.deps.runWorker=async()=>{const draft=await old();draft.ci_assertions.executions.pop();return draft;};}
 await assert.rejects(publishCiAdmissionBaseline(o,f.deps),/CI_ADMISSION_/);assert.equal(existsSync(o.outputDir),false);
 if(variant!=='worker-missing-assertion')assert.equal(f.workers(),0);
});
