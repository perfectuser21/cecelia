'use strict';
// 专属随机资源验证真实 Harness adapter；不调用 provider、不挂宿主 HOME/凭据/socket。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createDockerAdapter } = require('./attempt-runner.cjs');
const { createAttemptResourceManager } = require('./attempt-resources.cjs');
const { resolveAttemptResourcePlan } = require('./attempt-resource-policy.cjs');
const run = promisify(execFile);
const attemptId = randomUUID(), runId = randomUUID();
const workerId = 'us-mac-m4', role = 'reviewer';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'attempt-limits-canary-'));
const workspace = path.join(root, 'workspace'), admin = path.join(root, 'admin'), runtime = path.join(root, 'runtime');
for (const dir of [root,workspace,admin,runtime]) { fs.mkdirSync(dir,{recursive:true}); fs.chmodSync(dir,0o777); }
const image = process.env.HARNESS_LIMITS_CANARY_IMAGE || 'sha256:aeaf290525a623a2182fdce5376ca914e9de2d0b1bab0ba18d7d07b9ea379033';
const postgresImageDigest = process.env.HARNESS_LIMITS_CANARY_POSTGRES_IMAGE || 'pgvector/pgvector:pg15@sha256:a20a57d7aa5217a6af0a391ccf69f4a8512406d6c14be08132f801468cc3cc62';
const command = (args, timeout=30000) => run('docker',args,{encoding:'utf8',timeout,maxBuffer:1024**2});
const program = 'const fs=require("fs");setInterval(()=>{if(fs.existsSync("/tmp/cecelia-prompts/oom-trigger")){const blocks=[];for(;;)blocks.push(Buffer.alloc(64*1024*1024,1));}},100);';
const runCommand = async (file,args) => {
  // 保留真实 adapter 的全部资源参数；仅测试程序替代模型入口，专属网络禁外连。
  if(file === 'docker' && args[0] === 'create') args=[args[0],'--entrypoint','node',...args.slice(1),'-e',program];
  if(file === 'docker' && args[0] === 'network' && args[1] === 'create') args=[...args.slice(0,2),'--internal',...args.slice(2)];
  return run(file,args,{encoding:'utf8',timeout:30000,maxBuffer:1024**2});
};
const docker = createDockerAdapter({workerId,runtimeRoot:runtime,runCommand});
const manager = createAttemptResourceManager({workerId,postgresImageDigest,runCommand,healthAttempts:30});
let runnerId, postgresId, resources;
const inspect = async id => JSON.parse((await command(['inspect',id])).stdout)[0];
function checkLimits(container, limits) {
  assert.equal(container.HostConfig.NanoCpus, limits.cpus*1e9);
  assert.equal(container.HostConfig.Memory, limits.memoryBytes);
  assert.equal(container.HostConfig.MemorySwap, limits.memoryBytes);
  assert.equal(container.HostConfig.PidsLimit, limits.pidsLimit);
}
async function main() {
  resources = await manager.provision({attemptId,role,requirements:{postgres:true}});
  postgresId = (await inspect(resources.runtime.postgres.container_name)).Id;
  const prepared = await docker.prepare({attemptId,runId,workerId,image,role,model:'canary',taskId:randomUUID(),timeoutSeconds:30,
    providerSpec:{provider:'claude',stdin:'{}'},roleEnv:{},labels:{'cecelia.fleet.attempt_id':attemptId,'cecelia.fleet.worker_id':workerId,'cecelia.fleet.run_id':runId},
    callback:{url:'http://127.0.0.1:5221/api/brain/callback',token:'offline-canary'},lease:{owner:'canary',generation:1},
    workspaceMount:{source:workspace,target:'/workspace',readOnly:true},workspaceAdminMount:{source:admin,target:admin,readOnly:true},
    runtimeNetwork:resources.networkName,runtimeEnvironment:{}});
  runnerId=prepared.containerId;
  await manager.enforceLimits({attemptId,role,runtime:resources.runtime});
  await docker.start({...prepared,attemptId,role,runId,image,hasPostgres:true});
  const plan=resolveAttemptResourcePlan({workerId,role,postgres:true});
  const [runner,pg]=await Promise.all([inspect(runnerId),inspect(postgresId)]);
  checkLimits(runner,plan.runner);checkLimits(pg,plan.postgres);
  assert.equal(runner.State.Running,true);assert.equal(pg.State.Running,true);
  for(const [key,field] of [['cpus','NanoCpus'],['memoryBytes','Memory'],['pidsLimit','PidsLimit']]) {
    assert.equal(runner.HostConfig[field]+pg.HostConfig[field],plan.total[key]*(key==='cpus'?1e9:1));
  }
  fs.writeFileSync(path.join(runtime,attemptId,'oom-trigger'),'canary');
  const exit = (await command(['wait',runnerId],45000)).stdout.trim();
  const stopped=await inspect(runnerId);
  assert.equal(exit,'137'); assert.equal(stopped.State.OOMKilled,true);
  assert.equal((await inspect(postgresId)).State.Running,true);
  assert.match((await command(['exec',postgresId,'pg_isready'])).stdout,/accepting connections/);
  console.log(JSON.stringify({result:'PASS',attempt_id:attemptId,runner_id:runnerId,postgres_id:postgresId,
    image,postgres_image:postgresImageDigest,plan,oom_isolated:true,postgres_healthy:true,model_calls:0}));
}
async function cleanup() {
  // 只清理由本次随机 attempt 标签证明归属的精确容器ID。
  for (const name of [`cecelia-fleet-${attemptId}`,`cecelia-pg-${attemptId}`]) {
    let value; try {value=await inspect(name);} catch(error){if(/No such (object|container)/.test(error.stderr||''))continue;throw error;}
    assert.equal(value.Config.Labels['cecelia.fleet.attempt_id'],attemptId);
    await command(['rm','-f','--',value.Id]);
  }
  const network=`cecelia-attempt-${attemptId}`;
  let value;try{value=JSON.parse((await command(['network','inspect',network])).stdout)[0];}catch(error){if(!/not found|No such/.test(error.stderr||''))throw error;}
  if(value){assert.equal(value.Labels['cecelia.fleet.attempt_id'],attemptId);await command(['network','rm',value.Id]);}
  fs.rmSync(root,{recursive:true,force:true});
}
main().catch(error=>{console.error(`attempt_limits_canary_failed:${error.code||error.name}`);process.exitCode=1;})
  .finally(()=>cleanup().catch(()=>{console.error('attempt_limits_canary_cleanup_failed');process.exitCode=1;}));
