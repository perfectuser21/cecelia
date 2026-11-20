import {readFileSync} from 'node:fs';
const DEFAULT_CONFIG=new URL('../../config/native-agent.json',import.meta.url);
const FIELDS=['machine_role','machine_id','release_root','operator_config','default_account_ref','default_model','default_thinking','default_timeout_sec','default_department','default_role'];
export function loadNativeAgentSettings(env=process.env,{configPath=DEFAULT_CONFIG}={}){
 let config;
 try{config=JSON.parse(readFileSync(configPath,'utf8'));}catch{throw Error('native_agent_deployment_invalid');}
 if(config?.protocol!=='brain-native-agent-deployment/v1'||config.machine_role!=='primary'||!['release_root','operator_config'].every(k=>typeof config[k]==='string'&&config[k].startsWith('/'))||!['default_account_ref','default_model','default_thinking'].every(k=>typeof config[k]==='string'&&config[k].trim())||!Number.isInteger(config.default_timeout_sec)||config.default_timeout_sec<60||config.default_timeout_sec>10800)throw Error('native_agent_deployment_invalid');
 const result={...config};
 for(const key of FIELDS){const name='BRAIN_NATIVE_AGENT_'+key.toUpperCase();if(Object.hasOwn(env,name))result[key]=env[name];}
 return result;
}
