/** 经审B补丁的完整模式变体；不读候选自身声明来扩大允许范围。 */
import {workflowHash,CI_BUILD_DEDUP_WORKFLOW,CI_BUILD_DEDUP_INPUTS,PREVIEW_RETIREMENT_WORKFLOW,PREVIEW_RETIREMENT_INPUTS,MAIN_AUTO_DEPLOY_WORKFLOW,MAIN_AUTO_DEPLOY_INPUTS,BIND_MOUNT_MARKER,BIND_MOUNT_LEGACY_INPUTS,BIND_MOUNT_INPUTS,CANDIDATE_BUILDER_MARKER,CANDIDATE_BUILDER_LEGACY_INPUTS,CANDIDATE_BUILDER_INPUTS,RUNTIME_IDEMPOTENCE_MARKER,RUNTIME_IDEMPOTENCE_INPUTS,NIGHTLY_STATUS_MARKER,NIGHTLY_STATUS_LEGACY_INPUTS,NIGHTLY_STATUS_INPUTS} from './existing-ops-ci-build-dedup-source.js';
import {STAGE_ENVELOPES} from './existing-ops-stage-envelopes.js';
const SKILLS_PROFILE = {
  "key": "zenithjoy-skills",
  "default": false,
  "enabled": true,
  "slug": "perfectuser21/zenithjoy-skills",
  "origin": "https://github.com/perfectuser21/zenithjoy-skills.git",
  "aliases": [
    "zenithjoy-skills"
  ],
  "clone": "~/perfect21/zenithjoy-skills-cw-runner",
  "worktree_base": "~/worktrees/zenithjoy-skills-cw",
  "state_ns": "zenithjoy-skills",
  "required_checks": [
    "lint-skills"
  ],
  "base_fresh_check": null,
  "install": [
    "python3",
    "--version"
  ],
  "qa_smoke": null,
  "version_fragment": null,
  "preview": {
    "type": "local"
  },
  "production_re": [
    ":5200\\b",
    "100\\.86\\.118\\.99",
    "\\bhk-vps\\b",
    "\\b(?:mmv|xian-m4)\\b",
    "\\badb\\b"
  ],
  "automerge": false,
  "prechecks": "skills",
  "rules_prompt": "prompts/repo-rules/skills.md"
};
const base=STAGE_ENVELOPES.mode;
const repos=JSON.parse(base['repos.json']);
export const REVIEWED_STAGE_MODES=Object.freeze([base,{
 ...base,
 'lib/repo-profile.mjs':base['lib/repo-profile.mjs'].replace("['cecelia', 'zenithjoy']", "['cecelia', 'zenithjoy', 'skills']"),
 'repos.json':JSON.stringify({...repos,repos:[...repos.repos,SKILLS_PROFILE]}),
}]);

// 只改变Cecelia登记的必需汇总名，其余完整仓库模式保持已审Skills变体。
export const BASIC_CI_STAGE_MODE=Object.freeze({
 ...REVIEWED_STAGE_MODES[1],
 'repos.json':JSON.stringify({...JSON.parse(REVIEWED_STAGE_MODES[1]['repos.json']),repos:JSON.parse(REVIEWED_STAGE_MODES[1]['repos.json']).repos.map(repo=>
  repo.key==='cecelia'?{...repo,required_checks:['源码保底通过'],base_fresh_check:null}:repo)}),
});

