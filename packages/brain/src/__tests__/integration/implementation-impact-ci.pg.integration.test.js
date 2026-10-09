import { it,expect } from 'vitest';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync,spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createMapRouter } from '../../routes/map.js';
import { implementationImpactDatabase,IMPACT_REPO } from '../fixtures/implementation-impact-db.js';

it('实际Git共享代码→真实PG/HTTP两消费者影响报告→CLI执行同一测试清单并回读收据',async()=>{
  const root=mkdtempSync(join(tmpdir(),'impact-ci-chain-'));let fixture;
  try {
    const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
    git('init','-q');git('config','user.name','ci');git('config','user.email','ci@example.invalid');git('remote','add','origin',`https://github.com/${IMPACT_REPO}.git`);
    mkdirSync(join(root,'src'));mkdirSync(join(root,'scripts/smoke'),{recursive:true});
    writeFileSync(join(root,'src/shared-lock.js'),'module.exports=1;\n');
    writeFileSync(join(root,'src/controller.js'),"module.exports=require('./shared-lock.js');\n");
    const assertionRef='scripts/smoke/controller.sh';
    writeFileSync(join(root,assertionRef),"#!/bin/bash\nset -e\nnode -e \"if(require('./src/controller.js')!==2)process.exit(8)\"\nprintf verified > actual-output\n");
    git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
    writeFileSync(join(root,'src/shared-lock.js'),'module.exports=2;\n');git('add','.');git('commit','-qm','head');const head=git('rev-parse','HEAD');
    fixture=await implementationImpactDatabase({baseRevision:base,headRevision:head,assertionRef,
      readBinding:async binding=>git('show',`${binding.revision}:${binding.path}`)+'\n'});
    await fixture.advance();
    const app=express();app.use(express.json());app.use('/api/brain/map',createMapRouter({pool:fixture.db}));
    const response=await request(app).post('/api/brain/map/implementation-impact').send({scope:'phones',repo:IMPACT_REPO,base_revision:base,head_revision:head,changed_files:['src/shared-lock.js']});
    expect(response.status,response.body).toBe(200);expect(response.body.mapping_status,JSON.stringify(response.body.gaps)).toBe('verified');
    expect(response.body.affected_usages).toHaveLength(2);expect(response.body.required_assertions).toHaveLength(1);
    const controllerDigest='sha256:'+createHash('sha256').update(git('show',`${head}:src/controller.js`)+'\n').digest('hex');
    expect(response.body.affected_usages.every(usage=>usage.evidence.every(e=>e.implementation.digest===controllerDigest))).toBe(true);
    const input=join(root,'report.json'),output=join(root,'receipt.json');writeFileSync(input,JSON.stringify(response.body));
    const cli=fileURLToPath(new URL('../../../../../scripts/ci/implementation-gate.mjs',import.meta.url));
    const run=()=>spawnSync(process.execPath,[cli,'--repo-root',root,'--report',input,'--output',output],{encoding:'utf8'});
    const result=run();expect(result.status,result.stderr).toBe(0);
    const receipt=JSON.parse(readFileSync(output,'utf8'));expect(receipt.verdict).toBe('PASS');expect(receipt.source.head_revision).toBe(head);
    expect(readFileSync(join(root,'actual-output'),'utf8')).toBe('verified');
    expect(receipt.assertions.map(a=>a.assertion_ref)).toEqual(response.body.required_assertions.map(a=>a.assertion_ref));
    expect(receipt.assertions[0].source_bindings).toEqual(response.body.required_assertions[0].source_bindings);
    await fixture.db.query('DELETE FROM journey_step_links');
    const missing=await request(app).post('/api/brain/map/implementation-impact').send({scope:'phones',...response.body.source});
    expect(missing.body.mapping_status).toBe('unknown');writeFileSync(input,JSON.stringify(missing.body));expect(run().status).toBe(1);
  } finally {if(fixture)await fixture.close();rmSync(root,{recursive:true,force:true});}
});
