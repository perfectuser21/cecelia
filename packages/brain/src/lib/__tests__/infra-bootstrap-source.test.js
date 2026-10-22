import {describe,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareInfraBootstrapSource,consumeInfraBootstrapSource} from '../infra-bootstrap-source.js';

const root=fileURLToPath(new URL('../../../../../',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trimEnd();
const revision=git('rev-parse','HEAD');
const input=()=>({task_id:'a6aa895d-f91e-4eb4-bdc6-242119ca46ce',client_request_id:'source-proof',expected_registry_sha256:'a'.repeat(64),revision});
// 仅远端main取证边界隔离；实际闭包读取本次固定Git对象，issuer/WeakMap真实执行。
const readFile=async(rev,path)=>execFileSync('git',['show',`${rev}:${path}`],{cwd:root,encoding:'utf8'});
const options=()=>({revision,readFile,checkMain:async rev=>{expect(rev).toBe(revision);}});

describe('infra bootstrap固定源码能力',()=>{
 it('真实固定闭包签发只可消费一次，保持非执行来源身份',async()=>{
  const request=input(),cap=await prepareInfraBootstrapSource(request,options());
  const proof=consumeInfraBootstrapSource(cap,request);
  expect(proof.source).toMatchObject({repo:'perfectuser21/cecelia',revision});
  expect(proof.source.sha256).toMatch(/^[a-f0-9]{64}$/);
  await expect(proof.check()).resolves.toBeUndefined();
  expect(()=>consumeInfraBootstrapSource(cap,request)).toThrow('INFRA_BOOTSTRAP_SOURCE_UNPREPARED');
 });
 it('普通对象不能伪造来源能力',()=>{
  expect(()=>consumeInfraBootstrapSource({source:{revision}},input())).toThrow('INFRA_BOOTSTRAP_SOURCE_UNPREPARED');
 });
 it('改请求消费失败并烧掉能力，不能改回后重用',async()=>{
  const request=input(),cap=await prepareInfraBootstrapSource(request,options());
  expect(()=>consumeInfraBootstrapSource(cap,{...request,client_request_id:'other'})).toThrow('INFRA_BOOTSTRAP_SOURCE_UNPREPARED');
  expect(()=>consumeInfraBootstrapSource(cap,request)).toThrow('INFRA_BOOTSTRAP_SOURCE_UNPREPARED');
 });
 it('错部署修订在任何远端检查之前拒绝',async()=>{
  let checks=0;
  await expect(prepareInfraBootstrapSource({...input(),revision:'b'.repeat(40)},{...options(),checkMain:async()=>{checks++;}})).rejects.toThrow('INFRA_BOOTSTRAP_DEPLOYMENT_MISMATCH');
  expect(checks).toBe(0);
 });
 it('已加载关键reader字节漂移不能签发',async()=>{
  await expect(prepareInfraBootstrapSource(input(),{...options(),readFile:async(rev,path)=>(await readFile(rev,path))+(path.endsWith('fixed-git-source.js')?'// drift':'')})).rejects.toThrow('INFRA_BOOTSTRAP_RUNTIME_MISMATCH');
 });
 it('真实消费者验证文件被改时拒绝，不把普通Git读取当充分证据',async()=>{
  await expect(prepareInfraBootstrapSource(input(),{...options(),readFile:async(rev,path)=>(await readFile(rev,path))+(path.endsWith('janitor_resident_service_exempt.test.sh')?'# drift':'')})).rejects.toThrow('INFRA_VERIFICATION_CONSUMER_UNPROVEN');
 });
 it('来源准备后的main漂移仍拒绝签发',async()=>{
  let checks=0;
  await expect(prepareInfraBootstrapSource(input(),{...options(),checkMain:async()=>{if(++checks===2)throw Error('MAIN_MOVED');}})).rejects.toThrow('MAIN_MOVED');
  expect(checks).toBe(2);
 });
});
