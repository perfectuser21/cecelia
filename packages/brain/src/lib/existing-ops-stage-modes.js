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
 const runner=await read(RUNNER),expectedCount=createHash('sha256').update(runner).digest('hex')===PILOT_HOST_INPUTS[RUNNER]?11:10;
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
export function reviewedPilotControls(profile,paths){
 if(!paths?.includes(PILOT_HOST))return profile;
 if(profile!==REVIEWED_NIGHTLY_STATUS)reject();
 return {...profile,...PILOT_HOST_INPUTS};
}
const PG_LAYERING_PATH='tests/brain-ci-pg-layering.test.ts';
const PG_LAYERING_DIGEST='2b6e813d5bc0f5fe546d25a996b21dc208dbb142c426de05fe5f24e45b06f774';
export async function reviewedPilotSourceControls(profile,paths,read){
 const controls=reviewedPilotControls(profile,paths);
 if(paths?.includes(PILOT_HOST)&&createHash('sha256').update(await read(PG_LAYERING_PATH)).digest('hex')===PG_LAYERING_DIGEST)return {...controls,[PG_LAYERING_PATH]:PG_LAYERING_DIGEST};
 return controls;
}
export function recordReviewedPilotSource({profile,paths,relation}){
 if(paths?.includes(PILOT_HOST)){
  if(profile!==REVIEWED_NIGHTLY_STATUS)reject();
  relation(PILOT_CLI,PILOT_HOST,'reviewed_pilot_foundation_host_source');
 }
}
export async function mainAutoDeployProfile(paths,read){
 if(!Array.isArray(paths))reject();
 const text=await read(CANDIDATE_BUILDER_MARKER);if(typeof text!=='string')reject();
 const digest=createHash('sha256').update(text).digest('hex');
 if(digest===CANDIDATE_BUILDER_INPUTS[CANDIDATE_BUILDER_MARKER]){
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
