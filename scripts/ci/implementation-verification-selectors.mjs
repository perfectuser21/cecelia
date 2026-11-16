/** 只解释固定配置中的有限Vitest选择规则；不加载配置、不执行测试。 */
import {parse} from 'acorn';
import {stripTypeScriptTypes} from 'node:module';
import {posix} from 'node:path';
import {createHash} from 'node:crypto';
const fail=()=>{throw Object.assign(Error('VERIFICATION_SELECTOR_UNPROVEN'),{code:'VERIFICATION_SELECTOR_UNPROVEN'});};
const sha=text=>createHash('sha256').update(text).digest('hex');
const key=n=>n?.key?.name??n?.key?.value;
const literal=(n,value)=>n?.type==='Literal'&&n.value===value;
function field(object,name,required=false){
 if(object?.type!=='ObjectExpression'||object.properties.some(p=>p.type!=='Property'||p.computed||p.kind!=='init'||p.method))fail();
 const matches=object.properties.filter(p=>key(p)===name);
 if(matches.length>1||required&&matches.length!==1)fail();return matches[0]?.value;
}
function nodes(tree){
 if(!tree||typeof tree!=='object')return [];
 return [...(tree.type?[tree]:[]),...Object.values(tree).flatMap(x=>Array.isArray(x)?x.flatMap(nodes):nodes(x))];
}
function glob(pattern,prefix){
 if(typeof pattern!=='string'||!pattern||pattern.startsWith('/')||/[\\\0]/.test(pattern))fail();
 const normalized=posix.normalize(posix.join(prefix,pattern));
 if(normalized==='..'||normalized.startsWith('../'))fail();
 let regex='';
 for(let i=0;i<normalized.length;){
  const rest=normalized.slice(i);
  if(rest.startsWith('**/')&&(i===0||normalized[i-1]==='/')){regex+='(?:[^/]+/)*';i+=3;}
  else if(rest==='**'&&(i===0||normalized[i-1]==='/')){regex+='.*';i+=2;}
  else if(rest.startsWith('**'))fail();
  else if(rest[0]==='*'){regex+='[^/]*';i++;}
  else if(rest.startsWith('?(')){
   const group=rest.match(/^\?\(([a-zA-Z]+(?:\|[a-zA-Z]+)*)\)/);if(!group)fail();
   regex+=`(?:${group[1]})?`;i+=group[0].length;
  }else if(rest[0]==='?'){regex+='[^/]';i++;}
  else if(rest[0]==='{'){
   const group=rest.match(/^\{([a-zA-Z0-9_-]+(?:,[a-zA-Z0-9_-]+)+)\}/);if(!group)fail();
   regex+=`(?:${group[1].split(',').join('|')})`;i+=group[0].length;
  }else if(rest[0]==='['){
   const group=rest.match(/^\[([a-zA-Z0-9]+)\]/);if(!group)fail();regex+=group[0];i+=group[0].length;
  }else if(rest[0]==='.'){regex+='\\.';i++;}
  else if(rest[0]==='+'){regex+='\\+';i++;}
  else if(/^[a-zA-Z0-9_/@+:-]$/.test(rest[0])){regex+=rest[0];i++;}
  else fail();
 }
 return {pattern,normalized,regex:new RegExp(`^${regex}$`)};
}
/** 独立信任域只解码已审helper的两张字面量表，不调用业务reader或执行helper。 */
function skillExcludes(text,component){
 if(!['brain','engine','quality','root'].includes(component)||!['1daf4f27f6fa97b3c8f3d9a9e1a9e86e44fbe92b84c962d1c2ce3b90db32b147',
  '6f8d97d2346e8b1bd00f4b532d76c8fa9bb871cb807adf7a13d5ce0ffb0f18e3',
  'dbb749f30271472fe1f24e1eec2215d7b5999f20c1d4ed74c00fd4b40f6c57c8'].includes(sha(text)))fail();
 const objects=new Map(parse(text,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.type==='VariableDeclaration')
  .flatMap(n=>n.declaration.declarations.map(d=>[d.id.name,d.init])));
 const strings=(name,key)=>{const value=field(objects.get(name),key);if(!value)return[];
  if(value.type!=='ArrayExpression'||value.elements.some(n=>n?.type!=='Literal'||typeof n.value!=='string'))fail();return value.elements.map(n=>n.value);};
 return [...strings('SKILL_SOURCE_TESTS',component),...strings('RETIRED_SKILL_TESTS',component),
  ...(component==='brain'?strings('SKILL_SOURCE_TESTS','root').map(path=>'../../'+path):[])];
}
/** 测试输入身份限制独立于glob，宽include不能把业务模块变成verification。 */
export function selectVitestVerificationInput({filePath,configPath,configText,skillText,component}){
 for(const path of[filePath,configPath])if(typeof path!=='string'||!/^[-A-Za-z0-9_./@+]+$/.test(path)||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'))fail();
 if(!/\.(?:test|spec)\./.test(filePath))throw Object.assign(Error('VERIFICATION_INPUT_NOT_TEST'),{code:'VERIFICATION_INPUT_NOT_TEST'});
 if(!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath))return {selected:false,witness:null};
 if(typeof configText!=='string'||!configText.trim())fail();
 let tree;try{tree=parse(configPath.endsWith('.ts')?stripTypeScriptTypes(configText,{mode:'strip'}):configText,{ecmaVersion:'latest',sourceType:'module'});}catch{fail();}
 const prefix=posix.dirname(configPath)==='.'?'':posix.dirname(configPath),constants=new Map();
 const imports=tree.body.filter(n=>n.type==='ImportDeclaration');
 const bound=(name,source,kind='ImportSpecifier')=>imports.flatMap(n=>n.specifiers.filter(s=>s.local.name===name).map(s=>({s,source:n.source.value})))
  .filter(x=>x.source===source&&x.s.type===kind&&(kind!=='ImportSpecifier'||x.s.imported.name===name)).length===1;
 if(!bound('defineConfig','vitest/config'))fail();
 // 此完整字节profile只证明既有Dashboard默认选择输入，不解释或运行plugin。
 const reviewedDashboard=configPath==='apps/dashboard/vitest.config.ts'&&sha(configText)==='a5899ed07ee4aa8ff262f7da361d695ef8eb26005571c5e09988aac53c1cc261';
 if(!reviewedDashboard){
 for(const statement of tree.body){
  const s=statement.type==='ExportNamedDeclaration'?statement.declaration:statement;
  if(s?.type==='VariableDeclaration'&&s.kind==='const'){
   for(const d of s.declarations){if(d.id.type!=='Identifier'||constants.has(d.id.name)||['defineConfig','skillSourceExcludes'].includes(d.id.name))fail();constants.set(d.id.name,d.init);}
  }else if(!['ImportDeclaration','ExportDefaultDeclaration'].includes(s?.type))fail();
 }
 for(const imp of imports){
  const source=imp.source.value;
  if(!['vitest/config','path','node:path','url','node:url'].includes(source)&&posix.normalize(posix.join(prefix,source))!=='scripts/ci/skill-source-tests.mjs')fail();
 }
 for(const n of nodes(tree)){
  if(['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration','AssignmentExpression','UpdateExpression','NewExpression','AwaitExpression'].includes(n.type))fail();
  if(n.type==='CallExpression'){
   if(n.callee.name==='defineConfig')continue;
   if(n.callee.name==='skillSourceExcludes'&&n.arguments.length===1&&literal(n.arguments[0],component))continue;
   if(n.callee.name==='fileURLToPath'&&n.arguments.length===1&&n.arguments[0].type==='MemberExpression'&&n.arguments[0].object?.type==='MetaProperty'&&n.arguments[0].property?.name==='url'&&n.arguments[0].object.meta?.name==='import'&&n.arguments[0].object.property?.name==='meta'
    &&(bound('fileURLToPath','url')||bound('fileURLToPath','node:url')))continue;
   if(n.callee.type==='MemberExpression'&&!n.callee.computed&&n.callee.object.name==='path'&&['dirname','resolve','join'].includes(n.callee.property.name)
    &&(bound('path','path','ImportDefaultSpecifier')||bound('path','node:path','ImportDefaultSpecifier'))
    &&n.arguments.every(a=>a.type==='Literal'&&typeof a.value==='string'||a.name==='__dirname'||a.type==='CallExpression'&&a.callee.name==='fileURLToPath'))continue;
   fail();
  }
 }
 }
 const exported=tree.body.filter(n=>n.type==='ExportDefaultDeclaration'),call=exported[0]?.declaration;
 if(exported.length!==1||call?.type!=='CallExpression'||call.callee.name!=='defineConfig'||call.arguments.length!==1)fail();
 const root=call.arguments[0],test=field(root,'test',true);
 for(const object of[root,test])for(const name of['root','dir','workspace','testNamePattern','includeSource','extends','typecheck'])if(field(object,name))fail();
 const array=(node,seen=new Set())=>{
  if(node?.type==='Identifier'){
   if(seen.has(node.name)||!constants.has(node.name))fail();return array(constants.get(node.name),new Set([...seen,node.name]));
  }
  if(node?.type==='CallExpression'&&node.callee.name==='skillSourceExcludes'&&node.arguments.length===1&&literal(node.arguments[0],component)){
   const imported=imports.filter(i=>posix.normalize(posix.join(prefix,i.source.value))==='scripts/ci/skill-source-tests.mjs');
   if(imported.length!==1||imported[0].specifiers.length!==1||imported[0].specifiers[0].type!=='ImportSpecifier'
    ||imported[0].specifiers[0].local.name!=='skillSourceExcludes'||imported[0].specifiers[0].imported.name!=='skillSourceExcludes'||typeof skillText!=='string')fail();
   try{return skillExcludes(skillText,component);}catch{fail();}
  }
  if(node?.type!=='ArrayExpression')fail();
  return node.elements.flatMap(n=>{
   if(n?.type==='Literal'&&typeof n.value==='string')return[n.value];
   if(n?.type==='SpreadElement'&&n.argument.type==='Identifier')return array(n.argument,seen);
   if(n?.type==='SpreadElement')return array(n.argument,seen);
   fail();
  });
 };
 const defaultInclude=['**/*.{test,spec}.?(c|m)[jt]s?(x)'];
 const globalExclude=field(test,'exclude')?array(field(test,'exclude')):[];
 const projects=field(test,'projects'),cases=[];
 if(projects){
  if(projects.type!=='ArrayExpression'||!projects.elements.length||field(test,'include'))fail();
  for(const project of projects.elements){for(const name of['root','dir','workspace','projects','extends','typecheck'])if(field(project,name))fail();const obj=field(project,'test',true);cases.push({name:field(obj,'name',true)?.value,test:obj});}
 }else cases.push({name:'default',test});
 const selectedProjects=[],witnesses=[];
 for(const project of cases){
  if(typeof project.name!=='string'||cases.filter(p=>p.name===project.name).length!==1)fail();
  for(const name of['root','dir','workspace','projects','testNamePattern','includeSource','typecheck'])if(field(project.test,name))fail();
  const include=field(project.test,'include'),patterns=include?array(include):defaultInclude;
  const exclude=project.test===test?globalExclude:[...globalExclude,...(field(project.test,'exclude')?array(field(project.test,'exclude')):[])];
  const includes=patterns.map(p=>glob(p,prefix)),excludes=exclude.map(p=>glob(p,prefix));
  const ancestors=filePath.split('/').slice(0,-1).map((_,i,parts)=>parts.slice(0,i+1).join('/'));
  const match=includes.filter(p=>p.regex.test(filePath)),rejected=excludes.filter(p=>p.regex.test(filePath)||ancestors.some(a=>p.regex.test(a)));
  const hidden=filePath.split('/').some(p=>p.startsWith('.')||['node_modules','dist','cypress'].includes(p));
  const defaultConfig=/(?:^|\/)(?:karma|rollup|webpack|vite|vitest|jest|ava|babel|nyc|cypress|tsup|build|eslint|prettier)\.config\./.test(filePath);
  if(match.length&&!rejected.length&&!hidden&&!defaultConfig)selectedProjects.push(project.name);
  witnesses.push({project:project.name,default_include:!include,include:patterns,exclude,matched_include:match.map(p=>p.pattern),matched_exclude:rejected.map(p=>p.pattern)});
 }
 return {selected:!!selectedProjects.length,witness:{kind:'finite_vitest_selector',schema_version:1,file_path:filePath,config_path:configPath,
  config_sha256:sha(configText),reviewed_config_profile:reviewedDashboard?'dashboard-default-v1':null,...(skillText&&{skill_selector_sha256:sha(skillText)}),selected_projects:selectedProjects,projects:witnesses}};
}

