/**
 * Claude Code 无头调用通道防复活守卫（任务 76a160b3，决策 067867c8）
 *
 * 主理人曾因 claude -p / 订阅 OAuth 被自动化调用而封号，通道已彻底下线。
 * 本守卫扫描 packages/brain、packages/workflows 下全部非测试、非文档源码，
 * 任何能重新拉起 claude CLI 的写法出现即红。白名单：lib/claude-channel.js 自身，
 * 以及整个 scripts/coding-workflow/ 目录（新编码流水线 runClaude/spawnClaude 用机器默认 Claude 登录，
 * 主理人 2026-10-10 决定保留，见决策 3859041e）。
 *
 * 判据（每条都必须能自证会报警，见末尾 describe）：
 *   R1 进程类调用（spawn/exec/execFile/…，含 doSpawn 之类包装）首参是 claude 命令字面量
 *   R2 命令位上的 claude（行首/管道/&&/;/env 前缀之后）且带 -p/--print/--resume/--session-id
 *   R3 command/cmd/bin 等字段的取值落到 claude 字面量（含 `?? 'claude'` / `|| 'claude'` 兜底）
 *   R4 claude 二进制绝对路径字面量（/opt/homebrew/bin/claude 等，存在即只为执行它）
 *   R5 以 CLAUDE_BIN / claudeBin / discoverClaudeBin 作为命令来源
 *   R6 引用 claude-launch.sh 启动器（它唯一用途是拉起 claude）
 *   R7 argv 数组首元素是 claude 且紧跟参数（['claude', '-p', …] 交给任意执行器）
 */
import { describe, it, expect } from 'vitest';
import { parse } from 'acorn';
/** 模式常量只能留在已审解析闭包；每种突变均应使纯数据资格失败。 */
function mutateStageMode(kind,sources,root){
 const file=path.join(root,'existing-ops-stage-modes.js'),other=path.join(root,'../unreviewed-mode-consumer.js');
 if(kind==='mode eval')sources.set(file,sources.get(file)+'\neval(REVIEWED_STAGE_MODES[0]["lib/repo-profile.mjs"]);');
 if(kind==='mode raw export')sources.set(file,sources.get(file)+'\nexport const raw=STAGE_ENVELOPES.recorded.spec;');
 if(kind==='mode process')sources.set(file,sources.get(file)+"\nimport {spawn as launch} from 'node:child_process';launch('claude',['-p']);");
 if(kind==='third mode')sources.set(other,"import {REVIEWED_STAGE_MODES} from './lib/existing-ops-stage-modes.js';eval(REVIEWED_STAGE_MODES[0]['lib/repo-profile.mjs']);");
 if(kind==='escaped mode')sources.set(other,"const m=await import('./lib/existing-ops-stage-\\u006dodes.js');eval(m.REVIEWED_STAGE_MODES[0]['lib/repo-profile.mjs']);");
 if(kind==='concat mode')sources.set(other,"const m=await import('./lib/existing-ops-stage-'+'modes.js');Function(m.REVIEWED_STAGE_MODES[0]['lib/repo-profile.mjs'])();");
 if(kind==='changed mode path'){sources.set(path.join(root,'other-stage-modes.js'),sources.get(file));sources.delete(file);}
}

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BRAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(BRAIN_ROOT, '../..');
const SCAN_ROOTS = [BRAIN_ROOT, path.join(REPO_ROOT, 'packages/workflows')];
const SOURCE_EXT = new Set(['.js', '.cjs', '.mjs', '.ts']);
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'tests', 'test', 'fixtures', '__fixtures__', 'docs', 'coverage', 'dist', '.git']);
const WHITELIST = new Set([path.join(BRAIN_ROOT, 'src/lib/claude-channel.js')]);
// 主理人 2026-10-10 决定保留新编码流水线（runClaude/spawnClaude），见决策 3859041e
const WHITELIST_DIRS = [path.join(BRAIN_ROOT, 'scripts/coding-workflow') + path.sep];
const CODING_WORKFLOW_CLAUDE = path.join(BRAIN_ROOT, 'scripts/coding-workflow/lib/claude.mjs');

function isWhitelisted(file) {
  return WHITELIST.has(file) || WHITELIST_DIRS.some((dir) => file.startsWith(dir));
}

const CMD = String.raw`(?:\S*\/)?claude`;
const RULES = [
  { id: 'R1', re: new RegExp(String.raw`\b\w*(?:spawn|Spawn|exec|Exec|fork)\w*\s*\(\s*(['"\x60])${CMD}\1`) },
  { id: 'R2', re: new RegExp(String.raw`(?:^|['"\x60]|(?:&&|\|\||[;|]|\$\(|\bexec|\benv(?:\s+\w+=\S+)*|\btimeout\s+\S+|\bnohup|\bsetsid)\s+)(?<!\b(?:grep|pgrep|pkill)\s+(?:-\S+\s+)*['"]?)${CMD}\s+(?:[^|;&'"\n]*\s)?(?:-p|--print|--resume|--session-id)\b`) },
  { id: 'R3', re: new RegExp(String.raw`\b(?:command|cmd|bin|binary|executable)\s*[:=][^,;\n]*(['"\x60])${CMD}\1`) },
  { id: 'R4', re: /['"`](?:\/opt\/homebrew\/bin|\/usr\/local\/bin|[^'"`\s]*\/\.local\/bin|[^'"`\s]*\/\.npm-global\/bin)\/claude['"`]/ },
  { id: 'R5', re: /\b(?:CLAUDE_BIN|claudeBin|discoverClaudeBin)\b/ },
  { id: 'R6', re: /claude-launch\.sh/ },
  { id: 'R7', re: new RegExp(String.raw`\[\s*(['"\x60])${CMD}\1\s*,\s*(['"\x60])-`) },
];

function isTestOrDoc(file) {
  return /\.(test|spec)\.[cm]?[jt]s$/.test(file) || file.endsWith('.d.ts');
}

function collectSources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) collectSources(full, out);
    else if (SOURCE_EXT.has(path.extname(name)) && !isTestOrDoc(name)) out.push(full);
  }
  return out;
}

