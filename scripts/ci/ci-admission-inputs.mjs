/** PR专用typed handoff。定位env不授予能力；每次load重核官方ZIP/authority/最近first-parent。 */
import {readFileSync} from 'node:fs';
import {stepSha256 as hash} from '../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {resolvePrBaseline} from './implementation-pr-baseline.mjs';
import {ciAdmissionDescriptor,readCiAdmissionInputs} from './ci-admission-handoff.mjs';
import {withCiAdmissionScratch} from './ci-admission-envelope.mjs';
import {createCiAdmissionScratch} from './ci-admission-scratch.mjs';
import {fixedLocalGit} from './fixed-local-git.mjs';
const handles=new WeakMap(),need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function state(handle){need(handles.has(handle),'CI_ADMISSION_INPUT_CAPABILITY_REQUIRED');return handles.get(handle);}
function assertCheckouts(s){for(const [root,revision] of s.checkouts)need(fixedLocalGit(root,['rev-parse','HEAD'],{encoding:'utf8'}).trim()===revision
 &&!fixedLocalGit(root,['status','--porcelain=v1','--untracked-files=no'],{encoding:'utf8'}).trim(),'CI_ADMISSION_CHECKOUT_CHANGED');}
export async function loadCiAdmissionInputs(options={},deps={}){
 need(options.mode==='pr','CI_ADMISSION_USAGE_FORBIDDEN');
 const inputDir=options.inputDir||process.env.IMPLEMENTATION_CI_ADMISSION_INPUT_DIR;
 need(typeof inputDir==='string'&&inputDir.startsWith('/'),'CI_ADMISSION_HANDOFF_PATH');
 const original=readCiAdmissionInputs(inputDir);
 const context={...options,repository:options.repository??process.env.GITHUB_REPOSITORY,eventName:options.eventName??process.env.GITHUB_EVENT_NAME,
  event:options.event??JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')),toolingRevision:options.toolingRevision??process.env.TOOLING_REVISION};
 const result=await resolvePrBaseline(context,deps);
 need(result.ciAdmission&&hash(ciAdmissionDescriptor(result))===hash(original.descriptor)
  &&result.ciAdmission.archive.equals(original.archive),'CI_ADMISSION_HANDOFF_CHANGED');
 const r=result.resolution,d=original.descriptor;
 const source={repo:r.repo,base_revision:r.effective_base_revision,head_revision:r.head_revision};
 const provenance={purpose:'ci_admission_only',artifact_id:d.artifact.id,artifact_digest:d.artifact.digest,envelope_sha256:d.envelope_sha256,
  source_revision:d.source_revision,control_revision:d.control_revision,original_pr_base_revision:d.original_pr_base_revision,tooling_revision:d.tooling_revision};
 const handle=Object.freeze(Object.create(null));handles.set(handle,{capability:result.ciAdmission.capability,source,provenance,checkouts:[[context.repoRoot,r.head_revision],[context.toolingRoot,r.tooling_revision]]});return handle;
}
export function inspectCiAdmissionInputs(handle){const s=state(handle);return freeze(structuredClone({source:s.source,scopes:['cecelia-kr','cecelia-factory','cecelia-infra'],provenance:s.provenance}));}
export async function withCiAdmissionInputsScratch(handle,consume){
 const s=state(handle);need(typeof consume==='function','CI_ADMISSION_CALLBACK_REQUIRED');assertCheckouts(s);const scratch=await createCiAdmissionScratch();
 try{return await withCiAdmissionScratch(s.capability,{db:scratch.db,usage:'pr'},async snapshots=>{const value=await consume(Object.freeze({db:scratch.db,snapshots,...inspectCiAdmissionInputs(handle)}));assertCheckouts(s);return value;});}
 finally{await scratch.close();}
}
