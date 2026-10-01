'use strict';
const {collectLinuxPoolProof}=require('./linux-pool-proof.cjs');
const {validateLinuxPoolProfile}=require('./linux-pool-profile.cjs');
const id='a'.repeat(64), imageId='sha256:'+'b'.repeat(64);
const cg='/cecelia.slice/cecelia-workloads.slice';
const member=cg+'/docker-'+id+'.scope';
function fixture() {
  const profile=validateLinuxPoolProfile({schema_version:1,machine_registry_id:'71d632df-252a-4991-ad6b-3647fbbea9f7',
    machine_id:'vps-hk',role:'worker',endpoint_host:'100.90.1.2',docker_host:'unix:///var/run/docker.sock',
    pool:{cpu_cores:0.5,memory_bytes:536870912,pids_limit:256},canary_image:'test/canary@sha256:'+'c'.repeat(64)});
  const expected={container_id:id,name:'cecelia-pool-canary-test',labels:{'cecelia.pool.nonce':'d'.repeat(64)}};
  const container={Id:id,Name:'/'+expected.name,Image:imageId,Config:{Image:profile.canary_image,User:'65534:65534',Labels:expected.labels},
    Mounts:[],State:{Running:true,Pid:2314},HostConfig:{CgroupParent:profile.cgroup_parent,Privileged:false,ReadonlyRootfs:true,
      NetworkMode:'none',CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],Binds:[],Devices:[],DeviceRequests:[],
      NanoCpus:250000000,Memory:134217728,MemorySwap:134217728,PidsLimit:32}};
  const files={
    '/proc/sys/kernel/random/boot_id':'1347658b-2aa4-4b38-91c0-a7b85531b918\n',
    '/proc/2314/cgroup':'0::'+member+'\n', '/proc/2314/stat':'2314 (node) S '+Array(18).fill('1').join(' ')+' 123456 0\n',
    '/proc/self/mountinfo':'30 20 0:28 / /sys/fs/cgroup rw - cgroup2 cgroup rw\n',
    '/proc/meminfo':'MemTotal: 8388608 kB\nMemAvailable: 6291456 kB\n',
    '/sys/devices/system/cpu/online':'0-3\n',
  };
  for(const dir of [cg,'/cecelia.slice']) {
    Object.assign(files,{['/sys/fs/cgroup'+dir+'/cpu.max']:dir===cg?'50000 100000':'max 100000',
      ['/sys/fs/cgroup'+dir+'/memory.max']:dir===cg?'536870912':'max',
      ['/sys/fs/cgroup'+dir+'/memory.current']:'104857600',
      ['/sys/fs/cgroup'+dir+'/memory.high']:'max',
      ['/sys/fs/cgroup'+dir+'/memory.swap.max']:'0',
      ['/sys/fs/cgroup'+dir+'/memory.events']:'oom 0\noom_kill 0\n',
      ['/sys/fs/cgroup'+dir+'/cpuset.cpus.effective']:'0-3',
      ['/sys/fs/cgroup'+dir+'/pids.max']:dir===cg?'256':'max',
      ['/sys/fs/cgroup'+dir+'/pids.current']:'4'});
  }
  const calls=[];
  const deps={getuid:()=>0,readText:async filename=>{if(!(filename in files))throw Object.assign(Error(),{code:'ENOENT'});return files[filename];},
    readlink:async p=>p==='/proc/1/exe'?'/usr/lib/systemd/systemd':'cgroup:[4026531835]',
    statfs:async()=>({bsize:4096n,blocks:10000000n,bfree:8000000n,bavail:7000000n}),
    runCommand:async(command,args)=>{
      calls.push({command,args});
      if(command==='/usr/bin/systemd-detect-virt')throw Object.assign(Error(),{code:1,stdout:'none\n'});
      if(command==='/usr/bin/systemctl')return {stdout:cg+'\n'};
      if(args[0]==='info')return {stdout:JSON.stringify({ID:'daemon-hk',CgroupDriver:'systemd',CgroupVersion:'2',DockerRootDir:'/var/lib/docker'})};
      if(args[0]==='image')return {stdout:imageId+'\n'};
      if(args[0]==='inspect')return {stdout:JSON.stringify([container])};
      throw Error('unexpected command');
    }};
  return {profile,expected,container,files,deps,calls};
}
describe('Linux真实执行池证明',()=>{
  it('采集容器宿主PID及真实父slice，保留分数CPU并扣除父池已用内存',async()=>{
    const f=fixture(); const proof=await collectLinuxPoolProof(f);
    expect(proof).toMatchObject({schema_version:'linux-pool-proof/v1',pool_verified:true,execution:false,
      container_id:id,cgroup_parent_path:cg,daemon_id:'daemon-hk',cpu_cores:0.5,
      memory_limit_bytes:536870912,memory_available_bytes:432013312,pids_limit:256,pids_available:252});
    expect(f.calls.every(c=>['/usr/bin/docker','/usr/bin/systemctl','/usr/bin/systemd-detect-virt'].includes(c.command))).toBe(true);
  });
  it.each([
    ['假同名容器',f=>{f.container.Id='f'.repeat(64);}],
    ['镜像被替换',f=>{f.container.Image='sha256:'+'f'.repeat(64);}],
    ['声明父池与实际PID不同',f=>{f.files['/proc/2314/cgroup']='0::/system.slice/docker-'+id+'.scope\n';}],
    ['未设置父池',f=>{f.container.HostConfig.CgroupParent='';}],
    ['privileged容器',f=>{f.container.HostConfig.Privileged=true;}],
    ['宿主挂载',f=>{f.container.Mounts=[{Source:'/var/run/docker.sock'}];}],
    ['缺少内存硬限',f=>{f.container.HostConfig.Memory=0;}],
    ['伪造root namespace',f=>{f.deps.readlink=async p=>p.includes('/1/')?'cgroup:[1]':'cgroup:[2]';}],
    ['非root可信验收入口',f=>{f.deps.getuid=()=>501;}],
    ['父池无限内存',f=>{f.files['/sys/fs/cgroup'+cg+'/memory.max']='max';}],
    ['PID上限未限制',f=>{f.files['/sys/fs/cgroup'+cg+'/pids.max']='max';}],
    ['池允许额外swap',f=>{f.files['/sys/fs/cgroup'+cg+'/memory.swap.max']='max';}],
    ['容器中systemd冒充完整宿主',f=>{const run=f.deps.runCommand;f.deps.runCommand=(c,a)=>c==='/usr/bin/systemd-detect-virt'?Promise.resolve({stdout:'lxc\n'}):run(c,a);}],
    ['PID1不是systemd',f=>{const readlink=f.deps.readlink;f.deps.readlink=p=>p==='/proc/1/exe'?Promise.resolve('/usr/bin/node'):readlink(p);}],
    ['未知状态',f=>{f.container.State.Running=false;}],
  ])('%s保守拒绝',async(_name,modify)=>{
    const f=fixture();modify(f);await expect(collectLinuxPoolProof(f)).rejects.toThrow('linux_pool_proof_unavailable');
  });
  it('宿主重启或容器PID复用发生在采集期间，不能输出旧证明',async()=>{
    for(const filename of ['/proc/sys/kernel/random/boot_id','/proc/2314/stat']) {
      const f=fixture(),read=f.deps.readText;let reads=0;
      f.deps.readText=async path=>path===filename&&++reads>1?'changed':read(path);
      await expect(collectLinuxPoolProof(f)).rejects.toThrow('linux_pool_proof_unavailable');
    }
  });
  it('祖先收紧额度时有效池预算下降，不把父机4核当0.5核池',async()=>{
    const f=fixture();f.files['/sys/fs/cgroup/cecelia.slice/cpu.max']='25000 100000';
    f.files['/sys/fs/cgroup/cecelia.slice/memory.max']='268435456';
    f.files['/sys/fs/cgroup/cecelia.slice/pids.max']='64';
    const proof=await collectLinuxPoolProof(f);
    expect(proof.cpu_cores).toBe(0.25);expect(proof.memory_limit_bytes).toBe(268435456);
    expect(proof.memory_available_bytes).toBe(163577856);expect(proof.pids_limit).toBe(64);
  });
});
