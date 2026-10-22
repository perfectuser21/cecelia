#!/usr/bin/env node
/** 第三来源独立导入；PR沿原协议在scratch从base登记重建HEAD，绝不伪造companion。 */
import {mkdirSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPublishedArtifact,validatePublishedSnapshot} from './implementation-main-snapshot.mjs';
const scope='cecelia-infra',repo='perfectuser21/cecelia';
const fail=code=>{throw Object.assign(Error(code),{code});};
export function prepareInfraInputs({sourceRepo,base,head,mode,inputDir}){
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
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==3)fail('IMPLEMENTATION_INFRA_ARGUMENT_INVALID');
  const result=prepareInfraInputs({sourceRepo:process.env.SOURCE_REPO,base:process.env.BASE,head:process.env.HEAD,mode:process.env.MODE,inputDir:process.argv[2]});
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(error){process.stderr.write((error.code||'IMPLEMENTATION_INFRA_INPUT_UNKNOWN')+'\n');process.exitCode=1;}
}
