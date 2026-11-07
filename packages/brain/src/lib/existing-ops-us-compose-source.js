/** US退役配置仅认完整受审组合；不执行候选源码，不读取凭据或生产机器。 */
import { createHash } from 'node:crypto';
const COMPOSE = 'docker-compose.us-vps.yml';
const hash = text => createHash('sha256').update(text).digest('hex');
const PATHS = {
  "guard": "packages/brain/src/openclaw-guards.js",
  "host": "packages/brain/src/host-exec.js",
  "notion": "packages/brain/src/notion-push-sync.js",
  "template": "packages/brain/src/lib/openclaw-dispatch-template.js",
  "defaults": "packages/brain/src/lib/openclaw-dispatch-defaults.js",
  "ledger": "packages/brain/src/feishu-task-ledger.js",
  "ingest": "packages/brain/src/openclaw-run-ingest.js"
};
const HASHES = {
  "guard": "9d6933a6d7ed61955c5ebd920357c5d08500e2a2e665d5bc3f08958cb0202063",
  "host": "11d58722a08d8b4c4d0fb9afa107c5840c3845302dcead62d4653a501c182daf",
  "notion": "22cbe332597cfe00cba9c5950d81b6ce267dbaa9e78f081403053713630a659c",
  "template": "0c964c2d5e81c1feeb7ed5ea72ef8a3e0272da48ee72e53174b11d3ae8a17fe4",
  "defaults": "0572c1c9dcd5e9b31ac49c2ea3355c0c0c2e0b7fdd30117c559b6bbeb97e3a7a",
  "ledger": "7c749eb053dc5eabe6160dcf5ec854857fc27eb215832823599079fd23ae29bc",
  "ingest": "f12d790cdb7e7cf61e97e0e1d85034fccf1a2ab1c73296b8e736dbff9a39e709"
};
// 四个阶段来自真实候选4d7ed2a5/f6cc5bc1f/e5b9437c4父树/e5b9437c4。
// final卸挂载额外要求远端ledger，不能仅靠compose哈希解锁。
const STAGES = {
  "7d152cec3fea0f50cab0a707bd7830a01c620953ffcc99851be27e384aca405b": [
    "guard",
    "host"
  ],
  "81621e0bac0ae54045b5c4d2973c15ca7e960c87cf4406028d03c45d3e9a8d5a": [
    "notion",
    "template",
    "defaults"
  ],
  "ed11f478e6ca21f997fb26c0fc4e7baddfd5a17a36789aa3e5da17a56f26d617": [
    "guard",
    "host",
    "notion",
    "template",
    "defaults"
  ],
  "ef7b77ce25f3d91e8be933fd604bbbd3dd0457fab6a5c1bd1a72f8d6fb10baf2": [
    "guard",
    "host",
    "notion",
    "template",
    "defaults",
    "ledger",
    "ingest"
  ]
};
// 当前 outreach 去抖修复只审 remote 阶段完整组合；不能逐文件 OR 到其它历史阶段。
const REVIEWED_REMOTE_COHORT = {
 compose: '7d152cec3fea0f50cab0a707bd7830a01c620953ffcc99851be27e384aca405b',
 sources: {
  guard: '05c28b3d6957c9bc364743fde291a4648389385eb62151032f8faf93a2c617e4',
  host: '11d58722a08d8b4c4d0fb9afa107c5840c3845302dcead62d4653a501c182daf',
 },
};
const EDGES = [
 ['guard','host'], ['notion','template'], ['template','defaults'],
 ['ledger','host'], ['ledger','ingest'], ['ingest','host'],
];
export async function proveReviewedUsCompose({ text, read, relations, revision }) {
 if (typeof text !== 'string') return false;
 const composeHash = hash(text);
 const selected = STAGES[composeHash];
 if (!selected) return false;
 // read()记录同一次返回的真实字节；必须全体通过才追加关系。
 const actual = {};
 for (const name of selected) {
  const bytes = await read(PATHS[name]);
  if (typeof bytes !== 'string') return false;
  actual[name] = hash(bytes);
 }
 const cohorts = [Object.fromEntries(selected.map(name => [name, HASHES[name]]))];
 if (composeHash === REVIEWED_REMOTE_COHORT.compose) cohorts.push(REVIEWED_REMOTE_COHORT.sources);
 if (!cohorts.some(group => Object.keys(group).length === selected.length
   && selected.every(name => actual[name] === group[name]))) return false;
 for (const name of ['guard','notion','ledger'].filter(n=>selected.includes(n)))
  relations.push({consumer_path:COMPOSE,input_path:PATHS[name],kind:'reviewed_us_openclaw_prerequisite',revision});
 for (const [from,to] of EDGES) if (selected.includes(from) && selected.includes(to))
  relations.push({consumer_path:PATHS[from],input_path:PATHS[to],kind:'reviewed_us_openclaw_static_import',revision});
 return true;
}

