const {createHash}=require('node:crypto');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ID='a'.repeat(64);
function fixture({logMaxFiles=2}={}) {
 const identity={reservation_id:'12345678-1234-4234-8234-123456789abc',intent_id:'22345678-1234-4234-8234-123456789abc',launch_generation:1,machine_id:'hk-vps',owner_key:'script-12345678-1234-4234-8234-123456789abc-a1',config_digest:'',worker_id:'hk-vps',worker_boot_id:'32345678-1234-4234-8234-123456789abc',execution_version_id:'42345678-1234-4234-8234-123456789abc',execution_grant_id:'52345678-1234-4234-8234-123456789abc',profile_id:'safe'};
 const profile={image:'test/image@sha256:'+'c'.repeat(64),cpus:0.25,memoryBytes:134217728,pidsLimit:32,logMaxSizeBytes:1048576,logMaxFiles,user:'65534:65534',cwd:'/tmp'};
 const job={profile:'safe',cmd:'printf ok',timeout_sec:30,env:{CI:'1'}};
 identity.config_digest=hash({job,profile_digest:hash(profile)});
 let record={identity,profile,job_digest:hash(job),timeout_sec:job.timeout_sec,pool:{schema_version:1,machine_registry_id:'71d632df-252a-4991-ad6b-3647fbbea9f7',machine_id:'hk-vps',role:'worker',endpoint_host:'100.90.1.4',docker_host:'unix:///var/run/docker.sock',pool:{cpu_cores:1,memory_bytes:1073741824,pids_limit:128},canary_image:profile.image},image_id:'sha256:'+'d'.repeat(64),daemon_id:'daemon-fixed',phase:'planned',container_id:null};
 const name=`cecelia-script-${identity.reservation_id}-g1`,calls=[],events=[];let container=null,gateError=null,createFailure=false,saveFailure=false;
 function makeContainer(){return {Id:ID,Name:'/'+name,Image:record.image_id,Config:{Image:profile.image,User:profile.user,WorkingDir:profile.cwd,Labels:{...Object.fromEntries(Object.entries(identity).map(([k,v])=>['cecelia.script.'+k,String(v)])),'cecelia.script.profile_digest':hash(profile)}},State:{Status:'created',ExitCode:0},Mounts:[],HostConfig:{CgroupParent:'cecelia-workloads.slice',Privileged:false,ReadonlyRootfs:true,NetworkMode:'none',CapDrop:['ALL'],SecurityOpt:['no-new-privileges'],NanoCpus:profile.cpus*1e9,Memory:profile.memoryBytes,MemorySwap:profile.memoryBytes,PidsLimit:profile.pidsLimit,LogConfig:{Type:'local',Config:{compress:'false','max-size':String(profile.logMaxSizeBytes),'max-file':String(profile.logMaxFiles)}}}};}
 const options={platform:'linux',getuid:()=>0,loadRuntime:async ref=>{if(ref!==name&&ref!==record.container_id)throw Error('unknown');return structuredClone(record);},saveRuntime:async value=>{events.push('save:'+value.phase);if(saveFailure)throw Error('disk full');record=structuredClone(value);},assertCanLaunch:async()=>{events.push('gate');if(gateError)throw Error(gateError);},run:async(command,args,opts)=>{
  calls.push(args);events.push(args[0]);expect(command).toBe('/usr/bin/docker');expect(opts.env.DOCKER_HOST).toBe('unix:///var/run/docker.sock');
  if(args[0]==='info')return {stdout:JSON.stringify({ID:'daemon-fixed',CgroupDriver:'systemd',CgroupVersion:'2'})};
  if(args[0]==='inspect'){if(!container || args.at(-1)!==container.Id&&args.at(-1)!==name)throw Object.assign(Error('missing'),{stderr:'Error: No such container: '+args.at(-1)});return {stdout:JSON.stringify([container])};}
  if(args[0]==='create'){container=makeContainer();if(createFailure)throw Error('reply lost');return {stdout:ID+'\n'};}
  if(args[0]==='start'){container.State.Status='running';return {stdout:ID};}
  if(args[0]==='rm'){container=null;return {stdout:ID};}
  if(args[0]==='logs')return {stdout:'ok',stderr:''};
  throw Error('unexpected');
 }};
 return {options,name,calls,events,makeContainer,input:{name,profile,command:job.cmd,env:job.env,identity},get record(){return record;},set record(v){record=v;},get container(){return container;},set container(v){container=v;},set gateError(v){gateError=v;},set createFailure(v){createFailure=v;},set saveFailure(v){saveFailure=v;}};
}
module.exports={fixture};
