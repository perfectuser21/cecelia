import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import express from 'express';
import request from 'supertest';
import {releaseEvidenceDatabase} from '../fixtures/release-evidence-db.js';
import {registerCapabilityRegression} from '../../lib/capability-regressions.js';
import {exportImplementationSnapshot} from '../../lib/implementation-ci-snapshot.js';
import {createReleasesRouter} from '../../routes/releases.js';
import {runPilotReleaseVerification} from '../../../../../scripts/ci/pilot-release-verification.mjs';
it.each([false,true])('真实Git固定M→中央导出→全计划Bash→HTTP发布；含规范raw描述=%s',async(rawImplementationDescriptions)=>{
 const root=mkdtempSync(join(tmpdir(),'pilot-release-http-'));let f;
 try{
  const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();git('init','-q','-b','pilot-fixture');git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');git('remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
  mkdirSync(join(root,'scripts/smoke'),{recursive:true});mkdirSync(join(root,'src'));writeFileSync(join(root,'scripts/smoke/lock.sh'),'#!/bin/bash\nset -e\ntest -z "${CECELIA_INTERNAL_TOKEN:-}"\nprintf actual > regression-result\n');writeFileSync(join(root,'src/controller.js'),'export const controller=true;\n');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');writeFileSync(join(root,'unmapped-new-business.js'),'export const unknown = true;\n');git('add','.');git('commit','-qm','head');const head=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',head);
  f=await releaseEvidenceDatabase({rawImplementationDescriptions,fullActivityBindings:true,baseRevision:base,headRevision:head,scope:'zenithjoy',assertionRef:'scripts/smoke/lock.sh',readBinding:async b=>readFileSync(join(root,b.path),'utf8'),seedIds:{keyword:'b1000000-0000-4000-8000-000000000001',benchmark:'b1000000-0000-4000-8000-000000000002'}});
  for(const w of f.workflows)for(const ref of w.payload.activities){const a=f.activities.find(a=>a.id===ref.activity_version_id);for(const step of [null,...a.payload.steps.map(s=>s.step_id)])await registerCapabilityRegression(f.db,{capability_id:w.payload.capability_id,activity_id:a.activity_id,step_id:step,assertion_ref:'scripts/smoke/lock.sh'});}
  const snapshot=await exportImplementationSnapshot(f.db,{scope:'zenithjoy',repo:f.releaseInput.components[0].repo,revision:head});expect(snapshot.status,snapshot.gaps).toBe('verified');
  const {report,receipt}=await runPilotReleaseVerification({repoRoot:root,snapshot,outputDir:join(root,'output'),event:'push',ref:'refs/heads/main'});expect(readFileSync(join(root,'regression-result'),'utf8')).toBe('actual');expect(receipt.assertions).toHaveLength(1);expect(report.expected_usages).toHaveLength(32);
  const app=express();app.use(express.json({limit:'2mb'}));app.use('/releases',createReleasesRouter({pool:f.db}));
  const result=await request(app).post('/releases').send({...f.releaseInput,ci_evidence:[{report,receipt,evidence_ref:'fixture:real-cli'}]});expect(result.status,result.body).toBe(201);expect(result.body.release.payload.verification.status).toBe('verified');expect(result.body.release.payload.assertion_plans[0].assertion_plan_sha256).toBe(report.assertion_plan_sha256);expect(receipt.business_runtime_status).toBe('not_evaluated');
 }finally{await f?.close();rmSync(root,{recursive:true,force:true});}
});
