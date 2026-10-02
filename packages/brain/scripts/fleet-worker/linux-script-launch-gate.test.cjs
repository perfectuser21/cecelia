const {createLinuxScriptLaunchGate}=require('./linux-script-launch-gate.cjs');
const {fixture}=require('./linux-script-test-fixture.cjs');
function setup(){
 const f=fixture(),r=f.record;r.expected={host_boot_id:'12345678-1234-4234-8234-123456789abc',worker_boot_id:r.identity.worker_boot_id};
 const files={'/proc/sys/kernel/random/boot_id':r.expected.host_boot_id,'/proc/meminfo':'MemAvailable: 2097152 kB\n',
 '/sys/fs/cgroup/cecelia.slice/cecelia-workloads.slice/cpu.max':'100000 100000','/sys/fs/cgroup/cecelia.slice/cecelia-workloads.slice/memory.max':'1073741824',
 '/sys/fs/cgroup/cecelia.slice/cecelia-workloads.slice/memory.swap.max':'0','/sys/fs/cgroup/cecelia.slice/cecelia-workloads.slice/pids.max':'128',
 '/sys/fs/cgroup/cecelia.slice/cecelia-workloads.slice/memory.current':'100','/sys/fs/cgroup/cecelia.slice/cecelia-workloads.slice/pids.current':'2'};
 for(const kind of ['cpu','memory'])files['/sys/fs/cgroup/cecelia.slice/cecelia-workloads.slice/'+kind+'.pressure']='some avg10=0.00 avg60=0.00 avg300=0.00 total=0\n';
 const markers=new Set();
 const options={workerBootId:r.identity.worker_boot_id,configDigest:'fixed',readConfigDigest:()=> 'fixed',
  readText:async p=>{if(!(p in files))throw Error('missing');return files[p];},lstat:async p=>{if(markers.has(p))return {};throw Object.assign(Error(),{code:'ENOENT'});},
  readlink:async p=>p==='/proc/1/exe'?'/usr/lib/systemd/systemd':p.includes('/ns/')?p.split('/').at(-1)+':[1]':null,
  statfs:async()=>({bsize:4096n,blocks:1048576n,bfree:524288n,bavail:524288n}),
  run:async(c,a)=>{if(c.endsWith('systemd-detect-virt'))throw Object.assign(Error(),{code:1,stdout:'none\n'});return f.options.run(c,a,{env:{DOCKER_HOST:'unix:///var/run/docker.sock'}});}};
 return {r,options,files,markers};
}
describe('root create/start前本机最终闸',()=>{
 it('真实池配额、空间、压力、宿主boot/namespace与root执行boot都匹配才通过',async()=>{
  const x=setup();await expect(createLinuxScriptLaunchGate(x.options)(x.r)).resolves.toBeUndefined();
 });
 it.each(['drain','install','hostboot','workerboot','configuration','slice','memory','pids','pressure','disk','namespace'])('%s异常时拒绝新副作用',async kind=>{
  const x=setup(),base='/sys/fs/cgroup/cecelia.slice/cecelia-workloads.slice/';
  if(kind==='drain')x.markers.add('/var/run/cecelia/fleet-worker.drain');
  if(kind==='install')x.markers.add('/run/cecelia/linux-pool.install.lock');
  if(kind==='hostboot')x.files['/proc/sys/kernel/random/boot_id']='changed';
  if(kind==='workerboot')x.options.workerBootId='changed';
  if(kind==='configuration')x.options.readConfigDigest=()=> 'changed';
  if(kind==='slice')x.files[base+'cpu.max']='max 100000';
  if(kind==='memory')x.files[base+'memory.current']='1073741820';
  if(kind==='pids')x.files[base+'pids.current']='120';
  if(kind==='pressure')x.files[base+'memory.pressure']='some avg10=95.00 avg60=0.00 avg300=0.00 total=0\n';
  if(kind==='disk')x.options.statfs=async()=>({bsize:4096n,blocks:1048576n,bfree:4n,bavail:4n});
  if(kind==='namespace')x.options.readlink=async()=> 'wrong';
  await expect(createLinuxScriptLaunchGate(x.options)(x.r)).rejects.toThrow();
 });
});
