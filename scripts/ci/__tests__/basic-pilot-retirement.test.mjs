import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {commandsFor} from '../run-basic-check.mjs';
const root=new URL('../../../',import.meta.url);
test('Pilot HEAD工作流已退役，发布CLI与报告验证仍保留',()=>{
 assert.equal(existsSync(new URL('.github/workflows/pilot-release-verification.yml',root)),false);
 for(const path of ['scripts/ci/pilot-release-verification.mjs','packages/brain/src/lib/pilot-release-verification.js','packages/brain/src/lib/release-index.js'])assert.ok(existsSync(new URL(path,root)),path);
 assert.ok(commandsFor('scripts').some(step=>step.args.includes('scripts/ci/__tests__/basic-pilot-retirement.test.mjs')));
});
test('历史Pilot固定Git对象自包含可读，篡改commit/tree/blob均拒绝',async()=>{
 const {createPublishedPilotGit,readPilotGitFixture,PILOT_REVISION,PILOT_BLOB}=await import('./fixtures/pilot-published-git.mjs');
 const f=createPublishedPilotGit();
 try {
  assert.equal(f.git('rev-parse',PILOT_REVISION+':.github/workflows/pilot-release-verification.yml').toString().trim(),PILOT_BLOB);
  const yaml=f.read().toString();assert.match(yaml,/name: Pilot release verification/);assert.match(yaml,/workflow_call:/);
  assert.equal(existsSync(new URL('.github/workflows/pilot-release-verification.yml',root)),false);
  assert.throws(()=>f.git('remote','get-url','origin'));
 } finally {f.close();}
 for(const type of ['commit','tree','blob']){
  const data=readPilotGitFixture();data.objects.find(o=>o.type===type).content_base64=Buffer.from('forged').toString('base64');
  assert.throws(()=>createPublishedPilotGit({data}));
 }
});
