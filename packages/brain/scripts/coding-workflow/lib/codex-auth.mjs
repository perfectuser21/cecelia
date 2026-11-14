import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

// 这里只冻结认证引用；密钥检查必须留在模型调用边界，不能阻断Code或动作读回。
export function normalizeCodexAuth(value,legacyHome){
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['mode','home'].includes(k))
    ||!['api-only','subscription'].includes(value.mode)||typeof value.home!=='string'||!path.isAbsolute(value.home)
    ||value.home.includes('\0'))throw Error('codex_auth_config_invalid');
  const auth={mode:value.mode,home:path.resolve(value.home)};
  if(legacyHome!==undefined&&(typeof legacyHome!=='string'||path.resolve(legacyHome)!==auth.home))throw Error('codex_auth_home_conflict');
  return auth;
}
const reservedEnv=key=>/^(?:OPENAI_|CODEX_|CODING_WF_CODEX_|AZURE_OPENAI_|CHATGPT_)/i.test(key)
  ||/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|OAUTH|BASE_URL|PROVIDER)/i.test(key);
export function codexAuthEnvironment(env,auth){
  if(!auth)return env;
  return {...Object.fromEntries(Object.entries(env).filter(([key])=>!reservedEnv(key))),CODEX_HOME:auth.home};
}
const configKeys=new Set(['approval_policy','model','model_reasoning_effort','model_reasoning_summary','model_verbosity','personality','service_tier']);
export function validateCodexAuthArgs(codex,auth){
  if(!auth)return;
  if(!Array.isArray(codex.args??[])||!Array.isArray(codex.env_keys??[])
    ||(codex.env_keys??[]).some(key=>typeof key!=='string'||reservedEnv(key)))throw Error('codex_auth_override_rejected');
  const args=codex.args??[];
  for(let i=0;i<args.length;i++){
    const arg=args[i];if(typeof arg!=='string')throw Error('codex_auth_override_rejected');
    let config;
    if(arg==='-c'||arg==='--config')config=args[++i];
    else if(arg.startsWith('--config='))config=arg.slice(9);
    else if(arg.startsWith('-c')&&arg.length>2)config=arg.slice(2);
    if(config!==undefined){
      if(typeof config!=='string'||!configKeys.has(config.split('=',1)[0].trim()))throw Error('codex_auth_override_rejected');
    }else if(['--model','-m','--ask-for-approval','-a','--enable','--disable'].includes(arg)){
      if(typeof args[++i]!=='string'||args[i].startsWith('-'))throw Error('codex_auth_override_rejected');
    }else throw Error('codex_auth_override_rejected');
  }
}
function readAuth(auth){
  let fd;
  try{
    const directory=fs.lstatSync(auth.home),file=path.join(auth.home,'auth.json');
    if(!directory.isDirectory()||directory.isSymbolicLink()||(directory.mode&0o777)!==0o700
      ||directory.uid!==process.getuid())throw Error();
    fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||(stat.mode&0o777)!==0o600||stat.uid!==process.getuid()||stat.size>65536)throw Error();
    const value=JSON.parse(fs.readFileSync(fd,'utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
    if(auth.mode==='api-only'){
      if(value.auth_mode!=='apikey'||typeof value.OPENAI_API_KEY!=='string'||!value.OPENAI_API_KEY.trim()
        ||Object.keys(value).some(k=>!['auth_mode','OPENAI_API_KEY'].includes(k)))throw Error();
    }else if(value.auth_mode!=='chatgpt'||value.OPENAI_API_KEY!=null||!value.tokens
      ||typeof value.tokens.access_token!=='string'||!value.tokens.access_token.trim())throw Error();
  }catch{throw Error('codex_auth_unavailable');}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function prepareCodexAuth(value,{legacyHome,codex}={}){
  const auth=normalizeCodexAuth(value,legacyHome);if(!auth)return null;
  if(codex)validateCodexAuthArgs(codex,auth);
  readAuth(auth);
  const args=['-c',`forced_login_method=${JSON.stringify(auth.mode==='api-only'?'api':'chatgpt')}`,
    '-c','cli_auth_credentials_store="file"','-c','model_provider="openai"'];
  if(codex){
    const toml=value=>value&&typeof value==='object'&&!Array.isArray(value)
      ?`{${Object.entries(value).map(([key,v])=>`${JSON.stringify(key)}=${toml(v)}`).join(',')}}`:JSON.stringify(value);
    const permissions={commander_activity:{extends:':workspace',filesystem:{[auth.home]:'deny',[path.join(process.env.HOME||os.homedir(),'.credentials')]:'deny'},network:{enabled:true}}};
    args.push('-c','default_permissions="commander_activity"','-c',`permissions=${toml(permissions)}`);
  }
  return {auth,identity:createHash('sha256').update(JSON.stringify(auth)).digest('hex'),
    args};
}
