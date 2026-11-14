#!/usr/bin/env node
// 独立opt-in宿主：受信清单冻结实现；业务表只走显式迁移，DBOS管理自己的系统schema。
// adapter是操作者提供的受信代码，必须在files中声明其活动/Skill依赖；不是模型可选的插件。
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {normalizeCodexAuth} from '../coding-workflow/lib/codex-auth.mjs';
import {DBOS} from '@dbos-inc/dbos-sdk';
import {configureCommanderWorkflow,startCommanderWorkflow} from '../../src/durable/commander-workflow.js';
import {createCommanderActionStore} from '../../src/durable/commander-action-store.js';
import {createCodexCommander} from '../../src/orchestrator/commander-codex.js';
import {durableWrite} from '../../src/orchestrator/activity-supervisor.js';
import {digest,normalizeCommanderRun} from '../../src/orchestrator/commander-decision.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runtimeFiles = ['supervise.mjs','skill-adapter.mjs','skill-worker.mjs','skill-protocol.mjs','../../src/orchestrator/activity-supervisor.js','../../src/orchestrator/activity-supervisor-state.cjs','host.mjs','../../src/durable/commander-workflow.js','../../src/durable/commander-action-store.js',
  '../../src/orchestrator/commander-decision.js','../../src/orchestrator/commander-codex.js',
  '../coding-workflow/lib/codex-judge.mjs','../coding-workflow/lib/claude.mjs','../coding-workflow/lib/codex-session.mjs',
  '../coding-workflow/lib/provenance-path.mjs','../coding-workflow/lib/preview-bridge.mjs','../../../../package-lock.json',
  '../../src/orchestrator/activity-runtime.js','../../src/orchestrator/activity-contract.js','../../src/orchestrator/activity-process.js','../../src/orchestrator/activity-judgment.js'];
export function loadCommanderManifest(filename) {
  const manifest = JSON.parse(fs.readFileSync(filename,'utf8')), profile = manifest.profile;
  if (!profile || !path.isAbsolute(profile.cwd) || typeof profile.adapter !== 'string' || !profile.files?.[profile.adapter]
    || !['codex','adapter'].includes(profile.commander?.provider)) throw Error('commander_profile_invalid');
  if(profile.codex_auth!==undefined)profile.codex_auth=normalizeCodexAuth(profile.codex_auth,profile.commander.codexHome);
  const cwd = fs.realpathSync(profile.cwd);
  function verifySource() {
    for (const [entry,expected] of Object.entries(profile.files)) {
      if (!/^[a-f0-9]{64}$/.test(expected) || path.isAbsolute(entry)) throw Error('commander_profile_invalid');
      const resolved = fs.realpathSync(path.resolve(cwd,entry));
      if (!resolved.startsWith(cwd+path.sep) || hash(fs.readFileSync(resolved)) !== expected) throw Error('commander_source_drift');
    }
    if (Object.entries(kernel).some(([file,expected]) => hash(fs.readFileSync(new URL(file,import.meta.url))) !== expected)) throw Error('commander_runtime_source_drift');
    if (manifest.run.contract.activities.some(a => !profile.files[a.runtime.entry])) throw Error('commander_source_unfrozen');
  }
  const providerDirectory = new URL('../coding-workflow/lib/',import.meta.url);
  const implementationFiles = [...runtimeFiles,...fs.readdirSync(providerDirectory).filter(p => p.endsWith('.mjs')).map(p => '../coding-workflow/lib/'+p)];
  const kernel = Object.fromEntries(implementationFiles.map(p => [p,hash(fs.readFileSync(new URL(p,import.meta.url)))]));
  verifySource();
  const revision = digest({profile,kernel});
  return {profile:{...profile,cwd},verifySource,revision,run:{...manifest.run,runtime_revision:revision}};
}
export async function runCommanderHost({manifestPath,resultPath}) {
  if (process.env.DBOS_DURABLE_ENABLED !== 'true') throw Error('commander_durable_unavailable');
  const {profile,verifySource,revision,run} = loadCommanderManifest(manifestPath);
  const schema = process.env.COMMANDER_DATABASE_SCHEMA ?? 'public', dbosSchema = process.env.COMMANDER_DBOS_SCHEMA ?? 'commander_workflow_dbos';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema) || !/^[a-z][a-z0-9_]{0,62}$/.test(dbosSchema) || schema === dbosSchema) throw Error('commander_schema_invalid');
  const url = process.env.COMMANDER_DATABASE_URL;
  if (!url) throw Error('commander_database_required');
  normalizeCommanderRun(run);
  const pool = new pg.Pool({connectionString:url,options:`-c search_path=${schema}`,max:5});
  const owner = new pg.Client({connectionString:url,application_name:`commander-owner-${run.run_id}`,statement_timeout:5000,query_timeout:6000,keepAlive:true});
  const ownerKey = BigInt.asIntN(64,BigInt('0x'+hash('commander-foundation:'+run.run_id).slice(0,16))).toString();
  let held=false,closing=false,lost=false;
  const revoke = () => {
    lost=true;
    // 丢失独占权的独立宿主不能再提交DBOS终态；外部动作仍由新宿主只读回。
    if(held&&!closing){console.error('commander_host_ownership_lost');process.exit(1);}
  };
  owner.on('error',revoke);owner.on('end',revoke);
  const verifyOwnership = async () => {
    if(!held||lost)throw Error('commander_host_ownership_lost');
    try{await owner.query('SELECT 1');}catch{revoke();throw Error('commander_host_ownership_lost');}
    verifySource();
  };
  try {
    await owner.connect();
    held=(await owner.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired',[ownerKey])).rows[0].acquired;
    if(!held)throw Error('commander_host_already_running');
    const adapter = await import(pathToFileURL(path.resolve(profile.cwd,profile.adapter)).href);
    const env = await adapter.createRuntime({profile,pool,run:normalizeCommanderRun(run),verifySource:verifyOwnership});
    const decide = profile.commander.provider === 'codex' ? createCodexCommander({...profile.commander,codexAuth:profile.codex_auth,manifestPath:path.resolve(manifestPath)}) : env.decide;
    configureCommanderWorkflow({...env,decide,cwd:profile.cwd,revision,verifySource:verifyOwnership,actionStore:createCommanderActionStore(pool)});
    DBOS.setConfig({name:'cecelia-commander-foundation',applicationVersion:revision,executorID:`commander-${run.run_id}`,
      systemDatabaseUrl:url,systemDatabaseSchemaName:dbosSchema});
    await DBOS.launch();
    const {workflow_id,handle} = await startCommanderWorkflow(run);
    const result = await handle.getResult();
    const output = {...result,workflow_id,runtime_revision:revision,definition_sha256:normalizeCommanderRun(run).definition_sha256};
    durableWrite(resultPath,output);
    return output;
  } finally {
    try{if(DBOS.isInitialized())await DBOS.shutdown();}
    finally{closing=true;await owner.end().catch(()=>{});await pool.end();}
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--manifest' || args[2] !== '--result') throw Error('usage: host.mjs --manifest FILE --result FILE');
  const output=await runCommanderHost({manifestPath:path.resolve(args[1]),resultPath:path.resolve(args[3])});
  console.log(JSON.stringify({status:output.status,run_id:output.run_id,result_path:path.resolve(args[3])}));
  if(output.status!=='completed')process.exitCode=2;
}
