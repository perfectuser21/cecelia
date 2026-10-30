#!/usr/bin/env bash
# 源码CI只读验证；合并权限与外部PAT不属于最低CI，失败结果不能被绿色日志掩盖。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
node --input-type=module - "$REPO_ROOT" <<'NODE'
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const root=process.argv[2],require=createRequire(join(root,'package.json'));
const workflow=require('js-yaml').load(readFileSync(join(root,'.github/workflows/ci.yml'),'utf8'));
assert.equal(workflow.permissions.contents,'read');
for(const permission of [workflow.permissions,...Object.values(workflow.jobs).map(job=>job.permissions).filter(Boolean)]) {
  assert.equal(typeof permission,'object','权限必须明确声明为只读');
  assert.ok(Object.values(permission).every(value=>value==='read'||value==='none'),'源码CI不能申请写权限');
}
assert.equal(workflow.jobs['auto-merge'],undefined);
const definition=JSON.stringify(workflow);
for(const [,secret] of definition.matchAll(/secrets\.([A-Z0-9_]+)/g))
  assert.equal(secret,'GITHUB_TOKEN','源码CI不能依赖外部PAT或生产凭据');
assert.doesNotMatch(definition,/gh\s+pr\s+merge|github\.rest\.pulls\.merge/);
const summary=join(root,'scripts/ci/check-basic-results.mjs');
const good={plan:{result:'success'},security:{result:'success'},checks:{result:'success'}};
function result(needs) {
  return spawnSync(process.execPath,[summary],{encoding:'utf8',env:{...process.env,NEEDS_JSON:JSON.stringify(needs)}});
}
assert.equal(result(good).status,0,'真实汇总入口应允许完整成功');
for(const job of Object.keys(good))for(const status of ['failure','cancelled','skipped','unknown','']) {
  assert.notEqual(result({...good,[job]:{result:status}}).status,0,`${job}=${status}不能放行`);
}
console.log('PASS：源码CI只读、无外部PAT依赖，真实汇总拒绝失败/取消/漏跑');
NODE
