#!/usr/bin/env bash
set -euo pipefail
if [[ "${SMOKE_ALLOW_WRITE:-}" != 1 ]]; then exit 0; fi
case "${1:-}" in
  --scenario) scenario="${2:-}" ;;
  *) echo 'usage: --scenario baseline|two-revisions|invalid|concurrency' >&2; exit 2 ;;
esac
case "$scenario" in baseline|two-revisions|invalid|concurrency) ;; *) exit 2;; esac
tooling="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$tooling"
SMOKE_TOOLING="$tooling" SMOKE_SCENARIO="$scenario" node --input-type=module <<'NODE'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pilotPlanHash} from './packages/brain/src/lib/pilot-release-verification.js';
const root=mkdtempSync(join(tmpdir(),'central-skill-smoke-')),scenario=process.env.SMOKE_SCENARIO;
const repo='perfectuser21/zenithjoy-workspace',centralRepo='perfectuser21/zenithjoy-skills';
const business=join(root,'business'),central=join(business,'.skills-source'),tooling=join(root,'tooling');
const skillPath='.claude/skills/demo/SKILL.md',sourcePath='business-skills/zenithjoy/demo/SKILL.md';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const put=(cwd,path,data)=>{const dest=join(cwd,path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,data);};
const commit=cwd=>{git(cwd,'add','-A');git(cwd,'-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture');return git(cwd,'rev-parse','--verify','HEAD^{commit}');};
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
try{
  mkdirSync(business);mkdirSync(central);git(business,'init','-q','-b','main');git(business,'remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');git(central,'init','-q','-b','main');symlinkSync(process.env.SMOKE_TOOLING,tooling,'dir');
  const fixture=join(root,'fixture.mjs');
  writeFileSync(fixture,`globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_IN_FIXED_CACHE_CLI');};\n`);
  put(business,'.gitignore','.skills-source/\n');
  put(business,'entry.js','export const fixed = true;\n');
  put(business,'scripts/smoke/pilot.sh','#!/bin/bash\nset -e\ntest -z "${GITHUB_TOKEN:-}"\ntest -z "${CECELIA_INTERNAL_TOKEN:-}"\n');
  put(business,skillPath,'---\nname: old\nversion: 1\n---\nremoved\n');commit(business);git(business,'rm','-q',skillPath);
  const centralCommit=version=>{
    const content=`---\nname: demo\nversion: ${version}\n---\ncentral ${version}\n`;
    put(central,sourcePath,content);
    put(central,'distribution/catalog.json',JSON.stringify({version:1,profiles:{zenithjoy:{files:[{path:skillPath,source:sourcePath,sha256:sha(content)}]}}}));
    return {revision:commit(central),content};
  };
  const lock=(centralRevision,patch={})=>JSON.stringify({version:1,repository:centralRepo,revision:centralRevision,profile:'zenithjoy',loader_sha256:'a'.repeat(64),...patch});
  const a=centralCommit(1);put(business,'.skills-source.json',lock(a.revision));const m1=commit(business);
  const snapshot=(revision,skill)=>{
    const row=(n,payload,identity)=>{const source={repo,path:'contracts/pilot.json',commit:revision};return {id:id(n),...identity,source_repo:repo,source_path:source.path,source_commit:revision,payload,payload_sha256:pilotPlanHash({source,payload})};};
    const activity=row(2,{activity_id:id(3),steps:[{step_id:id(4),locator:{activity_id:id(3),step_key:'verify'}}],implementation_bindings:[
      {kind:'code',scope:'activity',status:'verified',repo,path:'entry.js',revision,digest:'sha256:'+sha('export const fixed = true;\n')},
      {kind:'skill',scope:'activity',status:'verified',repo,path:skillPath,revision,digest:'sha256:'+sha(skill.content),resolved_source:{repo:centralRepo,path:sourcePath,revision:skill.revision}}
    ]},{activity_id:id(3)});
    const workflow=row(1,{workflow_id:id(5),capability_id:id(6),activities:[{reference_id:id(7),activity_id:id(3),activity_version_id:id(2)}]},{workflow_id:id(5)});
    const s={schema_version:1,scope:'zenithjoy',repo,revision,status:'verified',gaps:[],definitions:{workflows:[workflow],activities:[activity]},assertions:[null,id(4)].map((step,i)=>({id:id(10+i),journey_id:id(6),step_id:id(3),step_id_ref:step,cell_kind:'scenario',cell_key:`regression:${id(6)}:${step||'activity'}`,assertion_ref:'scripts/smoke/pilot.sh',assertion_revision:1}))};
    s.snapshot_sha256=pilotPlanHash(s);return s;
  };
  let runs=0;
  const run=(revision,skill,{expectPass=true,ref='refs/heads/main'}={})=>{
    git(business,'update-ref','refs/remotes/origin/main',revision);
    const output=join(root,`output-${++runs}`),file=join(root,`snapshot-${runs}.json`);
    writeFileSync(file,JSON.stringify({snapshot:snapshot(revision,skill)}));
    const args=['--import',fixture,join(tooling,'scripts/ci/pilot-release-verification.mjs'),'--repo-root',business,'--snapshot',file,'--output-dir',output,'--event','push','--ref',ref];
    const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_TOKEN:'local-fixture'}});
    const receipt=existsSync(join(output,'receipt.json'))?JSON.parse(readFileSync(join(output,'receipt.json'))):null;
    const gap=existsSync(join(output,'gap.json'))?JSON.parse(readFileSync(join(output,'gap.json'))):null;
    if(expectPass){if(result.status!==0||receipt?.verdict!=='PASS')throw Error(`expected PASS: ${result.stderr}`);}
    else if(result.status===0||gap?.status!=='unknown'||receipt?.verdict==='PASS')throw Error(`expected unknown gap: ${result.stderr}`);
    return {receipt,gap};
  };
  put(business,skillPath,'---\nname: evil\nversion: 9\n---\nworktree poison\n');
  if(scenario==='baseline'){
    run(m1,a);
    put(business,'entry.js','poison worktree\n');run(m1,a,{expectPass:false});
    put(business,'entry.js','export const fixed = true;\n');run(m1,a,{expectPass:false,ref:'refs/heads/other'});
  }else{
    const first=run(m1,a);
    const b=centralCommit(2);put(business,'.skills-source.json',lock(b.revision));const m2=commit(business);
    const second=run(m2,b);
    if(first.receipt?.verdict!=='PASS'||second.receipt?.verdict!=='PASS'||sha(a.content)===sha(b.content))throw Error('revisions crossed');
    if(scenario==='invalid'){
      const catalog=JSON.parse(readFileSync(join(central,'distribution/catalog.json')));
      const wrongDigest=structuredClone(catalog);wrongDigest.profiles.zenithjoy.files[0].sha256='0'.repeat(64);
      put(central,'distribution/catalog.json',JSON.stringify(wrongDigest));const badDigest=commit(central);
      const noEntry=structuredClone(catalog);noEntry.profiles.zenithjoy.files=[];
      put(central,'distribution/catalog.json',JSON.stringify(noEntry));const missingEntry=commit(central);
      const badPath=structuredClone(catalog);badPath.profiles.zenithjoy.files[0].source='../SKILL.md';
      put(central,'distribution/catalog.json',JSON.stringify(badPath));const traversal=commit(central);
      const noncatalog=structuredClone(catalog);noncatalog.profiles.zenithjoy.files[0].path='elsewhere/SKILL.md';
      put(central,'distribution/catalog.json',JSON.stringify(noncatalog));const wrongPath=commit(central);
      const cases=[lock(badDigest),lock(missingEntry),lock(traversal),lock(wrongPath),lock(b.revision,{revision:'main'}),lock(b.revision,{repository:'evil/repo'}),null];
      for(const value of cases){if(value===null)git(business,'rm','-q','.skills-source.json');else put(business,'.skills-source.json',value);const revision=commit(business);run(revision,b,{expectPass:false});}
    }
    if(scenario==='concurrency'){
      const altered=(change,expectPass=false)=>{
        const s=snapshot(m2,b);change(s.definitions.activities[0].payload.implementation_bindings);
        const activity=s.definitions.activities[0];activity.payload_sha256=pilotPlanHash({source:{repo,path:activity.source_path,commit:m2},payload:activity.payload});
        delete s.snapshot_sha256;s.snapshot_sha256=pilotPlanHash(s);
        const file=join(root,`altered-${++runs}.json`),output=join(root,`altered-output-${runs}`);writeFileSync(file,JSON.stringify({snapshot:s}));
        const result=spawnSync(process.execPath,['--import',fixture,join(tooling,'scripts/ci/pilot-release-verification.mjs'),'--repo-root',business,'--snapshot',file,'--output-dir',output,'--event','push','--ref','refs/heads/main'],{cwd:root,encoding:'utf8',env:{...process.env,GITHUB_TOKEN:'local-fixture'}});
        const receipt=existsSync(join(output,'receipt.json'))?JSON.parse(readFileSync(join(output,'receipt.json'))):null;
        const gap=existsSync(join(output,'gap.json'))?JSON.parse(readFileSync(join(output,'gap.json'))):null;
        if(expectPass){if(result.status!==0||receipt?.verdict!=='PASS')throw Error('duplicate fixed binding failed');return JSON.parse(readFileSync(join(output,'report.json')));}
        if(result.status===0||gap?.status!=='unknown'||receipt?.verdict==='PASS')throw Error('invalid binding did not fail');
      };
      altered(rows=>{rows[1].path='';});
      altered(rows=>{rows[1].path='a'.repeat(1001)+'/SKILL.md';});
      const duplicateReport=altered(rows=>rows.push({...rows[1]}),true);
      if(duplicateReport.expected_usages.length!==2)throw Error('duplicate expanded verification set');
      const cases=[[m1,a],[m2,b]];
      const results=await Promise.all(cases.map(async ([revision,skill],index)=>{
        const checkout=join(root,`source-${index}`);git(root,'clone','-q',business,checkout);git(checkout,'remote','set-url','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');git(checkout,'checkout','-q','--detach',revision);git(checkout,'update-ref','refs/remotes/origin/main',revision);git(root,'clone','-q',central,join(checkout,'.skills-source'));
        const file=join(root,`concurrent-${index}.json`),output=join(root,`concurrent-output-${index}`);
        writeFileSync(file,JSON.stringify({snapshot:snapshot(revision,skill)}));
        const args=['--import',fixture,join(tooling,'scripts/ci/pilot-release-verification.mjs'),'--repo-root',checkout,'--snapshot',file,'--output-dir',output,'--event','push','--ref','refs/heads/main'];
        const result=await new Promise(resolve=>{const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,GITHUB_TOKEN:'local-fixture'}});let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.on('close',status=>resolve({status,stderr}));});
        const receipt=existsSync(join(output,'receipt.json'))?JSON.parse(readFileSync(join(output,'receipt.json'))):null;
        if(result.status!==0||receipt?.verdict!=='PASS')throw Error(`concurrent CLI failed: ${result.stderr}`);
        return receipt;
      }));
      if(results.length!==2)throw Error('concurrent receipts missing');runs+=2;
    }
  }
  process.stdout.write(`central skill smoke ${scenario}: PASS (${runs} CLI runs)\n`);
}finally{rmSync(root,{recursive:true,force:true});}
NODE
