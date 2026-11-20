import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect,test} from 'vitest';
test('唯一部署配置读取逻辑默认，受信env显式覆盖且空值不偷回落',async()=>{
 const {loadNativeAgentSettings}=await import('../native-agent-settings.js');
 const dir=mkdtempSync(path.join(os.tmpdir(),'native-settings-'));const configPath=path.join(dir,'config.json');
 try{
  writeFileSync(configPath,JSON.stringify({protocol:'brain-native-agent-deployment/v1',machine_role:'primary',release_root:'/trusted/releases',operator_config:'/trusted/profiles.json',default_account_ref:'trusted',default_model:'gpt-6.2-sol',default_thinking:'medium',default_timeout_sec:1800}));
  expect(loadNativeAgentSettings({}, {configPath})).toMatchObject({default_account_ref:'trusted',machine_role:'primary'});
  expect(loadNativeAgentSettings({BRAIN_NATIVE_AGENT_DEFAULT_ACCOUNT_REF:''},{configPath}).default_account_ref).toBe('');
  writeFileSync(configPath,JSON.stringify({protocol:'unknown'}));
  expect(()=>loadNativeAgentSettings({}, {configPath})).toThrow('native_agent_deployment_invalid');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
