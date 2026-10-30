#!/usr/bin/env bash
# 实际执行main范围计划，核对Fleet shell全集并验证其失败传播，不绑定旧job名称。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
node --input-type=module - "$REPO_ROOT" <<'NODE'
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const root=process.argv[2],require=createRequire(join(root,'package.json'));
const {commandsFor}=await import(pathToFileURL(join(root,'scripts/ci/run-basic-check.mjs')));
const ci=require('js-yaml').load(readFileSync(join(root,'.github/workflows/ci.yml'),'utf8'));
const plan=ci.jobs.plan.steps.find(step=>step.id==='scope');
const temp=mkdtempSync(join(tmpdir(),'ci-main-plan-'));
try {
  const output=join(temp,'output');
  const full=spawnSync('bash',['-c',plan.run],{cwd:root,encoding:'utf8',env:{...process.env,
    EVENT_NAME:'push',BASE_SHA:'HEAD~1',HEAD_SHA:'HEAD',GITHUB_OUTPUT:output}});
  assert.equal(full.status,0,full.stderr);
  const matrix=JSON.parse(readFileSync(output,'utf8').trim().replace(/^matrix=/,''));
  assert.deepEqual(matrix.include.filter(row=>row.component==='brain-unit').map(row=>row.shard),[1,2,3,4,5,6]);
  assert.ok(matrix.include.some(row=>row.component==='brain-integration'));
  const expected=readdirSync(join(root,'packages/brain/scripts/fleet-worker')).filter(name=>name.endsWith('.test.sh')).sort();
  assert.ok(expected.length>0,'Fleet回归不能是空目录');
  const commands=commandsFor('brain-unit',1);
  for(const name of expected)assert.ok(commands.some(step=>step.command==='bash'&&
    step.args.includes(`packages/brain/scripts/fleet-worker/${name}`)),`${name}必须被实际runner选择`);
  const needs={plan:{result:'success'},security:{result:'success'},checks:{result:'failure'}};
  const gate=spawnSync(process.execPath,[join(root,'scripts/ci/check-basic-results.mjs')],{
    encoding:'utf8',env:{...process.env,NEEDS_JSON:JSON.stringify(needs)}});
  assert.notEqual(gate.status,0,'Fleet所属checks失败必须阻断');
  console.log(`PASS：main完整六片和runtime计划，${expected.length}份Fleet shell无孤儿，失败不放行`);
} finally {rmSync(temp,{recursive:true,force:true});}
NODE
