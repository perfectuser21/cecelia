import { createHash } from 'node:crypto';
import { digest } from '../../src/orchestrator/commander-decision.js';
import { execFile } from 'node:child_process';
import { mkdirSync, lstatSync, realpathSync, readFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { codexAuthEnvironment, prepareCodexAuth } from '../coding-workflow/lib/codex-auth.mjs';
import { readOwnedFile } from './launch.mjs';
import { durableWrite } from '../../src/orchestrator/activity-supervisor.js';

const execute = promisify(execFile);
// 发布 Profile 包含完整冻结定义和已核验部署文件清单。
const maxProfileBytes = 8 * 1024 * 1024;
const discoveryKey = 'douyin_video_discovery';
const collectionKey = 'douyin_video_processing';
const scoringKey = 'douyin_comment_scoring';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const same = (left, right, hash) => hash(left) === hash(right);

export async function confirmDiscovery(video, keyword, call) {
  const id = video?.videoId ?? video?.video_id;
  if (typeof id !== 'string' || !/^\d{16,24}$/.test(id) || video.keyword !== keyword) return null;
  const url = 'https://www.douyin.com/video/' + id;
  if ((video.videoUrl ?? video.video_url) !== url || typeof video.metrics?.digest !== 'string') return null;
  const observed = await call('business', { operation:'discover_readback', input:{video} });
  const proof = observed?.result?.result;
  if (observed?.ok !== true || observed.result?.ok !== true || proof?.metrics_verified !== true
    || proof.metrics_digest !== video.metrics.digest
    || (proof.handoff && (proof.handoff.video_id !== id || proof.handoff.video_url !== url))) return null;
  return { summary:'已采集一条视频，业务数据与指标已入库读回', evidence:[url] };
}

const preparationModules = ['public-domain-snapshot.mjs','runtime-definition.mjs'];
const runtimeModules = ['standalone-skill-runtime.mjs','standalone-skill-ipc.mjs'];

function verifyToolkitFiles(root, files) {
  for (const [entry, sha256] of Object.entries(files)) {
    if (isAbsolute(entry) || entry.split('/').some(part=>!part||part==='.'||part==='..')) throw Error('standalone_provider_toolkit_unfrozen');
    const file = join(root,entry);
    const info = lstatSync(file,{throwIfNoEntry:false});
    if (!info?.isFile() || realpathSync(file)!==file || (info.mode & 0o022)
      || createHash('sha256').update(readFileSync(file)).digest('hex')!==sha256) throw Error('standalone_provider_toolkit_drift');
  }
}

async function loadFrozenRuntime(directory, snapshot, profile) {
  const root = join(directory,'runtime');
  const files = profile.files ?? {};
  const frozen = snapshot.files ?? {};
  if (runtimeModules.some(name=>!Object.hasOwn(files,name))
    || Object.entries(files).some(([name,hash])=>!Object.hasOwn(frozen,'runtime/'+name)||frozen['runtime/'+name]!==hash)) {
    throw Error('standalone_provider_toolkit_unfrozen');
  }
  if (realpathSync(root)!==root) throw Error('standalone_provider_toolkit_drift');
  verifyToolkitFiles(root,files);
  // Native admission ties its module directory to the frozen runtime root.
  const [native, ipc] = await Promise.all(runtimeModules.map(name=>import(pathToFileURL(join(root,name)).href)));
  return {start:native.startStandaloneSkillRuntime,call:ipc.callStandaloneSkillTool};
}

export async function createDiscoveryServices(job, {profile, skillPath, stateRoot, phoneEnv={}, codex, toolkit}, {post, runModel} = {}) {
  const domain = profile?.domain_adapter;
  const cfg = domain?.config;
  const source = cfg?.snapshot;
  const resource = cfg?.resources;
  const input = job.input;
  const key = job.workflow_key ?? discoveryKey;
  const scoring = key === scoringKey;
  const collection = key === collectionKey;
  const hasSource = scoring || collection;
  const stage = scoring ? '103' : collection ? '102' : '101';
  const businessRange = hasSource ? { source_run: input?.business?.source_run } : {};
  const keyword = input?.business?.keyword;
  const approvedKeywords = hasSource ? [] : [keyword];
  const validSource = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(businessRange.source_run ?? '')
    && businessRange.source_run !== job.run_id;
  const validResource = scoring
    ? resource?.profile === 'mmv-scoring' && resource.serial === 'none' && resource.account === 'none'
    : [resource?.profile,resource?.serial,resource?.account].every(value => typeof value === 'string' && value !== '' && value !== 'none');
  const validBusiness = validResource && (hasSource ? validSource
    : key === discoveryKey && typeof keyword === 'string' && input?.business?.max_candidates === 1);
  if (cfg?.primary_host !== 'codex-exec-v1' || cfg.workflow_key !== key || resource?.machine !== job.machine_id
    || source?.release?.id !== job.release_id || source.workflow_version?.id !== job.definition?.workflow_definition_version_id
    || source.deployment?.observation_id !== job.definition?.observation_id || !validBusiness) {
    throw Error('standalone_profile_mismatch');
  }
  const { hash, agentInput, preparePublicDomainSnapshot } = toolkit;
  const skill = cfg.standalone_skill;
  const { max_duration_s:work, cleanup_grace_s:grace } = domain.budget;
  if (!uuid.test(job.run_id) || !uuid.test(job.task_id) || !isAbsolute(stateRoot) || realpathSync(stateRoot) !== stateRoot
    || !Number.isSafeInteger(work) || work < 1 || !Number.isSafeInteger(grace) || grace < 1
    || skill?.path !== 'skill/SKILL.md' || hash(readOwnedFile(skillPath)) !== skill.sha256) throw Error('standalone_job_invalid');
  const state = lstatSync(stateRoot);
  if (!state.isDirectory() || state.uid !== process.getuid() || state.mode & 0o077) throw Error('standalone_state_root_untrusted');
  const phoneKeys = new Set(['DOUYIN_PHONE_REGISTRY','DOUYIN_ACCOUNT_REGISTRY','DOUYIN_PHONE_TMP_ROOT','DOUYIN_PHONE_LOCK_ROOT']);
  if (Object.entries(phoneEnv).some(([name,value])=>!phoneKeys.has(name)||typeof value!=='string'||/[\0\r\n]/.test(value))) {
    throw Error('standalone_phone_env_invalid');
  }
  const dir = join(stateRoot, job.run_id);
  const modelOutput = join(dir, 'agent-receipt.json');
  const start = Math.floor(Date.now()/1000);
  const deadline = (start+work)*1000, cleanupDeadline = (start+work+grace)*1000;
  const company = cfg.company;
  const selectedInput = { task_id:job.task_id, run_tag:job.run_id, profile:resource.profile, serial:resource.serial, line:resource.line, limit:1, ...businessRange };
  const scope = {
    ...agentInput({
      ...cfg.env, LEADGEN_EXECUTION_MODE:'agent', WF_BRAIN_WORKFLOW:key, WF_BRAIN_TASK_ID:job.task_id, WFR_TAG:job.run_id,
      P:resource.profile, SERIAL:resource.serial, LEADGEN_LINE:resource.line, LEADGEN_LIMIT:'1',
      ...(hasSource ? { LEADGEN_SOURCE_RUN:businessRange.source_run } : {}),
      WF_RUN_START_TS:String(start), WF_RUN_MAX_SECONDS:String(work+grace),
    }),
    source_commit:source.deployment.source_commit, expected_account:resource.account, company,
    machine_id:job.machine_id, approved_keywords:approvedKeywords,
  };
  const references = Object.fromEntries(source.activities.map(({reference})=>[reference.slot_key,{
    reference_id:reference.reference_id, activity_id:reference.activity_id, activity_definition_version_id:reference.activity_version_id,
  }]));
  const auth = runModel ? null : prepareCodexAuth(codex.auth,{codex:{args:[],env_keys:[]}});
  if (!runModel && (!auth || !isAbsolute(codex.command) || !codex.model)) throw Error('standalone_codex_unconfigured');
  let nativeHost, callStandaloneSkillTool;

  return {
    async startHost() {
      mkdirSync(dir,{mode:0o700});
      const started = await post('runs/'+job.run_id+'/start-skill',{
        task_id:job.task_id, claimer:job.claimer, claimed_at:job.claimed_at,
        definition:{...job.definition,runtime_snapshot_sha256:profile.metadata[source.activities[0].reference.slot_key].runtime_snapshot_sha256,
          attempt_key:job.task_id+':1',actor:job.claimer},
        standalone:{scope,skill},
      });
      const binding = started.binding;
      const identity = {
        protocol:'codex-exec-v1', task_id:job.task_id, run_id:job.run_id, claimer:job.claimer, claimed_at:job.claimed_at, machine_id:job.machine_id,
        profile_sha256:hash(profile), skill, task_run_id:started.task_run_id, approved_keywords:approvedKeywords,
        run_binding:{ run_binding_id:binding.id, source_kind:binding.source_kind, workflow_id:binding.workflow_id,
          workflow_definition_version_id:binding.workflow_definition_version_id,attempt_key:binding.attempt_key,activities:references },
        input:selectedInput,
      };
      const prepared = preparePublicDomainSnapshot({identity,profile,runDirectory:dir,deadline_ms:deadline,cleanup_deadline_ms:cleanupDeadline,standaloneSkillPath:skillPath});
      const snapshot = prepared.snapshot;
      if (!same(scope,snapshot.standalone_skill.scope,hash)) throw Error('standalone_scope_drift');
      durableWrite(join(dir,'run-definition.json'),{...snapshot,snapshot_sha256:hash(snapshot)});
      const attestation = Object.fromEntries([
        'protocol','task_id','run_id','claimer','claimed_at','machine_id','profile_sha256','skill','scope_sha256',
        'run_binding','task_run_id','company','approved_keywords',
      ].map(field=>[field,snapshot.standalone_skill[field]]));
      const reply = await post('workflow-foundation/standalone/attest',{machine_id:job.machine_id,identity:attestation});
      if (reply.attested !== true) throw Error('standalone_attestation_unconfirmed');
      const runtime=await loadFrozenRuntime(dir,snapshot,profile);
      nativeHost=await runtime.start({runDirectory:dir,environment:{...prepared.env,...phoneEnv}});
      callStandaloneSkillTool=runtime.call;
      return nativeHost;
    },
    async runAgent({connectionPath}) {
      const prompt = [
        `执行冻结的 ${stage} Skill。先读取 skill/SKILL.md 和 skill/references/${stage}.md。只处理本单的一条候选。`,
        '通过以下本轮工具连接执行，不直接读取宿主凭据或访问业务数据库。',
        JSON.stringify({tool_command:[process.execPath,join(dir,'runtime','standalone-skill-runtime.mjs'),'call',connectionPath],
          tool_protocol:`在命令尾追加 ${scoring ? 'inspect 或 business' : 'inspect、phone 或 business'}，并将参数对象通过 stdin 传入。`,
          ...(hasSource ? businessRange : {metrics_command:[process.execPath,join(dir,'runtime','standalone-skill-runtime.mjs'),'metrics',dir],keyword})}),
        scoring ? '按 Skill 调用 score_input 取得冻结评论和政策。由当前 Agent 评分，用 score_submit 提交结论。随后核验原评分、标记及配送。提交回执不明时只读回原操作。'
          : collection ? '按 Skill 从本轮固定的 101 来源领取视频，完成资格与评论采样、持久化并做真实范围读回。部分提交保留已有结果。'
          : '最终只返回 JSON 对象 {"video": <提交给 discover 的同一个 video 对象>}。没有入库候选时返回 {"video":null}。',
      ].join('\n');
      if (runModel) return runModel({connectionPath,modelOutput,prompt});
      const remaining = deadline-Date.now();
      if (remaining < 1000) throw Error('standalone_work_deadline');
      const execution = execute(codex.command,['exec',...auth.args,'--model',codex.model,'--skip-git-repo-check','--output-last-message',modelOutput,prompt],{
        cwd:dir, env:codexAuthEnvironment({PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8'},auth.auth),
        timeout:remaining,maxBuffer:4*1024*1024,
      });
      // Codex reads piped stdin to EOF even when the prompt is already in argv.
      execution.child.stdin?.on('error',()=>{});
      execution.child.stdin?.end();
      await execution;
    },
    async verifyBusiness({connectionPath}) {
      if (scoring) {
        const proof=await nativeHost?.readEvidence?.();
        const comments=proof?.comment_ids,leads=proof?.lead_ids,delivery=Object.entries(proof?.delivery_states ?? {});
        if (!Array.isArray(comments)||comments.length!==1||!uuid.test(comments[0])||!Array.isArray(leads)||leads.length>1
          ||leads.some(id=>!uuid.test(id))||delivery.length!==leads.length
          ||delivery.some(([id,status])=>!uuid.test(id)||!['confirmed','excluded'].includes(status))) return null;
        return {summary:'一条指定来源评论已完成评分与标记，实际配送状态已读回',
          evidence:[`leadgen:comment:${comments[0]}`,...leads.map(id=>`leadgen:lead:${id}`),...delivery.map(([id,status])=>`leadgen:delivery:${id}:${status}`)]};
      }
      if (collection) {
        const proof = await nativeHost?.readEvidence?.();
        const videoId = proof?.video_id, comments = proof?.comment_ids;
        if (proof?.source_run !== businessRange.source_run || typeof videoId !== 'string'
          || !/^\d{16,24}$/.test(videoId) || proof.video_url !== 'https://www.douyin.com/video/' + videoId
          || proof.qualification !== 'matched' || !['sampled','exhausted'].includes(proof.coverage)
          || !Number.isInteger(proof.sample_target) || proof.sample_target < 1 || proof.sample_target > 5
          || !Array.isArray(comments) || !comments.length || comments.length > proof.sample_target
          || new Set(comments).size !== comments.length || !comments.every(value => uuid.test(value))
          || proof.coverage === 'sampled' && comments.length !== proof.sample_target) return null;
        return { summary:'已按指定视频完成资格判断及评论采集，评论已持久化读回',
          evidence:[proof.video_url,...comments.map(id=>`leadgen:comment:${id}`)] };
      }
      const result = JSON.parse(readOwnedFile(modelOutput));
      return confirmDiscovery(result.video, keyword, (operation,payload)=>callStandaloneSkillTool(connectionPath,operation,payload));
    },
  };
}

export async function createProvider(job, options) {
  if (!process.env.CECELIA_INTERNAL_TOKEN || process.env.BRAIN_INTERNAL_TOKEN !== process.env.CECELIA_INTERNAL_TOKEN) {
    throw Error('standalone_provider_brain_credentials_unavailable');
  }
  const binding = Object.hasOwn(options.bindings,job.input.binding_key) ? options.bindings[job.input.binding_key] : null;
  if (!binding || binding.tenant_id !== job.tenant_id) throw Error('standalone_provider_binding_missing');
  const profile = JSON.parse(readOwnedFile(binding.profile, { maxBytes: maxProfileBytes }));
  if (digest(profile) !== binding.profile_sha256) throw Error('standalone_provider_profile_drift');
  const root = profile.cwd;
  if (!isAbsolute(root) || realpathSync(root) !== root || !lstatSync(root).isDirectory()) throw Error('standalone_provider_root_invalid');
  if ([...preparationModules,...runtimeModules].some(name=>!Object.hasOwn(profile.files ?? {},name))) {
    throw Error('standalone_provider_toolkit_unfrozen');
  }
  verifyToolkitFiles(root,profile.files);
  const toolkit = Object.assign({}, ...await Promise.all(preparationModules.map(name=>import(pathToFileURL(join(root,name)).href))));
  return createDiscoveryServices(job,{profile,skillPath:binding.skill_path,stateRoot:options.state_root,
    phoneEnv:binding.phone_env,codex:options.codex,toolkit},{
    post:async (endpoint,body)=>{
      const response=await fetch('http://127.0.0.1:5221/api/brain/'+endpoint,{
        method:'POST',headers:{'content-type':'application/json','x-internal-token':process.env.CECELIA_INTERNAL_TOKEN},
        body:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error',
      });
      if (!response.ok) throw Error('standalone_provider_brain_'+response.status);
      return response.json();
    },
  });
}
