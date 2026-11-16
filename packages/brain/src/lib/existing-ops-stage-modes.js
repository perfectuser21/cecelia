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
export async function collectReviewedBusinessPgSources({read,parse,relation}){
 const cases=nodes(parse(await read(RUNNER))).filter(n=>n.type==='SwitchCase'&&n.test?.value==='brain-integration');
 if(cases.length!==1)reject();
 const steps=nodes(cases[0]).filter(n=>n.type==='CallExpression'&&n.callee?.name==='step'&&n.arguments[1]?.value==='npx');
 if(steps.length!==1||steps[0].arguments.some(n=>n.type!=='Literal'||typeof n.value!=='string'))reject();
 const args=steps[0].arguments.map(n=>n.value);
 if(JSON.stringify(args.slice(0,7))!==JSON.stringify(['packages/brain','npx','--no-install','vitest','run','--config','../../'+CONFIG])||args.at(-1)!=='--reporter=dot')reject();
 const tests=args.slice(7,-1);
 if(tests.length!==10||new Set(tests).size!==10||tests.some(p=>!/^src\/__tests__\/integration\/[a-z0-9-]+\.pg\.integration\.test\.js$/.test(p)))reject();
 relation(RUNNER,CONFIG,'reviewed_pr_postgres_config_selector');
 for(const p of tests){const input='packages/brain/'+p;if(!await read(input))reject();relation(RUNNER,input,'reviewed_pr_postgres_test_selector');}
 for(const [consumer,input] of [[CONFIG,'packages/brain/vitest.config.js'],[CONFIG,'scripts/ci/debt-pg.config.mjs'],['scripts/ci/debt-pg.config.mjs','scripts/ci/debt-pg-tests.json'],['scripts/ci/debt-pg.config.mjs','packages/brain/vitest.config.js']])relation(consumer,input,'reviewed_pr_postgres_config_input');
}