/** 固定Pinned包装器与已审字面量表交集；只证明输入，不声明私有源或合同执行。 */
export function selectPinnedSkillVerificationInput({filePath,configPath,configText,skillText,component}){
 const wrappers={"packages/brain/vitest.skill-source.config.mjs":"57e6f55962bd5e858f8c166d558220fc6e211574b40b59ce4bfda117a6c8e693","packages/engine/vitest.skill-source.config.mjs":"4a1dbfdb127656f4f17aab3edfb849e50d26d6426c9800b13cf1f70d5cd9af8d","packages/quality/vitest.skill-source.config.mjs":"13111f10d4eb803e41965a949666275f4251ce370b66f1bc049d1f9d6e9d588d","vitest.skill-source.config.mjs":"ee3e0130da6aec437f80eb9ba57d3573882ab1c3b0e03548c540c793283f7b16"};
 if(wrappers[configPath]!==sha(configText)||!['1daf4f27f6fa97b3c8f3d9a9e1a9e86e44fbe92b84c962d1c2ce3b90db32b147','dbb749f30271472fe1f24e1eec2215d7b5999f20c1d4ed74c00fd4b40f6c57c8'].includes(sha(skillText)))fail();
 const expected={brain:'packages/brain/vitest.skill-source.config.mjs',engine:'packages/engine/vitest.skill-source.config.mjs',quality:'packages/quality/vitest.skill-source.config.mjs',root:'vitest.skill-source.config.mjs'};
 if(expected[component]!==configPath||typeof filePath!=='string'||!/^[-A-Za-z0-9_./@+]+$/.test(filePath)||filePath.split('/').some(p=>!p||p==='.'||p==='..'))fail();
 const exported=parse(skillText,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.declarations?.[0]?.id.name==='SKILL_SOURCE_TESTS');
 const list=field(exported?.declaration.declarations[0].init,component,true);
 if(list.type!=='ArrayExpression'||list.elements.some(n=>n?.type!=='Literal'||typeof n.value!=='string'))fail();
 const include=list.elements.map(n=>n.value),prefix=component==='root'?'':posix.dirname(configPath);
 const matched=include.filter(pattern=>glob(pattern,prefix).regex.test(filePath));
 return {selected:!!matched.length&&!filePath.split('/').some(p=>p.startsWith('.')||p==='node_modules'),witness:{kind:'finite_pinned_skill_selector',component,
  config_path:configPath,config_sha256:sha(configText),skill_selector_sha256:sha(skillText),include,matched_include:matched,execution_status:'not_evaluated'}};
}

