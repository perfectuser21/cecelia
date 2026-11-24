import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {computeBundleDigest,apiKeyIdentityFingerprint} from '../../../scripts/native-agent/bundle.mjs';
import {nativeAgentTransport} from '../../lib/native-agent-transport.js';
const hash=x=>createHash('sha256').update(x).digest('hex');
/** 真实CLI/worker/进程/退出收据；仅Codex外部命令替换为本例无网络程序。 */
export function createNativeAgentHostFixture({accountRef='fixture-account'}={}){
 const previousHandoff=process.env.HANDOFF_DOCS_DIR;
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-brain-pg-')));fs.chmodSync(root,0o700);
 const handoffPath=path.join(root,'handoffs');process.env.HANDOFF_DOCS_DIR=handoffPath;
 for(const name of ['home','auth','cwd','state','skills'])fs.mkdirSync(path.join(root,name),{mode:0o700});
 fs.writeFileSync(path.join(root,'auth/auth.json'),JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'isolated-native-fixture'}),{mode:0o600});
 const command=fileURLToPath(new URL('./native-agent-command-fixture.cjs',import.meta.url));
 const brainRoot=fileURLToPath(new URL('../../../',import.meta.url)),sha=computeBundleDigest(brainRoot);
 const config={protocol:'native-agent-config/v1',bundle_sha256:sha,state_dir:path.join(root,'state'),profiles:[{
  tenant:'fixture-native',department:'main',role:'agent',account_ref:accountRef,models:['fixture-model'],model_aliases:{'fixture-model':'fixture-model'},thinking:['medium'],timeout_ms:1800000,terminate_grace_ms:100,
  command,command_sha256:hash(fs.readFileSync(command)),cwd:path.join(root,'cwd'),home:path.join(root,'home'),codex_home:path.join(root,'auth'),auth_mode:'api-only',auth_identity_salt:'fedcba9876543210'.repeat(4),auth_identity_sha256:apiKeyIdentityFingerprint('isolated-native-fixture','fedcba9876543210'.repeat(4)),codex_config_sha256:hash(''),codex_config_present:false,skill_roots:[path.join(root,'skills')],skills:{}}]};
 const configPath=path.join(root,'config.json');fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
 const host={machine_id:'us-mac-m4',cli_path:path.join(brainRoot,'scripts/native-agent/cli.mjs'),config_path:configPath,bundle_sha256:sha};
 const transport=(h,r)=>nativeAgentTransport(h,r,{spawnFn:(_command,_args,options)=>spawn(process.execPath,[h.cli_path,h.config_path,h.bundle_sha256],{...options,env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:root}})});
 const launches=()=>fs.existsSync(path.join(root,'launches'))?fs.readFileSync(path.join(root,'launches'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 return {root,host,transport,launches,env:{BRAIN_NATIVE_AGENT_DEFAULT_ACCOUNT_REF:accountRef,BRAIN_NATIVE_AGENT_DEFAULT_MODEL:'fixture-model',BRAIN_NATIVE_AGENT_DEFAULT_THINKING:'medium',BRAIN_NATIVE_AGENT_DEFAULT_TIMEOUT_SEC:'1800'},
  close:()=>{if(process.env.HANDOFF_DOCS_DIR===handoffPath){if(previousHandoff===undefined)delete process.env.HANDOFF_DOCS_DIR;else process.env.HANDOFF_DOCS_DIR=previousHandoff;}for(const launch of launches())try{process.kill(-launch.pid,'SIGKILL');}catch{}fs.rmSync(root,{recursive:true,force:true});}};
}
