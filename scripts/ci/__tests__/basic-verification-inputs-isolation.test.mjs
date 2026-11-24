import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixedInputFixture} from './fixtures/verification-input-git.mjs';

test('共享fixed Git输入事实不依赖已退休factory工作树profile，仍拒绝伪造',async t=>{
 const api=await import('../implementation-verification-inputs.mjs');
 const f=fixedInputFixture(t);
 const row=api.readVerificationInputFacts(f.root,{source:f.source,side:'head',path:f.path});
 assert.equal(row.source.revision,f.source.head_revision);
 assert.equal(row.git_blob_sha1,f.git('rev-parse','HEAD:'+f.path));
 assert.equal(row.entry_verified,false);assert.equal(row.owner_verified,false);
 assert.deepEqual(api.verifyVerificationInputFacts(f.root,{source:f.source,row}),row);
 assert.throws(()=>api.verifyVerificationInputFacts(f.root,{source:f.source,row:{...row,sha256:'0'.repeat(64)}}),/VERIFICATION_INPUT_FACTS_MISMATCH/);
});
test('未知CI只提供真实Git事实，不因移除历史factory cohort而自动获得输入资格',async t=>{
 const api=await import('../implementation-verification-inputs.mjs');
 const f=fixedInputFixture(t),workflow='.github/workflows/ci.yml';
 mkdirSync(join(f.root,'.github/workflows'),{recursive:true});
 writeFileSync(join(f.root,workflow),'name: unknown workflow\non: push\njobs: {}\n');
 f.git('add','.');f.git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','test: unknown fixed CI');
 f.source.head_revision=f.git('rev-parse','HEAD');
 f.source.changed_files=f.git('diff','--name-only',f.source.base_revision,f.source.head_revision).split('\n').filter(Boolean).map(path=>({path}));
 const proof=api.collectVerificationInputEvidence(f.root,{source:f.source});
 assert.deepEqual(proof.rows,[]);
 assert.ok(proof.unproven.some(row=>row.path===f.path&&row.side==='head'&&row.reason==='entry_unproven'));
 assert.equal(proof.native_owner_authorized,false);assert.equal(proof.execution_status,'not_evaluated');
});
