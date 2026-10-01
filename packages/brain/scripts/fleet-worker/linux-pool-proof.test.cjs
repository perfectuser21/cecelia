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
    readlink:async p=>p==='/proc/1/exe'?'/usr/lib/systemd/systemd':p.split('/').at(-1)+':[4026531835]',
    statfs:async()=>({type:0x63677270n,bsize:4096n,blocks:10000000n,bfree:8000000n,bavail:7000000n}),
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
    ['宿主PID namespace不匹配',f=>{const link=f.deps.readlink;f.deps.readlink=p=>p==='/proc/self/ns/pid'?Promise.resolve('pid:[9999]'):link(p);}],
    ['宿主挂载namespace不匹配',f=>{const link=f.deps.readlink;f.deps.readlink=p=>p==='/proc/self/ns/mnt'?Promise.resolve('mnt:[9999]'):link(p);}],
    ['cgroup祖先被tmpfs覆盖',f=>{f.files['/proc/self/mountinfo']+='31 30 0:29 / /sys/fs/cgroup/cecelia.slice rw - tmpfs tmpfs rw\n';}],
    ['实际文件系统不是cgroup2',f=>{f.deps.statfs=async()=>({type:0x1021994n,bsize:4096n,blocks:10000n,bfree:8000n,bavail:7000n});}],
    ['追加CAP_SYS_ADMIN',f=>{f.container.HostConfig.CapAdd=['SYS_ADMIN'];}],
    ['宿主PID共享',f=>{f.container.HostConfig.PidMode='host';}],
    ['宿主IPC共享',f=>{f.container.HostConfig.IpcMode='host';}],
    ['宿主UTS共享',f=>{f.container.HostConfig.UTSMode='host';}],
    ['关闭seccomp',f=>{f.container.HostConfig.SecurityOpt.push('seccomp=unconfined');}],
    ['关闭apparmor',f=>{f.container.HostConfig.SecurityOpt.push('apparmor=unconfined');}],
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
  it('祖先在采集中收紧CPU/内存/cpuset/PID任一限制则拒绝旧证明',async()=>{
    for(const [file,value] of [['cpu.max','10000 100000'],['memory.max','134217728'],['cpuset.cpus.effective','0'],['pids.max','8']]) {
      const f=fixture(),read=f.deps.readText;
      f.files['/sys/fs/cgroup/cecelia.slice/pids.max']='128';
      f.deps.readText=async filename=>{
        const text=await read(filename);
        if(filename==='/sys/fs/cgroup/cecelia.slice/pids.current')f.files['/sys/fs/cgroup/cecelia.slice/'+file]=value;
        return text;
      };
      await expect(collectLinuxPoolProof(f)).rejects.toThrow('linux_pool_proof_unavailable');
    }
  });
  it('Docker daemon在采集期间更换时拒绝旧端点证明',async()=>{
    const f=fixture(),run=f.deps.runCommand;let reads=0;
    f.deps.runCommand=async(c,a)=>{
      const result=await run(c,a);
      if(a[0]==='info'&&++reads>1){const info=JSON.parse(result.stdout);info.ID='replacement';return {stdout:JSON.stringify(info)};}
      return result;
    };
    await expect(collectLinuxPoolProof(f)).rejects.toThrow('linux_pool_proof_unavailable');
  });
});

