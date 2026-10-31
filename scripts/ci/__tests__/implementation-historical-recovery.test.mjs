import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import yaml from 'js-yaml';
import {bundle} from './fixtures/admission-bundle.mjs';
import {infraSnapshot} from './fixtures/infra-snapshot.mjs';
import {rebuildHistoricalE3a,verifyHistoricalE3aAtGate,resolveRecoveryBridges,HISTORICAL_E3A} from '../implementation-source-recovery.mjs';

const repo='perfectuser21/cecelia';
const {anchor,head,merges}=HISTORICAL_E3A;
const second='061a8a1784ffd02fdf1e3071390b2036e70d9395';
const latest='a68df7e48781bc38875d8581249049f57c4fe5de';

test('恢复链只接受固定 first-parent 两桥，未知或断链拒绝',()=>{
 const parents=new Map([[latest,second],[second,head]]);
 const links=resolveRecoveryBridges(head,latest,revision=>parents.get(revision));
 assert.deepEqual(links.map(link=>link.pr),[6705,6706]);
 assert.throws(()=>resolveRecoveryBridges(head,latest,revision=>revision===latest?'f'.repeat(40):parents.get(revision)),/SOURCE_RECOVERY_BRIDGE_INVALID/);
 assert.throws(()=>resolveRecoveryBridges(head,'f'.repeat(40),()=>latest),/SOURCE_RECOVERY_BRIDGE_INVALID/);
});

