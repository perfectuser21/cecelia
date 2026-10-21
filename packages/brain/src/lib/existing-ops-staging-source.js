/** 隔离staging的已审调用边；完整固定来源不符即UNKNOWN，不把来源证明当运行PASS。 */
import {createHash} from 'node:crypto';
const hash=text=>createHash('sha256').update(text).digest('hex');
const REVIEWED_FILES={
  ".github/workflows/auto-staging-deploy.yml": "65406abb24f3ef49fcef89b4a6f32163fb6b555fe35254e84ca66b910f7fde67",
  "scripts/staging-deploy.sh": "e8c35ccbe3eb599619c2f94d87d80c309f9694eacdd920ece6afffb3c3484a34",
  "scripts/lib/brain-staging.sh": "57697254e538f75b6a99e276e0b3d95405eb29f95c6a01686f5fd66dd5227089",
  "scripts/staging-verify.sh": "7174239878cb2b159e6cd8cc3ab8cb2af102ef75a7c188e1c6d73fae48932925",
  "scripts/wait-for-staging.sh": "feed4d74afc960f4c6ce73b27c63cf2249aef8cd5b17c9dea10199e3ab1251c0",
  "scripts/brain-deploy.sh": "b75e43593d5d24ddbfeec4a5eb46ba20602259aeb27664268401eb3de6d7a428"
};
const ROUTE_AST_SHA='ee1e4ad9892532df8de35241d8f55665cc0511140598f49045e154004537ebfe';
export function stagingSelectorVersion(text,parse){
 const declaration=parse(text).body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='VariableDeclaration'&&n.declaration.declarations.some(d=>d.id?.name==='EXISTING_OPS_STAGING_SELECTOR_SCHEMA'))?.declaration;
 if(!declaration)return 0;
 const value=declaration.declarations.find(d=>d.id?.name==='EXISTING_OPS_STAGING_SELECTOR_SCHEMA')?.init;
 if(declaration.kind!=='const'||value?.type!=='Literal'||![0,1,2].includes(value.value))throw Error('staging_selector_schema_unknown');
 return value.value;
}
function nodes(root){
 const out=[];function visit(n){if(!n||typeof n!=='object')return;if(n.type)out.push(n);for(const v of Object.values(n))if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);}visit(root);return out;
}
function routeProven(text,parse){
 const program=parse(text),match=n=>n.type==='CallExpression'&&n.callee?.type==='MemberExpression'&&!n.callee.computed&&n.callee.object?.name==='router'&&n.callee.property?.name==='post'&&n.arguments[0]?.value==='/deploy';
 const entries=program.body.filter(n=>n.type==='ExpressionStatement').map(n=>n.expression).filter(match);
 return entries.length===1&&nodes(program).filter(match).length===1&&hash(JSON.stringify(entries[0],(k,v)=>['start','end','raw'].includes(k)?undefined:v))===ROUTE_AST_SHA;
}
export async function collectIsolatedStagingSources({read,requireProof,relations,revision,route,parse}){
 // 这些完整shell/workflow已通过真实脚本正反例；任何控制流变化均需重新审查，不能按关键词认领。
 for(const[path,digest]of Object.entries(REVIEWED_FILES)){
  const source=await read(path);requireProof(source&&hash(source)===digest,'isolated_staging_source_unproven');
 }
 requireProof(route&&routeProven(route,parse),'isolated_staging_route_unproven');
 for(const path of ['scripts/brain-build.sh','packages/brain/src/db-config.js'])await read(path);
 for(const[consumer_path,input_path,kind]of [
  ['.github/workflows/auto-staging-deploy.yml','packages/brain/src/routes/ops.js','reviewed_staging_deploy_request'],
  ['.github/workflows/auto-staging-deploy.yml','scripts/wait-for-staging.sh','reviewed_staging_receipt_wait'],
  ['packages/brain/src/routes/ops.js','scripts/staging-deploy.sh','reviewed_staging_script_exec'],
  ['scripts/staging-deploy.sh','scripts/lib/brain-staging.sh','bash_source_call'],
  ['scripts/staging-deploy.sh','scripts/brain-build.sh','fixed_sha_build_call'],
  ['scripts/brain-deploy.sh','scripts/lib/brain-staging.sh','bash_source_call'],
  ['scripts/lib/brain-staging.sh','scripts/staging-verify.sh','isolated_candidate_verification'],
  ['scripts/lib/brain-staging.sh','packages/brain/src/migrate.js','isolated_candidate_migration'],
  ['scripts/staging-verify.sh','packages/brain/src/db-config.js','candidate_database_readback'],
 ])relations.push({consumer_path,input_path,kind,revision});
}