describe('受管脚本真实容器证明',()=>{
  function scriptFixture(){
    const f=fixture();
    const scriptProfile={image:'test/script@sha256:'+'e'.repeat(64),cpus:0.25,memoryBytes:134217728,pidsLimit:32,
      logMaxSizeBytes:65536,logMaxFiles:2,user:'10001:10001',cwd:'/workspace'};
    const identity={reservation_id:'657e2e9a-c0bb-47df-a282-a1b2ff8b2ff2',intent_id:'7a57c0d2-9ef8-4ab9-b4a4-87a3562037e9',launch_generation:2,
      machine_id:f.profile.machine_id,owner_key:'script-309836c1-08cd-4eb7-827d-1c3c09b30135-a1',config_digest:'f'.repeat(64),
      worker_id:f.profile.machine_id,worker_boot_id:'55daf575-0078-450c-93cb-1eddb688c32f',
      execution_version_id:'c451ee88-fd1c-4197-b3aa-70b5f0633237',execution_grant_id:'e6024b1e-8ae8-4520-a7dd-d9f35b0398f0',profile_id:'readonly-report'};
    const name=`cecelia-script-${identity.reservation_id}-g${identity.launch_generation}`;
    f.container.Name='/'+name;f.container.Config.Image=scriptProfile.image;f.container.Config.User=scriptProfile.user;
    f.container.Config.WorkingDir=scriptProfile.cwd;
    f.container.Config.Labels=Object.fromEntries(Object.entries(identity).map(([k,v])=>['cecelia.script.'+k,String(v)]));
    f.container.Config.Labels['cecelia.script.profile_digest']=require('node:crypto').createHash('sha256').update(JSON.stringify(scriptProfile)).digest('hex');
    f.container.HostConfig.LogConfig={Type:'local',Config:{'max-size':'65536','max-file':'2'}};
    return {...f,scriptProfile,identity,containerId:id,expectedHostBootId:'1347658b-2aa4-4b38-91c0-a7b85531b918',expectedDaemonId:'daemon-hk'};
  }
  const collect=f=>require('./linux-pool-proof.cjs').collectLinuxScriptProof(f);
  it('真实script名称/持久身份/profile得到独立事实证明，不能成为旧pool-canary回执',async()=>{
    const f=scriptFixture();const proof=await collect(f);
    expect(proof).toMatchObject({schema_version:'linux-script-proof/v1',execution:false,script_verified:true,
      container_id:id,cgroup_parent_path:cg,identity:f.identity});
    expect(f.calls.filter(c=>c.args[0]==='image').every(c=>c.args.at(-1)===f.scriptProfile.image)).toBe(true);
    await expect(collectLinuxPoolProof({...f,expected:{container_id:id,name:f.container.Name.slice(1),labels:f.container.Config.Labels}})).rejects.toThrow('linux_pool_proof_unavailable');
  });
  it.each([
    ['外来reservation标签',f=>f.container.Config.Labels['cecelia.script.reservation_id']='wrong'],
    ['旧worker boot',f=>f.container.Config.Labels['cecelia.script.worker_boot_id']='old'],
    ['旧execution version',f=>f.container.Config.Labels['cecelia.script.execution_version_id']='old'],
    ['错误profile digest',f=>f.container.Config.Labels['cecelia.script.profile_digest']='a'.repeat(64)],
    ['同池内擅自增加CPU',f=>f.container.HostConfig.NanoCpus=500000000],
    ['同池内擅自增加内存',f=>f.container.HostConfig.Memory=f.container.HostConfig.MemorySwap=268435456],
    ['同池内擅自增加PID',f=>f.container.HostConfig.PidsLimit=64],
    ['profile超池预算',f=>f.scriptProfile.cpus=1],
    ['错误固定镜像',f=>f.container.Config.Image=f.profile.canary_image],
    ['错误工作目录',f=>f.container.Config.WorkingDir='/tmp'],
    ['无限日志',f=>f.container.HostConfig.LogConfig.Config={}],
    ['宿主boot与验收身份不符',f=>f.expectedHostBootId='88cf1bbe-a1a3-44ac-9f21-f17477a61689'],
    ['daemon与验收身份不符',f=>f.expectedDaemonId='other-daemon'],
    ['缺失完整container ID',f=>f.containerId=null],
    ['缺失持久grant',f=>delete f.identity.execution_grant_id],
  ])('%s拒绝且不修改容器',async(_name,mutate)=>{
    const f=scriptFixture();mutate(f);await expect(collect(f)).rejects.toThrow('linux_script_proof_unavailable');
    expect(f.calls.some(c=>['create','start','rm','stop','update'].includes(c.args[0]))).toBe(false);
  });
});