function fixture(t,{missing=null,gateVerdict='PASS'}={}){
 const dir=mkdtempSync(join(tmpdir(),'historical-e3a-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const calls=[];
 const sources=new Map([
  [`cecelia-kr:${anchor}`,bundle(anchor)],
  [`cecelia-infra:${anchor}`,infraSnapshot(anchor)],
  [`cecelia-infra:${head}`,infraSnapshot(head)],
 ]);
 const readArtifact=({scope,revision})=>{
  calls.push(`${scope}:${revision}`);
  if(missing===`${scope}:${revision}`)throw Object.assign(Error('IMPLEMENTATION_CI_BASE_ARTIFACT_MISSING'),{code:'IMPLEMENTATION_CI_BASE_ARTIFACT_MISSING'});
  const index=[`cecelia-kr:${anchor}`,`cecelia-infra:${anchor}`,`cecelia-infra:${head}`].indexOf(`${scope}:${revision}`)+1;
  return {body:sources.get(`${scope}:${revision}`),origin:{artifact_id:index,artifact_digest:`sha256:${String(index).repeat(64)}`}};
 };
 return {dir,calls,dependencies:{
  readArtifact,
  verifyLineage:async()=>({anchor,head,merges:merges.map(({revision,parent,pr,prHead})=>({revision,parent,pr,prHead}))}),
  compile:async({head:target,baseline})=>{assert.equal(target,head);assert.equal(baseline.snapshot.revision,anchor);return bundle(head).snapshot;},
  prepareCheckout:async()=>({path:dir,cleanup:()=>{}}),
  runGate:async options=>{
   assert.equal(options.base,anchor);assert.equal(options.head,head);
   assert.deepEqual(JSON.parse(options.mainScopes).scopes,['cecelia-kr','cecelia-factory']);
   for(const [side,revision]of [['base',anchor],['head',head]]){
    assert.equal(JSON.parse(readFileSync(join(options.infraInputDir,side,`${side}-cecelia-infra.json`))).revision,revision);
   }
   return {receipt:{verdict:gateVerdict,evidence_sha256:'a'.repeat(64),scope_receipts:['cecelia-kr','cecelia-factory','cecelia-infra'].map(scope_key=>({scope_key,verdict:gateVerdict,assertions:(scope_key==='cecelia-kr'?['smoke','auxiliary']:['smoke']).map(ref=>({assertion_ref:`${scope_key}-${ref}`,source_revision:head,test_sha256:'a'.repeat(64),exit_code:gateVerdict==='PASS'?0:1}))}))}};
  },
 }};
}

test('缺 e3a artifact 时仅用官方68b双scope、68b/e3a Infra和三scope PASS重建',async t=>{
 const f=fixture(t);
 const result=await rebuildHistoricalE3a({repoRoot:f.dir,requestedBase:head,outputDir:f.dir},f.dependencies);
 assert.deepEqual(f.calls,[`cecelia-kr:${anchor}`,`cecelia-infra:${anchor}`,`cecelia-infra:${head}`]);
 assert.equal(result.baseline.snapshot.revision,head);
 assert.equal(result.proof.anchor_revision,anchor);
 assert.equal(result.proof.head_revision,head);
 assert.equal(result.proof.gate_verdict,'PASS');
 assert.equal(result.proof.artifacts.length,3);
});

test('官方历史输入缺失或三scope门禁失败均不可生成e3a基线',async t=>{
 for(const config of [{missing:`cecelia-infra:${head}`},{gateVerdict:'FAIL'}]){
  const f=fixture(t,config);
  await assert.rejects(rebuildHistoricalE3a({repoRoot:f.dir,requestedBase:head,outputDir:f.dir},f.dependencies));
 }
});

test('仅精确e3a可走一次性历史重建',async t=>{
 const f=fixture(t);
 await assert.rejects(rebuildHistoricalE3a({repoRoot:f.dir,requestedBase:'f'.repeat(40),outputDir:f.dir},f.dependencies),/SOURCE_RECOVERY_HISTORICAL_BASE_INVALID/);
 assert.deepEqual(f.calls,[]);
});

test('Gate独立重取官方artifact并对生产者原e3a快照重跑三scope',async t=>{
 const f=fixture(t),producer=await rebuildHistoricalE3a({repoRoot:f.dir,requestedBase:head,outputDir:f.dir},f.dependencies);
 const verified=await verifyHistoricalE3aAtGate({repoRoot:f.dir,baseline:producer.baseline,proof:producer.proof,outputDir:f.dir},f.dependencies);
 assert.equal(verified.verdict,'PASS');
 assert.deepEqual(f.calls,[`cecelia-kr:${anchor}`,`cecelia-infra:${anchor}`,`cecelia-infra:${head}`,`cecelia-kr:${anchor}`,`cecelia-infra:${anchor}`,`cecelia-infra:${head}`]);
});

test('Gate拒绝生产者伪造artifact摘要和三scope失败',async t=>{
 const f=fixture(t),producer=await rebuildHistoricalE3a({repoRoot:f.dir,requestedBase:head,outputDir:f.dir},f.dependencies);
 const args={repoRoot:f.dir,baseline:producer.baseline,proof:structuredClone(producer.proof),outputDir:f.dir};
 args.proof.artifacts[0].artifact_digest=`sha256:${'f'.repeat(64)}`;
 await assert.rejects(verifyHistoricalE3aAtGate(args,f.dependencies),/SOURCE_RECOVERY_HISTORICAL_ARTIFACT_CHANGED/);
 args.proof=producer.proof;
 await assert.rejects(verifyHistoricalE3aAtGate(args,{...f.dependencies,runGate:async()=>({receipt:{verdict:'FAIL'}})}),/SOURCE_RECOVERY_HISTORICAL_GATE_FAILED/);
});

test('Gate仅在真实回归步骤取得GitHub只读凭据以独立复核官方artifact',()=>{
 const workflow=yaml.load(readFileSync(new URL('../../../.github/workflows/implementation-impact.yml',import.meta.url),'utf8'));
 const gate=workflow.jobs.gate,step=gate.steps.find(item=>item.name==='实际变更影响与固定回归');
 assert.equal(step.env.GH_TOKEN,'${{ github.token }}');
 assert.equal(gate.env.GH_TOKEN,undefined);
 assert.equal(gate.steps.find(item=>item.name==='独立infra固定来源加入联合输入').env.GH_TOKEN,'${{ github.token }}');
});
