import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import yaml from 'js-yaml';
test('Nightly实际Start Brain步骤记录本次健康探测序号，不继承无关i变量',()=>{
 const document=yaml.load(readFileSync(new URL('../../../.github/workflows/nightly-regression.yml',import.meta.url),'utf8'));
 const steps=Object.values(document.jobs).flatMap(job=>job.steps??[]);const step=steps.find(x=>x.name?.startsWith('Start Brain container'));
 assert.equal(typeof step?.run,'string');const directory=mkdtempSync(join(tmpdir(),'nightly-health-attempt-'));
 try{
  const counter=join(directory,'calls');writeFileSync(counter,'0');
  const script=`set -euo pipefail\ndocker(){ :; }\nsleep(){ :; }\ncurl(){ local count; read -r count < "$COUNTER" || true; count=$((count+1)); printf '%s' "$count" > "$COUNTER"; [[ "$count" -eq 3 ]]; }\n${step.run}`;
  const result=spawnSync('/bin/bash',['-c',script],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',COUNTER:counter,i:'unrelated-parent-value'}});
  assert.equal(result.status,0,result.stderr);assert.equal(readFileSync(counter,'utf8'),'3');assert.match(result.stdout,/Brain healthy in 3s/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
