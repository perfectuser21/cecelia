/** 固定Git与本进程实际装载源码逐字节核对；准备对象不可由HTTP/JSON伪造。 */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFixedGitFile} from '../workflow-authoring/fixed-git-source.js';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
export const NATIVE_SPEC_PATH='packages/brain/config/workflow-assembly-native.json';
export const NATIVE_REPO='perfectuser21/cecelia';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const require=createRequire(import.meta.url);
export const nativeSpec=require('../../config/workflow-assembly-native.json');
const paths=[NATIVE_SPEC_PATH,...['workflow-assembly-native.js','workflow-assembly-native-ledger.js','workflow-assembly-native-source.js','workflow-assembly-native-registration.js',
  'workflow-assembly-reconcile-runner.js','workflow-assembly-reconcile.js','workflow-assembly-reconcile-derived.js','workflow-assembly-reconcile-tasks.js'].map(p=>'packages/brain/src/lib/'+p),
  'packages/brain/src/workflow-authoring/assembly-driver.js','packages/brain/src/workflow-authoring/execution-proof.js'];
const loaded=new Map(paths.map(path=>[path,readFileSync(root+path,'utf8')]));
const trusted=new WeakSet();
const cache=new Map();
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
export function deployedNativeRevision(){
  const revision=process.env.GIT_SHA??execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if(!/^[a-f0-9]{40}$/.test(revision))throw Error('native_deployment_revision_required');return revision;
}
export function assertNativeSource(value){if(!trusted.has(value))throw Error('native_source_unprepared');}
async function readSource(revision,path,options){
  try{return execFileSync('git',['show',`${revision}:${path}`],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});}
  catch{return readFixedGitFile({repo:NATIVE_REPO,path,revision},options);}
}
export async function prepareNativeSource({revision,readFile=readSource,deadline=Date.now()+20000,signal}={}){
  if(!/^[a-f0-9]{40}$/.test(revision??''))throw Error('native_source_revision_required');
  if(readFile===readSource && cache.has(revision))return cache.get(revision);
  const bindings=[];
  for(const path of paths){
    if(signal?.aborted||Date.now()>=deadline)throw Error('native_source_budget');
    const text=await readFile(revision,path,{deadline,signal});
    if(signal?.aborted||Date.now()>=deadline)throw Error('native_source_budget');
    if(text!==loaded.get(path))throw Error('native_source_runtime_mismatch');
    const sha=createHash('sha256').update(text).digest('hex');
    bindings.push({kind:'code',repo:NATIVE_REPO,path,revision,content_sha256:sha,digest:'sha256:'+sha,status:'verified',scope:'activity',validation_scope:'runtime_bytes'});
  }
  const source=freeze({repo:NATIVE_REPO,path:NATIVE_SPEC_PATH,commit:revision,bindings});trusted.add(source);
  if(readFile===readSource)cache.set(revision,source);return source;
}
