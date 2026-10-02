/** 固定影响报告→本仓固定测试→执行收据；不执行网络报告携带的 command。 */
import { createHash } from 'node:crypto';
import { execFileSync,spawnSync } from 'node:child_process';
import { readFile,realpath,writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname,join,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertionCommand,classifyAssertionRef,canonicalRepoIdentity } from '../../packages/brain/src/lib/gp-assertion-command.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
const objectId=value=>typeof value==='string'&&/^[0-9a-f]{40}$/.test(value);
function changedPaths(items) {
  if(!Array.isArray(items))fail('IMPACT_DIFF_MISSING');
  const paths=new Set();
  for(const item of items){
    if(!item||typeof item.path!=='string')fail('IMPACT_DIFF_INVALID');
    paths.add(item.path);if(item.old_path)paths.add(item.old_path);
  }
  return [...paths].sort();
}
function assertReport(report) {
  if(report?.mapping_status!=='verified'||!Array.isArray(report.gaps)||report.gaps.length)fail('IMPACT_EVIDENCE_UNKNOWN');
  if(!objectId(report.source?.base_revision)||!objectId(report.source?.head_revision))fail('IMPACT_REVISION_REQUIRED');
  for(const side of ['base','head']){
    const evidence=report[side];
    if(evidence?.revision!==report.source[`${side}_revision`]||!evidence.graph_snapshot?.digest
      ||!evidence.projection||!Array.isArray(evidence.gaps)||evidence.gaps.length
      ||evidence.traversal?.truncated!==false)fail('IMPACT_SNAPSHOT_UNKNOWN');
  }
  if(!Array.isArray(report.affected_usages)||!Array.isArray(report.required_assertions))fail('IMPACT_REPORT_INVALID');
  if(report.affected_usages.length&&!report.required_assertions.length)fail('IMPACT_REGRESSION_MISSING');
  for(const usage of report.affected_usages){
    if(!report.required_assertions.some(item=>(item.capability_ids||[]).includes(usage.capability_id)))fail('IMPACT_REGRESSION_MISSING');
  }
}
async function toolchains(root,kind) {
  if(kind==='bash')return {bash:{path:'/bin/bash'}};
  if(kind==='pytest')return {python:{path:'/usr/bin/python3'}};
  const require=createRequire(join(root,'package.json'));
  return {node:{path:process.execPath},vitest:{path:join(dirname(require.resolve('vitest/package.json')),'vitest.mjs')}};
}
async function prepareAssertion(root,assertion,repo,head) {
  if(assertion.source_repo!==repo)fail('IMPACT_ASSERTION_REPO_UNKNOWN');
  if(!Array.isArray(assertion.source_bindings)||!assertion.source_bindings.length)fail('IMPACT_ASSERTION_IDENTITY_MISSING');
  const shape=classifyAssertionRef(assertion.assertion_ref);
  const command=await assertionCommand(assertion.assertion_ref,root,{toolchains:await toolchains(root,shape.kind)});
  const path=relative(root,await realpath(resolve(root,shape.path)));
  const committed=execFileSync('git',['show',`${head}:${path}`],{cwd:root,maxBuffer:16*1024*1024});
  const bytes=await readFile(join(root,path));
  if(!bytes.equals(committed))fail('IMPACT_ASSERTION_BYTES_CHANGED');
  return {assertion,command,path,test_sha256:sha(bytes)};
}

export async function runImplementationGate({repoRoot,report,timeoutMs=300000}) {
  assertReport(report);
  const root=await realpath(repoRoot);
  const source=report.source;
  const repo=canonicalRepoIdentity(git(root,'remote','get-url','origin').trim()).replace(/^github\.com\//,'');
  if(repo!==source.repo||git(root,'rev-parse','HEAD').trim()!==source.head_revision)fail('IMPACT_SOURCE_MISMATCH');
  // 已跟踪源代码和测试一起核对；不允许以脏工作区冒充固定提交。
  if(git(root,'status','--porcelain=v1','--untracked-files=no').trim())fail('IMPACT_SOURCE_STATE_DIRTY');
  const actual=git(root,'diff','--no-renames','--name-only','-z',source.base_revision,source.head_revision,'--').split('\0').filter(Boolean).sort();
  if(JSON.stringify(actual)!==JSON.stringify(changedPaths(source.changed_files)))fail('IMPACT_DIFF_MISMATCH');
  const prepared=[];
  for(const assertion of report.required_assertions)prepared.push(await prepareAssertion(root,assertion,repo,source.head_revision));
  const assertions=[];
  for(const item of prepared){
    const result=spawnSync(item.command.executable,item.command.argv,{
      cwd:item.command.options.cwd,shell:false,encoding:'utf8',timeout:timeoutMs,maxBuffer:16*1024*1024,
      env:{...process.env,CI:'true'},
    });
    assertions.push({assertion_ref:item.assertion.assertion_ref,source_repo:repo,source_revision:source.head_revision,
      source_bindings:item.assertion.source_bindings,test_sha256:item.test_sha256,command_argv:[item.command.executable,...item.command.argv],
      exit_code:result.status,signal:result.signal||null,error:result.error?.code||null,
      stdout_sha256:sha(result.stdout||''),stderr_sha256:sha(result.stderr||'')});
  }
  return {schema_version:1,source,report_sha256:sha(JSON.stringify(report)),actor:'implementation_ci_gate',
    verdict:assertions.every(item=>item.exit_code===0&&!item.error)?'PASS':'FAIL',assertions,
    scope:'regression_tests',business_runtime_status:'not_evaluated',recorded_at:new Date().toISOString()};
}

async function main() {
  const args=process.argv.slice(2),options={};
  for(let index=0;index<args.length;index+=2){
    if(!['--report','--repo-root','--output'].includes(args[index])||!args[index+1])fail('IMPACT_CLI_ARGUMENT_INVALID');
    options[args[index]]=args[index+1];
  }
  if(!options['--report']||!options['--output'])fail('IMPACT_REPORT_AND_OUTPUT_REQUIRED');
  const receipt=await runImplementationGate({repoRoot:options['--repo-root']||process.cwd(),report:JSON.parse(await readFile(options['--report'],'utf8'))});
  await writeFile(options['--output'],JSON.stringify(receipt,null,2)+'\n');
  process.stdout.write(`${receipt.verdict}: ${receipt.assertions.length} regressions\n`);
  if(receipt.verdict!=='PASS')process.exitCode=1;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===await realpath(process.argv[1])){
  main().catch(error=>{process.stderr.write(`${error.code||'IMPACT_GATE_ERROR'}: ${error.message}\n`);process.exitCode=1;});
}