// 仅解释已封印历史入口；当前固定核心CI不调用这些路径裁剪规则。
const ORDER = ['brain-unit', 'brain-integration', 'image', 'mcp', 'dashboard', 'ops', 'scripts'];
// 独立只读MCP没有已证现役消费者；包自身变更仍验证，不进入Brain全量默认。
const ACTIVE = ORDER.filter(component => component !== 'mcp');
// 现役前端为 apps/dashboard；已退役根 frontend 不再创建源码任务。
const SHARED_RUNTIME = ['brain-unit', 'brain-integration', 'image', 'ops'];
const DOCUMENT = /\.(?:md|txt|rst|png|jpe?g|gif|svg|webp|pdf)$/i;
const DOCUMENT_NAME = /(?:^|\/)(?:README|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|LICENSE)\.md$/i;
const ROOT_DOCUMENT = /^(?:AGENTS|CLAUDE|DEFINITION|PRD|DoD)\.md$/i;

// 按文件名分段，避免嵌套正则对连续点号产生指数级回溯。
function isConfiguration(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const parts = name.split('.');
  return (['vitest', 'vite', 'eslint'].includes(parts[0]) && parts.slice(1).includes('config')) ||
    (parts[0] === 'tsconfig' && parts.at(-1) === 'json') ||
    name === '.eslintrc' || name.startsWith('.eslintrc.');
}

