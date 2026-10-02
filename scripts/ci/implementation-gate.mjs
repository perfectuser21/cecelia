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
const hashId=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function testEnvironment() {
  const env={PATH:`${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,CI:'true',NODE_ENV:'test',LANG:'C.UTF-8'};
  // 测试库连接是显式能力；不继承解释器启动钩子、模块搜索覆盖或通用凭据。
  for(const key of ['DB_HOST','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','TZ','TMPDIR']){
    if(process.env[key]!==undefined)env[key]=process.env[key];
  }
  return env;
}
function sourceUnchanged(root,head) {
  return git(root,'rev-parse','HEAD').trim()===head&&!git(root,'status','--porcelain=v1','--untracked-files=no').trim();
}
function changedPaths(items) {
  if(!Array.isArray(items))fail('IMPACT_DIFF_MISSING');
  const paths=new Set();
  for(const item of items){
    if(!item||typeof item.path!=='string')fail('IMPACT_DIFF_INVALID');
    paths.add(item.path);if(item.old_path)paths.add(item.old_path);
  }
  return [...paths].sort();
}
function provenEmptyActivities(report,side) {
  const evidence=report[side],key=side==='base'?'addition_evidence':'removal_evidence';
  if(evidence.impact_status!==(side==='base'?'known_added':'known_removed')||!Array.isArray(evidence[key])||!evidence[key].length)return false;
  const ids=new Set(evidence.definition_versions.workflows.map(v=>v.id));
  return report.affected_usages?.length>0&&report.affected_usages.every(usage=>evidence[key].some(item=>
    item.workflow_id===usage.workflow_id&&item.reference_id===usage.reference_id&&item.activity_id===usage.activity_id
    &&ids.has(item[`${side}_workflow_definition_version_id`])));
}
function assertFileCoverage(report) {
  if(!Array.isArray(report.unclaimed_paths)||report.unclaimed_paths.length||!Array.isArray(report.source.changed_files)||!report.source.changed_files.length)fail('IMPACT_FILE_COVERAGE_MISSING');
  for(const side of ['base','head'])if(!Array.isArray(report[side].file_coverage)||report[side].file_coverage.length!==report.source.changed_files.length)fail('IMPACT_FILE_COVERAGE_MISSING');
  for(const [index,change] of report.source.changed_files.entries()){
    const pair=['base','head'].map(side=>{
      const item=report[side].file_coverage[index],path=side==='base'?change.old_path||change.path:change.path;
      if(item.change_index!==index||item.path!==path||!Array.isArray(item.matched_paths)||item.truncated!==false)fail('IMPACT_FILE_COVERAGE_MISSING');
      return item;
    });
    if(!pair.some(item=>item.matched_paths.length))fail('IMPACT_FILE_COVERAGE_MISSING');
  }
}
function assertReport(report) {
  if(report?.mapping_status!=='verified'||!Array.isArray(report.gaps)||report.gaps.length)fail('IMPACT_EVIDENCE_UNKNOWN');
  if(!objectId(report.source?.base_revision)||!objectId(report.source?.head_revision))fail('IMPACT_REVISION_REQUIRED');
  for(const side of ['base','head']){
    const evidence=report[side];
    if(evidence?.revision!==report.source[`${side}_revision`]||!hashId(evidence.graph_snapshot?.digest)
      ||evidence.graph_snapshot.source_revision!==evidence.revision
      ||!uuid(evidence.projection?.projection_run_id)||!uuid(evidence.projection?.manifest_version_id)
      ||!hashId(evidence.projection?.projection_digest)||!hashId(evidence.projection?.manifest_digest)
      ||!Array.isArray(evidence.gaps)||evidence.gaps.length
      ||evidence.traversal?.truncated!==false)fail('IMPACT_SNAPSHOT_UNKNOWN');
    for(const kind of ['workflows','activities']){
      const versions=evidence.definition_versions?.[kind];
      if(!Array.isArray(versions)||versions.some(v=>!uuid(v.id)||!hashId(v.payload_sha256))
        ||(!versions.length&&!(kind==='activities'&&provenEmptyActivities(report,side))))fail('IMPACT_DEFINITION_UNKNOWN');
    }
  }
  if(!Array.isArray(report.affected_usages)||!Array.isArray(report.required_assertions))fail('IMPACT_REPORT_INVALID');
  if(!report.affected_usages.length)fail('IMPACT_USAGE_EVIDENCE_MISSING');
  assertFileCoverage(report);
  if(report.affected_usages.length&&!report.required_assertions.length)fail('IMPACT_REGRESSION_MISSING');
  for(const usage of report.affected_usages){
    if(!Array.isArray(usage.evidence)||!usage.evidence.length)fail('IMPACT_USAGE_EVIDENCE_MISSING');
    for(const evidence of usage.evidence){
      const steps=evidence.assertion_step_ids??[null];
      if(!Array.isArray(steps)||!steps.length)fail('IMPACT_REGRESSION_MISSING');
      for(const step of steps)if(!evidence.capability_id||!evidence.activity_id||!report.required_assertions.some(item=>(item.source_bindings||[]).some(
        binding=>binding.capability_id===evidence.capability_id&&binding.activity_id===evidence.activity_id&&(binding.step_id??null)===step)))fail('IMPACT_REGRESSION_MISSING');
    }
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
    if(!sourceUnchanged(root,source.head_revision)||(sha(await readFile(join(root,item.path)))!==item.test_sha256))fail('IMPACT_SOURCE_CHANGED_BEFORE_TEST');
    const result=spawnSync(item.command.executable,item.command.argv,{
      cwd:item.command.options.cwd,shell:false,encoding:'utf8',timeout:timeoutMs,maxBuffer:16*1024*1024,
      env:testEnvironment(),
    });
    const drift=!sourceUnchanged(root,source.head_revision);
    assertions.push({assertion_ref:item.assertion.assertion_ref,source_repo:repo,source_revision:source.head_revision,
      source_bindings:item.assertion.source_bindings,test_sha256:item.test_sha256,command_argv:[item.command.executable,...item.command.argv],
      exit_code:result.status,signal:result.signal||null,error:drift?'IMPACT_SOURCE_CHANGED_DURING_TEST':result.error?.code||null,
      stdout_sha256:sha(result.stdout||''),stderr_sha256:sha(result.stderr||'')});
    if(drift)break;
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
