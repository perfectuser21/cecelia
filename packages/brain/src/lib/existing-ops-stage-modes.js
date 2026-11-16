/** 经审B补丁的完整模式变体；不读候选自身声明来扩大允许范围。 */
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
 const cases=nodes(parse(await read(RUNNER))).filter(n=>n.type==='SwitchCase'&&n.test?.value==='brain-integration');
 if(cases.length!==1)reject();
 const steps=nodes(cases[0]).filter(n=>n.type==='CallExpression'&&n.callee?.name==='step'&&n.arguments[1]?.value==='npx');
 if(steps.length!==1||steps[0].arguments.some(n=>n.type!=='Literal'||typeof n.value!=='string'))reject();
 const args=steps[0].arguments.map(n=>n.value);
 if(JSON.stringify(args.slice(0,7))!==JSON.stringify(['packages/brain','npx','--no-install','vitest','run','--config','../../'+CONFIG])||args.at(-1)!=='--reporter=dot')reject();
 const tests=args.slice(7,-1);
 if(tests.length!==10||new Set(tests).size!==10||tests.some(p=>!/^src\/__tests__\/integration\/[a-z0-9-]+\.pg\.integration\.test\.js$/.test(p)))reject();
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
export async function collectReviewedCloseoutDeep({read,paths,relation}){
 if(!paths?.includes(CLOSEOUT_PROFILE_PATH))reject();
 for(const [path,digest] of Object.entries(REVIEWED_CLOSEOUT)){if(digest===null){if(paths.includes(path))reject();continue;}const bytes=await read(path);if(createHash('sha256').update(bytes).digest('hex')!==digest)reject();}
 relation('packages/brain/src/lib/existing-ops-stage-modes.js',CLOSEOUT_PROFILE_PATH,'reviewed_deep_ci_source_profile');
 for(const [consumer,input] of [['scripts/ci/deep-integration.config.mjs','scripts/ci/debt-pg.config.mjs'],['scripts/ci/debt-pg.config.mjs','scripts/ci/debt-pg-tests.json'],['scripts/ci/debt-pg.config.mjs','packages/brain/vitest.config.js']])relation(consumer,input,'reviewed_deep_postgres_config_input');
}
