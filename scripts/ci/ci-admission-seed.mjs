/** CI登记元数据只取受保护control的Git字节，不从source候选或回执定义分母。 */
import {readFixedLocalGitBlob} from './fixed-local-git.mjs';
import {stepSha256} from '../../packages/brain/scripts/sync-steps-from-workspace.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),SEED_SCHEMA=require('./config/ci-admission-registry.json').schema;
export const CI_ADMISSION_SCOPES=Object.freeze(['cecelia-kr','cecelia-factory','cecelia-infra']);
export const CI_ADMISSION_SEED_PATH='scripts/ci/config/ci-admission-registry.json';
const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code});};
export function loadCiAdmissionSeed(controlRoot,controlRevision){
 let seed;
 try{
  const bytes=readFixedLocalGitBlob(controlRoot,{revision:controlRevision,path:CI_ADMISSION_SEED_PATH});
  need(bytes.length<=1024*1024,'CI_ADMISSION_SEED_SIZE');seed=JSON.parse(bytes);
 }catch(error){if(error.code?.startsWith('CI_ADMISSION_'))throw error;need(false,'CI_ADMISSION_SEED_GIT_REQUIRED');}
 need(seed?.schema===SEED_SCHEMA&&seed.origin==='ci_synthetic'
  &&JSON.stringify(seed.scopes)===JSON.stringify(CI_ADMISSION_SCOPES),'CI_ADMISSION_SEED_INVALID');
 const rows=seed.required_assertions;
 need(Array.isArray(rows)&&rows.length>0&&rows.length<=1000&&new Set(rows.map(r=>r.id)).size===rows.length
  &&rows.every(r=>CI_ADMISSION_SCOPES.includes(r.scope)&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(r.id||'')&&typeof r.assertion_ref==='string'&&r.assertion_ref.length>0)
  &&CI_ADMISSION_SCOPES.every(scope=>rows.some(r=>r.scope===scope)),'CI_ADMISSION_SEED_ASSERTIONS_INVALID');
 need(CI_ADMISSION_SCOPES.every(scope=>seed.canonical_ids?.[scope]
  &&['areas','journeys','workflows','activities','steps','references'].every(k=>Array.isArray(seed.canonical_ids[scope][k])
   &&new Set(seed.canonical_ids[scope][k]).size===seed.canonical_ids[scope][k].length)),'CI_ADMISSION_SEED_CANONICAL_INVALID');
 const cells=CI_ADMISSION_SCOPES.flatMap(scope=>{
  need(Array.isArray(seed.scope_cells?.[scope])&&seed.scope_cells[scope].length>0,'CI_ADMISSION_SEED_CELLS_INVALID');
  return seed.scope_cells[scope].map(row=>({...row,scope}));
 });
 need(new Set(cells.map(c=>c.id)).size===cells.length&&stepSha256(cells.filter(c=>c.assertion_ref).sort((a,b)=>a.id.localeCompare(b.id)))===stepSha256(rows.map(({id,scope,assertion_ref})=>({id,scope,assertion_ref})).sort((a,b)=>a.id.localeCompare(b.id)))
  &&stepSha256(cells.map(c=>c.id).sort())===stepSha256(seed.tables?.activity_cells?.map(c=>c.id).sort()),'CI_ADMISSION_SEED_CELLS_INVALID');
 return {seed,digest:stepSha256(seed)};
}
