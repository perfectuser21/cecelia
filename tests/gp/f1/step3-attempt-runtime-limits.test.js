import { expect,it } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import resourcePolicy from '../../../packages/brain/scripts/fleet-worker/attempt-resource-policy.cjs';
import runnerModule from '../../../packages/brain/scripts/fleet-worker/attempt-runner.cjs';
import { getRoleCapacity } from '../../../packages/brain/src/orchestrator/fleet-node/node-profile.js';
it('F1造完真验：预约角色权重与两个容器配额同源，默认adapter不能无界create',async()=>{
  for(const role of Object.keys(resourcePolicy.ROLE_WEIGHTS)){
    const {weight}=getRoleCapacity({baseCapacity:8,role});
    const plan=resourcePolicy.resolveAttemptResourcePlan({workerId:'us-mac-m4',role,postgres:true});
    for(const key of Object.keys(resourcePolicy.BASE_SLOT)) expect(plan.runner[key]+plan.postgres[key]).toBe(weight*resourcePolicy.BASE_SLOT[key]);
  }
  const root=mkdtempSync(path.join(tmpdir(),'gp-attempt-limits-'));let creates=0;
  try{
    const docker=runnerModule.createDockerAdapter({runtimeRoot:root,runCommand:async()=>{creates++;throw Error('unexpected create');}});
    await expect(docker.prepare({workerId:'us-mac-m4',role:'generator',limits:{memoryBytes:-1}})).rejects.toThrow('attempt_resource_profile_unavailable');
    expect(creates).toBe(0);
  }finally{rmSync(root,{recursive:true,force:true});}
});
