import {completeReport as healthFixture,merge} from '../../__tests__/helpers/fleet-config-fs-fixture.js';
import {it,expect} from 'vitest';
import * as contract from './node-profile.js';
import {evaluateBaseAdmission} from './node-admission.js';
const NOW_MS=Date.now();
const completeReport=(profile,overrides={})=>healthFixture(profile,overrides,NOW_MS);
it('既有Mac目录OS版本可更新，部署canonical保持15.6.1且其它准入维度不得放宽',async()=>{
 const profile=contract.getNodeProfile('xian-mac-m4'),candidate=structuredClone(profile);candidate.version_policy.os='26.6.2';
 expect(contract.getDeploymentNodeProfile('xian-mac-m4').version_policy.os).toBe('15.6.1');expect(contract.validateNodeProfile(candidate)).toBe(false);
 const report=completeReport(candidate);expect(evaluateBaseAdmission(report,{profile:candidate,nowMs:NOW_MS}).base_admitted).toBe(false);
 const {directory}=await import('../../execution-directory/directory.js');const rows=structuredClone(directory.current().nodes);rows.find(n=>n.canonical_id==='xian-mac-m4').profile=candidate;await directory.refresh({pool:{query:async()=>({rows})}});const registered=contract.getNodeProfile('xian-mac-m4');expect(evaluateBaseAdmission(report,{profile:registered,nowMs:NOW_MS}).base_admitted).toBe(true);
 for(const [patch,code] of [[{os:{version:'27.0.0'}},'os_version_drift'],[{os:{version:'26.6.1'}},'os_version_below_floor'],[{time_sync:{synchronized:false}},'time_unsynchronized'],[{runner:{image_digest:'sha256:'+ 'b'.repeat(64)}},'runner_digest_drift']])expect(evaluateBaseAdmission(merge(report,patch),{profile:registered,nowMs:NOW_MS}).reasons.map(r=>r.code)).toContain(code);
 const lower=structuredClone(candidate);lower.resources.disk_min_free_gib=1;expect(evaluateBaseAdmission(report,{profile:lower,nowMs:NOW_MS}).base_admitted).toBe(false);
});
