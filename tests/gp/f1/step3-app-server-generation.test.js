import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import runnerModule from '../../../packages/brain/scripts/fleet-worker/app-server-runner.cjs';
import profileModule from '../../../packages/brain/scripts/fleet-worker/app-server-profile.cjs';

it('F1造完真验：专用容器取消墓碑跨重启禁止迟到启动；默认没有启动能力', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'gp-appserver-'));
  const profile = { image: `sha256:${'a'.repeat(64)}`, cpus: 1, memoryBytes: 67108864,
    pidsLimit: 16, user: '1000:1000', tmpBytes: 1048576, network: 'none',
    homeKey: 'b'.repeat(64), workspaceKey: 'c'.repeat(64) };
  const identity = { reservation_id: randomUUID(), intent_id: randomUUID(), launch_generation: 1,
    machine_id: 'gp-node', worker_id: 'gp-worker', worker_boot_id: randomUUID(),
    profile: 'canary', home_key: profile.homeKey, config_digest: profileModule.profileDigest(profile) };
  identity.owner_key=profileModule.generationOwner(identity);
  let creates = 0;
  const config = { stateRoot: root, machineId: identity.machine_id, workerId: identity.worker_id,
    bootId: identity.worker_boot_id, assertLocalResources: async () => {},
    docker: { inspect: async () => null, create: async () => { creates++; throw Error('unexpected create'); } } };
  try {
    const disabled = runnerModule.createAppServerRunner(config);
    expect(disabled.capabilities().profiles).toEqual({});
    await expect(disabled.start(identity)).rejects.toThrow('appserver_profile_unavailable');
    const enabled = runnerModule.createAppServerRunner({ ...config, profiles: { canary: profile } });
    expect(await enabled.cancel({ ...identity, container_id: null, challenge: randomUUID() }))
      .toMatchObject({ absent: true, tombstoned: true, status: 'cleaned' });
    const restarted = runnerModule.createAppServerRunner({ ...config, bootId: randomUUID() });
    await expect(restarted.start(identity)).rejects.toThrow('appserver_launch_tombstoned');
    expect(creates).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it('F1受管实例：默认HOME配置与普通任务入口都不能制造app-server执行许可',async()=>{
 const [{createAppServerController},{routeWork},{APP_SERVER_AUTHORITY},{TICK_DISPATCH_EXCLUDED}]=await Promise.all([
  import('../../../packages/brain/src/app-server/controller.js'),import('../../../packages/brain/src/work-router.js'),
  import('../../../packages/brain/src/app-server/task-authority.js'),import('../../../packages/brain/src/lib/task-type-registry.js')]);
 let queries=0;const pool={query:async()=>{queries++;throw Error('unexpected database');}};
 await expect(createAppServerController({pool,env:{}}).ensure({home_id:'chat-test',request_key:randomUUID()})).rejects.toThrow('appserver_home_unconfigured');expect(queries).toBe(0);
 const request={source:'scheduler',source_id:'gp',title:'受管实例',requested_task_type:'app_server_run',declared_domain:'operations',mutation_intent:'write',metadata:{policy:'app-server-exclusive-v1'},task:{executor_kind:'app-server-controller'}};
 expect(()=>routeWork(request,[])).toThrow('appserver_task_authority_required');
 expect(routeWork(request,[],{appServerAuthority:APP_SERVER_AUTHORITY}).canonical_task_type).toBe('app_server_run');
 expect(TICK_DISPATCH_EXCLUDED).toContain('app_server_run');
});