/** 去掉整行注释与块注释里的内容，保留行号对齐；只扫可执行代码。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*(\/\/|#|\*)/.test(line) ? '' : line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')));
}

// 只剥离已证明流入 Acorn 的固定模板值；模块其余内容仍经过所有原规则。
const ENVELOPE_FILE = path.join(BRAIN_ROOT,'src/lib/existing-ops-build-envelopes.js');
const ENVELOPE_CONSUMER = path.join(BRAIN_ROOT,'src/lib/existing-ops-build-source.js');
const parseModule = text => parse(text,{ecmaVersion:'latest',sourceType:'module'});
function astRows(tree) {
  const rows=[];
  const visit=(node,parent=null)=>{if(!node||typeof node!=='object')return;if(node.type)rows.push({node,parent});for(const v of Object.values(node))if(Array.isArray(v))v.forEach(n=>visit(n,node));else if(v&&typeof v==='object')visit(v,node);};
  visit(tree);return rows;
}
const astShape = n => JSON.stringify(n,(k,v)=>['start','end','raw'].includes(k)?undefined:v);
// 已独审的 boolean readers 及其纯比较闭包；摘要只决定模板可否剥除，并不豁免模块扫描。
// 模板 AST 不得流出这些固定函数；改变 matcher 时需显式复审此有限消费合同。
const PURE_READERS = new Set(["canonical", "declaration", "walk", "nodes", "bound", "member", "call", "variable", "fn", "same", "intact", "moduleEnvelope", "namedFunctionsLink", "functionMatches", "registration", "registrationBody", "testSetup", "testWitness", "mainPrefix", "cliEnvelope", "proveLegacyBuildSources", "proveBuildSources", "proveLegacyPublishSources", "provePublishSources"]);
const PURE_READERS_SHA256 = '32834e4869d8d7b9f6062813044fcc44224ac9712082b7ab36ea98a4ac889d63';
function provenReaderClosure(consumer) {
  if(consumer.body.some(n=>n.type==='ExportNamedDeclaration'&&n.source&&(n.source.value!=='./existing-ops-build-envelopes.js'||n.specifiers.length!==1||n.specifiers[0].local.name!=='buildSelectorEnabled'||n.specifiers[0].exported.name!=='buildSelectorEnabled')))return false;
  const declarations=consumer.body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n).filter(Boolean);
  const definitions=declarations.flatMap(n=>n.type==='VariableDeclaration'?n.declarations:[n]);
  const selected=[...PURE_READERS].map(name=>definitions.filter(n=>n.id?.name===name));
  if(selected.some(rows=>rows.length!==1)||createHash('sha256').update(astShape(selected.map(rows=>rows[0]))).digest('hex')!==PURE_READERS_SHA256)return false;
  const constants=new Set(['requireAcorn','PREFIX','BUILD_SOURCE_PATHS','PUBLISH_TEST','PUBLISH_ENTRY']);
  const functions=new Set([...PURE_READERS,'parseEnvelope','collectBuildSources','collectPublishSources','provenanceInputs','collectProvenanceInputs']);
  if(declarations.some(n=>n.type==='ImportDeclaration'?!['node:module','./existing-ops-build-envelopes.js','./existing-ops-provenance-envelope.js','./existing-ops-stage-source.js','./existing-ops-native-evidence-source.js'].includes(n.source.value):n.type==='VariableDeclaration'?n.declarations.some(d=>!constants.has(d.id.name)&&!PURE_READERS.has(d.id.name)):n.type==='FunctionDeclaration'?!functions.has(n.id.name):true))return false;
  // 真实模块无需动态代码/模块入口；新增顶层副作用或读取者之外的全局写入一律失败关闭。
  const rows=astRows(consumer),parents=new Map(rows.map(r=>[r.node,r.parent]));
  const readerOf=node=>{for(let n=node;n;n=parents.get(n))if(n.type==='FunctionDeclaration'&&PURE_READERS.has(n.id?.name))return n;return null;};
  return !rows.some(({node,parent})=>node.type==='ImportExpression'||node.type==='Identifier'&&['eval','Function','global','globalThis','process','Reflect'].includes(node.name)
    ||node.type==='AssignmentExpression'&&!readerOf(node)
    ||node.type==='Identifier'&&node.name==='parseEnvelope'&&parent?.type==='CallExpression'&&parent.callee===node&&!readerOf(node));
}

// 已独审的完整 runtime 指纹闭包：固定十三文件只读→SHA摘要/比较；没有模板执行或原文出口。
// 仅此路径且整个模块 AST 相等时认可该消费者；任何语义改动都须重新审查。
// 这不把 runtime 加入文件白名单，模块原 R1–R7/进程别名扫描照常执行。
const HASH_RUNTIME_FILE = path.join(BRAIN_ROOT,'src/lib/native-consumer-runtime.js');
const HASH_RUNTIME_SHA256 = 'a3dc811f2170896591e197d3dbf503759a1e3ab21722adf59e8570c7a1193d99';
const provenFingerprintReader = (file,text) => file===HASH_RUNTIME_FILE
  &&createHash('sha256').update(astShape(parseModule(text))).digest('hex')===HASH_RUNTIME_SHA256;

// V2 normalize 返回代码字符串投影；安全边界是完整已审 helper + 唯一已审 caller，
// caller 只将投影交回旧 Acorn/matcher。未知消费者不能继承此资格。
const STAGE_HELPER=path.join(BRAIN_ROOT,'src/lib/existing-ops-stage-source.js');
const STAGE_DATA=path.join(BRAIN_ROOT,'src/lib/existing-ops-stage-envelopes.js');
const STAGE_MODES=path.join(BRAIN_ROOT,'src/lib/existing-ops-stage-modes.js');
const PROVENANCE_HELPER = path.join(BRAIN_ROOT,'src/lib/existing-ops-provenance-envelope.js');
const NATIVE_HELPER = path.join(BRAIN_ROOT,'src/lib/existing-ops-native-evidence-source.js');
const NATIVE_DATA = path.join(BRAIN_ROOT,'src/lib/existing-ops-native-evidence-envelopes.js');
const PROVENANCE_READER_HASHES = new Map([
  ['existing-ops-stage-source.js','317bd323a8a6acacd581eeecef4a327adbf588c6540e16544f1fb0a4394e639e'],
  ['existing-ops-stage-modes.js','8266c7b1f74b11a0161684f83e3deb189ee101e2a0b64578cacffaaff1711752'],
  ['existing-ops-stage-envelopes.js','1fda2fc1f3bf3ef7684930e46ac8dc0364bd1af1f8f27e97c7eb197fe23a6d8f'],
  ['existing-ops-provenance-envelope.js','27c87c40b07ef90e87d642042afbdeb6a770a71ec74582da312599ec6fae5d5e'],
  ['existing-ops-provenance-core-envelope.js','c3e8769e7f053fc63d52074235b521df5134e65c31d34f151bb6a9400fa4ab93'],
  ['existing-ops-provenance-entry-envelopes.js','126a93b9db9856fe06894a394ecb9e0afd099860b9fb54e8927c56c8b96a15bb'],
  ['existing-ops-provenance-local-envelopes.js','ef359ef987229815f3d258ff78535fb55dc909bb64eae88d67ce63d0ea55c7f4'],
  // 新完整模块仅作有界Brotli→JSON数据与Acorn比较；整个AST及所有真实消费者均固定。
  ['existing-ops-native-evidence-source.js','db5308fd90094044e2e4942dc704c90a41e6a225fd5bf04d0f5b876959175eb0'],
  ['existing-ops-native-evidence-envelopes.js','ed0b4b01fb98b9ee5c852736286ae22ad7ce28252936840df257666778949c57'],
].map(([name,hash])=>[path.join(BRAIN_ROOT,'src/lib',name),hash]));
const PROVENANCE_CALLER_SHA256 = '689b9d5ed49e6d76a8f16b2a8cf8f4fea87f510cb33697a4ff3b2cb92770118e';
// 仅静态折叠有界字面量拼接；不求值标识符、调用或运行时表达式。
function constantReferenceString(node,depth=0) {
  if(!node||depth>32)return null;
  if(node.type==='Literal'&&typeof node.value==='string')return node.value.length<=4096?node.value:null;
  if(node.type==='TemplateLiteral'&&!node.expressions.length) {
    const value=node.quasis.map(q=>q.value.cooked).join('');
    return value.length<=4096?value:null;
  }
  if(node.type==='BinaryExpression'&&node.operator==='+') {
    const left=constantReferenceString(node.left,depth+1),right=constantReferenceString(node.right,depth+1);
    if(left!==null&&right!==null&&left.length+right.length<=4096)return left+right;
  }
  return null;
}
function decodedReferenceTexts(text) {
  try{return [text,...astRows(parseModule(text)).flatMap(({node})=>{
    if(node.type==='Literal'&&typeof node.value==='string')return [node.value];
    if(node.type==='TemplateLiteral'&&!node.expressions.length)return [node.quasis.map(q=>q.value.cooked).join('')];
    const value=constantReferenceString(node);
    return value===null?[]:[value];
  })];}
  catch{return [text];} // 非 JS 文件仍保留原文本检查。
}
function provenanceReaderClosure(sources) {
  if(createHash('sha256').update(astShape(parseModule(sources.get(ENVELOPE_CONSUMER)||''))).digest('hex')!==PROVENANCE_CALLER_SHA256)return false;
  const decoded=new Map([...sources].map(([file,text])=>[file,decodedReferenceTexts(text)]));
  for(const [file,hash] of PROVENANCE_READER_HASHES) {
    if(createHash('sha256').update(astShape(parseModule(sources.get(file)||''))).digest('hex')!==hash)return false;
    for(const [consumer,text] of sources) {
      if(!decoded.get(consumer).some(value=>value.includes(path.basename(file))))continue;
      const callers=file===NATIVE_DATA?[NATIVE_HELPER]:file===NATIVE_HELPER?[ENVELOPE_CONSUMER,STAGE_HELPER,PROVENANCE_HELPER]
        :file===STAGE_DATA?[STAGE_HELPER,STAGE_MODES]:file===STAGE_MODES?[STAGE_HELPER]:file===STAGE_HELPER||file===PROVENANCE_HELPER?[ENVELOPE_CONSUMER]:[PROVENANCE_HELPER];
      if(callers.includes(consumer))continue;
      if(provenFingerprintReader(consumer,text))continue;
      return false;
    }
  }
  return true;
}

function envelopeRanges(src,sources) {
  const tree=parseModule(src), rows=astRows(tree);
  const declarations=tree.body.filter(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.kind==='const').flatMap(n=>n.declaration.declarations).filter(n=>n.id.name==='ENVELOPES');
  if(declarations.length!==1)return null;
  const data=declarations[0],properties=data.init?.properties;
  if(data.init?.type!=='ObjectExpression'||!properties?.length||properties.some(p=>p.type!=='Property'||p.computed||p.method||p.kind!=='init'||p.value?.type!=='TemplateLiteral'||p.value.expressions.length))return null;
  if(rows.some(({node,parent})=>node.type==='Identifier'&&node.name==='ENVELOPES'&&!(parent===data&&parent.id===node)))return null;
  // 额外消费者没有获得纯数据资格；不推断它不会执行字符串。
  if(!provenanceReaderClosure(sources))return null;
  for(const [file,text] of sources)if(file!==ENVELOPE_FILE&&file!==ENVELOPE_CONSUMER&&file!==PROVENANCE_HELPER&&text.includes('existing-ops-build-envelopes')&&!provenFingerprintReader(file,text))return null;
  const consumer=parseModule(sources.get(ENVELOPE_CONSUMER)||''), usages=astRows(consumer);
  if(!provenReaderClosure(consumer))return null;
  const imports=consumer.body.filter(n=>n.type==='ImportDeclaration');
  const dataImport=imports.filter(n=>n.source.value==='./existing-ops-build-envelopes.js');
  const moduleImport=imports.filter(n=>n.source.value==='node:module');
  if(dataImport.length!==1||dataImport[0].specifiers.length!==1||dataImport[0].specifiers[0].imported?.name!=='ENVELOPES'||dataImport[0].specifiers[0].local.name!=='ENVELOPES')return null;
  if(moduleImport.length!==1||moduleImport[0].specifiers.length!==1||moduleImport[0].specifiers[0].imported?.name!=='createRequire'||moduleImport[0].specifiers[0].local.name!=='createRequire')return null;
  const requireDeclaration=consumer.body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='requireAcorn'));
  const parser=consumer.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='parseEnvelope');
  if(astShape(requireDeclaration)!==astShape(parseModule('const requireAcorn = createRequire(import.meta.url);').body[0])||astShape(parser)!==astShape(parseModule("function parseEnvelope(text) { return requireAcorn('acorn').parse(text, { ecmaVersion: 'latest', sourceType: 'module' }); }").body[0]))return null;
  const parents=new Map(usages.map(({node,parent})=>[node,parent]));
  let count=0;
  for(const {node,parent} of usages) {
    if(node.type!=='Identifier')continue;
    if(node.name==='ENVELOPES') {
      if(parent?.type==='ImportSpecifier')continue;
      if(parent?.type!=='MemberExpression'||parent.object!==node)return null;
      if(parent.computed&&!['Identifier','Literal','BinaryExpression'].includes(parent.property.type))return null;
      const use=parents.get(parent);
      const direct=use?.type==='CallExpression'&&use.callee.name==='parseEnvelope'&&use.arguments.length===1&&use.arguments[0]===parent;
      const wrapped=use?.type==='TemplateLiteral'&&use.expressions.length===1&&use.expressions[0]===parent&&parent.property.name==='mainPrefix'&&!parent.computed&&use.quasis.map(q=>q.value.cooked).join('|')==='async function main(input) {|}'&&parents.get(use)?.callee?.name==='parseEnvelope'&&parents.get(use).arguments.length===1;
      if(!direct&&!wrapped)return null;count++;
    }
    if(node.name==='parseEnvelope'&&!(parent===parser&&parent.id===node)&&!(parent?.type==='CallExpression'&&parent.callee===node))return null;
    if(node.name==='requireAcorn'&&!(parent===requireDeclaration.declarations[0]&&parent.id===node)&&!(parent?.type==='CallExpression'&&parent.callee===node&&node.start>=parser.start&&node.end<=parser.end))return null;
    if(node.name==='createRequire'&&parent?.type!=='ImportSpecifier'&&!(parent?.type==='CallExpression'&&parent.callee===node&&node.start>=requireDeclaration.start&&node.end<=requireDeclaration.end))return null;
  }
  return count?properties.map(p=>[p.value.start,p.value.end]):null;
}
// 原正则仍保留；补充进程函数的显式本地别名，不能靠改名藏起真实启动。
function aliasedProcessCalls(src) {
  try {
    const rows=astRows(parseModule(src)),aliases=new Set(['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']);
    for(const {node} of rows)if(node.type==='ImportDeclaration'&&['node:child_process','child_process'].includes(node.source.value))for(const spec of node.specifiers)if(aliases.has(spec.imported?.name))aliases.add(spec.local.name);
    for(let i=0;i<rows.length;i++){let added=false;for(const {node} of rows)if(node.type==='VariableDeclarator'&&node.id.type==='Identifier'&&aliases.has(node.init?.name)&&!aliases.has(node.id.name)){aliases.add(node.id.name);added=true;}if(!added)break;}
    return rows.filter(({node})=>node.type==='CallExpression'&&aliases.has(node.callee?.name)&&typeof node.arguments[0]?.value==='string'&&/(^|\/)claude(?:\s|$)/.test(node.arguments[0].value)).map(({node})=>({rule:'R1',line:src.slice(0,node.start).split('\n').length,text:src.slice(node.start,node.end).slice(0,160)}));
  }catch{return [];}
}

export function findClaudeInvocations(src, {file,sources}={}) {
  const original=src;
  if(file===NATIVE_DATA){
    let readonly=false;try{readonly=src===sources.get(file)&&provenanceReaderClosure(sources);}catch{}
    // 压缩并不隐藏可执行语句：整个数据模块不匹配或任何新消费者出现都明确E1，原R1-R7继续扫描。
    if(!readonly)return [{rule:'E1',line:1,text:'原生封套不在已审只读消费闭包'},...findClaudeInvocations(src)];
  }
  if(file===STAGE_DATA){
    let ranges;try{if(src===sources.get(file)&&provenanceReaderClosure(sources))ranges=astRows(parseModule(src)).filter(({node})=>node.type==='Literal'&&typeof node.value==='string').map(({node})=>[node.start,node.end]);}catch{}
    if(!ranges)return [{rule:'E1',line:1,text:'阶段封套不在已审只读消费闭包'},...findClaudeInvocations(src)];
    for(const [start,end] of ranges.reverse())src=src.slice(0,start)+src.slice(start,end).replace(/[^\n]/g,' ')+src.slice(end);
  }
  if(file===ENVELOPE_FILE) {
    let ranges;try{ranges=envelopeRanges(src,sources);}catch{ranges=null;}
    if(!ranges)return [{rule:"E1",line:1,text:"来源模板不是已证明的只读 Acorn 输入"},...findClaudeInvocations(src)];
    for(const [start,end] of [...ranges].reverse())src=src.slice(0,start)+src.slice(start,end).replace(/[^\n]/g," ")+src.slice(end);
  }
  const hits = [];
  stripComments(src).forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.re.test(line)) hits.push({ rule: rule.id, line: i + 1, text: line.trim().slice(0, 160) });
    }
  });
  return [...hits,...aliasedProcessCalls(original)];
}

function scanOffenders() {
  const offenders = [];
  const files=SCAN_ROOTS.flatMap(root=>collectSources(root));
  const sources=new Map([...files,...collectSources(path.join(REPO_ROOT,"scripts"))].map(file=>[file,readFileSync(file,"utf8")]));
  for (const file of files) {
      if (isWhitelisted(file)) continue;
      for (const hit of findClaudeInvocations(sources.get(file),{file,sources})) {
        offenders.push(`${path.relative(REPO_ROOT, file)}:${hit.line} [${hit.rule}] ${hit.text}`);
      }
  }
  return offenders;
}
describe('Claude 无头通道防复活守卫：源码扫描', () => {
  it('packages/brain 与 packages/workflows 非测试源码中不存在任何拉起 claude CLI 的写法', () => {
    const offenders = scanOffenders();
    expect(offenders, `发现 claude 无头调用路径：\n${offenders.join('\n')}`).toEqual([]);
  });
  it('白名单生效而非守卫失灵：coding-workflow 的 claude 启动写法能被判据识别，但不进 offenders', () => {
    const src = readFileSync(CODING_WORKFLOW_CLAUDE, 'utf8');
    expect(findClaudeInvocations(src).length).toBeGreaterThan(0);
    expect(collectSources(BRAIN_ROOT)).toContain(CODING_WORKFLOW_CLAUDE);
    expect(isWhitelisted(CODING_WORKFLOW_CLAUDE)).toBe(true);
    expect(isWhitelisted(path.join(BRAIN_ROOT, 'src/executor.js'))).toBe(false);
    expect(scanOffenders().filter((o) => o.includes('scripts/coding-workflow/'))).toEqual([]);
  });
  it('单一来源常量模块存在且声明通道已退役', async () => {
    const mod = await import('../lib/claude-channel.js');
    expect(mod.CLAUDE_CHANNEL_RETIRED).toBe(true);
    expect(mod.CLAUDE_CHANNEL_RETIRED_CODE).toBe('claude_channel_retired');
    expect(() => mod.assertClaudeChannelRetired('guard')).toThrow(/claude_channel_retired/);
    const err = (() => { try { mod.assertClaudeChannelRetired('x'); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(mod.ClaudeChannelRetiredError);
    expect(err.code).toBe('claude_channel_retired');
    expect(mod.isClaudeCommand('claude')).toBe(true);
    expect(mod.isClaudeCommand('/opt/homebrew/bin/claude')).toBe(true);
    expect(mod.isClaudeCommand('"/usr/local/bin/claude"')).toBe(true);
    expect(mod.isClaudeCommand('claude-launch.sh')).toBe(true);
    expect(mod.isClaudeCommand('codex')).toBe(false);
    expect(mod.isClaudeCommand('docker')).toBe(false);
    expect(mod.isClaudeCommand('ssh')).toBe(false);
    expect(mod.isClaudeCommand(undefined)).toBe(false);
  });
});
describe('守卫自证：每条判据都会报警', () => {
  it.each([
    ['R1', "const p = spawn('claude', ['-p', prompt]);"],
    ['R1', "execFile('claude', ['-p', ...args], cb);"],
    ['R1', 'const r = spawnSync("/opt/homebrew/bin/claude", args);'],
    ['R1', "await doSpawn('claude');"],
    ['R2', "exec(`claude -p ${prompt}`);"],
    ['R2', "const cmd = 'cd /tmp && claude --print hi';"],
    ['R2', "const c = 'env A=1 claude --resume abc';"],
    ['R3', "const bin = process.env.X_BIN || 'claude';"],
    ['R3', "command: execution.command ?? 'claude',"],
    ['R4', "const p = '/opt/homebrew/bin/claude';"],
    ['R5', 'llm.run({ command: CLAUDE_BIN, args });'],
    ['R6', "const launcher = path.join(repo, 'scripts/claude-launch.sh');"],
    ['R7', "cmdArgs = ['claude', '--dangerously-skip-permissions', '-p'];"],
  ])('%s 命中：%s', (rule, line) => {
    expect(findClaudeInvocations(line).map((h) => h.rule)).toContain(rule);
  });
  it.each([
    ["execSync(\"ps -eo pid,ppid,args | grep 'claude -p' | grep -v grep\")"],
    ["if (!bin.endsWith('/claude') && bin !== 'claude') continue;"],
    ["const ENGINE_NAMES = ['codex', 'claude', 'terra'];"],
    ["spawn('codex', ['exec', prompt]);"],
    ["// spawn('claude', ['-p'])  注释不算"],
    ["provider: 'claude',"],
    ["desc: '派发并监控任务，bridge → claude -p /skill 调用链',"],
    ["const TIER_C_BODY = /Skill\\s*\\(|claude -p\\b/;"],
  ])('不误报：%s', (line) => {
    expect(findClaudeInvocations(line)).toEqual([]);
  });
});
describe('只读来源封套数据与实际执行代码分离',()=>{
 const dataFile=path.join(BRAIN_ROOT,'src/lib/existing-ops-build-envelopes.js');
 const consumer=path.join(BRAIN_ROOT,'src/lib/existing-ops-build-source.js');
 const baseSources=()=>new Map([[dataFile,readFileSync(dataFile,'utf8')],[consumer,readFileSync(consumer,'utf8')],...[...PROVENANCE_READER_HASHES.keys()].map(file=>[file,readFileSync(file,'utf8')])]);
 const scan=(edit=()=>{},suffix='')=>{const sources=baseSources();edit(sources);return findClaudeInvocations(sources.get(dataFile)+suffix,{file:dataFile,sources});};
 it('真实无插值ENVELOPES仅供Acorn解析，原R3文本不是进程执行',()=>expect(scan()).toEqual([]));
 it.each(['spawn','alias','interpolation','consume','consumer_alias','extra_consumer','parser_shadow','parser_reassign','ast_escape','helper_side_effect','top_side_effect','dynamic_module'])('封套 %s 不得被纯数据豁免遮住',kind=>{
  const result=scan(sources=>{
   if(kind==='spawn')sources.set(dataFile,sources.get(dataFile)+"\nspawn('claude',['-p']);");
   if(kind==='alias')sources.set(dataFile,sources.get(dataFile)+"\nimport {spawn as launch} from 'node:child_process';launch('claude',['-p']);");
   if(kind==='interpolation')sources.set(dataFile,sources.get(dataFile).replace('spawnParameters: `','spawnParameters: `${launch("claude")}'));
   if(kind==='consume')sources.set(consumer,sources.get(consumer)+"\nexec(ENVELOPES.spawnParameters);");
   if(kind==='consumer_alias')sources.set(consumer,sources.get(consumer)+"\nconst escaped=ENVELOPES;exec(escaped.spawnParameters);");
   if(kind==='extra_consumer')sources.set(path.join(BRAIN_ROOT,'src/extra.js'),"import {ENVELOPES} from './lib/existing-ops-build-envelopes.js';exec(ENVELOPES.spawnParameters)");
   if(kind==='ast_escape')sources.set(consumer,sources.get(consumer)+"\nimport {spawn as executeDerived} from 'node:child_process';const derived=parseEnvelope(ENVELOPES.spawnParameters);executeDerived(derived.body[0].params[0].properties.find(p=>p.key.name==='bin').value.right.right.value,['-p','probe']);");
   if(kind==='helper_side_effect')sources.set(consumer,sources.get(consumer).replace('const same=(a,b)=>canonical(a)===canonical(b);','const same=(a,b)=>{ sendElsewhere(b); return true; };'));
   if(kind==='top_side_effect')sources.set(consumer,sources.get(consumer)+"\nJSON.stringify=executeDerived;");
   if(kind==='dynamic_module')sources.set(consumer,sources.get(consumer)+"\nconst tool=await import('node:child_process');");
   if(kind==='parser_shadow')sources.set(consumer,sources.get(consumer).replace('function functionMatches(tree,name,_parse)', 'function functionMatches(tree,name,_parse,parseEnvelope)'));
   if(kind==='parser_reassign')sources.set(consumer,sources.get(consumer)+"\nparseEnvelope=eval;");
  });expect(result.length).toBeGreaterThan(0);
 });
 it.each(['helper eval','helper raw export','third helper consumer','escaped helper import','escaped dynamic helper import','third data consumer','other helper path','data top effect'])('V2 %s 不得逃逸完整只读消费闭包',kind=>{
  const result=scan(sources=>{
   if(kind==='helper eval')sources.set(PROVENANCE_HELPER,sources.get(PROVENANCE_HELPER)+'\neval(ENVELOPES.runClaude);');
   if(kind==='helper raw export')sources.set(PROVENANCE_HELPER,sources.get(PROVENANCE_HELPER)+'\nexport const raw=ENVELOPES.runClaude;');
   if(kind==='third helper consumer')sources.set(path.join(BRAIN_ROOT,'src/other.js'),"import {normalizeProvenanceBuild} from './lib/existing-ops-provenance-envelope.js'; eval(normalizeProvenanceBuild(candidate,parse).cli);");
   if(kind==='escaped helper import')sources.set(path.join(BRAIN_ROOT,'src/other.js'),"import {normalizeProvenanceBuild} from './lib/existing-ops-provenance-\\u0065nvelope.js'; eval(normalizeProvenanceBuild(candidate,parse).cli);");
   if(kind==='escaped dynamic helper import')sources.set(path.join(BRAIN_ROOT,'src/other.js'),"const {normalizeProvenanceBuild}=await import('./lib/existing-ops-provenance-\\u0065nvelope.js'); eval(normalizeProvenanceBuild(candidate,parse).cli);");
   if(kind==='third data consumer')sources.set(path.join(BRAIN_ROOT,'src/other.js'),"import {REVIEWED} from './lib/existing-ops-provenance-entry-envelopes.js'; eval(REVIEWED.runClaude);");
   if(kind==='other helper path'){sources.set(path.join(BRAIN_ROOT,'src/lib/other-helper.js'),sources.get(PROVENANCE_HELPER));sources.delete(PROVENANCE_HELPER);}
   if(kind==='data top effect'){const file=path.join(BRAIN_ROOT,'src/lib/existing-ops-provenance-entry-envelopes.js');sources.set(file,sources.get(file)+'\nexecute(REVIEWED.runClaude);');}
  });expect(result.some(hit=>hit.rule==='E1')).toBe(true);
 });
});
describe('新增阶段封套不允许执行或额外消费者',()=>{
 const helper=path.join(BRAIN_ROOT,'src/lib/existing-ops-stage-source.js'),data=path.join(BRAIN_ROOT,'src/lib/existing-ops-stage-envelopes.js');
 const base=()=>new Map([[ENVELOPE_FILE,readFileSync(ENVELOPE_FILE,'utf8')],[ENVELOPE_CONSUMER,readFileSync(ENVELOPE_CONSUMER,'utf8')],...[...PROVENANCE_READER_HASHES.keys(),helper,data,STAGE_MODES].map(file=>[file,readFileSync(file,'utf8')])]);
 it('实际只读阶段数据合同继续经过完整闭包资格',()=>{const sources=base();expect(findClaudeInvocations(sources.get(data),{file:data,sources})).toEqual([]);});
 it.each(['helper side effect','data side effect','third helper','third data','escaped data','mode eval','mode raw export','mode process','third mode','escaped mode','concat mode','changed mode path'])('%s使阶段及原封套资格失败',kind=>{
  const sources=base();
  mutateStageMode(kind,sources,path.join(BRAIN_ROOT,'src/lib'));
  if(kind==='helper side effect')sources.set(helper,sources.get(helper)+'\neval(REVIEWED.recorded.spec);');
  if(kind==='data side effect')sources.set(data,sources.get(data)+'\neval(STAGE_ENVELOPES.recorded.spec);');
  if(kind==='third helper')sources.set(path.join(BRAIN_ROOT,'src/extra.js'),"import {stageSourceVersion} from './lib/existing-ops-stage-source.js';stageSourceVersion(candidate,eval);");
  if(kind==='third data')sources.set(path.join(BRAIN_ROOT,'src/extra.js'),"import {STAGE_ENVELOPES} from './lib/existing-ops-stage-envelopes.js';eval(STAGE_ENVELOPES.recorded.spec);");
  if(kind==='escaped data')sources.set(path.join(BRAIN_ROOT,'src/extra.js'),"const {STAGE_ENVELOPES}=await import('./lib/existing-ops-stage-\\u0065nvelopes.js');eval(STAGE_ENVELOPES.recorded.spec);");
  expect(findClaudeInvocations(sources.get(data),{file:data,sources}).some(hit=>hit.rule==='E1')).toBe(true);
  expect(findClaudeInvocations(sources.get(ENVELOPE_FILE),{file:ENVELOPE_FILE,sources}).some(hit=>hit.rule==='E1')).toBe(true);
 });
});
describe('isolation 新封套仍只允许已审 Acorn 消费闭包',()=>{
 const core=path.join(BRAIN_ROOT,'src/lib/existing-ops-provenance-core-envelope.js');
 const local=path.join(BRAIN_ROOT,'src/lib/existing-ops-provenance-local-envelopes.js');
 const base=()=>new Map([[ENVELOPE_FILE,readFileSync(ENVELOPE_FILE,'utf8')],[ENVELOPE_CONSUMER,readFileSync(ENVELOPE_CONSUMER,'utf8')],...[...PROVENANCE_READER_HASHES.keys()].map(file=>[file,readFileSync(file,'utf8')])]);
 const scan=sources=>[ENVELOPE_FILE,STAGE_DATA].map(file=>findClaudeInvocations(sources.get(file),{file,sources}));
 it('完整新版本取得只读资格，原执行规则仍扫描剩余代码',()=>{
  const sources=base();
  expect(sources.get(core)).toContain('export const ISOLATION_REVIEWED');
  expect(sources.get(local)).toContain('export const ISOLATION_REVIEWED');
  expect(sources.get(STAGE_DATA)).toContain('export const ISOLATION_STAGE_ENVELOPES');
  expect(scan(sources)).toEqual([[],[]]);
 });
 it.each(['core eval','local Function','stage exec','raw helper export','extra core consumer','extra local consumer','escaped stage consumer','dynamic helper consumer','caller executes selector'])('%s不能继承新增数据的只读资格',kind=>{
  const sources=base(),other=path.join(BRAIN_ROOT,'src/unreviewed-isolation-consumer.js');
  if(kind==='core eval')sources.set(core,sources.get(core)+'\neval(ISOLATION_REVIEWED.recordProvenance);');
  if(kind==='local Function')sources.set(local,sources.get(local)+'\nnew Function(ISOLATION_REVIEWED.qaIsolation)();');
  if(kind==='stage exec')sources.set(STAGE_DATA,sources.get(STAGE_DATA)+'\nexec(ISOLATION_STAGE_ENVELOPES.evaluate);');
  if(kind==='raw helper export')sources.set(PROVENANCE_HELPER,sources.get(PROVENANCE_HELPER)+'\nexport const raw=ISOLATION_CORE.recordProvenance;');
  if(kind==='extra core consumer')sources.set(other,"import {ISOLATION_REVIEWED} from './lib/existing-ops-provenance-core-envelope.js';export const raw=ISOLATION_REVIEWED;");
  if(kind==='extra local consumer')sources.set(other,"import {ISOLATION_REVIEWED} from './lib/existing-ops-provenance-local-envelopes.js';eval(ISOLATION_REVIEWED.qaIsolation);");
  if(kind==='escaped stage consumer')sources.set(other,"import {ISOLATION_STAGE_ENVELOPES} from './lib/existing-ops-stage-\\u0065nvelopes.js';eval(ISOLATION_STAGE_ENVELOPES.evaluate);");
  if(kind==='dynamic helper consumer')sources.set(other,"const {provenanceSourceVersion}=await import('./lib/existing-ops-provenance-\\u0065nvelope.js');provenanceSourceVersion(candidate,eval);");
  if(kind==='caller executes selector')sources.set(ENVELOPE_CONSUMER,sources.get(ENVELOPE_CONSUMER)+'\nprovenanceSourceVersion(candidate,eval);');
  for(const hits of scan(sources))expect(hits.some(h=>h.rule==='E1')).toBe(true);
 });
 it('新阶段数据后的真实claude进程调用仍同时触发E1与R1',()=>{
  const sources=base();sources.set(STAGE_DATA,sources.get(STAGE_DATA)+"\nimport {spawn as launch} from 'node:child_process';launch('claude',['-p','probe']);");
  const hits=findClaudeInvocations(sources.get(STAGE_DATA),{file:STAGE_DATA,sources});
  expect(hits.some(h=>h.rule==='E1')).toBe(true);expect(hits.some(h=>h.rule==='R1')).toBe(true);
 });
});
describe('固定runtime字节指纹不执行来源模板',()=>{
 const runtime=path.join(BRAIN_ROOT,'src/lib/native-consumer-runtime.js');
 const source=readFileSync(runtime,'utf8');
 const base=()=>new Map([[ENVELOPE_FILE,readFileSync(ENVELOPE_FILE,'utf8')],[ENVELOPE_CONSUMER,readFileSync(ENVELOPE_CONSUMER,'utf8')],[runtime,source],...[...PROVENANCE_READER_HASHES.keys()].map(file=>[file,readFileSync(file,'utf8')])]);
 const scan=sources=>findClaudeInvocations(sources.get(ENVELOPE_FILE),{file:ENVELOPE_FILE,sources});
 it('真实固定模块仅fs读取后hash/比较，允许模板数据且模块本身仍经过R1-R7',()=>{
  expect(scan(base())).toEqual([]);
  expect(findClaudeInvocations(source,{file:runtime,sources:base()})).toEqual([]);
 });
 it.each([
  ['eval',s=>s+"\neval(readFileSync(new URL('existing-ops-build-envelopes.js',import.meta.url),'utf8'));"],
  ['Function',s=>s+"\nFunction(readFileSync(new URL('existing-ops-build-envelopes.js',import.meta.url),'utf8'))();"],
  ['exec',s=>s+"\nimport {exec} from 'node:child_process';exec(readFileSync(new URL('existing-ops-build-envelopes.js',import.meta.url),'utf8'));"],
  ['spawn',s=>s+"\nimport {spawn} from 'node:child_process';spawn(readFileSync(new URL('existing-ops-build-envelopes.js',import.meta.url),'utf8'));"],
  ['raw export',s=>s+"\nexport const raw=readFileSync(new URL('existing-ops-build-envelopes.js',import.meta.url),'utf8');"],
  ['raw hash replacement',s=>s.replace("createHash('sha256').update(bytes).digest('hex')","bytes.toString('utf8')")],
  ['hash rebinding',s=>s+"\ncreateHash=eval;"],
  ['dynamic import',s=>s+"\nawait import('node:child_process');"],
  ['changed read path',s=>s.replace('new URL(name,import.meta.url)',"new URL(name,'file:///tmp/')")],
  ['global side effect',s=>s+"\nBuffer.from=eval;"],
  ['exec alias',s=>s+"\nimport {exec as launch} from 'node:child_process';launch(readFileSync(new URL('existing-ops-build-envelopes.js',import.meta.url),'utf8'));"],
  ['names expansion',s=>s.replace("'existing-ops-source.js',","'unreviewed-source.js','existing-ops-source.js',")],
  ['raw return',s=>s.replace("files:files.map(f=>({...f}))","files:readFileSync(new URL('existing-ops-build-envelopes.js',import.meta.url),'utf8')")],
  ['extra top call',s=>s+"\nsendElsewhere(readFileSync(new URL('existing-ops-build-envelopes.js',import.meta.url),'utf8'));"],
 ])('runtime %s 必须拒绝整条模板数据资格',(_name,edit)=>{
  const sources=base();sources.set(runtime,edit(source));
  expect(scan(sources).some(hit=>hit.rule==='E1')).toBe(true);
 });
 it.each(['same source at other path','third consumer'])('%s 不继承固定runtime资格',kind=>{
  const sources=base(),other=path.join(BRAIN_ROOT,'src/lib/other-runtime.js');
  if(kind==='same source at other path'){sources.delete(runtime);sources.set(other,source);}
  else sources.set(other,"import {ENVELOPES} from './existing-ops-build-envelopes.js';export const raw=ENVELOPES;");
  expect(scan(sources).some(hit=>hit.rule==='E1')).toBe(true);
 });
});
describe('merge 读取封套不增加 Claude 原文执行出口',()=>{
 const local=path.join(BRAIN_ROOT,'src/lib/existing-ops-provenance-local-envelopes.js');
 const base=()=>new Map([[ENVELOPE_FILE,readFileSync(ENVELOPE_FILE,'utf8')],[ENVELOPE_CONSUMER,readFileSync(ENVELOPE_CONSUMER,'utf8')],...[...PROVENANCE_READER_HASHES.keys()].map(file=>[file,readFileSync(file,'utf8')])]);
 it('新实际五模块仅在完整固定 reader 闭包内取得纯数据资格',()=>{const sources=base();for(const file of [local,STAGE_DATA,ENVELOPE_FILE])expect(findClaudeInvocations(sources.get(file),{file,sources})).toEqual([]);});
 it.each(['local eval','escaped consumer','stage execution'])('%s 仍使原封套 E1 拒绝',kind=>{
  const sources=base();
  if(kind==='local eval')sources.set(local,sources.get(local)+'\neval(MERGE_REVIEWED.sourceMergeProof);');
  if(kind==='escaped consumer')sources.set(path.join(BRAIN_ROOT,'src/merge-escape.js'),"import {MERGE_REVIEWED} from './lib/existing-ops-provenance-local-\\u0065nvelopes.js';eval(MERGE_REVIEWED.sourceProvenance);");
  if(kind==='stage execution')sources.set(STAGE_DATA,sources.get(STAGE_DATA)+'\nFunction(MERGE_STAGE_ENVELOPES.evaluate)();');
  expect(findClaudeInvocations(sources.get(ENVELOPE_FILE),{file:ENVELOPE_FILE,sources}).some(h=>h.rule==='E1')).toBe(true);
 });
});
describe('原生QA完整封套只作为有界解码后的Acorn输入',()=>{
 const helper=path.join(BRAIN_ROOT,'src/lib/existing-ops-native-evidence-source.js');
 const data=path.join(BRAIN_ROOT,'src/lib/existing-ops-native-evidence-envelopes.js');
 const base=()=>new Map([...new Set([ENVELOPE_FILE,ENVELOPE_CONSUMER,HASH_RUNTIME_FILE,helper,data,...PROVENANCE_READER_HASHES.keys()])].map(file=>[file,readFileSync(file,'utf8')]));
 const scan=sources=>findClaudeInvocations(sources.get(data),{file:data,sources});
 it('完整已审新旧闭包及十三文件只读指纹不恢复任何Claude执行路径',()=>{
  const sources=base();
  for(const file of [ENVELOPE_FILE,STAGE_DATA,helper,data,HASH_RUNTIME_FILE])expect(findClaudeInvocations(sources.get(file),{file,sources})).toEqual([]);
 });
 it.each(['data eval','data Function','unbounded decode','changed encoding','changed payload','helper eval','helper raw export','caller eval','stage eval','provenance eval','third data consumer','third helper consumer','escaped data consumer','dynamic helper consumer','missing helper','runtime raw export','concat data consumer','concat helper consumer'])('%s 必须拒绝原生封套纯数据资格',kind=>{
  const sources=base(),other=path.join(BRAIN_ROOT,'src/unreviewed-native-reader.js');
  if(kind==='data eval')sources.set(data,sources.get(data)+'\neval(NATIVE_EVIDENCE_ENVELOPES.legacyCli);');
  if(kind==='data Function')sources.set(data,sources.get(data)+'\nFunction(NATIVE_EVIDENCE_ENVELOPES.legacyCli)();');
  if(kind==='unbounded decode')sources.set(data,sources.get(data).replace('{ maxOutputLength: 321616 }','{}'));
  if(kind==='changed encoding')sources.set(data,sources.get(data).replace(", 'base64')",", 'utf8')"));
  if(kind==='changed payload')sources.set(data,sources.get(data).replace(/Buffer\.from\('([A-Za-z0-9+/=])/,(_all,c)=>`Buffer.from('${c==='A'?'B':'A'}`));
  if(kind==='helper eval')sources.set(helper,sources.get(helper)+'\neval(REVIEWED.legacyCli);');
  if(kind==='helper raw export')sources.set(helper,sources.get(helper)+'\nexport const raw=REVIEWED.legacyCli;');
  if(kind==='caller eval')sources.set(ENVELOPE_CONSUMER,sources.get(ENVELOPE_CONSUMER)+'\nnativeBuildSources(candidate,eval);');
  if(kind==='stage eval')sources.set(STAGE_HELPER,sources.get(STAGE_HELPER)+'\nnativeEvidenceStages(candidate,eval);');
  if(kind==='provenance eval')sources.set(PROVENANCE_HELPER,sources.get(PROVENANCE_HELPER)+'\nnativeEvidenceForwarding(candidate,eval);');
  if(kind==='third data consumer')sources.set(other,"import {NATIVE_EVIDENCE_ENVELOPES as data} from './lib/existing-ops-native-evidence-envelopes.js';eval(data.legacyCli);");
  if(kind==='third helper consumer')sources.set(other,"import {nativeCompatibleCli} from './lib/existing-ops-native-evidence-source.js';eval(nativeCompatibleCli());");
  if(kind==='escaped data consumer')sources.set(other,"import {NATIVE_EVIDENCE_ENVELOPES} from './lib/existing-ops-native-evidence-\\u0065nvelopes.js';eval(NATIVE_EVIDENCE_ENVELOPES.legacyCli);");
  if(kind==='dynamic helper consumer')sources.set(other,"const reader=await import('./lib/existing-ops-native-evidence-\\u0073ource.js');eval(reader.nativeCompatibleCli());");
  if(kind==='concat data consumer')sources.set(other,"const d=await import('./lib/existing-ops-native-evidence-'+'envelopes.js');Function(d.NATIVE_EVIDENCE_ENVELOPES.legacyCli)();");
  if(kind==='concat helper consumer')sources.set(other,"const d=await import('./lib/existing-ops-native-evidence-'+'source.js');Function(d.nativeCompatibleCli())();");
  if(kind==='missing helper')sources.delete(helper);
  if(kind==='runtime raw export')sources.set(HASH_RUNTIME_FILE,sources.get(HASH_RUNTIME_FILE)+"\nexport const raw=readFileSync(new URL('existing-ops-native-evidence-envelopes.js',import.meta.url),'utf8');");
  expect(scan(sources).some(hit=>hit.rule==='E1')).toBe(true);
 });
 it('数据后的实际进程别名调用仍同时触发E1与原R1',()=>{
  const sources=base();sources.set(data,sources.get(data)+"\nimport {spawn as launch} from 'node:child_process';launch('claude',['-p']);");
  const hits=scan(sources);expect(hits.some(hit=>hit.rule==='E1')).toBe(true);expect(hits.some(hit=>hit.rule==='R1')).toBe(true);
 });
});