function assertPaths(paths, full) {
  if (!Array.isArray(paths) || (!full && paths.length === 0)) {
    throw new Error('CI scope requires nonempty paths，路径列表不能为空');
  }
  for (const path of paths) {
    if (typeof path !== 'string' || !path || path.includes('\0') || path.startsWith('/') ||
      path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error(`Invalid repository path: ${JSON.stringify(path)}`);
    }
  }
}

function matrixFor(selected) {
  return ORDER.filter(component => selected.has(component)).flatMap(component =>
    component === 'brain-unit'
      ? Array.from({length: 6}, (_, index) => ({component, shard: index + 1}))
      : [{component}]);
}

/** Select whole component suites; dynamic file reads make import-only selection unsafe. */
export function legacyPlanChecks(paths, {full = false} = {}) {
  assertPaths(paths, full);
  const selected = new Set(['scripts']);
  let all = full;
  for (const path of paths) {
    // 说明书读取器只消费这两层的直接 Markdown，镜像也打包同一输入。
    if (/^docs\/instruction-book\/(?:skills|features)\/[^/]+\.md$/.test(path)) {
      selected.add('brain-unit');
      selected.add('image');
      continue;
    }
    // Markdown 也可能是实际运行时提示词；只有明确的文档位置/文件名才走轻量路径。
    if (DOCUMENT_NAME.test(path) || ROOT_DOCUMENT.test(path) ||
      ((path.startsWith('docs/') || path.startsWith('sprints/')) && DOCUMENT.test(path))) continue;
    if (path.startsWith('packages/mcp-readonly/')) selected.add('mcp');
    if (isConfiguration(path) || /^(?:\.github|scripts|config)\//.test(path) ||
      /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|\.npmrc|\.skills-source\.json)$/.test(path)) {
      all = true;
    } else if (path.startsWith('apps/api/features/')) selected.add('dashboard');
    // 独立旧Core服务不在现役compose；它的src/tests不冒充Brain运行输入。
    else if (/^apps\/api\/(?:src|tests)\//.test(path)) continue;
    else if (path.startsWith('apps/api/')) all = true;
    else if (path.startsWith('packages/brain/')) {
      for (const component of SHARED_RUNTIME) selected.add(component);
    }
    else if (path.startsWith('packages/mcp-readonly/')) selected.add('mcp');
    else if (path.startsWith('apps/dashboard/')) selected.add('dashboard');
    else all = true;
  }
  return matrixFor(all ? new Set([...ACTIVE, ...selected]) : selected);
}

