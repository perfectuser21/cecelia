const {createLinuxScriptDockerAdapter}=require('./linux-script-docker.cjs');
const ID='a'.repeat(64),OTHER='b'.repeat(64);
const {fixture}=require('./linux-script-test-fixture.cjs');
describe('Linux root bridge Docker限制核心',()=>{
 it('完整根身份和可信store/launch闸缺省拒绝',()=>{
  expect(()=>createLinuxScriptDockerAdapter()).toThrow('linux_script_adapter_unavailable');
  const f=fixture();expect(()=>createLinuxScriptDockerAdapter({...f.options,getuid:()=>501})).toThrow('linux_script_adapter_unavailable');
 });
 it('先持久creating再create；精确inspect后绑定ID，四限/父slice/无网/只读/固定镜像只取可信record',async()=>{
  const f=fixture(),a=createLinuxScriptDockerAdapter(f.options);expect(await a.create(f.input)).toBe(ID);
  const flags=f.calls.find(a=>a[0]==='create');for(const arg of ['--pull=never','--cgroup-parent=cecelia-workloads.slice','--network=none','--memory=134217728','--memory-swap=134217728','--pids-limit=32','--cpus=0.25','--read-only','--user=65534:65534'])expect(flags).toContain(arg);
  expect(f.events.indexOf('save:creating')).toBeLessThan(f.events.indexOf('create'));expect(f.record.container_id).toBe(ID);expect(f.record.phase).toBe('bound');
  await a.start(ID);expect(f.calls.find(a=>a[0]==='start')).toEqual(['start',ID]);
 });
 it('固定local禁用压缩，单文件日志预算可启动且不增加大小或份数',async()=>{
  const f=fixture({logMaxFiles:1}),r=f.record;
  const a=createLinuxScriptDockerAdapter(f.options);await a.create({...f.input,profile:r.profile});
  const flags=f.calls.find(args=>args[0]==='create');
  expect(flags).toContain('--log-opt=compress=false');expect(flags).toContain('--log-opt=max-file=1');
  expect(flags).toContain('--log-opt=max-size=1048576');
  await a.start(ID);expect(f.calls.filter(args=>args[0]==='start')).toEqual([['start',ID]]);
 });
 it.each([undefined,'true','FALSE',false])('日志压缩配置%s不精确时禁止start/remove/logs',async compress=>{
  const f=fixture(),a=createLinuxScriptDockerAdapter(f.options);await a.create(f.input);
  f.container.HostConfig.LogConfig.Config.compress=compress;
  for(const method of ['start','remove','logs'])await expect(a[method](ID)).rejects.toThrow('linux_script_identity_mismatch');
  expect(f.calls.some(args=>['start','rm','logs'].includes(args[0]))).toBe(false);
 });
 it('外来profile/命令不可替换可信journal，零create',async()=>{
  for(const patch of [{profile:{...fixture().input.profile,cpus:8}},{command:'evil'},{env:{CI:'evil'}}]){
   const f=fixture(),a=createLinuxScriptDockerAdapter(f.options);await expect(a.create({...f.input,...patch})).rejects.toThrow('linux_script_identity_mismatch');expect(f.calls.some(a=>a[0]==='create')).toBe(false);
  }
 });
 it('新US/scheduler/zero或过池配额不执行',async()=>{
  for(const change of [r=>r.pool.machine_registry_id='1a379d80-ad36-47d3-88ba-e545ab299a54',r=>r.pool.role='scheduler',r=>r.pool.pool.cpu_cores=0,r=>r.profile.cpus=2]){
   const f=fixture();change(f.record);const a=createLinuxScriptDockerAdapter(f.options);await expect(a.create(f.input)).rejects.toThrow();expect(f.calls.length).toBe(0);
  }
 });
 it('create回执丢失留creating，重建adapter也不重跑或认领同名容器',async()=>{
  const f=fixture();f.createFailure=true;await expect(createLinuxScriptDockerAdapter(f.options).create(f.input)).rejects.toThrow('linux_script_operation_unconfirmed');
  expect(f.record.phase).toBe('creating');const a=createLinuxScriptDockerAdapter(f.options);await expect(a.create(f.input)).rejects.toThrow('linux_script_create_unconfirmed');await expect(a.remove(f.name)).rejects.toThrow();expect(f.calls.filter(a=>a[0]==='create').length).toBe(1);expect(f.calls.some(a=>a[0]==='rm')).toBe(false);
 });
 it('意图落盘失败零create',async()=>{
  const f=fixture();f.saveFailure=true;await expect(createLinuxScriptDockerAdapter(f.options).create(f.input)).rejects.toThrow();expect(f.calls.some(a=>a[0]==='create')).toBe(false);
 });
 it('已绑定ID消失不回落同名替换者，反复inspect和remove零rm',async()=>{
  const f=fixture(),a=createLinuxScriptDockerAdapter(f.options);await a.create(f.input);f.container={...f.container,Id:OTHER};
  expect(await a.inspect(ID)).toBeNull();await a.remove(ID);expect(await createLinuxScriptDockerAdapter(f.options).inspect(ID)).toBeNull();expect(f.record.container_id).toBe(ID);expect(f.calls.some(a=>a[0]==='rm')).toBe(false);expect(f.calls.filter(a=>a[0]==='inspect').slice(-3).every(a=>a.at(-1)===ID)).toBe(true);
 });
 it.each(['label','image','name','slice','memory','mount','user'])('实际%s不符时禁止start/remove/logs',async kind=>{
  const f=fixture(),a=createLinuxScriptDockerAdapter(f.options);await a.create(f.input);
  if(kind==='label')f.container.Config.Labels['cecelia.script.execution_grant_id']='other';
  if(kind==='image')f.container.Image='sha256:'+OTHER;
  if(kind==='name')f.container.Name='/foreign';
  if(kind==='slice')f.container.HostConfig.CgroupParent='system.slice';
  if(kind==='memory')f.container.HostConfig.Memory=1;
  if(kind==='mount')f.container.Mounts=[{Source:'/'}];
  if(kind==='user')f.container.Config.User='0:0';
  for(const method of ['start','remove','logs'])await expect(a[method](ID)).rejects.toThrow('linux_script_identity_mismatch');
  expect(f.calls.some(a=>['start','rm','logs'].includes(a[0]))).toBe(false);
 });
 it('最终本机drain拒绝新start，但已running探活/精确清理不走新许可',async()=>{
  const f=fixture(),a=createLinuxScriptDockerAdapter(f.options);await a.create(f.input);f.gateError='worker_draining';await expect(a.start(ID)).rejects.toThrow('worker_draining');
  f.container.State.Status='running';await a.start(ID);await a.remove(ID);expect(f.calls.filter(a=>a[0]==='rm')).toEqual([['rm','--force',ID]]);
 });
});
