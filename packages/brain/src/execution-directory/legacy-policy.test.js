import {it,expect} from 'vitest';
import {legacyRecords,LEGACY_REPOS} from './legacy-policy.js';
import workspacePolicy from '../../scripts/fleet-worker/workspace-manager.cjs';
it('Worker与Brain使用同一两仓声明，账号不能派生脚本profile授权',()=>{
 expect(LEGACY_REPOS).toEqual(Object.keys(workspacePolicy.createFleetRepoAllowlist({})));
 const profiles=JSON.stringify({'us-mac-m4':['safe']});
 expect(legacyRecords({env:{EXECUTION_LEGACY_SCRIPT_PROFILES:profiles}}).flatMap(n=>n.grants).filter(g=>g.surface==='managed_script')).toHaveLength(0);
 const nodes=legacyRecords({env:{SCRIPT_MANAGED_MACHINES:'us-mac-m4',EXECUTION_LEGACY_SCRIPT_PROFILES:profiles}});
 expect(nodes.flatMap(n=>n.grants).filter(g=>g.surface==='managed_script')).toMatchObject([{provider:'script',profile_id:'safe',provenance:'legacy_policy'}]);
 expect(nodes.every(n=>n.identity_mode==='legacy-v1'&&n.worker_boot_id===null)).toBe(true);
});