/** 已审现役PG控制封组；仅读源码，不执行候选runner或测试。 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const BUSINESS_PROFILE_PATH='packages/brain/src/lib/existing-ops-business-smoke-retirement-profile.json';
const SHA='18e8a6aff7886a7875468d923010ef1936fb100b497abc17f9e09c05b83218bd';
const text=readFileSync(new URL('./existing-ops-business-smoke-retirement-profile.json',import.meta.url),'utf8');
if(createHash('sha256').update(text).digest('hex')!==SHA)throw Error('basic_ci_source_unproven');
export const REVIEWED_BUSINESS_SMOKE_RETIREMENT={...JSON.parse(text),[BUSINESS_PROFILE_PATH]:SHA};
const RUNNER='scripts/ci/run-basic-check.mjs',CONFIG='scripts/ci/deep-integration.config.mjs';
const nodes=n=>!n||typeof n!=='object'?[]:[...(n.type?[n]:[]),...Object.values(n).flatMap(v=>Array.isArray(v)?v.flatMap(nodes):nodes(v))];
const reject=()=>{throw Error('basic_ci_source_unproven');};
export async function collectReviewedBusinessPgSources({read,parse,relation,profile=BUSINESS_PROFILE_PATH}){
 const runner=await read(RUNNER),digest=createHash('sha256').update(runner).digest('hex'),expectedCount=digest===NATIVE_AGENT_INPUTS[RUNNER]?15:digest===PILOT_HOST_INPUTS[RUNNER]?11:10;
 const cases=nodes(parse(runner)).filter(n=>n.type==='SwitchCase'&&n.test?.value==='brain-integration');
 if(cases.length!==1)reject();
 const steps=nodes(cases[0]).filter(n=>n.type==='CallExpression'&&n.callee?.name==='step'&&n.arguments[1]?.value==='npx');
 if(steps.length!==1||steps[0].arguments.some(n=>n.type!=='Literal'||typeof n.value!=='string'))reject();
 const args=steps[0].arguments.map(n=>n.value);
 if(JSON.stringify(args.slice(0,7))!==JSON.stringify(['packages/brain','npx','--no-install','vitest','run','--config','../../'+CONFIG])||args.at(-1)!=='--reporter=dot')reject();
 const tests=args.slice(7,-1);
 if(tests.length!==expectedCount||new Set(tests).size!==expectedCount||tests.some(p=>!/^src\/__tests__\/integration\/[a-z0-9-]+\.pg\.integration\.test\.js$/.test(p)))reject();
 relation('packages/brain/src/lib/existing-ops-stage-modes.js',profile,'reviewed_basic_ci_source_profile');
 relation(RUNNER,CONFIG,'reviewed_pr_postgres_config_selector');
 for(const p of tests){const input='packages/brain/'+p;if(!await read(input))reject();relation(RUNNER,input,'reviewed_pr_postgres_test_selector');}
 for(const [consumer,input] of [[CONFIG,'packages/brain/vitest.config.js'],[CONFIG,'scripts/ci/debt-pg.config.mjs'],['scripts/ci/debt-pg.config.mjs','scripts/ci/debt-pg-tests.json'],['scripts/ci/debt-pg.config.mjs','packages/brain/vitest.config.js']])relation(consumer,input,'reviewed_pr_postgres_config_input');
}

// 固定11核心矩阵的完整只读控制组；旧组不覆盖。
export const FIXED_PROFILE_PATH='packages/brain/src/lib/existing-ops-fixed-checks-profile.json';
const FIXED_SHA='9cca439f60bccb91b84726e4a59d4f9b1f58782bab25fd135a68974262000aa2',fixedText=readFileSync(new URL('./existing-ops-fixed-checks-profile.json',import.meta.url),'utf8');
if(createHash('sha256').update(fixedText).digest('hex')!==FIXED_SHA)reject();
export const REVIEWED_FIXED_CHECKS={...JSON.parse(fixedText),[FIXED_PROFILE_PATH]:FIXED_SHA};
/** 手动Foundation发布入口的完整已审封组；保留历史PG控制封组原身份。 */
export const FOUNDATION_PROFILE_PATH='packages/brain/src/lib/existing-ops-foundation-release-profile.json';
const foundationSha='1ff02f908373ff61365f413433f2ed1c61450e4c3ab813920631db38da862b57',foundationText=readFileSync(new URL('./existing-ops-foundation-release-profile.json',import.meta.url),'utf8');
if(createHash('sha256').update(foundationText).digest('hex')!==foundationSha)throw Error('basic_ci_source_unproven');
export const REVIEWED_FOUNDATION_RELEASE={...JSON.parse(foundationText),[FOUNDATION_PROFILE_PATH]:foundationSha};

