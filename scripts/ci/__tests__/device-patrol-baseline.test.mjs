import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePatrolBaselineRun} from '../implementation-patrol-baseline.mjs';
const sha='a'.repeat(40);
const run={head_sha:sha,head_branch:'main',event:'workflow_dispatch',path:'.github/workflows/device-patrol-admission.yml',conclusion:'success',repository:{full_name:'perfectuser21/cecelia'},head_repository:{full_name:'perfectuser21/cecelia'}};
test('巡查身份artifact只能由固定已发布工具main可信baseline成功运行提供',()=>{
 assert.equal(validatePatrolBaselineRun(run,sha),run);
 for(const patch of [{head_sha:'b'.repeat(40)},{event:'pull_request'},{head_branch:'feature'},{conclusion:'failure'},{path:'.github/workflows/ci.yml'},{head_repository:{full_name:'attacker/fork'}}])assert.throws(()=>validatePatrolBaselineRun({...run,...patch},sha));
});
