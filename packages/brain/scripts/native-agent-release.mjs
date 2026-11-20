import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';

// 函数同时是SSH安装端的实际程序；只读规范配置，不接收任务正文或凭据。
export async function installNativeBundle(request){
 const fs=await import('node:fs/promises'),path=await import('node:path'),crypto=await import('node:crypto');
 const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
 const fail=reason=>{throw Error('native_agent_release_'+reason);};
 const {root,configPath,files,sha256}=request;
 if(![root,configPath].every(p=>typeof p==='string'&&path.isAbsolute(p)&&!p.includes('\0'))
   ||!Array.isArray(files)||!files.length||files.length>32||!/^[a-f0-9]{64}$/.test(sha256))fail('bundle_invalid');
 const seen=new Set();let total=0;
 for(const f of files){
  if(typeof f.path!=='string'||!f.path||path.isAbsolute(f.path)||f.path.split('/').some(p=>!p||p==='.'||p==='..')
    ||!/^[A-Za-z0-9_./-]+$/.test(f.path)||seen.has(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256)
    ||typeof f.content_base64!=='string')fail('bundle_path_invalid');
  const bytes=Buffer.from(f.content_base64,'base64');total+=bytes.length;
  if(total>1048576||hash(bytes)!==f.sha256)fail('bundle_digest_mismatch');seen.add(f.path);
 }
 if(hash(JSON.stringify(files.map(f=>[f.path,f.sha256])))!==sha256)fail('bundle_digest_mismatch');
 async function protectedFile(file){
  const handle=await fs.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const s=await handle.stat();if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o077)||s.nlink!==1||s.size>1048576)fail('config_unprotected');return await handle.readFile('utf8');}
  finally{await handle.close();}
 }
 const parent=await fs.lstat(path.dirname(configPath));
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==process.getuid()||(parent.mode&0o077)||await fs.realpath(configPath)!==path.resolve(configPath))fail('config_directory_unprotected');
 const source=JSON.parse(await protectedFile(configPath));
 if(!source||typeof source!=='object'||Array.isArray(source))fail('config_invalid');
 const config=JSON.stringify({...source,bundle_sha256:sha256})+'\n';
 await fs.mkdir(root,{recursive:true,mode:0o700});const owner=await fs.lstat(root);
 if(!owner.isDirectory()||owner.isSymbolicLink()||owner.uid!==process.getuid()||(owner.mode&0o077)
   ||await fs.realpath(root)!==path.resolve(root))fail('directory_unprotected');
 const directory=path.join(root,sha256),config_path=path.join(directory,'operator-config.json');
 async function verify(){
  const s=await fs.lstat(directory);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))fail('directory_unprotected');
  for(const f of files){const file=path.join(directory,f.path);if(await fs.realpath(file)!==file||hash(await protectedFile(file))!==f.sha256)fail('published_source_drift');}
  if(await protectedFile(config_path)!==config)fail('published_config_conflict');
  return {bundle_sha256:sha256,directory,config_path,cli_path:path.join(directory,'scripts/native-agent/cli.mjs')};
 }
 try{await fs.lstat(directory);return await verify();}catch(error){if(error.code!=='ENOENT')throw error;}
 const pending=path.join(root,'.install-'+crypto.randomUUID());await fs.mkdir(pending,{mode:0o700});
 try{
  for(const f of files){const file=path.join(pending,f.path);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,Buffer.from(f.content_base64,'base64'),{flag:'wx',mode:0o600});}
  await fs.writeFile(path.join(pending,'operator-config.json'),config,{flag:'wx',mode:0o600});
  try{await fs.rename(pending,directory);}catch(error){if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;}
  return await verify();
 }finally{await fs.rm(pending,{recursive:true,force:true});}
}

export async function collectNativeBundle(brainRoot){
 const module=await import(pathToFileURL(path.join(brainRoot,'scripts/native-agent/bundle.mjs')));
 const files=[];
 for(const relative of module.BUNDLE_FILES){const bytes=await fs.readFile(path.join(brainRoot,relative));files.push({path:relative,sha256:createHash('sha256').update(bytes).digest('hex'),content_base64:bytes.toString('base64')});}
 const sha256=createHash('sha256').update(JSON.stringify(files.map(f=>[f.path,f.sha256]))).digest('hex');
 if(await module.computeBundleDigest(brainRoot)!==sha256)throw Error('native_agent_release_source_drift');
 return {files,sha256};
}

export async function publishNativeAgentRelease({brainRoot,env=process.env,transport,spawnFn=spawn}={}){
 if(Object.hasOwn(env,'BRAIN_NATIVE_AGENT_CONFIG_PATH'))throw Error('native_agent_config_override_unknown');
 const {loadNativeAgentSettings}=await import('../src/lib/native-agent-settings.js');
 const settings=loadNativeAgentSettings(env,{configPath:path.join(brainRoot,'config/native-agent.json')});
 const {resolvePrimaryWorkerId}=await import('../src/machine-registry.js');
 const machine=settings.machine_id||resolvePrimaryWorkerId(),root=settings.release_root,configPath=settings.operator_config;
 if(!machine||!root||!configPath)throw Error('native_agent_release_unconfigured');
 const {sshTargetFor}=await import('../src/machine-registry.js');
 const {sshWithStdin}=await import('../src/lib/ssh-exec.js');
 const {SSH_BASE_ARGS}=await import('../src/lib/ssh-args.js');
 const bundle=await collectNativeBundle(brainRoot);
 const program=`const install=(${installNativeBundle.toString()});console.log(JSON.stringify(await install(${JSON.stringify({root,configPath,...bundle})})));`;
 const invoke=transport??((target,body)=>sshWithStdin(spawnFn,[...SSH_BASE_ARGS,target,'node --input-type=module -'],body,30000));
 const raw=await invoke(sshTargetFor(machine),program),output=typeof raw==='string'?raw:raw.stdout;
 const result=JSON.parse(output);
 if(result.bundle_sha256!==bundle.sha256||result.directory!==path.join(root,bundle.sha256)
   ||result.config_path!==path.join(root,bundle.sha256,'operator-config.json'))throw Error('native_agent_release_receipt_mismatch');
 return result;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const brainRoot=fileURLToPath(new URL('..',import.meta.url));
 try{console.log(JSON.stringify(await publishNativeAgentRelease({brainRoot})));}catch(error){console.error(error.message);process.exitCode=1;}
}
