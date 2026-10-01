'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateLinuxPoolProfile, loadLinuxPoolProfile, renderLinuxUnits } = require('./linux-pool-profile.cjs');
const hk = '71d632df-252a-4991-ad6b-3647fbbea9f7';
const us = '1a379d80-ad36-47d3-88ba-e545ab299a54';
const profile = () => ({ schema_version: 1, machine_registry_id: hk, machine_id: 'vps-hk', role: 'worker',
  endpoint_host: '100.90.1.2', docker_host: 'unix:///var/run/docker.sock',
  pool: { cpu_cores: 0.5, memory_bytes: 536870912, pids_limit: 256 },
  canary_image: 'registry.example/cecelia-canary@sha256:' + 'a'.repeat(64) });

describe('Linux执行池可信部署合同', () => {
  it('分数CPU不抬高，固定执行池/数据目录且配置摘要覆盖全部受信参数', () => {
    const p = validateLinuxPoolProfile(profile());
    expect(p.pool.cpu_cores).toBe(0.5); expect(p.cgroup_parent).toBe('cecelia-workloads.slice');
    expect(p.data_root).toBe('/var/lib/cecelia/fleet-worker');
    expect(p.config_digest).toMatch(/^[a-f0-9]{64}$/);
    const changed=profile();changed.pool.memory_bytes*=2;
    expect(validateLinuxPoolProfile(changed).config_digest).not.toBe(p.config_digest);
    expect(Object.isFrozen(p.pool)).toBe(true);
  });
  it('零预算保留为不可执行，不能自动抬高最少槽数或生成可运行单元', () => {
    const input=profile();input.pool.cpu_cores=0;
    expect(validateLinuxPoolProfile(input).execution_budget_available).toBe(false);
    expect(()=>renderLinuxUnits(validateLinuxPoolProfile(input))).toThrow('linux_pool_budget_unavailable');
  });
  it('US稳定UUID和scheduler角色均硬拒执行，与可编辑machine名称无关', () => {
    for(const patch of [{machine_registry_id:us,machine_id:'innocent-worker'},{role:'scheduler'}]) {
      const p=validateLinuxPoolProfile({...profile(),...patch});
      expect(p.execution_budget_available).toBe(false);
      expect(()=>renderLinuxUnits(p)).toThrow('linux_scheduler_only');
    }
  });
  it.each([
    {endpoint_host:'0.0.0.0'}, {endpoint_host:'127.2.3.4'}, {endpoint_host:'0:0:0:0:0:0:0:0'}, {endpoint_host:'::ffff:127.0.0.1'}, {endpoint_host:'public.example'}, {docker_host:'tcp://other:2375'},
    {machine_id:['vps-hk']}, {machine_registry_id:[us]},
    {machine_id:'bad\nExecStart=/bin/sh'}, {machine_registry_id:'unknown'}, {role:'admin'},
    {canary_image:'node:latest'}, {command:'/bin/sh'}, {cgroup_parent:'production.slice'},
    {pool:{cpu_cores:-1,memory_bytes:536870912,pids_limit:256}},
    {pool:{cpu_cores:Infinity,memory_bytes:536870912,pids_limit:256}},
    {pool:{cpu_cores:0.5,memory_bytes:1.5,pids_limit:256}},
    {pool:{cpu_cores:0.5,memory_bytes:536870912,pids_limit:0}},
  ])('拒绝未知字段、可变镜像、任意Docker端点与无效资源：%j', patch => {
    expect(()=>validateLinuxPoolProfile({...profile(),...patch})).toThrow('linux_pool_profile_invalid');
  });
  it('systemd池与采集服务分开：限额作用于专属slice，服务不伪称工作负载池', () => {
    const units=renderLinuxUnits(validateLinuxPoolProfile(profile()));
    expect(units.slice).toContain('CPUQuota=50%');expect(units.slice).toContain('MemoryMax=536870912');
    expect(units.slice).toContain('TasksMax=256');
    expect(units.service).toContain('User=_cecelia');expect(units.service).toContain('NoNewPrivileges=yes');
    expect(units.service).toContain('ExecStart=/usr/local/libexec/cecelia/toolchain/bin/node /usr/local/libexec/cecelia/fleet-worker/linux-pool-server.cjs');
    expect(units.service).not.toContain('Slice=cecelia-workloads.slice');
    expect(units.service).not.toContain('Environment=');
    expect(units.service).toContain('CPUQuota=25%');
    expect(units.service).toContain('MemoryMax=268435456');
    expect(units.service).toContain('TasksMax=64');
    expect(units.service).toContain('StateDirectory=cecelia/fleet-worker');
  });
  it('只读可信0600配置，拒软链、宽权限、陌生属主和超长内容', () => {
    const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'linux-pool-profile-'));
    try {
      const file=path.join(dir,'profile.json');fs.writeFileSync(file,JSON.stringify(profile()),{mode:0o600});
      expect(loadLinuxPoolProfile(file).machine_registry_id).toBe(hk);
      const link=path.join(dir,'link');fs.symlinkSync(file,link);expect(()=>loadLinuxPoolProfile(link)).toThrow('linux_pool_profile_untrusted');
      fs.chmodSync(file,0o644);expect(()=>loadLinuxPoolProfile(file)).toThrow('linux_pool_profile_untrusted');
      fs.chmodSync(file,0o600);expect(()=>loadLinuxPoolProfile(file,{uid:999999})).toThrow('linux_pool_profile_untrusted');
      const originalRead=fs.readSync;
      const spy=vi.spyOn(fs,'readSync').mockImplementation((...args)=>{const result=originalRead(...args);fs.chmodSync(file,0o644);return result;});
      try {expect(()=>loadLinuxPoolProfile(file)).toThrow('linux_pool_profile_untrusted');} finally {spy.mockRestore();fs.chmodSync(file,0o600);}
      fs.writeFileSync(file,'x'.repeat(65537));expect(()=>loadLinuxPoolProfile(file)).toThrow('linux_pool_profile_untrusted');
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
});