export function legacyDomainForTest(path) {
  if (path.startsWith('docker/cecelia-runner/') || path.endsWith('/runner-credential-single-chain-smoke.sh')) return 'runner';
  if (/\/(?:dispatch-worker|codex-request|codex-remote-launch)/.test(path)) return 'launcher';
  if (/\/preview-|\/preview-agent\//.test(path)) return 'preview';
  if (/\/dashboard-|\/deploy-chain-wounds-/.test(path)) return 'dashboard';
  if (/\/brain-image-|\/bluegreen-|\/brain-deploy-|\/brain-compose-|\/gate3-brain-|\/deploy-local-npm-cache-/.test(path)) return 'brain';
  if (/^scripts\/ops\/__tests__\/(?:credentials\/|janitor\/|opc[_-]|openclaw_)/.test(path)) return 'ops';
  return null;
}

export function legacyDomainsForChanges(paths) {
  if (paths === null) return null;
  if (!Array.isArray(paths) || !paths.length || paths.some(path => typeof path !== 'string' ||
      !path || path.includes('\0') || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..'))) {
    throw new Error('Ops PR paths 路径列表无效');
  }
  const domains = new Set(['brain']);
  for (const path of paths) {
    // 构建配置、CI调度及未分类来源都必须保守全量；不能猜测公共文件的影响面。
    if (/^(?:\.github\/|scripts\/ci\/|config\/|package(?:-lock)?\.json$|\.npmrc$)/.test(path) ||
        /^packages\/brain\/(?:config\/|package(?:-lock)?\.json$)/.test(path)) return null;
    const ownTest = /\.test\.(?:mjs|cjs|sh)$|^scripts\/smoke\//.test(path) ? legacyDomainForTest(path) : null;
    if (ownTest) { domains.add(ownTest); continue; }
    if (/^scripts\/(?:dispatch-worker|codex-request|codex-remote-launch)/.test(path)) domains.add('launcher');
    else if (/^(?:scripts\/ops\/|tests\/ops\/)/.test(path) ||
        /^packages\/brain\/src\/(?:lib\/(?:infra-|existing-ops-)|.*company-kr)/.test(path)) domains.add('ops');
    else if (/^(?:scripts\/(?:preview-|request-preview-|wait-preview-|verify-preview-|lib\/preview-)|packages\/brain\/src\/(?:preview-|routes\/preview\.js|capacity-gate\.js))/.test(path)) domains.add('preview');
    else if (/^(?:apps\/dashboard\/|frontend-proxy\.js$|scripts\/(?:promote-dashboard|rollback-cecelia|dashboard-|dev-preview|lib\/(?:dashboard-|release-)))/.test(path)) domains.add('dashboard');
    else if (/^(?:docker\/cecelia-runner\/|docker\/build\.sh$|packages\/brain\/(?:scripts\/fleet-worker\/|src\/(?:orchestrator\/|app-server\/|executor|spawn\/)))/.test(path)) domains.add('runner');
    else if (/^scripts\/deploy-local\.sh$|^docker-compose.*\.ya?ml$/.test(path)) {
      for (const domain of ['runner', 'dashboard', 'preview']) domains.add(domain);
    } else if (/^scripts\/(?:brain-(?:deploy|build|rollback)|lib\/(?:brain-|bluegreen|internal-auth))/.test(path)) domains.add('runner');
    // 注册/回调、入口及脚本会跨执行面。尚未逐项证明的公共接口按全量处理。
    else if (/^packages\/brain\/(?:server\.js|scripts\/|src\/(?:routes\.js|cecelia-routes\.js|routes\/|.*(?:executor|worker|credentials|fleet)))/.test(path)) return null;
    else if (/^packages\/brain\/src\//.test(path)) continue;
    else return null;
  }
  return domains;
}