// 合并固定核心检查与手动发布；只复用已封印清单，不动态扩大允许来源。
export const REVIEWED_FOUNDATION_FIXED_CHECKS={...REVIEWED_FIXED_CHECKS,[FOUNDATION_PROFILE_PATH]:REVIEWED_FOUNDATION_RELEASE[FOUNDATION_PROFILE_PATH],
 'scripts/ci/__tests__/basic-workflow.test.mjs':'2d969e97dd0a72f8555400b041ec3772d1d85f0321b27bb7a4cac18d9458f807',
 'scripts/ci/foundation-release-snapshot.mjs':REVIEWED_FOUNDATION_RELEASE['scripts/ci/foundation-release-snapshot.mjs'],
 'scripts/ci/__tests__/foundation-release-readiness.test.mjs':'b0b806af90f3675c88e8e79d2d7f46fe9b2f801ab3cfdf1afb3d7f982fa782fc',
 'scripts/ci/pilot-release-verification.mjs':REVIEWED_FOUNDATION_RELEASE['scripts/ci/pilot-release-verification.mjs']};

// 清退重复默认检查后的完整控制组；纯数据字节固定，历史组不覆盖。
export const CLOSEOUT_PROFILE_PATH='packages/brain/src/lib/existing-ops-closeout-profile.json';
const closeoutSha='7ccb681d2e3aa696bee74e109e028fb55b42b6ac29419d20d7e82fb908297c19',closeoutText=readFileSync(new URL('./existing-ops-closeout-profile.json',import.meta.url),'utf8');
if(createHash('sha256').update(closeoutText).digest('hex')!==closeoutSha)reject();
export const REVIEWED_CLOSEOUT={...JSON.parse(closeoutText),[CLOSEOUT_PROFILE_PATH]:closeoutSha};
// Checker有限返工只增加本次已验收的完整控制封组；旧closeout字节保持兼容。
export const REPAIR_PROFILE_PATH='packages/brain/src/lib/existing-ops-checker-repair-profile.json';
const repairSha='b9e11b26b52fc0f189542585581af7aa4d259ada5859bb88b8e7659c1905a776',repairText=readFileSync(new URL('./existing-ops-checker-repair-profile.json',import.meta.url),'utf8');
if(createHash('sha256').update(repairText).digest('hex')!==repairSha)reject();
export const REVIEWED_CHECKER_REPAIR={...JSON.parse(repairText),[REPAIR_PROFILE_PATH]:repairSha};
// 复用历史完整清单，只有这三项已审差异；历史profile与身份保持不变。
export const REVIEWED_CI_BUILD_DEDUP={...REVIEWED_CHECKER_REPAIR,...CI_BUILD_DEDUP_INPUTS};
export const REVIEWED_PREVIEW_RETIREMENT={...REVIEWED_CI_BUILD_DEDUP,...PREVIEW_RETIREMENT_INPUTS};
export const REVIEWED_MAIN_AUTO_DEPLOY={...REVIEWED_PREVIEW_RETIREMENT,...MAIN_AUTO_DEPLOY_INPUTS,...BIND_MOUNT_LEGACY_INPUTS,...CANDIDATE_BUILDER_LEGACY_INPUTS};
export const REVIEWED_BIND_MOUNT={...REVIEWED_MAIN_AUTO_DEPLOY,...BIND_MOUNT_INPUTS};
export const REVIEWED_CANDIDATE_BUILDER={...REVIEWED_BIND_MOUNT,...CANDIDATE_BUILDER_INPUTS};
export const REVIEWED_RUNTIME_IDEMPOTENCE={...REVIEWED_CANDIDATE_BUILDER,...RUNTIME_IDEMPOTENCE_INPUTS,...NIGHTLY_STATUS_LEGACY_INPUTS};
export const REVIEWED_NIGHTLY_STATUS={...REVIEWED_RUNTIME_IDEMPOTENCE,...NIGHTLY_STATUS_INPUTS};
const PILOT_CLI='scripts/ci/pilot-release-verification.mjs',PILOT_HOST='scripts/ci/pilot-foundation-bindings.mjs';
const PILOT_HOST_INPUTS={
 'scripts/ci/run-basic-check.mjs':'b9f9c449e750861f896d2f8f771d2486207bbddfdefabb5fd043897294984f31',
 'packages/brain/src/scheduler-jobs.js':'b6558bd7d3ff9a253d900a99a005992f4385f8cef86b218553b8fe72696a3b16',
 'packages/brain/src/guard-drill.js':null,
 'packages/brain/src/__tests__/guard-drill.test.js':null,
 'scripts/ci/basic-runtime-smoke.mjs':'d1360c4d2bdf45f04a4a24b182d13cd40de4cfd0a6a4a865c8a0f09bf4c50e28',
 '.github/workflows/nightly-regression.yml':'2870f299ccf14127015c5c3788239d30a6632356c8f1354556a61b48e7564657',
 'scripts/brain-deploy.sh':'bd73713dd2efdc4d923358c1751893e7161ced1457a8b6f2b7fb6fc89b7fab0c',
 'scripts/ci/__tests__/basic-ops-coverage.test.mjs':'258c37f9c4a197da08b5c73ff7c056490ff7e48382e8a9f3b87f97107fd441d5',
 'scripts/__tests__/brain-deploy-sha-readonly.test.sh':'ead9cef418952105e60633ecb3121a7d6355d567e2d716b20601cb0197a9679a',
 [PILOT_CLI]:'96287d46c2b7de3fbc7757d04818e4b09d62c0e726d3d619282bd183aa9ba2a3',
 [PILOT_HOST]:'a7388d9dbcd5da7aa8253981800d1097cddd1c388f8cccb3c25d0ab4dcf570d4',
};
const PERSISTENT_DRAIN_CLIENT='scripts/lib/brain-drain-client.sh';
const PERSISTENT_DRAIN_CLIENT_INPUTS={
 'scripts/__tests__/brain-deploy-sha-readonly.test.sh':'2e8fca5f4b7901ba8072879df0e60c9756632cf6584a23069440545963515586',
 'scripts/brain-deploy.sh':'3286c4ee9f58d38637ec682f482519500526b9711fa2925866412953b47fc428',
 [PERSISTENT_DRAIN_CLIENT]:'2dab5aacee384f5e9c1ca9ae5dddf7a26a1ac725e87fc2bc93265f5da8c2ed2b',
};
// 候选缓存回收仅接受本次完整控制组；旧 Builder/Pilot 字节与身份保持。
const CANDIDATE_CACHE_INPUTS={
 'scripts/brain-build.sh':'ab7d115536f0a59e0ed382ff9b53392d5ba0124e729f76a4b03dd866938bf061',
 'scripts/brain-deploy.sh':'4466ff61442d1853f5380baad33be6aea3f90d29cb6ee94dff07c239e04abf80',
 'scripts/staging-deploy.sh':'96042c7754e8eeaf770405227517c09b55d0300481370d6887912fbc1b815049',
 'scripts/lib/brain-candidate-docker.sh':'55e2955d9dad60d6a69c2471e161a9cc47e4d976e5e684f10412bfddb735177a',
 'scripts/lib/brain-staging.sh':'6098ce2dfce78eb444eaaea0f21c4edda29f68f7661bec7c3b6b1ec09deabd8d',
 'scripts/ci/__tests__/basic-brain-candidate-host.test.mjs':'c98a6753c143d73e07f93b4dbed8eb57fe51783a074014e107b108c21cf00b2b',
};
// 本次清退宿主重复回退及sidecar固定恢复；旧缓存与发布组不改字节。
const DEPLOY_RECOVERY_MARKER='scripts/ci/__tests__/basic-brain-predecessor.test.mjs';
const DEPLOY_RECOVERY_INPUTS={
 'scripts/ci/prepare-ubuntu-archive.mjs':'4ddadfe0b1c4f498f3248fee31591acbbcc01b07ff84763e65761d324fa35d93',
 'scripts/ci/__tests__/basic-ubuntu-archive.test.mjs':'34af9e13f4784f2d8d2b685787535e98b5ee99e31a476eaf5a58322b696555b9',
 'scripts/lib/brain-drain-client.sh':'2dab5aacee384f5e9c1ca9ae5dddf7a26a1ac725e87fc2bc93265f5da8c2ed2b',
 'scripts/brain-deploy.sh':'98630a4b6a4ad2bf77df9fa6bd640827cef0ad51ec765e6732a3d86af1de4fd3',
 'scripts/brain-rollback.sh':'8d5fb92bbe90c0d579a6b30ef3f8441ee083ff5de49152eef1561fe6c9fed137',
 'scripts/lib/bluegreen.sh':'236107eb668f6091daedbfff28e7643967c5f9e258db4fa06f7377b044c02b55',
 'scripts/lib/bluegreen-sidecar.sh':'434a84e5d3337c3fa7802edaef7840e4bf621dc8966dfa665c61443e72c67b9d',
 'scripts/lib/brain-post-deploy.sh':'444df152c293fc434de4525c1aa23dc48a00abddb97422b9bcd43509597c0af4',
 'scripts/__tests__/brain-deploy-sha-readonly.test.sh':'0cc563f7d11e9c8a6e506ecdcaf34f259e9f4451d3a5e7cf9b7241400c63ba8b',
 'scripts/ci/__tests__/basic-retired-cd-entrypoints.test.mjs':'6ad7c64659bab26fdc52dd96bc20178a9bd19a7c2203f168009f396450b2b071',
 'scripts/ci/__tests__/basic-brain-predecessor.test.mjs':'3ba6dce8b4693a42809ad51aacce3538a3347228be1e10966b0082f1f81c5cc6',
 'scripts/ci/__tests__/helpers/brain-deploy-predecessor.fixture.mjs':'943a0cf598bab07f731edc73fc82a75b4a14f615fe6a8268a7ac0ba0f8137ec4',
};
const NATIVE_AGENT_MARKER='packages/brain/config/native-agent.json';
const NATIVE_AGENT_INPUTS={
 "packages/brain/config/native-agent.json": "bb44c10fa839af43e9a3e740ef3573ed6e4806cc22c8caa73876b8b2ef0a75dc",
 "scripts/ci/run-basic-check.mjs": "be28cd7275aca52331e45b385f9f842a65b97bc209b5ff891e5d4cba282fd267",
 "scripts/ci/ops-checks.mjs": "9230590fa0f20ff718fe4b7dbf2992f4b8d94e6a1b250003f36368295bf9e0e4",
 "scripts/brain-deploy.sh": "8aeef5d054ddafd69c4d7d09beb43be8747418c9cf927bb17f4e68b9a9bf8d37",
 "packages/brain/src/scheduler-jobs.js": "188e8286890326949defb4615b1d39076174b353edb7f27c9d05a1b85e4607fb",
 "packages/brain/Dockerfile": "766bfccba1fc57da3b28bd0730c06df74fa2b8ab3922e213e9a743db580430f1",
 "scripts/ci/__tests__/basic-ops-coverage.test.mjs": "d11d246ac9759f343ba77a21bbbc0159d2de3bca6b019ba7fac0d003514f0230",
 "scripts/ci/__tests__/helpers/brain-deploy-predecessor.fixture.mjs": "16ba0317da37c90f81fd1c3e7a6608036b35bdebb0a58aeec5f7356edb1817b9",
 "scripts/ci/__tests__/basic-native-agent-deploy.test.mjs": "5380a708fac0578697a1ce62a950cc5c03f15ce6900db80b0f3cee214a395a54",
 "packages/brain/scripts/native-agent-release.mjs": "8fd7191c3ba28363c36391387fc659e3019c8b3cdc38bf54ca5dc4940620cab4",
 "tests/brain-ci-pg-layering.test.ts": "caa9b44da2c08084ae8d9e71c6e8f01cc7f252f9cc40e04c0ef2e8f64cfdd62c",
 "packages/brain/scripts/native-agent/bundle.mjs": "0686f14f99ce0bb842133c4df0f42a83e5fc64bbe0fc308389ab4aca83154e45",
 "packages/brain/scripts/native-agent/config.mjs": "998832cc568844a1bbfb8676d2f6cf6148e5102f036851372461d1110233238d",
 "packages/brain/scripts/native-agent/store.mjs": "9b64fb2814e3c7803cd5a285f727597392730daed4521b8fdc5aa9ddc0ec3982",
 "packages/brain/scripts/native-agent/process.mjs": "ce94d7d127f5e72e03bb3372eb01ab56d80ffb160110b9ccde85c80f49e2b5a4",
 "packages/brain/scripts/native-agent/worker.mjs": "301b9d5206054d14c1c7c7d2b9d39d54d5772e5593c4df316d378fd32d384dc4",
 "packages/brain/scripts/native-agent/cli.mjs": "b0f3b68c3f3ec2690acd73bd6bee643525127a0ef50c4eb0be33f8709234fca4",
 "packages/brain/scripts/coding-workflow/lib/codex-auth.mjs": "15bda8001eb742902dba602cb8a4706abf1dbdf62e35405153d2c8f02d46521d",
 "packages/brain/src/orchestrator/activity-supervisor-state.cjs": "e094eee3477d42d30465effd56ce390f011cf7653ae7ddbdd34ab30a038484a6",
 "scripts/ci/__tests__/basic-fixed-core.test.mjs": "6bd8b0c52467785f700909ddd10b886527e71a5e194ce7ea5026542cd5a4814e",
 "packages/brain/scripts/native-agent/__tests__/native-agent.node-test.mjs": "2861842166d54814e261bb7947d85c5bd4fd7ddb43318337188c4ba2272fc2ab"
};
const NATIVE_AGENT_BUNDLE=["packages/brain/scripts/native-agent/bundle.mjs","packages/brain/scripts/native-agent/config.mjs","packages/brain/scripts/native-agent/store.mjs","packages/brain/scripts/native-agent/process.mjs","packages/brain/scripts/native-agent/worker.mjs","packages/brain/scripts/native-agent/cli.mjs","packages/brain/scripts/coding-workflow/lib/codex-auth.mjs","packages/brain/src/orchestrator/activity-supervisor-state.cjs"];
export function reviewedPilotControls(profile,paths){
 if(!paths?.includes(PILOT_HOST))return profile;
 if(profile!==REVIEWED_NIGHTLY_STATUS)reject();
 return {...profile,...PILOT_HOST_INPUTS,...(paths.includes(PERSISTENT_DRAIN_CLIENT)?PERSISTENT_DRAIN_CLIENT_INPUTS:{})};
}
const PG_LAYERING_PATH='tests/brain-ci-pg-layering.test.ts';
const PG_LAYERING_DIGEST='2b6e813d5bc0f5fe546d25a996b21dc208dbb142c426de05fe5f24e45b06f774';
export async function reviewedPilotSourceControls(profile,paths,read){
 let controls=reviewedPilotControls(profile,paths);
 if(paths?.includes(PILOT_HOST)&&createHash('sha256').update(await read(CANDIDATE_BUILDER_MARKER)).digest('hex')===CANDIDATE_CACHE_INPUTS[CANDIDATE_BUILDER_MARKER])controls={...controls,...CANDIDATE_CACHE_INPUTS};
 if(paths?.includes(DEPLOY_RECOVERY_MARKER)){
  if(profile!==REVIEWED_NIGHTLY_STATUS||!paths.includes(PILOT_HOST)||createHash('sha256').update(await read(DEPLOY_RECOVERY_MARKER)).digest('hex')!==DEPLOY_RECOVERY_INPUTS[DEPLOY_RECOVERY_MARKER])reject();
  controls={...controls,...DEPLOY_RECOVERY_INPUTS};
 }
 if(paths?.includes(NATIVE_AGENT_MARKER)){
  if(profile!==REVIEWED_NIGHTLY_STATUS||!paths.includes(PILOT_HOST)||!paths.includes(DEPLOY_RECOVERY_MARKER))reject();
  return {...controls,...NATIVE_AGENT_INPUTS};
 }
 if(paths?.includes(PILOT_HOST)&&createHash('sha256').update(await read(PG_LAYERING_PATH)).digest('hex')===PG_LAYERING_DIGEST)return {...controls,[PG_LAYERING_PATH]:PG_LAYERING_DIGEST};
 return controls;
}
export function recordReviewedPilotSource({profile,paths,relation}){
 if(paths?.includes(PILOT_HOST)){
  if(profile!==REVIEWED_NIGHTLY_STATUS)reject();
  relation(PILOT_CLI,PILOT_HOST,'reviewed_pilot_foundation_host_source');
  if(paths.includes(NATIVE_AGENT_MARKER)){
   const release='packages/brain/scripts/native-agent-release.mjs',bundle='packages/brain/scripts/native-agent/bundle.mjs';
   relation('scripts/brain-deploy.sh',release,'reviewed_native_agent_release_entry');
   relation(release,bundle,'reviewed_native_agent_release_bundle');
   relation(RUNNER,bundle,'reviewed_native_agent_image_bundle_check');
   relation('scripts/ci/ops-checks.mjs','packages/brain/scripts/native-agent/__tests__/native-agent.node-test.mjs','reviewed_native_agent_host_test_selector');
   for(const input of NATIVE_AGENT_BUNDLE)if(input!==bundle)relation(bundle,input,'reviewed_native_agent_bundle_member');
  }
  if(paths.includes(DEPLOY_RECOVERY_MARKER)){
   relation('scripts/brain-deploy.sh','scripts/lib/brain-post-deploy.sh','reviewed_deploy_post_success_helper');
   relation(DEPLOY_RECOVERY_MARKER,'scripts/ci/__tests__/helpers/brain-deploy-predecessor.fixture.mjs','reviewed_deploy_predecessor_fixture');
  }
  if(paths.includes(PERSISTENT_DRAIN_CLIENT))relation('scripts/brain-deploy.sh',PERSISTENT_DRAIN_CLIENT,'reviewed_persistent_process_drain_client');
 }
}
export async function mainAutoDeployProfile(paths,read){
 if(!Array.isArray(paths))reject();
 const text=await read(CANDIDATE_BUILDER_MARKER);if(typeof text!=='string')reject();
 const digest=createHash('sha256').update(text).digest('hex');
 if(digest===CANDIDATE_BUILDER_INPUTS[CANDIDATE_BUILDER_MARKER]||(paths.includes(PILOT_HOST)&&digest===CANDIDATE_CACHE_INPUTS[CANDIDATE_BUILDER_MARKER])){
  const runtime=await read(RUNTIME_IDEMPOTENCE_MARKER);if(typeof runtime!=='string')reject();
  const runtimeDigest=createHash('sha256').update(runtime).digest('hex');
  if(runtimeDigest===RUNTIME_IDEMPOTENCE_INPUTS[RUNTIME_IDEMPOTENCE_MARKER]){
   const status=await read(NIGHTLY_STATUS_MARKER);if(typeof status!=='string')reject();
   const statusDigest=createHash('sha256').update(status).digest('hex');
   if(statusDigest===NIGHTLY_STATUS_INPUTS[NIGHTLY_STATUS_MARKER])return REVIEWED_NIGHTLY_STATUS;
   if(statusDigest===REVIEWED_RUNTIME_IDEMPOTENCE[NIGHTLY_STATUS_MARKER])return REVIEWED_RUNTIME_IDEMPOTENCE;
   reject();
  }
  if(runtimeDigest===REVIEWED_CANDIDATE_BUILDER[RUNTIME_IDEMPOTENCE_MARKER])return REVIEWED_CANDIDATE_BUILDER;
  reject();
 }
 if(digest!==MAIN_AUTO_DEPLOY_INPUTS[CANDIDATE_BUILDER_MARKER])reject();
 return paths.includes(BIND_MOUNT_MARKER)?REVIEWED_BIND_MOUNT:REVIEWED_MAIN_AUTO_DEPLOY;
}
async function checkerRepairProfile(read,paths){
 const digest=workflowHash(await read('.github/workflows/ci.yml'));
 if(digest===MAIN_AUTO_DEPLOY_WORKFLOW)return mainAutoDeployProfile(paths,read);
 if(digest===PREVIEW_RETIREMENT_WORKFLOW)return REVIEWED_PREVIEW_RETIREMENT;
 if(digest===CI_BUILD_DEDUP_WORKFLOW)return REVIEWED_CI_BUILD_DEDUP;
 if(digest==='68d48d86c12927eb533101cd0c47cd446dfa3e456cf733643d68e9ee72c7671a')return REVIEWED_CHECKER_REPAIR;
 reject();
}

