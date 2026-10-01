'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID,createHash } = require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const BINDINGS=['reservation_id','machine_id','owner_key','intent_id','launch_generation','config_digest'];
const digest=(value)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function validateProfile(profile) {
  if (!profile || !/^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/.test(profile.image)
    || !Number.isFinite(profile.cpus) || profile.cpus<=0
    || !Number.isSafeInteger(profile.memoryBytes) || profile.memoryBytes<=0
    || !Number.isSafeInteger(profile.pidsLimit) || profile.pidsLimit<=0
    || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(profile.user)
    || typeof profile.cwd!=='string' || !profile.cwd.startsWith('/') || profile.cwd.includes('..')
    || Object.keys(profile).some((k)=>!['image','cpus','memoryBytes','pidsLimit','user','cwd'].includes(k))) {
    throw new Error('script_profile_invalid');
  }
  return profile;
}
function validateJob(job,profiles) {
  if (!job || Object.keys(job).some((k)=>!['profile','cmd','timeout_sec','env'].includes(k))) throw new Error('script_job_field_rejected');
  if (!Object.hasOwn(profiles,job.profile)) throw new Error('script_profile_unavailable');
  const profile=validateProfile(profiles[job.profile]);
  if (typeof job.cmd!=='string' || !job.cmd.trim() || Buffer.byteLength(job.cmd)>8192
    || !Number.isInteger(job.timeout_sec) || job.timeout_sec<1 || job.timeout_sec>3600
    || !job.env || Array.isArray(job.env) || Object.keys(job.env).length>32
    || Object.entries(job.env).some(([k,v])=>!/^(?:(?:SCRIPT|TASK|APP)_[A-Z0-9_]{1,56}|TZ|LANG|LC_ALL|CI|NODE_ENV|DEBUG)$/.test(k)
      || typeof v!=='string' || Buffer.byteLength(v)>4096 || v.includes('\0'))) throw new Error('script_job_invalid');
  return profile;
}
function loadProtectedScriptProfiles(filename) {
  if (!filename) return {};
  const stat=fs.lstatSync(filename);
  if(!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)!==0
    || (stat.uid!==0 && stat.uid!==process.getuid?.())) throw new Error('script_profiles_permissions');
  const config=JSON.parse(fs.readFileSync(filename,'utf8'));
  // 已有宿主脚本须先对账，再由部署者显式确认；缺此声明不会启用新容器入口。
  if(config.legacy_host_scripts_reconciled!==true || !config.profiles || Array.isArray(config.profiles)) throw new Error('script_legacy_reconciliation_required');
  for(const profile of Object.values(config.profiles)) validateProfile(profile);
  return config.profiles;
}
function createScriptRunner({stateRoot,machineId,workerId,bootId=randomUUID(),profiles={},docker,assertLocalResources}) {
  fs.mkdirSync(stateRoot,{recursive:true,mode:0o700});
  const root=fs.realpathSync(stateRoot);
  fs.chmodSync(root,0o700);
  const timers=new Map();
  function validate(input) {
    if(!UUID.test(input?.reservation_id) || !UUID.test(input.intent_id)
      || input.machine_id!==machineId || !/^script-[a-f0-9-]+-a[1-9][0-9]*$/.test(input.owner_key)
      || !Number.isSafeInteger(input.launch_generation) || input.launch_generation<1
      || !DIGEST.test(input.config_digest)) throw new Error('script_identity_invalid');
  }
  function read(id) {
    try { return JSON.parse(fs.readFileSync(path.join(root,`${id}.json`),'utf8')); }
    catch(error) { if(error.code==='ENOENT') return null;throw error; }
  }
  function save(state) {
    const dest=path.join(root,`${state.reservation_id}.json`),temp=`${dest}.${randomUUID()}`;
    const fd=fs.openSync(temp,'wx',0o600);
    try {fs.writeFileSync(fd,JSON.stringify(state));fs.fsyncSync(fd);} finally{fs.closeSync(fd);}
    fs.renameSync(temp,dest);
    const dir=fs.openSync(root,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  }
  async function locked(input,fn) {
    validate(input);
    const lock=path.join(root,`${input.reservation_id}.lock`);
    // 不按时间删除锁：进程崩溃留下的锁会 fail-closed，防止与尚存启动请求竞争。
    try {fs.mkdirSync(lock,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw new Error('script_operation_locked');throw error;}
    try {
      const state=read(input.reservation_id);
      if(state && BINDINGS.some((key)=>state[key]!==input[key])) throw new Error('script_identity_mismatch');
      return await fn(state);
    } finally {fs.rmdirSync(lock);}
  }
  function initial(input) {
    return {...Object.fromEntries(BINDINGS.map((key)=>[key,input[key]])),worker_id:workerId,worker_boot_id:bootId,
      container_id:null,container_name:`cecelia-script-${input.reservation_id}-g${input.launch_generation}`,
      status:'launching',created_at:Date.now(),tombstoned:false};
  }
  async function observe(state) {
    const container=await docker.inspect(state.container_id ?? state.container_name);
    if(!container) return {...state,status:state.tombstoned?'cleaned':state.status==='waiting_resources'?'waiting_resources':'unknown'};
    if(state.container_id && container.id!==state.container_id) throw new Error('script_identity_mismatch');
    if(container.labels && ['reservation_id','intent_id','launch_generation'].some((key)=>
      container.labels[`cecelia.script.${key}`]!==String(state[key]))) throw new Error('script_identity_mismatch');
    if(!state.container_id){state.container_id=container.id;save(state);}
    if(container.status==='exited') {
      state.terminal={exit_code:container.exit_code,stdout:container.stdout??'',stderr:container.stderr??'',timed_out:state.timed_out===true};save(state);
    }
    return {...state,status:state.status==='waiting_resources'&&container.status==='created'?'waiting_resources':container.status,exit_code:container.exit_code,
      stdout:container.stdout??'',stderr:container.stderr??'',timed_out:state.timed_out===true};
  }
  function schedule(state) {
    if(state.tombstoned || state.terminal || timers.has(state.reservation_id))return;
    const timer=setTimeout(async()=>{
      timers.delete(state.reservation_id);
      try {
        await locked(state,async(current)=>{
          if(!current || current.tombstoned)return;
          const observed=await observe(current);
          if(observed.status==='exited')return;
          current.timed_out=true;current.tombstoned=true;current.status='cleanup_pending';
          current.terminal={exit_code:124,stdout:'',stderr:'script_timeout',timed_out:true};save(current);
          if(current.container_id)await docker.remove(current.container_id);
          if(await docker.inspect(current.container_id??current.container_name))throw new Error('script_cleanup_unconfirmed');
          current.status='cleaned';save(current);
        });
      } catch { /* journal 持续占用，由下一次认证 inspect/cancel 完成确认。 */ }
    },Math.max(1,state.created_at+state.timeout_sec*1000-Date.now()));
    timer.unref?.();timers.set(state.reservation_id,timer);
  }
  for(const name of fs.readdirSync(root)) {
    if(/^[a-f0-9-]+\.json$/.test(name))schedule(JSON.parse(fs.readFileSync(path.join(root,name),'utf8')));
  }
  return {
    close(){for(const timer of timers.values())clearTimeout(timer);timers.clear();},
    capabilities() {
      return {machine_id:machineId,worker_id:workerId,worker_boot_id:bootId,
        profiles:Object.fromEntries(Object.entries(profiles).map(([name,p])=>[name,digest(validateProfile(p))]))};
    },
    async start(input) {
      const profile=validateJob(input.job,profiles);
      return locked(input,async(state)=>{
        if(state?.tombstoned) throw new Error('script_launch_tombstoned');
        if(state) {
          if(state.job_digest!==digest(input.job))throw new Error('script_identity_mismatch');
          if(state.status!=='waiting_resources')return observe(state);
        }
        if(input.config_digest!==digest({job:input.job,profile_digest:digest(profile)}))throw new Error('script_config_digest_mismatch');
        if(!state && input.worker_id && (input.worker_id!==workerId || input.worker_boot_id!==bootId))throw new Error('script_worker_changed');
        if(typeof assertLocalResources!=='function')throw new Error('script_local_resources_unavailable');
        state??={...initial(input),job_digest:digest(input.job),timeout_sec:input.job.timeout_sec};save(state);
        const admit=async()=>{
          try {await assertLocalResources();return true;}
          catch(error){if(!/^(attempt|script)_local_resources_unavailable$/.test(error.message))throw error;
            state.status='waiting_resources';save(state);return false;}
        };
        if(!await admit())return state;
        if(!state.container_id)state.container_id=await docker.create({name:state.container_name,profile,command:input.job.cmd,
          env:input.job.env,identity:{reservation_id:state.reservation_id,intent_id:state.intent_id,launch_generation:state.launch_generation}});
        save(state); // exact ID 持久化后才可 start；重复请求只 inspect。
        if(!await admit())return state;
        state.status='starting';save(state);
        await docker.start(state.container_id);
        state.status='running';save(state);schedule(state);
        return observe(state);
      });
    },
    async inspect(input) {
      return locked(input,async(state)=>{
        if(!state)throw new Error('script_intent_unknown');
        const result=await observe(state);
        if(['created','running','restarting'].includes(result.status) && Date.now()>state.created_at+state.timeout_sec*1000) {
          state.timed_out=true;save(state);
          return {...result,timed_out:true};
        }
        return result;
      });
    },
    async cancel(input) {
      if(!UUID.test(input.challenge))throw new Error('script_cleanup_challenge_required');
      return locked(input,async(state)=>{
        state ??= {...initial(input),worker_boot_id:input.worker_boot_id ?? bootId};
        if(input.container_id!==state.container_id) throw new Error('script_identity_mismatch');
        state.tombstoned=true;state.status='cleanup_pending';save(state);
        const current=await observe(state);
        if(current.container_id!==input.container_id) throw new Error('script_identity_mismatch');
        if(current.status!=='cleaned') await docker.remove(state.container_id);
        const after=await docker.inspect(state.container_id ?? state.container_name);
        if(after)throw new Error('script_cleanup_unconfirmed');
        state.status='cleaned';save(state);
        return {...Object.fromEntries([...BINDINGS,'worker_id','worker_boot_id','container_id'].map((k)=>[k,state[k]])),
          status:'cleaned',absent:true,tombstoned:true,challenge:input.challenge,terminal:state.terminal??null};
      });
    },
  };
}
module.exports={createScriptRunner,loadProtectedScriptProfiles};
