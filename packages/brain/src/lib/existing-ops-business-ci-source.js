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