// 已审历史部署消费源：生产 compose 与 staging 共用的固定输入。
const REVIEWED_LEGACY_STAGING_INPUTS=Object.freeze({
   '.skills-source.json':'3ffcaf4a8fc3af78dc0297df88141e2f8a704e4f681856953618e93dd1b74386',
   'scripts/ensure-skills-source.sh':'d605139c61e0567e8ec0fbe94356ca63f81ece4d613dc6307814a54f20c233d0',
   'scripts/skills-source.py':'500517f4b1493696062d36aa0c1c45d9b1d63f0093f96ae290aa0f5d8f022ab6',
   'packages/brain/src/db-config.js':'5dfa5b8490b65d322f542b1d693784125de91fa87264a556a53bb099a2347fb0',
   'scripts/lib/bluegreen.sh':'ca287873ef216a990fd57e588284e401218969294df17ab48592653262ed74d6',
   'packages/quality/smoke-core.txt':'15ea889c19d29543b86fd05a4d5bcf8275c92858080ccf032c0a05fc76a96003',
   'packages/brain/scripts/smoke/healthz-smoke.sh':'64961c8f288cbd2bd2c674bb2de6870cd50d95038a186fb0db95771cc13f5da2',
   'packages/brain/scripts/smoke/version-endpoint-smoke.sh':'b107f452f07b3ff86ab4fc8c651522c759fba59a36f60af319f5d397320e0503',
   'packages/brain/scripts/smoke/harness-ping-smoke.sh':'4988ef2a018aac906f7f5e95e58f75d09cf6c94040018f88ab1b0c7abe6b5b8d',
   'packages/brain/scripts/smoke/harness-echo-smoke.sh':'92ec4a5174aadbacf668fea98e12ce54868a332a7b0032c9d8c379dfd6c997f0',
   'packages/brain/scripts/smoke/harness-schema-validation-smoke.sh':'097585a73ecc525c576aee6cdcd520ec2f90b12e6479a200de137bd8d3256359',
  });

// 只认审核过的完整 staging 消费组合，不能按文件单独拼配。
export async function matchesReviewedStagingTuple({read,budget,stagingFiles,settlementFiles,smokeList,smokes}) {
 const workflow=await read('.github/workflows/auto-staging-deploy.yml');
 if(!budget||!workflow||hash(workflow)!=='400fde7d031188fc87b9a8abbaf0f4fa48374c60e0d6c657c4e0218366dfcecb')return false;
 const paths=[...new Set([...Object.keys(stagingFiles),...Object.keys(settlementFiles),'scripts/brain-build.sh','packages/brain/src/db-config.js','.skills-source.json','scripts/ensure-skills-source.sh','scripts/skills-source.py',smokeList,...smokes])].filter(p=>!p.startsWith('scripts/lib/brain-bootstrap')).sort();
 const parts=[];
 for(const path of paths){const text=await read(path);if(!text)return false;parts.push(`${path}\0${hash(text)}\n`);}
 return hash(parts.join(''))==='8616636415530b9cc8d0b32a9f77b9364d41e0453e2058f9dd6e504237681721';
}

export async function verifyLegacyStagingInputs({read,requireProof,relations,revision}) {
 for(const[path,digest]of Object.entries(REVIEWED_LEGACY_STAGING_INPUTS)){
  const text=await read(path);requireProof(text&&hash(text)===digest,'isolated_staging_source_unproven');
 }
 relations.push({consumer_path:'scripts/lib/bluegreen.sh',input_path:'packages/quality/smoke-core.txt',kind:'reviewed_pre_swap_smoke_list',revision});
 for(const input_path of Object.keys(REVIEWED_LEGACY_STAGING_INPUTS).filter(p=>p.startsWith('packages/brain/scripts/smoke/')))
  relations.push({consumer_path:'packages/quality/smoke-core.txt',input_path,kind:'reviewed_pre_swap_smoke_script',revision});
}