export async function collectReviewedCloseoutDeep({read,paths,relation}){
 if(!paths?.includes(CLOSEOUT_PROFILE_PATH))reject();
 const profile=paths.includes(REPAIR_PROFILE_PATH)?await checkerRepairProfile(read,paths):REVIEWED_CLOSEOUT;
 for(const [path,digest] of Object.entries(await reviewedPilotSourceControls(profile,paths,read))){if(digest===null){if(paths.includes(path))reject();continue;}const bytes=await read(path);if(createHash('sha256').update(bytes).digest('hex')!==digest)reject();}
 recordReviewedPilotSource({profile,paths,relation});
 relation('packages/brain/src/lib/existing-ops-stage-modes.js',CLOSEOUT_PROFILE_PATH,'reviewed_deep_ci_source_profile');
 if([REVIEWED_NIGHTLY_STATUS,REVIEWED_RUNTIME_IDEMPOTENCE,REVIEWED_CANDIDATE_BUILDER,REVIEWED_BIND_MOUNT,REVIEWED_MAIN_AUTO_DEPLOY,REVIEWED_PREVIEW_RETIREMENT,REVIEWED_CI_BUILD_DEDUP,REVIEWED_CHECKER_REPAIR].includes(profile))relation('packages/brain/src/lib/existing-ops-stage-modes.js',REPAIR_PROFILE_PATH,'reviewed_deep_ci_source_profile');
 for(const [consumer,input] of [['scripts/ci/deep-integration.config.mjs','scripts/ci/debt-pg.config.mjs'],['scripts/ci/debt-pg.config.mjs','scripts/ci/debt-pg-tests.json'],['scripts/ci/debt-pg.config.mjs','packages/brain/vitest.config.js']])relation(consumer,input,'reviewed_deep_postgres_config_input');
}

