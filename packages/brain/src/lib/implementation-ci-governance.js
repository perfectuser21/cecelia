/** 固定治理分类；该模块从受信工具版本加载，PR正文不能扩白名单。 */
import { createHash } from 'node:crypto';
export const GOVERNANCE_REPO='perfectuser21/cecelia';
export const GOVERNANCE_FILES=['DEFINITION.md','.brain-versions','.dod.md','DoD.md','packages/brain/VERSION'];
export const VERSION_JSON_FILES=['package.json','package-lock.json','packages/brain/package.json','packages/brain/package-lock.json'];
export const GOVERNANCE_CHECKS=[
  {id:'facts',path:'scripts/facts-check.mjs',runtime:'node'},
  {id:'versions',path:'scripts/check-version-sync.sh',runtime:'bash'},
  {id:'dod',path:'packages/quality/scripts/devgate/check-dod-mapping.cjs',runtime:'node',args:['.dod.md']},
];
export const GOVERNANCE_POLICY_SHA256=createHash('sha256').update(JSON.stringify({repo:GOVERNANCE_REPO,files:GOVERNANCE_FILES,json:VERSION_JSON_FILES,checks:GOVERNANCE_CHECKS})).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
export function normalizeVersionJson(text){
  const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('JSON对象必填');
  delete value.version;
  for(const key of ['', 'packages/brain'])if(value.packages?.[key])delete value.packages[key].version;
  return JSON.stringify(canonical(value));
}
export function classifyGovernanceChange(repo,path,before,after){
  if(repo!==GOVERNANCE_REPO||typeof before!=='string'||typeof after!=='string')return null;
  if(GOVERNANCE_FILES.includes(path))return 'governance';
  if(VERSION_JSON_FILES.includes(path))try{return normalizeVersionJson(before)===normalizeVersionJson(after)?'version_only':null;}catch{return null;}
  return null;
}
export function assertGovernanceCoverage(report,path){
  const fail=()=>{throw Object.assign(Error('治理文件缺少固定来源与独立验证'),{code:'IMPACT_GOVERNANCE_UNVERIFIED'});};
  const evidence=report.governance_evidence,file=evidence?.files?.find(f=>f.path===path),source=report.source;
  const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
  if(!file||source?.repo!==GOVERNANCE_REPO||evidence.policy_sha256!==GOVERNANCE_POLICY_SHA256
    ||evidence.source?.repo!==source.repo||evidence.source?.base_revision!==source.base_revision||evidence.source?.head_revision!==source.head_revision
    ||!hash(file.base_sha256)||!hash(file.head_sha256)||!Array.isArray(evidence.checks))fail();
  if(!(file.kind==='governance'&&GOVERNANCE_FILES.includes(path))&&!(file.kind==='version_only'&&VERSION_JSON_FILES.includes(path)&&hash(file.normalized_sha256)))fail();
  for(const rule of GOVERNANCE_CHECKS)if(!evidence.checks.some(c=>c.id===rule.id&&c.path===rule.path&&c.exit_code===0&&!c.error&&hash(c.script_sha256)&&hash(c.stdout_sha256)&&hash(c.stderr_sha256)))fail();
  return true;
}
