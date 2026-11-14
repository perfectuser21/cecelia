import {test,expect,afterEach,vi} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createCodexCommander} from '../commander-codex.js';
import {createRuntime} from '../../../scripts/commander-workflow/skill-adapter.mjs';
const roots=[];afterEach(()=>{vi.unstubAllEnvs();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'commander-api-auth-'));roots.push(root);fs.chmodSync(root,0o700);
 const home=path.join(root,'api-home');fs.mkdirSync(home,{mode:0o700});
 fs.writeFileSync(path.join(home,'auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'synthetic-api-key'}),{mode:0o600});
 const bin=path.join(root,'codex'),capture=path.join(root,'calls.jsonl');
 fs.writeFileSync(bin,`#!${process.execPath}\nconst fs=require('fs');let prompt='';process.stdin.on('data',d=>prompt+=d);process.stdin.on('end',()=>{const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({args,env:Object.fromEntries(Object.entries(process.env).filter(([k])=>/OPENAI|CODEX|API_KEY|ACCESS_TOKEN|AUTH_TOKEN|PROVIDER/.test(k))),prompt})+'\\n');const text='{}';fs.writeFileSync(args[args.indexOf('--output-last-message')>=0?args.indexOf('--output-last-message')+1:args.indexOf('-o')+1],text);console.log(JSON.stringify({type:'thread.started',thread_id:'thread-api'}));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text}}));console.log(JSON.stringify({type:'turn.completed'}));});`,{mode:0o755});
 fs.writeFileSync(path.join(root,'skill.txt'),'执行本次活动');fs.writeFileSync(path.join(root,'tools.txt'),'本地夹具');
 fs.writeFileSync(path.join(root,'check.cjs'),`let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s);console.log(JSON.stringify({identity:Object.fromEntries(['task_id','run_id','run_tag','workflow','activity','attempt'].map(k=>[k,r[k]])),nonce:r.nonce,outcome:'passed',checks:r.checks.map(id=>({id,status:'passed',evidence:[{source:'fixture',observation:{exists:true}}]})),output:{checked:true}}));});`);
 fs.writeFileSync(path.join(root,'work.js'),`let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>console.log(JSON.stringify({schema_version:1,run_tag:JSON.parse(s).run_tag,status:'completed',outputs:{checked:true},metrics:{},evidence:[],execution_stopped:true})));`);
 const checker={command:process.execPath,command_sha256:sha(process.execPath),entry:'check.cjs',start_checks:['authority'],required_checks:['product']};
 const auth={mode:'api-only',home};
 const profile={cwd:root,codex_auth:auth,files:Object.fromEntries(['skill.txt','tools.txt','check.cjs','work.js'].map(f=>[f,sha(path.join(root,f))])),skill_runtime:{control_dir:'control',tools:'tools.txt',codex:{command:bin,command_sha256:sha(bin)},activities:{one:{skill:'skill.txt',checker}}}};
 const run={task_id:'task',run_id:'run',input:{run_tag:'tag'},contract:{workflow:'fixture'}};
 const activity={key:'one',budget:{max_duration_s:5,heartbeat_s:1},runtime:{phase:'source',executor_kind:'agent',protocol:'json-stdio-v1',entry:'work.js',interactive:false}};
 const calls=()=>fs.existsSync(capture)?fs.readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse):[];
 async function commander(overrides={}){return createCodexCommander({model:'fixture-model',codexHome:home,codexBin:bin,codexAuth:auth,transcriptPath:path.join(root,'commander.jsonl'),...overrides})({input:{}},{timeoutMs:3000});}
 async function worker(action='one'){const runtime=await createRuntime({profile,run});return runtime.executeActivity(activity,run.input,{identity:{task_id:'task',run_id:'run',action_id:action,activity_key:'one'},cwd:root,deadlineMs:Date.now()+5000});}
 return {root,home,auth,profile,run,activity,calls,commander,worker};
}
const forced=['forced_login_method="api"','cli_auth_credentials_store="file"','model_provider="openai"'];
test('两个完整caller使用同一API身份，exec/resume强制file/openai并净化继承环境',async()=>{
 const f=fixture();for(const k of ['OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','OPENAI_ACCESS_TOKEN','OPENAI_BASE_URL','CODEX_AUTHAPI_BASE_URL','OPENAI_IDENTITY_TOKEN_FILE','OPENAI_FEDERATION_RULE_ID','CODEX_MODEL_PROVIDER'])vi.stubEnv(k,'conflicting-value');vi.stubEnv('CODEX_HOME','/wrong/subscription-home');
 await f.commander();expect((await f.worker()).status).toBe('completed');expect((await f.worker('two')).status).toBe('completed');
 const calls=f.calls();expect(calls).toHaveLength(3);
 for(const call of calls){expect(call.env).toEqual({CODEX_HOME:f.home});for(const arg of forced)expect(call.args).toContain(arg);expect(call.args).toContain('--ignore-user-config');expect(call.prompt).not.toContain('synthetic-api-key');}
 expect(calls[2].args).toContain('resume');
 expect(JSON.parse(fs.readFileSync(path.join(f.root,'control','run','thread.json'),'utf8')).auth_identity).toMatch(/^[a-f0-9]{64}$/);
});
test.each(['missing','empty','oauth','mixed','directory-mode','file-mode','symlink'])('API %s两caller都在模型spawn前拒绝且无订阅fallback',async kind=>{
 const f=fixture(),file=path.join(f.home,'auth.json');
 if(kind==='missing')fs.unlinkSync(file);
 if(kind==='empty')fs.writeFileSync(file,JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:''}));
 if(kind==='oauth')fs.writeFileSync(file,JSON.stringify({auth_mode:'chatgpt',tokens:{access_token:'fake-oauth'}}));
 if(kind==='mixed')fs.writeFileSync(file,JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'synthetic-api-key',tokens:{access_token:'fake-oauth'}}));
 if(kind==='directory-mode')fs.chmodSync(f.home,0o755);
 if(kind==='file-mode')fs.chmodSync(file,0o644);
 if(kind==='symlink'){const target=path.join(f.root,'real-auth');fs.renameSync(file,target);fs.symlinkSync(target,file);}
 vi.stubEnv('CODEX_HOME','/wrong/subscription-home');
 await expect(f.commander()).rejects.toThrow();
 expect((await f.worker()).status).toBe('needs_review');expect(f.calls()).toEqual([]);
});
test.each([
 ['-c','forced_login_method="chatgpt"'],['--config=model_provider="custom"'],['-cmodel_providers.openai.base_url="http://wrong"'],['--profile','subscription'],['--oss'],
].map(args=>[args]))('worker拒绝覆盖共享认证的argv %j',async args=>{
 const f=fixture();f.profile.skill_runtime.codex.args=args;
 expect((await f.worker()).status).toBe('needs_review');expect(f.calls()).toEqual([]);
});
test.each(['CODEX_HOME','OPENAI_API_KEY','OPENAI_BASE_URL','CODEX_AUTHAPI_BASE_URL'])('worker拒绝认证env_keys覆盖%s',async key=>{
 const f=fixture();vi.stubEnv(key,'wrong');f.profile.skill_runtime.codex.env_keys=[key];
 expect((await f.worker()).status).toBe('needs_review');expect(f.calls()).toEqual([]);
});
test('Commander显式旧home冲突不启动模型；Worker同thread不允许改认证身份',async()=>{
 const f=fixture();await expect(f.commander({codexHome:path.join(f.root,'other')})).rejects.toThrow();expect(f.calls()).toEqual([]);
 expect((await f.worker()).status).toBe('completed');
 const other=path.join(f.root,'other-api');fs.mkdirSync(other,{mode:0o700});fs.copyFileSync(path.join(f.home,'auth.json'),path.join(other,'auth.json'));fs.chmodSync(path.join(other,'auth.json'),0o600);
 f.profile.codex_auth={mode:'api-only',home:other};expect((await f.worker('two')).status).toBe('needs_review');expect(f.calls()).toHaveLength(1);
});
test('已提交动作readback与Code执行不读取缺失API凭据',async()=>{
 const f=fixture();expect((await f.worker()).status).toBe('completed');fs.unlinkSync(path.join(f.home,'auth.json'));
 const runtime=await createRuntime({profile:f.profile,run:f.run});
 expect((await runtime.inspectActivity(f.activity,f.run.input,{identity:{task_id:'task',run_id:'run',action_id:'one',activity_key:'one'}})).state).toBe('completed');
 f.activity.runtime.executor_kind='code';expect((await f.worker('cleanup')).status).toBe('completed');expect(f.calls()).toHaveLength(1);
});
