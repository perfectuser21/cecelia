/** Narrow fixed-Git consumer proof. Unknown execution envelopes add no graph edges.
 * This is dependency evidence, not a claim that a docs-only CI ran workspace tests.
 * Input envelopes were reviewed at b5800c2; future semantic changes require review.
 */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import yaml from 'js-yaml';
import {canonicalRepoIdentity} from '../../packages/brain/src/lib/gp-assertion-command.js';
import {WORKSPACE_ENVELOPES} from './workspace-test-envelopes.mjs';
// Resolve the explicitly declared TypeScript dependency from trusted tooling, never candidate root.
const ts=createRequire(new URL('../../apps/api/package.json',import.meta.url))('typescript');
const SELF='perfectuser21/cecelia',F3='0466016e-6d9f-4325-aeb4-d8bc70424a48';
const CI='.github/workflows/ci.yml',PKG='apps/api/package.json',CONFIG='apps/api/vitest.config.ts',SETUP='apps/api/test/setup.ts';
const PREFIX='apps/api/features/planning/pages/capability-system/';
const NAMES=['BusinessInputs','CapabilitySystem','InvocationPanel'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const digest=value=>sha(JSON.stringify(stable(value)));
function ast(path,text){
 const tree=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 if(tree.parseDiagnostics.length)throw Error('unparsed source');
 return tree;
}
function children(node){const out=[];ts.forEachChild(node,n=>{out.push(n);});return out;}
function nodes(node){return [node,...children(node).flatMap(nodes)];}
const named=(n,name)=>n&&ts.isIdentifier(n)&&n.text===name;
const call=(n,name)=>n&&ts.isCallExpression(n)&&named(n.expression,name);
function imports(tree,source){return tree.statements.filter(n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text===source);}
function imported(tree,source,name){return imports(tree,source).some(n=>n.importClause?.namedBindings?.elements?.some(s=>s.name.text===name&&!s.propertyName&&!s.isTypeOnly&&!n.importClause.isTypeOnly));}
function rendersImportedOwner(test,owner,name){
 const incoming=imports(test,'./'+name);
 if(incoming.length!==1||incoming[0].importClause?.name?.text!==name||incoming[0].importClause.isTypeOnly||!imported(test,'vitest','it')||!imported(test,'@testing-library/react','render'))return false;
 const exported=owner.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.body&&n.name?.text===name&&!n.modifiers?.some(m=>m.kind===ts.SyntaxKind.DeclareKeyword)&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)&&n.modifiers.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword));
 if(exported.length!==1)return false;
 const active=[];
 const register=statements=>{
  for(const s of statements){
   const c=ts.isExpressionStatement(s)?s.expression:null;
   if(!call(c,'it')&&!call(c,'describe'))continue;
   const fn=c.arguments[1];if(!fn||!ts.isArrowFunction(fn)||!ts.isBlock(fn.body))continue;
   if(call(c,'it'))active.push(fn.body);else register(fn.body.statements);
  }
 };
 register(test.statements);
 return active.some(body=>body.statements.some(s=>{
  const c=ts.isExpressionStatement(s)?s.expression:ts.isVariableStatement(s)?s.declarationList.declarations[0]?.initializer:null;
  return call(c,'render')&&c.arguments.length===1&&nodes(c.arguments[0]).some(n=>(ts.isJsxSelfClosingElement(n)||ts.isJsxOpeningElement(n))&&named(n.tagName,name));
 }));
}
function workflowEnvelope(ci){
 // Entire reviewed selection, setup and failure-exit envelopes are compared, not substrings.
 return {on:ci.on,env:ci.env,defaults:ci.defaults,permissions:ci.permissions,changes:ci.jobs?.changes,workspace:ci.jobs?.['workspace-test'],aggregate:ci.jobs?.['ci-passed']};
}
const packageView=p=>Object.fromEntries(['name','type','bin','scripts','workspaces','dependencies','devDependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','overrides','config','packageManager','engines','os','cpu'].filter(k=>k in p).map(k=>[k,p[k]]));
const hooks=new Set(['preinstall','install','postinstall','prepublish','prepare','preprepare','postprepare']);
/** Only the already frozen self-repo F3 code binding can anchor these rebuilt edges. */
export function collectWorkspaceTestEdges(root,snapshot){
 try{
  if(snapshot?.repo!==SELF||snapshot.scope!=='cecelia-factory'||!(/^[a-f0-9]{40}$/).test(snapshot.revision))return [];
  const revision=snapshot.revision;
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
  if(canonicalRepoIdentity(git('remote','get-url','origin').trim()).replace(/^github\.com\//,'')!==SELF||git('rev-parse',revision+'^{commit}').trim()!==revision)return [];
  const entries=new Map(git('ls-tree','-rz',revision).split('\0').filter(Boolean).map(row=>{const [meta,path]=row.split('\t');return [path,meta];}));
  const read=path=>{if(!/^100644 blob [a-f0-9]{40}$/.test(entries.get(path)||''))throw Error('not regular committed source');return git('show',revision+':'+path);};
  const activity=snapshot.definitions?.activities?.find(a=>a.activity_id===F3&&a.payload.definition_scope==='consumer_evidence'&&a.payload.source_scope==='cecelia-factory');
  const binding=activity?.payload.implementation_bindings?.find(b=>b.kind==='code'&&b.status==='verified'&&b.repo===SELF&&b.revision===revision&&b.path===CI);
  if(!binding)return [];
  const texts=new Map(),readText=path=>{if(!texts.has(path))texts.set(path,read(path));return texts.get(path);};
  const ciText=readText(CI),ciHash=sha(ciText);
  if(binding.digest!=='sha256:'+ciHash||binding.content_sha256!==ciHash)return [];
  // Unsupported npm/project/config entrypoints must not execute ahead of the reviewed test.
  for(const path of entries.keys()){
   if(/^(?:\.npmrc|(?:apps|packages)\/[^/]+\/\.npmrc)$/.test(path))return [];
   if(/^(?:apps\/api\/)?vitest\.(?:workspace|projects)\./.test(path))return [];
   if(/^apps\/api\/(?:vitest|vite)\.config\./.test(path)&&path!==CONFIG)return [];
   if(/^(?:apps|packages)\/[^/]+\/package\.json$/.test(path)){
    const pkg=JSON.parse(readText(path));if(Object.keys(pkg.scripts||{}).some(k=>hooks.has(k)))return [];
   }
  }
  const ci=yaml.load(ciText);if(digest(workflowEnvelope(ci))!==WORKSPACE_ENVELOPES.workflow)return [];
  const rootPackage=JSON.parse(readText('package.json')),pkg=JSON.parse(readText(PKG));
  if(digest(packageView(rootPackage))!==WORKSPACE_ENVELOPES.rootPackage||digest(packageView(pkg))!==WORKSPACE_ENVELOPES.apiPackage)return [];
  if(pkg.devDependencies?.vitest!=='^4.0.18'||pkg.devDependencies?.typescript!=='^5.6.0')return [];
  ast(CONFIG,readText(CONFIG));ast(SETUP,readText(SETUP));
  if(sha(readText(CONFIG))!==WORKSPACE_ENVELOPES.config||sha(readText(SETUP))!==WORKSPACE_ENVELOPES.setup)return [];
  for(const name of NAMES){
   const test=ast(PREFIX+name+'.test.tsx',readText(PREFIX+name+'.test.tsx'));
   const owner=ast(PREFIX+name+'.tsx',readText(PREFIX+name+'.tsx'));
   if(sha(readText(PREFIX+name+'.test.tsx'))!==WORKSPACE_ENVELOPES.tests[name]||!rendersImportedOwner(test,owner,name))return [];
  }
  const inputs=Object.fromEntries([...texts].map(([path,text])=>[path,sha(text)]));
  const pairs=[[CI,PKG],[PKG,CONFIG],[CONFIG,SETUP],...NAMES.flatMap(n=>[[CONFIG,PREFIX+n+'.test.tsx'],[PREFIX+n+'.test.tsx',PREFIX+n+'.tsx']])];
  return pairs.map(([src_path,dst_path])=>({src_path,dst_path,edge_type:'import',detail:{via:'fixed_workspace_test_consumer',proof_version:'workspace-test-v1',source_revision:revision,source_repo:SELF,source_sha256:inputs[src_path],target_sha256:inputs[dst_path],inputs,
   selector:'changes.apps/** -> workspace-test -> apps/api npm test -> **/*.{test,spec}.{ts,tsx}',execution_claim:'dependency_only; not per-run test PASS',parser:'typescript '+ts.version}}));
 }catch{return [];}
}
