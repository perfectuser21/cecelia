import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {runPredecessorScenario} from './helpers/brain-deploy-predecessor.fixture.mjs';
function scenario(t,code){return runPredecessorScenario(t,'handoff-parent-survives',{prepare(f){
 fs.mkdirSync(f.repo+'/packages/brain/config',{recursive:true});fs.writeFileSync(f.repo+'/packages/brain/config/native-agent.json','{}');
 fs.mkdirSync(f.repo+'/packages/brain/scripts',{recursive:true});fs.writeFileSync(f.repo+'/packages/brain/scripts/native-agent-release.mjs',`console.log('NATIVE_AGENT_PUBLISHED');process.exit(${code});\n`);
}});}
test('原生执行包发布失败必须保留实际blue，不进入生产切换',t=>{
 const r=scenario(t,42);assert.equal(r.signal,null);assert.match(r.stdout,/STAGING_VERIFIED/);
 assert.equal(r.exit_code,42);assert.doesNotMatch(r.handoff_events,/sidecar-started|blue-removed/);
 assert.equal(r.status.status,'failed');
});
test('候选隔离验收后、启动green和切换blue前发布已验证原生执行包',t=>{
 const r=scenario(t,0);assert.equal(r.exit_code,75);assert.match(r.handoff_events,/sidecar-started/);
 const stage=r.stdout.indexOf('STAGING_VERIFIED'),native=r.stdout.indexOf('NATIVE_AGENT_PUBLISHED'),green=r.stdout.indexOf('起 green canary');
 assert.ok(stage>=0&&native>stage&&green>native,r.stdout);
});
