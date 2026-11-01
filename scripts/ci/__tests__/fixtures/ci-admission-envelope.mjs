import {bundle} from './admission-bundle.mjs';
import {infraSnapshot} from './infra-snapshot.mjs';
import {authorityFixture} from './ci-admission-authority.mjs';
import {attachCiArchive} from './ci-admission-archive.mjs';
import {stepSha256 as hash} from '../../../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {createCiAdmissionEnvelope,authorizeCiAdmissionEnvelope} from '../../ci-admission-envelope.mjs';
import {verifyCiAdmissionAuthority} from '../../ci-admission-authority.mjs';
const scopes=['cecelia-kr','cecelia-factory','cecelia-infra'];
const seed={schema:'cecelia.ci-registry/v1',origin:'ci_synthetic',scopes,required_assertions:scopes.map((scope,i)=>({scope,id:`00000000-0000-4000-8000-00000000000${i}`,assertion_ref:`scripts/smoke/check-${i}.sh`}))};
const template=bundle('0'.repeat(40)).snapshot;
template.canonical.workflows=[{id:'00000000-0000-4000-8000-0000000000aa'}];
seed.canonical_ids=Object.fromEntries([template,template.admission_companion.snapshot,infraSnapshot('0'.repeat(40)).snapshot].map(s=>[s.scope,Object.fromEntries(['areas','journeys','workflows','activities','steps','references'].map(k=>[k,(s.canonical[k]||[]).map(r=>r.id).sort()]))]));
seed.scope_cells=Object.fromEntries(scopes.map(scope=>[scope,seed.required_assertions.filter(a=>a.scope===scope).map(({id,assertion_ref})=>({id,assertion_ref}))]));
seed.scope_cells['cecelia-kr'].push({id:'00000000-0000-4000-8000-0000000000ff',assertion_ref:null});
seed.tables={activity_cells:Object.values(seed.scope_cells).flat()};
const path='scripts/ci/config/ci-admission-registry.json';
export async function admissionFixture(t,sourceAuthority={}){
 const f=authorityFixture(t,{...sourceAuthority,controlFiles:{[path]:JSON.stringify(seed)}}),authority=await f.run(),parent=bundle(f.source).snapshot;
 parent.canonical.workflows=structuredClone(template.canonical.workflows);
 const snapshots=[parent,parent.admission_companion.snapshot,infraSnapshot(f.source).snapshot];
 for(const s of snapshots)s.assertions=structuredClone(seed.scope_cells[s.scope]);
 // 每个scope的真实schema/digest仍须成立；先封子，再更新父companion。
 const seal=s=>{const {snapshot_sha256,...body}=s;return {...body,snapshot_sha256:hash(body)};};
 snapshots[1]=seal(snapshots[1]);const {companion_sha256,...companion}=snapshots[0].admission_companion;
 companion.snapshot=snapshots[1];snapshots[0].admission_companion={...companion,companion_sha256:hash(companion)};
 snapshots[0]=seal(snapshots[0]);snapshots[2]=seal(snapshots[2]);
 const executions=seed.required_assertions.map(a=>({assertion_ref:a.assertion_ref,source_repo:'perfectuser21/cecelia',source_revision:f.source,registered_ids:[a.id],command_argv:['/bin/bash',a.assertion_ref],exit_code:0,signal:null,error:null,test_sha256:'1'.repeat(64),stdout_sha256:'2'.repeat(64),stderr_sha256:'3'.repeat(64)}));
 const body=await createCiAdmissionEnvelope({authority,controlRoot:f.root,snapshots,executions,sourceTree:f.git('rev-parse',`${f.source}^{tree}`)});
 const official=attachCiArchive(f,body),bound=await verifyCiAdmissionAuthority(official.options,official.deps);
 const open=()=>authorizeCiAdmissionEnvelope(body,{authority:bound,controlRoot:f.root});
 return {...f,authority:bound,body,snapshots,executions,open};
}
