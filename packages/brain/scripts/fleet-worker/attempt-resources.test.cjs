'use strict';

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const POSTGRES_ID = 'a'.repeat(64);
const POSTGRES_IMAGE = `postgres:16-alpine@sha256:${'f'.repeat(64)}`;

function loadResourceManager() {
  const loaded = require('./attempt-resources.cjs');
  expect(loaded.createAttemptResourceManager).toBeTypeOf('function');
  return loaded.createAttemptResourceManager;
}

const NETWORK_ID = 'b'.repeat(64);
function observedResourceCommand(image = POSTGRES_IMAGE) {
  return async (_command, args) => {
    if (args[0] === 'inspect') return { stdout: JSON.stringify([{Id:POSTGRES_ID,Name:`/cecelia-pg-${ATTEMPT_ID}`,Image:`sha256:${'f'.repeat(64)}`,
      Config:{Image:image,Labels:{'cecelia.fleet.attempt_id':ATTEMPT_ID,'cecelia.fleet.resource':'postgres'}}}]) };
    if (args[0] === 'image') return {stdout:`sha256:${'f'.repeat(64)}`};
    if (args[0] === 'network' && args[1] === 'inspect') return {stdout:JSON.stringify([{Id:NETWORK_ID,Name:`cecelia-attempt-${ATTEMPT_ID}`,
      Labels:{'cecelia.fleet.attempt_id':ATTEMPT_ID,'cecelia.fleet.resource':'postgres'}}])};
    return {stdout:''};
  };
}

