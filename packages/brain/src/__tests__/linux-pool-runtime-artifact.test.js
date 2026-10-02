import { mkdtempSync,readFileSync,cpSync,mkdirSync,symlinkSync,rmSync,realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe,it,expect } from 'vitest';
const repo=fileURLToPath(new URL('../../../../',import.meta.url));

/** 按Dockerfile最后一阶段的本地COPY组装真实字节；依赖使用当前已安装生产依赖，不mock源码模块。 */
function runtimeArtifact(root){
 const text=readFileSync(path.join(repo,'packages/brain/Dockerfile'),'utf8');
 const stages=text.split(/^FROM .+$/m),runtime=stages.at(-1);let copied=0;
 for(const line of runtime.split('\n')){
  if(!/^COPY\s/.test(line)||/^COPY\s+--from=/.test(line))continue;
  const match=line.match(/^COPY\s+(\S+)\s+(\S+)\s*$/);if(!match)throw Error('unsupported_runtime_copy');
  const [,source,target]=match;
  if(!target.startsWith('./'))throw Error('unsupported_runtime_target');
  const from=path.join(repo,source),to=path.join(root,target);
  mkdirSync(path.dirname(to),{recursive:true});
  if(source.endsWith('/'))cpSync(from,to,{recursive:true});
  else {mkdirSync(to,{recursive:true});cpSync(from,path.join(to,path.basename(source)));}
  copied++;
 }
 if(copied<8)throw Error('runtime_layout_incomplete');
 symlinkSync(realpathSync(path.join(repo,'node_modules')),path.join(root,'node_modules'),'dir');
}

describe('linux-pool-runtime-artifact 实际发布工件',()=>{
it('实际Dockerfile布局可导入machines及完整Linux服务链；无部署配置仍启动HTTP且拒绝授权',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'linux-pool-runtime-'));
 try{
  runtimeArtifact(root);
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import express from 'express';
    const {default:router}=await import('./src/routes/machines.js');
    for(const name of ['linux-pool-profile','linux-pool-proof','linux-pool-server','linux-pool-installer','linux-pool-canary']) {
      assert.equal(typeof await import('./scripts/fleet-worker/'+name+'.cjs'),'object');
    }
    assert.equal(process.env.CECELIA_LINUX_POOL_DEPLOYMENTS_FILE,undefined);
    const app=express();app.use(express.json());app.use('/api/brain/machines',router);
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    try{
      const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/brain/machines/linux-pool/71d632df-252a-4991-ad6b-3647fbbea9f7/challenges',
        {method:'POST',headers:{Authorization:'Bearer artifact-internal-token','Content-Type':'application/json'},body:JSON.stringify({expected_version_id:null})});
      assert.equal(response.status,409);assert.equal((await response.json()).error,'linux_pool_deployment_unavailable');
      process.stdout.write('linux_pool_runtime_artifact_ok\\n');
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await (await import('./src/db.js')).default.end();}
  `],{cwd:root,encoding:'utf8',timeout:15000,maxBuffer:65536,env:{PATH:process.env.PATH,NODE_ENV:'test',CECELIA_INTERNAL_TOKEN:'artifact-internal-token',DB_HOST:'127.0.0.1',DB_PORT:'1',DB_NAME:'artifact_no_database',DB_USER:'artifact'}});
  expect(result.error?.message??null).toBeNull();
  expect(result.status,`runtime import stderr: ${result.stderr}`).toBe(0);
  expect(result.stdout).toContain('linux_pool_runtime_artifact_ok');
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);

});