// 本轮休眠边界完整只读封组；旧Closeout字节与历史资格保持独立。
export const DORMANT_PROFILE_PATH='packages/brain/src/lib/existing-ops-dormant-boundaries-profile.json';
const dormantSha='c4e0d5cdda063ac3425146327b38562af8361f694b720e77066f91176a4dfd2a',dormantText=readFileSync(new URL('./existing-ops-dormant-boundaries-profile.json',import.meta.url),'utf8');
if(createHash('sha256').update(dormantText).digest('hex')!==dormantSha)reject();
export const REVIEWED_DORMANT_BOUNDARIES={...JSON.parse(dormantText),[DORMANT_PROFILE_PATH]:dormantSha};
export async function collectReviewedDormantDeep({read,paths,relation}){
 if(!paths?.includes(DORMANT_PROFILE_PATH))reject();
 const profile=paths.includes(REPAIR_PROFILE_PATH)?await checkerRepairProfile(read,paths):REVIEWED_DORMANT_BOUNDARIES;
 for(const [path,digest] of Object.entries(await reviewedPilotSourceControls(profile,paths,read))){if(digest===null){if(paths.includes(path))reject();continue;}const bytes=await read(path);if(createHash('sha256').update(bytes).digest('hex')!==digest)reject();}
 recordReviewedPilotSource({profile,paths,relation});
 relation('packages/brain/src/lib/existing-ops-stage-modes.js',DORMANT_PROFILE_PATH,'reviewed_deep_ci_source_profile');
 if([REVIEWED_NIGHTLY_STATUS,REVIEWED_RUNTIME_IDEMPOTENCE,REVIEWED_CANDIDATE_BUILDER,REVIEWED_BIND_MOUNT,REVIEWED_MAIN_AUTO_DEPLOY,REVIEWED_PREVIEW_RETIREMENT,REVIEWED_CI_BUILD_DEDUP,REVIEWED_CHECKER_REPAIR].includes(profile))relation('packages/brain/src/lib/existing-ops-stage-modes.js',REPAIR_PROFILE_PATH,'reviewed_deep_ci_source_profile');
 for(const [consumer,input] of [['scripts/ci/deep-integration.config.mjs','scripts/ci/debt-pg.config.mjs'],['scripts/ci/debt-pg.config.mjs','scripts/ci/debt-pg-tests.json'],['scripts/ci/debt-pg.config.mjs','packages/brain/vitest.config.js']])relation(consumer,input,'reviewed_deep_postgres_config_input');
}