describe('Fleet Worker Attempt runtime resources', () => {
  it('creates a private network and healthy pinned PostgreSQL sidecar with ephemeral credentials', async () => {
    const createAttemptResourceManager = loadResourceManager();
    const calls = [];
    const runCommand = vi.fn(async (command, args) => {
      calls.push([command, args]);
      if (args[0] === 'exec') return { stdout: 'postgres:5432 - accepting connections' };
      if(args[0]==='network'&&args[1]==='create')return {stdout:NETWORK_ID};
      if(args[0]==='run')return {stdout:POSTGRES_ID};
      return observedResourceCommand()('docker',args);
    });
    const manager = createAttemptResourceManager({
      workerId: 'us-mac-m4',
      runCommand,
      postgresImageDigest: POSTGRES_IMAGE,
      randomBytesFn: () => Buffer.from('0123456789abcdef0123456789abcdef'),
      waitFn: vi.fn(async () => {}),
    });

    const provisioned = await manager.provision({
      role: 'generator',
      attemptId: ATTEMPT_ID,
      requirements: { postgres: true },
    });

    expect(calls[0]).toEqual([
      'docker',
      expect.arrayContaining([
        'network',
        'create',
        '--label',
        `cecelia.fleet.attempt_id=${ATTEMPT_ID}`,
      ]),
    ]);
    expect(calls[1]).toEqual([
      'docker',
      expect.arrayContaining([
        'run',
        '--detach',
        '--network-alias',
        'postgres',
        POSTGRES_IMAGE,
      ]),
    ]);
    expect(calls[2]).toEqual([
      'docker',
      expect.arrayContaining([
        'exec',
        '--',
        POSTGRES_ID,
        'pg_isready',
        '-U',
        '-d',
      ]),
    ]);
    expect(provisioned.networkName).toBe(`cecelia-attempt-${ATTEMPT_ID}`);
    expect(provisioned.environment.DB_URL).toMatch(
      /^postgresql:\/\/attempt_[a-f0-9]+:[a-f0-9]+@postgres:5432\/acceptance_[a-f0-9]+_scratch$/,
    );
    expect(provisioned.environment.DATABASE_URL).toBe(
      provisioned.environment.DB_URL,
    );
    expect(provisioned.environment).toMatchObject({
      DB_HOST: 'postgres',
      DB_PORT: '5432',
      DB_USER: expect.stringMatching(/^attempt_[a-f0-9]+$/),
      DB_PASSWORD: expect.stringMatching(/^[a-f0-9]+$/),
      DB_NAME: expect.stringMatching(/^acceptance_[a-f0-9]+_scratch$/),
    });
    expect(provisioned.runtime).toEqual({
      postgres: {
        container_id: POSTGRES_ID,
        network_id: NETWORK_ID,
        container_name: `cecelia-pg-${ATTEMPT_ID}`,
        network_name: `cecelia-attempt-${ATTEMPT_ID}`,
        image_digest: POSTGRES_IMAGE,
      },
    });
    expect(JSON.stringify(provisioned.runtime)).not.toContain(
      provisioned.environment.DB_URL,
    );
  });

  it('fails closed and removes owned partial resources when PostgreSQL never becomes healthy', async () => {
    const createAttemptResourceManager = loadResourceManager();
    const runCommand = vi.fn(async (_command, args) => {
      if (args[0] === 'exec') throw new Error('postgres not ready');
      if(args[0]==='network'&&args[1]==='create')return {stdout:NETWORK_ID};
      if(args[0]==='run')return {stdout:POSTGRES_ID};
      return observedResourceCommand()('docker',args);
    });
    const manager = createAttemptResourceManager({
      workerId: 'us-mac-m4',
      runCommand,
      postgresImageDigest: POSTGRES_IMAGE,
      randomBytesFn: () => Buffer.alloc(32, 7),
      waitFn: vi.fn(async () => {}),
      healthAttempts: 2,
    });

    await expect(manager.provision({
      role: 'generator',
      attemptId: ATTEMPT_ID,
      requirements: { postgres: true },
    })).rejects.toThrow('attempt_postgres_not_ready');

    expect(runCommand).toHaveBeenCalledWith('docker', [
      'rm',
      '-f',
      '--',
      POSTGRES_ID,
    ]);
    expect(runCommand).toHaveBeenCalledWith('docker', [
      'network',
      'rm',
      '--',
      NETWORK_ID,
    ]);
  });

  it('releases only deterministic resources owned by the exact Attempt', async () => {
    const createAttemptResourceManager = loadResourceManager();
    const runCommand = vi.fn(observedResourceCommand());
    const manager = createAttemptResourceManager({
      workerId: 'us-mac-m4',
      runCommand,
      postgresImageDigest: POSTGRES_IMAGE,
    });

    await expect(manager.release({
      attemptId: ATTEMPT_ID,
      runtime: {
        postgres: {
          container_name: `cecelia-pg-${ATTEMPT_ID}`,
          network_name: `cecelia-attempt-${ATTEMPT_ID}`,
          image_digest: POSTGRES_IMAGE,
        },
      },
    })).resolves.toEqual({ status: 'released' });

    expect(runCommand.mock.calls.filter(([,args])=>args.includes('rm'))).toEqual([
      ['docker', ['rm', '-f', '--', POSTGRES_ID]],
      ['docker', ['network', 'rm', '--', NETWORK_ID]],
    ]);
  });

  it('releases only the PostgreSQL service before callback commit and retains the active Runner network', async () => {
    const createAttemptResourceManager = loadResourceManager();
    const runCommand = vi.fn(observedResourceCommand());
    const manager = createAttemptResourceManager({
      workerId: 'us-mac-m4',
      runCommand,
      postgresImageDigest: POSTGRES_IMAGE,
    });

    await expect(manager.releaseService({
      attemptId: ATTEMPT_ID,
      runtime: {
        postgres: {
          container_name: `cecelia-pg-${ATTEMPT_ID}`,
          network_name: `cecelia-attempt-${ATTEMPT_ID}`,
          image_digest: POSTGRES_IMAGE,
        },
      },
    })).resolves.toEqual({ status: 'released' });

    expect(runCommand.mock.calls.filter(([,args])=>args.includes('rm'))).toEqual([
      ['docker', ['rm', '-f', '--', POSTGRES_ID]],
    ]);
    expect(JSON.stringify(runCommand.mock.calls)).not.toContain('network');
  });

  it('releases an exact historical Attempt after the configured pinned digest changes', async () => {
    const createAttemptResourceManager = loadResourceManager();
    const previousPinnedImage = `postgres:16-alpine@sha256:${'a'.repeat(64)}`;
    const runCommand = vi.fn(observedResourceCommand(previousPinnedImage));
    const manager = createAttemptResourceManager({
      workerId: 'us-mac-m4',
      runCommand,
      postgresImageDigest: POSTGRES_IMAGE,
    });

    await expect(manager.release({
      attemptId: ATTEMPT_ID,
      runtime: {
        postgres: {
          container_name: `cecelia-pg-${ATTEMPT_ID}`,
          network_name: `cecelia-attempt-${ATTEMPT_ID}`,
          image_digest: previousPinnedImage,
        },
      },
    })).resolves.toEqual({ status: 'released' });

    expect(runCommand.mock.calls.filter(([,args])=>args.includes('rm'))).toHaveLength(2);
  });

  it('treats explicit missing resources as idempotent but propagates real removal failures', async () => {
    const createAttemptResourceManager = loadResourceManager();
    const runtime = {
      postgres: {
        container_name: `cecelia-pg-${ATTEMPT_ID}`,
        network_name: `cecelia-attempt-${ATTEMPT_ID}`,
        image_digest: POSTGRES_IMAGE,
      },
    };
    const missingManager = createAttemptResourceManager({
      workerId: 'us-mac-m4',
      runCommand: vi.fn(async () => {
        throw new Error('Error response from daemon: No such container');
      }),
      postgresImageDigest: POSTGRES_IMAGE,
    });
    await expect(missingManager.release({
      attemptId: ATTEMPT_ID,
      runtime,
    })).resolves.toEqual({ status: 'released' });

    const deniedManager = createAttemptResourceManager({
      workerId: 'us-mac-m4',
      runCommand: vi.fn(async () => {
        throw new Error('permission denied while removing resource');
      }),
      postgresImageDigest: POSTGRES_IMAGE,
    });
    await expect(deniedManager.release({
      attemptId: ATTEMPT_ID,
      runtime,
    })).rejects.toThrow('attempt_runtime_resource_owner_mismatch');
  });

  it('reconciles only labelled deterministic orphan resources outside the retained set', async () => {
    const createAttemptResourceManager = loadResourceManager();
    const retainedAttemptId = '33333333-3333-4333-8333-333333333333';
    const foreignAttemptId = '44444444-4444-4444-8444-444444444444';
    const runCommand = vi.fn(async (_command, args) => {
      if (args[0] === 'ps') {
        return {
          stdout: [
            `${POSTGRES_ID}\tcecelia-pg-${ATTEMPT_ID}\t${ATTEMPT_ID}`,
            `${'c'.repeat(64)}\tcecelia-pg-${retainedAttemptId}\t${retainedAttemptId}`,
            `${'d'.repeat(64)}\toperator-postgres\t${foreignAttemptId}`,
          ].join('\n'),
        };
      }
      if (args[0] === 'network' && args[1] === 'ls') {
        return {
          stdout: [
            `${NETWORK_ID}\tcecelia-attempt-${ATTEMPT_ID}\t${ATTEMPT_ID}`,
            `${'e'.repeat(64)}\tcecelia-attempt-${retainedAttemptId}\t${retainedAttemptId}`,
          ].join('\n'),
        };
      }
      return observedResourceCommand()('docker',args);
    });
    const manager = createAttemptResourceManager({
      workerId: 'us-mac-m4',
      runCommand,
      postgresImageDigest: POSTGRES_IMAGE,
    });

    await expect(manager.reconcile({
      retainedAttemptIds: [retainedAttemptId],
    })).resolves.toEqual({ removed_attempts: [ATTEMPT_ID] });

    expect(runCommand).toHaveBeenCalledWith('docker', [
      'rm',
      '-f',
      '--',
      POSTGRES_ID,
    ]);
    expect(runCommand).toHaveBeenCalledWith('docker', [
      'network',
      'rm',
      '--',
      NETWORK_ID,
    ]);
    expect(JSON.stringify(runCommand.mock.calls)).not.toContain(
      `cecelia-pg-${retainedAttemptId}`,
    );
    expect(runCommand).not.toHaveBeenCalledWith('docker', [
      'rm',
      '-f',
      '--',
      'operator-postgres',
    ]);
  });
});
it('真实PG创建与旧sidecar限额更新均固定为预约内份额，未知Worker不得启动', async () => {
  const factory=loadResourceManager();const calls=[];
  const runCommand=async(file,args)=>{calls.push(args);
    if(args[0]==='inspect')return {stdout:JSON.stringify([{Id:POSTGRES_ID,Name:`/cecelia-pg-${ATTEMPT_ID}`,Image:`sha256:${'f'.repeat(64)}`,
      Config:{Image:POSTGRES_IMAGE,Labels:{'cecelia.fleet.attempt_id':ATTEMPT_ID,'cecelia.fleet.resource':'postgres'}}}])};
    if(args[0]==='image')return {stdout:`sha256:${'f'.repeat(64)}`};
    return {stdout:args[0]==='exec'?'accepting connections':POSTGRES_ID};};
  const manager=factory({workerId:'us-mac-m4',postgresImageDigest:POSTGRES_IMAGE,runCommand});
  const result=await manager.provision({attemptId:ATTEMPT_ID,role:'planner',requirements:{postgres:true},limits:{memoryBytes:-1}});
  await manager.enforceLimits({attemptId:ATTEMPT_ID,role:'planner',runtime:result.runtime});
  for(const verb of ['run','update']) {
    const args=calls.find(a=>a[0]===verb);
    for(const [flag,value] of [['--cpus','.25'],['--memory',String(256*1024**2)],['--memory-swap',String(256*1024**2)],['--pids-limit','32']]) {
      expect(Number(args[args.indexOf(flag)+1])).toBe(Number(value));
    }
  }
  const unavailable=factory({postgresImageDigest:POSTGRES_IMAGE,runCommand});
  await expect(unavailable.provision({attemptId:ATTEMPT_ID,role:'planner',requirements:{postgres:true}})).rejects.toThrow('attempt_resource_profile_unavailable');
});
describe('Postgres hard-limit update identity', () => {
  const id='a'.repeat(64), other='b'.repeat(64);
  const runtime=(containerId=id)=>({postgres:{container_name:`cecelia-pg-${ATTEMPT_ID}`,network_name:`cecelia-attempt-${ATTEMPT_ID}`,
    image_digest:POSTGRES_IMAGE,...(containerId?{container_id:containerId}:{})}});
  const observed=()=>({Id:id,Name:`/cecelia-pg-${ATTEMPT_ID}`,Image:`sha256:${'f'.repeat(64)}`,
    Config:{Image:POSTGRES_IMAGE,Labels:{'cecelia.fleet.attempt_id':ATTEMPT_ID,'cecelia.fleet.resource':'postgres'}}});
  it.each(['wrong-attempt','wrong-resource','wrong-image','replacement-id','wrong-name'])('%s rejects before any update',async scenario=>{
    const value=observed();
    if(scenario==='wrong-attempt')value.Config.Labels['cecelia.fleet.attempt_id']='33333333-3333-4333-8333-333333333333';
    if(scenario==='wrong-resource')value.Config.Labels['cecelia.fleet.resource']='other';
    if(scenario==='wrong-image')value.Config.Image=`sha256:${'c'.repeat(64)}`;
    if(scenario==='replacement-id')value.Id=other;
    if(scenario==='wrong-name')value.Name='/somebody-elses-postgres';
    const runCommand=vi.fn(async()=>({stdout:JSON.stringify([value])}));
    const manager=loadResourceManager()({workerId:'us-mac-m4',postgresImageDigest:POSTGRES_IMAGE,runCommand});
    await expect(manager.enforceLimits({attemptId:ATTEMPT_ID,role:'planner',runtime:runtime()})).rejects.toThrow('attempt_runtime_resource_owner_mismatch');
    expect(runCommand.mock.calls.some(([,args])=>args[0]==='update')).toBe(false);
  });
  it('legacy identity resolves without updating and then only the persisted full ID may be updated',async()=>{
    const runCommand=vi.fn(async(_file,args)=>({stdout:args[0]==='image'?`sha256:${'f'.repeat(64)}`:JSON.stringify([observed()])}));
    const manager=loadResourceManager()({workerId:'us-mac-m4',postgresImageDigest:POSTGRES_IMAGE,runCommand});
    expect(manager).toHaveProperty('resolveIdentity');
    const resolved=await manager.resolveIdentity({attemptId:ATTEMPT_ID,runtime:runtime(null)});
    expect(resolved.postgres.container_id).toBe(id);
    expect(runCommand.mock.calls.some(([,args])=>args[0]==='update')).toBe(false);
    await expect(manager.enforceLimits({attemptId:ATTEMPT_ID,role:'planner',runtime:runtime(null)})).rejects.toThrow('attempt_resource_identity_required');
    await manager.enforceLimits({attemptId:ATTEMPT_ID,role:'planner',runtime:resolved});
    const updates=runCommand.mock.calls.filter(([,args])=>args[0]==='update');
    expect(updates).toHaveLength(1);expect(updates[0][1].at(-1)).toBe(id);
  });
});
describe('Postgres cleanup observes ownership before side effects',()=>{
  it.each(['release','releaseService'])('%s 拒绝旧journal同名替换容器并且零删除',async entry=>{
    const runCommand=vi.fn(async()=>({stdout:JSON.stringify([{Id:POSTGRES_ID,Name:`/cecelia-pg-${ATTEMPT_ID}`,Config:{Image:POSTGRES_IMAGE,Labels:{'cecelia.fleet.attempt_id':'other','cecelia.fleet.resource':'postgres'}}}])}));
    const manager=loadResourceManager()({workerId:'us-mac-m4',postgresImageDigest:POSTGRES_IMAGE,runCommand});
    await expect(manager[entry]({attemptId:ATTEMPT_ID,runtime:{postgres:{container_name:`cecelia-pg-${ATTEMPT_ID}`,network_name:`cecelia-attempt-${ATTEMPT_ID}`,image_digest:POSTGRES_IMAGE}}})).rejects.toThrow('attempt_runtime_resource_owner_mismatch');
    expect(runCommand.mock.calls.some(([,args])=>args.includes('rm'))).toBe(false);
  });
});
it('release在任一删除前拒绝同名替换network',async()=>{
  const observed=observedResourceCommand();
  const runCommand=vi.fn(async(file,args)=>{
    const result=await observed(file,args);
    if(args[0]==='network'&&args[1]==='inspect'){
      const value=JSON.parse(result.stdout);value[0].Labels['cecelia.fleet.attempt_id']='other';return {stdout:JSON.stringify(value)};
    }
    return result;
  });
  const manager=loadResourceManager()({workerId:'us-mac-m4',postgresImageDigest:POSTGRES_IMAGE,runCommand});
  await expect(manager.release({attemptId:ATTEMPT_ID,runtime:{postgres:{container_name:`cecelia-pg-${ATTEMPT_ID}`,network_name:`cecelia-attempt-${ATTEMPT_ID}`,image_digest:POSTGRES_IMAGE}}})).rejects.toThrow('attempt_runtime_resource_owner_mismatch');
  expect(runCommand.mock.calls.some(([,args])=>args.includes('rm'))).toBe(false);
});
describe('missing observation never downgrades a bound PG identity',()=>{
  it.each(['release','releaseService'].flatMap(entry=>[false,true].map(restart=>({entry,restart}))))('第二次解析不认领同名替换对象，$entry 重启=$restart',async({entry,restart})=>{
    const original='a'.repeat(64),replacement='c'.repeat(64);
    const observed=observedResourceCommand();
    const runCommand=vi.fn(async(file,args)=>{
      if(args[0]==='inspect'){
        if(args.at(-1)===original)throw Error(`No such container: ${original}`);
        const result=await observed(file,args),value=JSON.parse(result.stdout);value[0].Id=replacement;return {stdout:JSON.stringify(value)};
      }
      return observed(file,args);
    });
    const factory=()=>loadResourceManager()({workerId:'us-mac-m4',postgresImageDigest:POSTGRES_IMAGE,runCommand});
    let manager=factory();
    const runtime=await manager.resolveIdentity({attemptId:ATTEMPT_ID,allowMissing:true,runtime:{postgres:{container_id:original,
      container_name:`cecelia-pg-${ATTEMPT_ID}`,network_name:`cecelia-attempt-${ATTEMPT_ID}`,image_digest:POSTGRES_IMAGE}}});
    if(restart)manager=factory();
    await manager[entry]({attemptId:ATTEMPT_ID,runtime:restart?JSON.parse(JSON.stringify(runtime)):runtime});
    expect(runCommand.mock.calls.some(([,args])=>args[0]==='rm')).toBe(false);
    expect(runtime.postgres.container_id).toBe(original);
    expect(runCommand.mock.calls.filter(([,args])=>args[0]==='inspect').every(([,args])=>args.at(-1)===original)).toBe(true);
  });
});
it('旧无ID记录已观察缺失后不再按名称认领，且仍拒绝启动配额更新',async()=>{
  const runCommand=vi.fn(async()=>{throw Error('No such container');});
  const manager=loadResourceManager()({workerId:'us-mac-m4',postgresImageDigest:POSTGRES_IMAGE,runCommand});
  const runtime=await manager.resolveIdentity({attemptId:ATTEMPT_ID,allowMissing:true,runtime:{postgres:{container_name:`cecelia-pg-${ATTEMPT_ID}`,network_name:`cecelia-attempt-${ATTEMPT_ID}`,image_digest:POSTGRES_IMAGE}}});
  runCommand.mockClear();
  await manager.releaseService({attemptId:ATTEMPT_ID,runtime:JSON.parse(JSON.stringify(runtime))});
  await expect(manager.resolveIdentity({attemptId:ATTEMPT_ID,runtime})).rejects.toThrow('attempt_runtime_resource_owner_mismatch');
  expect(runCommand).not.toHaveBeenCalled();
});
describe('每个孤儿或失败创建资源独立核验归属',()=>{
  it('仅network证明归属不能删除同名外来PG',async()=>{
    const observed=observedResourceCommand();
    const runCommand=vi.fn(async(file,args)=>{
      if(args[0]==='ps')return {stdout:''};
      if(args[0]==='network'&&args[1]==='ls')return {stdout:`${NETWORK_ID}\tcecelia-attempt-${ATTEMPT_ID}\t${ATTEMPT_ID}`};
      if(args[0]==='inspect')throw Error('foreign container must not be addressed');
      return observed(file,args);
    });
    const manager=loadResourceManager()({workerId:'us-mac-m4',postgresImageDigest:POSTGRES_IMAGE,runCommand});
    await manager.reconcile();
    expect(runCommand.mock.calls.filter(([,args])=>args.includes('rm'))).toEqual([['docker',['network','rm','--',NETWORK_ID]]]);
  });
  it.each(['response-lost','name-replaced'])('provision rollback %s 不按名字误删',async scenario=>{
    const observed=observedResourceCommand();
    const runCommand=vi.fn(async(file,args)=>{
      if(args[0]==='network'&&args[1]==='create')return {stdout:NETWORK_ID};
      if(args[0]==='run'){
        if(scenario==='response-lost')throw Error('run response lost');
        return {stdout:POSTGRES_ID};
      }
      if(args[0]==='exec')throw Error('not ready');
      if(args[0]==='inspect'){
        if(args.at(-1)===POSTGRES_ID)throw Error(`No such container: ${POSTGRES_ID}`);
        const result=await observed(file,args),value=JSON.parse(result.stdout);value[0].Id='c'.repeat(64);return {stdout:JSON.stringify(value)};
      }
      return observed(file,args);
    });
    const manager=loadResourceManager()({workerId:'us-mac-m4',postgresImageDigest:POSTGRES_IMAGE,runCommand,healthAttempts:1});
    await expect(manager.provision({attemptId:ATTEMPT_ID,role:'planner',requirements:{postgres:true}})).rejects.toThrow();
    expect(runCommand.mock.calls.some(([,args])=>args[0]==='rm')).toBe(false);
    expect(runCommand.mock.calls.filter(([,args])=>args.includes('rm')).every(([,args])=>/^[a-f0-9]{64}$/.test(args.at(-1)))).toBe(true);
  });
});

describe('Postgres实际启动维护暂停',()=>{
 it('创建network期间进入drain，禁止docker run且只清理本次准备资源',async()=>{
  let drain=false;const calls=[];const observed=observedResourceCommand();
  const manager=loadResourceManager()({workerId:'us-mac-m4',postgresImageDigest:POSTGRES_IMAGE,
   healthAttempts:1,healthIntervalMs:0,assertCanLaunch:()=>{if(drain)throw Error('worker_draining');},
   runCommand:async(command,args)=>{calls.push(args);
    if(args[0]==='network'&&args[1]==='create'){drain=true;return {stdout:NETWORK_ID};}
    return observed(command,args);
   }});
  await expect(manager.provision({attemptId:ATTEMPT_ID,role:'planner',requirements:{postgres:true}})).rejects.toThrow('worker_draining');
  expect(calls.some(a=>a[0]==='run')).toBe(false);
  expect(calls.filter(a=>a[0]==='network'&&a[1]==='rm')).toEqual([['network','rm','--',NETWORK_ID]]);
 });
});
