import {isBuiltin} from 'node:module';
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {posix, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const WORKER = 'packages/brain/scripts/fleet-worker/';
const FLAGS = ['linux', 'app_server', 'legacy'];
const CONTROL = ['.github/workflows/ci.yml', 'scripts/ci/resource-canary-scope.mjs', 'scripts/ci/check-basic-results.mjs'];
export function validateResourcePlan(encoded) {
  const plan = JSON.parse(encoded);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) ||
      Object.keys(plan).length !== FLAGS.length || FLAGS.some(flag => typeof plan[flag] !== 'boolean')) {
    throw new Error('资源专项计划必须精确包含三个布尔标志');
  }
  return plan;
}

// 生产未启用AppServer，历史attempt/OOM也没有现役消费：都只显式按需验收。
// Linux观测容器只消费下列bind输入及其相对require，直接用Node内置模块，
// 不读取npm依赖；根manifest/lock版本或无关依赖变化无需拉起真实Docker。
export function collectInputs(read) {
  const seen = new Set();
  function visit(path) {
    if (seen.has(path)) return;
    if(path.startsWith('../') || path.startsWith('/')) throw new Error('模块越过仓库边界');
    seen.add(path);
    const source=read(path), specifiers=[];
    const remaining=source.replace(/require\(\s*['"]([^'"]+)['"]\s*\)/g,(_,value)=>{specifiers.push(value);return '';});
    if(/\b(?:require|import)\s*\(|\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?['"]/.test(remaining)) throw new Error(`未知computed动态模块：${path}`);
    for(const specifier of specifiers) {
      if(specifier.startsWith('.')) visit(posix.normalize(posix.join(posix.dirname(path),specifier)));
      else if(!isBuiltin(specifier) && specifier !== '/probe/linux-resource-probe.cjs') throw new Error(`资源专项新增未评估的外部依赖：${path}: ${specifier}`);
    }
  }
  // 采样器在容器内require，路径通过两个bind挂载解析，必须包含宿主对应文件。
  ['linux-resource-canary.cjs','linux-resource-probe.cjs','linux-cgroup.cjs'].forEach(name=>visit(WORKER+name));
  return {linux:[...seen],app_server:[]};
}
export function planResourceCanaries(paths, {manual = 'none', inputs} = {}) {
  if (!['none','linux','app-server','legacy','all'].includes(manual)) throw new Error('未知资源专项选项');
  if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..') || path.includes('\0'))) throw new Error('非法资源专项路径');
  if (!inputs || !Array.isArray(inputs.linux) || !Array.isArray(inputs.app_server)) throw new Error('缺少专项输入闭包');
  const affected = flag => paths.some(path => CONTROL.includes(path) || inputs[flag].includes(path));
  return {linux: manual === 'all' || manual === 'linux' || affected('linux'),
    app_server: manual === 'all' || manual === 'app-server',
    legacy: manual === 'all' || manual === 'legacy'};
}
const git = args => execFileSync('git', args, {encoding:'utf8', maxBuffer:16*1024*1024});
function revision(value) {
  if (!value || value.startsWith('-')) throw new Error('非法 Git revision');
  return git(['rev-parse','--verify','--end-of-options',`${value}^{commit}`]).trim();
}
export function main(argv = process.argv.slice(2)) {
  const options = {};
  for(let index=0;index<argv.length;index+=2) {
    const key=argv[index],value=argv[index+1];
    if(!['--base','--head','--manual'].includes(key) || !value || value.startsWith('--') || Object.hasOwn(options,key)) throw new Error('非法资源专项参数');
    options[key]=value;
  }
  const head=revision(options['--head']),base=options['--base'] ? revision(options['--base']) : undefined;
  const revisions=[...new Set([base,head].filter(Boolean))];
  const closures=revisions.map(ref=>collectInputs(path=>git(['show',`${ref}:${path}`])));
  const inputs=Object.fromEntries(['linux','app_server'].map(flag=>[flag,[...new Set(closures.flatMap(input=>input[flag]))]]));
  const raw=base ? git(['diff','--no-ext-diff','--no-textconv','--name-only','--no-renames','-z',base,head,'--']) : '';
  const paths=raw ? raw.slice(0,-1).split('\0') : [];
  const plan=JSON.stringify(planResourceCanaries(paths,{manual:options['--manual'] ?? 'none',inputs}));
  if(process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,`resource_plan=${plan}\n`);
  process.stdout.write(`${plan}\n`);
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {main();} catch(error) {process.stderr.write(`${error.message}\n`);process.exitCode=1;}
}
