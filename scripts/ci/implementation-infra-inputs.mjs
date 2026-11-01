#!/usr/bin/env node
/** 第三来源独立导入；PR沿原协议在scratch从base登记重建HEAD，绝不伪造companion。 */
import {mkdirSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPublishedArtifact,validatePublishedSnapshot} from './implementation-main-snapshot.mjs';
import {loadCiAdmissionInputs,inspectCiAdmissionInputs} from './ci-admission-inputs.mjs';
const scope='cecelia-infra',repo='perfectuser21/cecelia';
const fail=code=>{throw Object.assign(Error(code),{code});};
export function prepareInfraInputs({sourceRepo,base,head,mode,inputDir}){
 if(process.env.IMPLEMENTATION_CI_ADMISSION_INPUT_DIR||existsSync(join(resolve(inputDir),'ci-admission','handoff.json')))fail('IMPLEMENTATION_INFRA_TYPED_INPUT_REQUIRED');
 if(sourceRepo!==repo||!['pr','main'].includes(mode)||![base,head].every(x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x)))fail('IMPLEMENTATION_INFRA_INPUT_INVALID');
 const output=resolve(inputDir),diagnostics=join(output,'infra-origin');mkdirSync(diagnostics,{recursive:true});
 const snapshots={};
 for(const [side,revision] of [['base',base],['head',mode==='pr'?base:head]]){
  const destination=join(output,side,`${side}-${scope}.json`);
  if(existsSync(destination))fail('IMPLEMENTATION_INFRA_OUTPUT_EXISTS');
  const body=side==='head'&&mode==='pr'?snapshots.base:readPublishedArtifact({repo,revision,scope,diagnostics});
  validatePublishedSnapshot(body,{scope,repo,revision,complete:true});snapshots[side]=body;
 }
 for(const side of ['base','head']){
  mkdirSync(join(output,side),{recursive:true});
  writeFileSync(join(output,side,`${side}-${scope}.json`),JSON.stringify(snapshots[side].snapshot)+'\n',{flag:'wx',mode:0o600});
 }
 return {scope,repo,base_revision:base,head_revision:head,head_basis:mode==='pr'?'base_registry_seed_for_fixed_head_scratch_rebuild':'trusted_main_fixed_head',execution_status:'unknown'};
}
export async function prepareCiAdmissionInfraInputs(options,deps={}){
 if(options.mode!=='pr')fail('CI_ADMISSION_USAGE_FORBIDDEN');
 const handle=await loadCiAdmissionInputs(options,deps),view=inspectCiAdmissionInputs(handle);
 if(options.sourceRepo!==view.source.repo||options.base!==view.source.base_revision||options.head!==view.source.head_revision)fail('CI_ADMISSION_INFRA_SOURCE_MISMATCH');
 return {scope,repo,base_revision:view.source.base_revision,head_revision:view.source.head_revision,input_kind:'ci_admission_only',
  scopes:view.scopes,provenance:view.provenance,execution_status:'unknown',head_basis:'typed_base_registry_seed_for_fixed_head_scratch_rebuild'};
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==3)fail('IMPLEMENTATION_INFRA_ARGUMENT_INVALID');
  const options={sourceRepo:process.env.SOURCE_REPO,base:process.env.BASE,head:process.env.HEAD,mode:process.env.MODE,inputDir:process.argv[2]};
  const result=process.env.IMPLEMENTATION_CI_ADMISSION_INPUT_DIR?await prepareCiAdmissionInfraInputs({...options,inputDir:process.env.IMPLEMENTATION_CI_ADMISSION_INPUT_DIR,
   repoRoot:process.env.GITHUB_WORKSPACE&&join(process.env.GITHUB_WORKSPACE,'source'),toolingRoot:process.env.GITHUB_WORKSPACE&&join(process.env.GITHUB_WORKSPACE,'tooling')}):prepareInfraInputs(options);
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(error){process.stderr.write((error.code||'IMPLEMENTATION_INFRA_INPUT_UNKNOWN')+'\n');process.exitCode=1;}
}
