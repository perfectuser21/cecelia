import {it,expect} from 'vitest';
import express from 'express';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {nativeMaintenanceDatabase} from '../fixtures/workflow-assembly-native-db.test.js';
import {runNativeReconcile} from '../../lib/workflow-assembly-native.js';
import {nativeSpec as spec,prepareNativeSource} from '../../lib/workflow-assembly-native-source.js';
import {registerNativeReconcile} from '../../lib/workflow-assembly-native-registration.js';
import {readCapabilitySystem} from '../../lib/capability-system.js';
import {listSystemRuns,readSystemRunEvidence} from '../../lib/capability-system-evidence.js';
it.runIf(process.env.META_NATIVE_BROWSER==='1')('真实native目录只读浏览器fixture：旧run保持固定版本',async()=>{
  if(process.env.DB_NAME!=='cecelia_scratch'||process.env.DB_HOST!=='/tmp')throw Error('actual_scratch_required');
  const git=args=>execFileSync('git',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
  expect(git(['status','--porcelain=v1','--untracked-files=no'])).toBe('');
  const head=git(['rev-parse','HEAD']),f=await nativeMaintenanceDatabase();let server;
  try{
    for(const table of ['areas','enabler_calls','journey_features'])await f.pool.query(`CREATE TABLE ${table}(LIKE public.${table} INCLUDING ALL)`);
    const readSource=async(revision,path)=>execFileSync('git',['show',`${revision}:${path}`],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
    const first=await runNativeReconcile(f.pool,{request_key:'browser-fixed-history',trigger:'manual'},{revision:head,readSource});
    // 同一固定tree的本地Git模型模拟下一次部署；不更新任何工作树/分支/远程ref。
    const next=execFileSync('git',['commit-tree',git(['rev-parse','HEAD^{tree}']),'-p',head],{input:'test: native historical browser model\n',encoding:'utf8'}).trim();
    const current=await registerNativeReconcile(f.pool,await prepareNativeSource({revision:next,readFile:readSource}));
    const app=express();
    const read=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(e){res.status(500).json({error:e.code??e.message});}};
    app.get('/api/brain/map/registry',read(()=>readCapabilitySystem(f.pool)));
    app.get('/api/brain/map/runs',read(req=>listSystemRuns(f.pool,{workflowId:req.query.workflow_id,limit:20,offset:0})));
    app.get('/api/brain/map/runs/:id/evidence',read(req=>readSystemRunEvidence(f.pool,req.params.id)));
    app.get('/api/brain/map/releases',(_req,res)=>res.json({releases:[],total:0,limit:20,offset:0}));
    server=await new Promise(resolve=>{const s=app.listen(Number(process.env.META_NATIVE_PREVIEW_PORT??15286),'127.0.0.1',()=>resolve(s));});
    const manifest={code_head:head,port:server.address().port,schema:f.schema,workflow_id:spec.id,activity_id:spec.activities[0].id,
      run_id:first.native_run_id,run_definition_version_id:first.run.detail.workflow_definition_version_id,current_definition_version_id:current.workflow_definition_version_id,
      fixed_source:'actual-local-Git-HEAD; next-version=unpublished-same-tree-model',execution:'actual-native-code-no-agent',scope:'scratch-private-schema',read_only_http:true};
    writeFileSync('/tmp/meta-workflow-native-browser-manifest.json',JSON.stringify(manifest,null,2));process.stdout.write(JSON.stringify(manifest)+'\n');
    await new Promise(resolve=>{for(const signal of ['SIGINT','SIGTERM','SIGUSR2'])process.once(signal,resolve);});
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await f.close();}
},900000);
