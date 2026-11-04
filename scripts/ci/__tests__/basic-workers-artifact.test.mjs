import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const require=createRequire(join(root,'apps/api/package.json')),ts=require('typescript');
const pkg=JSON.parse(readFileSync(join(root,'apps/api/package.json'),'utf8'));
assert.match(readFileSync(join(root,'apps/api/Dockerfile'),'utf8'),/COPY dist\/ \.\/dist\//);
for(const mode of ['real','missing','malformed','invalid-shape','empty']){
 test(`API真实standalone配置产物 ${mode}`,async t=>{
  const home=mkdtempSync(join(tmpdir(),'workers-artifact-')),app=join(home,'app'),dist=join(app,'dist');
  t.after(()=>rmSync(home,{recursive:true,force:true}));
  mkdirSync(join(dist,'workers'),{recursive:true});mkdirSync(join(app,'node_modules'),{recursive:true});
  writeFileSync(join(app,'package.json'),'{"type":"module"}');
  for(const dep of ['express','supertest'])symlinkSync(dirname(require.resolve(dep+'/package.json')),join(app,'node_modules',dep),'dir');
  for(const name of ['config','service','routes']){
   const source=readFileSync(join(root,`apps/api/src/workers/${name}.ts`),'utf8');
   const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
   writeFileSync(join(dist,'workers',name+'.js'),output);
  }
  if(pkg.scripts.build.includes('stage-workers-config.mjs')){
   const {stageWorkersConfig}=await import(pathToFileURL(join(root,'apps/api/scripts/stage-workers-config.mjs')));
   stageWorkersConfig(dist);
   assert.equal(readFileSync(join(dist,'data/workers/workers.config.json'),'utf8'),readFileSync(join(root,'packages/workflows/staff/workers.config.json'),'utf8'));
  }
  const config=join(dist,'data/workers/workers.config.json');
  if(mode==='missing')rmSync(config,{force:true});
  else if(mode!=='real'){
   mkdirSync(dirname(config),{recursive:true});
   writeFileSync(config,mode==='malformed'?'{':JSON.stringify(mode==='empty'?{version:'3.0.0',teams:[]}:{version:'3.0.0',teams:'invalid'}));
  }
  writeFileSync(join(app,'runner.mjs'),`import express from 'express';import request from 'supertest';import router from './dist/workers/routes.js';const app=express();app.use('/api/workers',router);const res=await request(app).get('/api/workers');process.stdout.write(JSON.stringify({status:res.status,body:res.body}));`);
  const out=JSON.parse(execFileSync(process.execPath,[join(app,'runner.mjs')],{cwd:app,encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']}));
  assert.equal(out.status,mode==='real'||mode==='empty'?200:503,JSON.stringify(out));
  assert.equal(out.body.success,mode==='real'||mode==='empty');
  if(mode==='real')assert.ok(out.body.data.totalWorkers>0);
  if(mode==='empty')assert.equal(out.body.data.totalWorkers,0);
 });
}
