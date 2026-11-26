import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { commandsFor } from '../run-basic-check.mjs';
import brainConfig from '../../../packages/brain/vitest.config.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'));

test('默认Brain测试集合不递归执行历史Sprint工作目录', () => {
  assert.equal(brainConfig.test.include.some(pattern => pattern.includes('sprints/')), false);
});

test('所有启用工作流都能解析，新增文件也自动检查', () => {
  const directory = new URL('../../../.github/workflows/', import.meta.url);
  const files = readdirSync(directory).filter(name => /\.ya?ml$/.test(name));
  assert.ok(files.length > 0);
  for (const file of files) {
    const config = yaml.load(readFileSync(new URL(file, directory), 'utf8'));
    assert.ok(config?.on && config?.jobs && Object.keys(config.jobs).length, `${file}缺少触发器或实际任务`);
  }
});

test('每个声明的源码检查都必须抵达同一个最终结果，没有孤儿任务', () => {
  const reached = new Set();
  function visit(name) {
    assert.ok(workflow.jobs[name], `缺少任务：${name}`);
    if (reached.has(name)) return;
    reached.add(name);
    const needs = workflow.jobs[name].needs || [];
    for (const parent of Array.isArray(needs) ? needs : [needs]) visit(parent);
  }
  visit('ci-passed');
  assert.deepEqual([...reached].sort(), Object.keys(workflow.jobs).filter(id => !['foundation-release-verification','brain-deploy'].includes(id)).sort());
  assert.equal(workflow.jobs['ci-passed'].if, "always() && github.event_name != 'schedule' && github.event.action != 'closed'");
  assert.equal(workflow.jobs['ci-passed'].name, '源码保底通过');
  assert.equal(workflow.jobs.checks.strategy['fail-fast'], false);
  assert.equal(workflow.jobs.checks.name, "${{ format('Check ({0} {1})', matrix.component, matrix.shard) }}");
  assert.equal(workflow.jobs.checks.if, "github.event_name != 'schedule' && github.event.action != 'closed'");
  const run = workflow.jobs.checks.steps.find(step => step.name === 'Run actual checks');
  assert.equal(run.run, 'node scripts/ci/run-basic-check.mjs "$COMPONENT" "$SHARD"');
  const scripts = commandsFor('scripts');
  assert.equal(scripts.filter(step => step.command === 'python3' && step.args.includes('test_skill_source_ownership.py')).length, 1);
  assert.equal(scripts.filter(step => step.command === 'python3' && step.args[0] === 'scripts/skill_source_ownership.py').length, 1);

});

test('实际workflow的最终命令严格传播失败、跳过和取消', () => {
  const step = workflow.jobs['ci-passed'].steps.find(step => step.env?.NEEDS_JSON);
  assert.equal(step.env.NEEDS_JSON, '${{ toJSON(needs) }}');
  for (const status of ['success', 'failure', 'cancelled', 'skipped', '']) {
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, NEEDS_JSON: JSON.stringify(Object.fromEntries(workflow.jobs['ci-passed'].needs.map(job => [job,{result:job === 'checks' ? status : 'success'}]))) },
    });
    assert.equal(result.status === 0, status === 'success', result.stderr);
  }
});

test('每个现役矩阵项都能解析到非空真实命令', () => {
  for (const row of workflow.jobs.checks.strategy.matrix.include) {
    const commands = commandsFor(row.component, row.shard);
    assert.ok(commands.length > 0, row.component);
    for (const command of commands) {
      assert.ok(command.command && command.args.length > 0);
      assert.ok(!command.args.includes('--passWithNoTests'));
    }
  }
});

test('最小源码CI只使用只读自动令牌，不依赖生产账号或私有Skills', () => {
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  for (const id of ['security','checks','ci-passed']) assert.doesNotMatch(JSON.stringify(workflow.jobs[id]), /secrets\.|skills-source|GH_PAT_BOT|CECELIA_INTERNAL_TOKEN/);
});

test('只给实际PG跑道设置数据库URI，不能意外启用单测文件里的真实PG describe', () => {
  assert.equal(workflow.jobs.checks.env.DATABASE_URL,
    "${{ matrix.component == 'brain-integration' && 'postgresql://ci:isolated-ci@127.0.0.1:5432/cecelia_scratch' || '' }}");
});






test('退出旧API集成跑道，只有现役Brain PG组件可启动数据库', () => {
  const job = workflow.jobs.checks;
  assert.equal(job.env.API_PG_INTEGRATION, '0');
  assert.equal(job.services.postgres.image,
    "${{ matrix.component == 'brain-integration' && 'mirror.gcr.io/pgvector/pgvector:pg17' || '' }}");
  assert.ok(!workflow.jobs.checks.strategy.matrix.include.some(row => row.component === 'api-integration'));
});



// 只约束必需实际命令、隔离库和失败传播，不冻结完整job或历史commit。
const requiredRuntimeChecks=[
  {
    "name": "真实采集与凭据生命周期回归",
    "run": "node --test --test-concurrency=1 scripts/ops/__tests__/node-onboarding*.test.mjs"
  },
  {
    "name": "接入结算与隔离回归（含真实数据库）",
    "run": "npx vitest run src/node-onboarding/__tests__/service.test.js src/node-onboarding/__tests__/settlement.test.js src/node-onboarding/__tests__/registry-adoption.test.js --maxWorkers=1 --minWorkers=1",
    "env": {
      "NODE_ONBOARDING_TEST_DB": "postgresql://onboarding_ci:onboarding_ci@localhost:5432/cecelia_scratch"
    },
    "working-directory": "packages/brain"
  },
  {
    "name": "Linux自动接入与续验真实数据库回归",
    "run": "npx vitest run --config vitest.integration.config.js src/__tests__/integration/linux-controller-contract.pg.integration.test.js src/__tests__/integration/linux-onboarding-flow.pg.integration.test.js src/__tests__/integration/linux-script-authorization.pg.integration.test.js --maxWorkers=1 --minWorkers=1",
    "env": {
      "TEST_DATABASE_URL": "postgresql://onboarding_ci:onboarding_ci@localhost:5432/cecelia_scratch"
    },
    "working-directory": "packages/brain"
  },
  {
    "name": "Verify real process recovery without replay",
    "run": "node packages/brain/scripts/smoke/commander-dbos-recovery-smoke.mjs",
    "env": {
      "TEST_DB_URL": "postgresql://onboarding_ci:onboarding_ci@127.0.0.1:5432/cecelia_scratch"
    },
    "if": "!cancelled()"
  },
  {
    "name": "Verify Commander decisions and activity recovery",
    "run": "node packages/brain/scripts/smoke/commander-foundation-smoke.mjs",
    "env": {
      "TEST_DB_URL": "postgresql://onboarding_ci:onboarding_ci@127.0.0.1:5432/cecelia_scratch"
    },
    "if": "!cancelled()"
  },
  {
    "name": "Verify bounded checker repair and host recovery",
    "run": "node packages/brain/scripts/smoke/commander-repair-smoke.mjs",
    "env": {
      "TEST_DB_URL": "postgresql://onboarding_ci:onboarding_ci@127.0.0.1:5432/cecelia_scratch"
    },
    "if": "!cancelled()"
  },
  {
    "name": "Verify Workflow registration to Brain and real DBOS execution",
    "run": "npx vitest run --config vitest.integration.config.js src/__tests__/integration/workflow-foundation.pg.integration.test.js src/__tests__/integration/standalone-start-reconciliation.pg.integration.test.js src/__tests__/integration/foundation-legacy-entrances.pg.integration.test.js --maxWorkers=1 --minWorkers=1",
    "env": {
      "DB_NAME": "cecelia_scratch",
      "DB_HOST": "127.0.0.1",
      "DB_PORT": "5432",
      "DB_USER": "onboarding_ci",
      "DB_PASSWORD": "onboarding_ci",
      "TEST_DB_URL": "postgresql://onboarding_ci:onboarding_ci@127.0.0.1:5432/cecelia_scratch"
    },
    "if": "!cancelled()",
    "working-directory": "packages/brain"
  },
  {
    "name": "Verify audited Commander failure boundaries",
    "run": "npx vitest run --config vitest.integration.config.js src/orchestrator/__tests__/commander-foundation-audit.pg.integration.test.js src/durable/__tests__/commander-action-store.pg.integration.test.js --maxWorkers=1 --minWorkers=1",
    "env": {
      "TEST_DB_URL": "postgresql://onboarding_ci:onboarding_ci@127.0.0.1:5432/cecelia_scratch"
    },
    "if": "!cancelled()",
    "working-directory": "packages/brain"
  }
];
function assertRuntimeContracts(job){
  for(const required of requiredRuntimeChecks){
    const matching=job.steps.filter(step=>step.name===required.name);
    assert.equal(matching.length,1,required.name+'必须恰好执行一次');
    const step=matching[0];
    for(const key of ['run','env','if','working-directory'])assert.deepEqual(step[key],required[key],required.name+':'+key);
    assert.ok(!step['continue-on-error'],required.name+'不能吞失败');
  }
}
function assertSecurityContracts(job){
  const checkout=job.steps.find(step=>step.uses==='actions/checkout@v4');
  assert.equal(checkout.with['persist-credentials'],false);
  assert.equal(checkout.with['fetch-depth'],0);
  const scan=job.steps.find(step=>step.uses==='gitleaks/gitleaks-action@v2');
  assert.ok(scan&&scan.if===undefined&&!scan['continue-on-error']);
  assert.equal(scan.env.GITHUB_TOKEN,'${{ github.token }}');
  const audit=job.steps.find(step=>step.name==='Check dependency vulnerabilities');
  assert.equal(audit.run.trim(),'bash scripts/ci/dep-audit-runtime-high.sh\nbash scripts/ci/dep-audit-critical.sh');
  assert.ok(audit.if===undefined&&!audit['continue-on-error']);
}

test('统一CI真实合并runner，保持独有命令和产物并隔离安全权限', () => {
  const files=readdirSync(new URL('../../../.github/workflows/',import.meta.url)).filter(file=>/\.ya?ml$/.test(file));
  assert.deepEqual(files.filter(file=>{
    const events=yaml.load(readFileSync(new URL('../../../.github/workflows/'+file,import.meta.url),'utf8')).on;
    return typeof events==='string' ? ['pull_request','pull_request_target'].includes(events) :
      Array.isArray(events) ? events.some(event=>['pull_request','pull_request_target'].includes(event)) :
      Object.hasOwn(events,'pull_request')||Object.hasOwn(events,'pull_request_target');
  }),['ci.yml']);
  for(const [id,job]of Object.entries(workflow.jobs))assert.equal(job.uses,undefined,id+'不得复用另一个workflow');
  assert.ok(readFileSync(new URL('../../../.github/workflows/ci.yml',import.meta.url),'utf8').trimEnd().split('\n').length<=500);
  assert.equal(Object.keys(workflow.jobs).length, 7);
  const runtime=workflow.jobs['runtime-integration'];
  assertRuntimeContracts(runtime);
  assert.deepEqual(Object.keys(runtime.services),['postgres']);
  assert.equal(runtime.services.postgres.image,'mirror.gcr.io/library/postgres:17');
  assert.deepEqual(runtime.services.postgres.env,{POSTGRES_USER:'onboarding_ci',POSTGRES_PASSWORD:'onboarding_ci',POSTGRES_DB:'cecelia_scratch'});
  assert.deepEqual(runtime.services.postgres.ports,['5432:5432']);
  const settlement=runtime.steps.find(step=>step.name==='接入结算与隔离回归（含真实数据库）');
  assert.equal(settlement['working-directory'], 'packages/brain');
  assert.deepEqual(settlement.env, {NODE_ONBOARDING_TEST_DB:'postgresql://onboarding_ci:onboarding_ci@localhost:5432/cecelia_scratch'});
  assert.equal(settlement.run, 'npx vitest run src/node-onboarding/__tests__/service.test.js src/node-onboarding/__tests__/settlement.test.js src/node-onboarding/__tests__/registry-adoption.test.js --maxWorkers=1 --minWorkers=1');
  const onboarding=runtime.steps.find(step=>step.run?.startsWith('node --test'));
  assert.equal(onboarding.run,'node --test --test-concurrency=1 scripts/ops/__tests__/node-onboarding*.test.mjs');
  assert.equal(onboarding.if,undefined);
  const linux=runtime.steps.find(step=>step.name==='Linux自动接入与续验真实数据库回归');
  assert.equal(linux.env.TEST_DATABASE_URL,'postgresql://onboarding_ci:onboarding_ci@localhost:5432/cecelia_scratch');
  assert.equal(linux['working-directory'],'packages/brain');
  assert.equal(linux.if,undefined);
  assert.equal(linux.run,'npx vitest run --config vitest.integration.config.js src/__tests__/integration/linux-controller-contract.pg.integration.test.js src/__tests__/integration/linux-onboarding-flow.pg.integration.test.js src/__tests__/integration/linux-script-authorization.pg.integration.test.js --maxWorkers=1 --minWorkers=1');
  const recovery=runtime.steps.find(step => step.run?.includes('commander-dbos-recovery-smoke.mjs'));
  assert.equal(recovery.if, '!cancelled()');
  assert.equal(recovery.env.TEST_DB_URL, 'postgresql://onboarding_ci:onboarding_ci@127.0.0.1:5432/cecelia_scratch');
  assert.equal(runtime.steps.filter(step => step.uses === 'actions/checkout@v4').length, 1);
  assert.equal(runtime.steps.filter(step => step.uses === 'actions/setup-node@v4').length, 1);
  assert.equal(runtime.steps.filter(step => step.run === 'npm ci --no-audit --no-fund').length, 1);
  assert.equal(runtime.steps.some(step => step['continue-on-error']), false);
  assert.equal(workflow.jobs['pwa-upgrade'],undefined);
  const security=workflow.jobs.security;
  assertSecurityContracts(security);
  assert.equal(security.steps.some(step=>Object.hasOwn(step,'if')||step['continue-on-error']),false);
  assert.equal(security.steps.filter(step=>step.uses==='gitleaks/gitleaks-action@v2').length,1);
  assert.equal(security.steps.find(step=>step.name==='Check dependency vulnerabilities').run.trim(),
    'bash scripts/ci/dep-audit-runtime-high.sh\nbash scripts/ci/dep-audit-critical.sh');
  assert.equal(security.steps.find(step=>step.name==='Install locked dependency manifests'),undefined);
  assert.equal(workflow.jobs.codeql.steps.some(step=>Object.hasOwn(step,'if')||step['continue-on-error']),false);
});

test('周扫描仅CodeQL执行，全部CI无PR评论写权限', () => {
  const normal="github.event_name != 'schedule' && github.event.action != 'closed'";
  for(const [id,job]of Object.entries(workflow.jobs)) {
    if(!['codeql','foundation-release-verification','brain-deploy'].includes(id)) assert.equal(job.if,(['ci-passed','skill-passed'].includes(id)?'always() && ':'')+normal,id);
    assert.notEqual(job.permissions?.['pull-requests'],'write',id);
    if(id!=='codeql')assert.notEqual(job.permissions?.['security-events'],'write',id);
  }
  assert.deepEqual(workflow.on.schedule,[{cron:'0 3 * * 1'}]);
  assert.equal(workflow.jobs.codeql.if,"github.event.action != 'closed'");
  assert.deepEqual(workflow.jobs.codeql.strategy.matrix.language,['actions','javascript-typescript','python']);
  const init=workflow.jobs.codeql.steps.find(step=>step.uses==='github/codeql-action/init@v4');
  const inputs = {...init.with};
  delete inputs.config;
  assert.deepEqual(inputs,{languages:'${{ matrix.language }}','build-mode':'none'});
  assert.deepEqual(workflow.jobs.codeql.steps.find(step=>step.uses==='github/codeql-action/analyze@v4').with,{category:'/language:${{ matrix.language }}','upload-database':false});
  assert.deepEqual(workflow.jobs.codeql.permissions,{contents:'read','security-events':'write'});
  assert.ok(workflow.concurrency.group.includes("'weekly-codeql'"));
  assert.ok(workflow.concurrency['cancel-in-progress'].includes("github.event.action != 'closed'"));
});

test('CodeQL仅移除明确退役归档，当前源码和测试仍全量扫描', () => {
  const init = workflow.jobs.codeql.steps.find(step => step.uses === 'github/codeql-action/init@v4');
  const config = yaml.load(init.with.config ?? '{}');
  assert.deepEqual(config, {'paths-ignore': ['sprints/archive/**', 'docs/archive/engine-tests-retired/**']});
  assert.equal(Object.hasOwn(init.with, 'config-file'), false);
  assert.equal(Object.hasOwn(init.with, 'queries'), false);
  assert.equal(Object.hasOwn(init.with, 'packs'), false);
});

test('现役全量PR固定执行16个runner，不包含自动预览', () => {
  const selected = workflow.jobs.checks.strategy.matrix.include;
  assert.equal(selected.length, 10);
  const expanded = Object.entries(workflow.jobs).filter(([id]) => !['foundation-release-verification','brain-deploy'].includes(id)).map(([id, job]) => {
    if (id === 'checks') return selected.length;
    const matrix = job.strategy?.matrix;
    if (!matrix) return 1;
    if (matrix.include) {
      assert.deepEqual(Object.keys(matrix), ['include']);
      return matrix.include.length;
    }
    return Object.values(matrix).reduce((count, axis) => count * axis.length, 1);
  });
  assert.equal(expanded.reduce((sum, count) => sum + count, 0), 16);
});


test('真实YAML事件表达式隔离closed/weekly，普通PR push manual严格汇总', () => {
  function context(name, action='') {
    return {github:{event_name:name,actor:'owner',repository:'example/repo',head_ref:'feature/ui',ref:'refs/heads/main',event:{action,pull_request:{number:42,user:{login:'owner'},head:{repo:{full_name:'example/repo'}},labels:[]}}},
      needs:{'ci-passed':{result:'success'}},inputs:{foundation_release_verification:false},always:()=>true,contains:(xs,x)=>xs.includes(x),startsWith:(s,p)=>s.startsWith(p),format:(s,...values)=>s.replace(/\{(\d+)\}/g,(_,i)=>values[Number(i)])};
  }
  const evaluate=(expression,ctx)=>runInNewContext(expression.replace(/github\.event\.pull_request\.labels\.\*\.name/g,'github.event.pull_request.labels.map(label => label.name)'),ctx);
  for(const event of ['pull_request','push','workflow_dispatch']) {
    const ctx=context(event,event==='pull_request'?'opened':'');
    for(const [id,job]of Object.entries(workflow.jobs)) assert.equal(evaluate(job.if,ctx),id!=='foundation-release-verification'&&(id!=='brain-deploy'||event==='push'),event+':'+id);
  }
  const closed=context('pull_request','closed'),scheduled=context('schedule');
  for(const [id,job]of Object.entries(workflow.jobs)) {
    assert.equal(evaluate(job.if,closed),false,'closed:'+id);
    assert.equal(evaluate(job.if,scheduled),id==='codeql','schedule:'+id);
  }
  const release=context('workflow_dispatch');release.inputs.foundation_release_verification=true;
  assert.equal(evaluate(workflow.jobs['foundation-release-verification'].if,release),true);
  release.github.ref='refs/heads/feature/untrusted';
  assert.equal(evaluate(workflow.jobs['foundation-release-verification'].if,release),false);
  const group=ctx=>evaluate(workflow.concurrency.group.match(/\$\{\{([\s\S]+)\}\}/)[1],ctx);
  assert.notEqual(group(scheduled),group(context('push')));
  assert.equal(evaluate(workflow.concurrency['cancel-in-progress'].match(/\$\{\{([\s\S]+)\}\}/)[1],closed),false);
});

for(const mutate of [
  job=>{job.steps.find(step=>step.name==='Verify Commander decisions and activity recovery').run='echo PASS';},
  job=>{job.steps=job.steps.filter(step=>step.name!=='Verify bounded checker repair and host recovery');},
  job=>{job.steps.find(step=>step.name==='接入结算与隔离回归（含真实数据库）').if='false';},
  job=>{job.steps.find(step=>step.name==='Verify Workflow registration to Brain and real DBOS execution').env.DB_NAME='cecelia';},
])test('现役集成合同拒绝空跑、删步骤、禁用和生产库',()=>{
  const job=structuredClone(workflow.jobs['runtime-integration']);mutate(job);
  assert.throws(()=>assertRuntimeContracts(job));
});
test('凭据扫描不允许checkout持久化令牌或吞掉审计失败',()=>{
  for(const mutate of [job=>{job.steps.find(step=>step.uses==='actions/checkout@v4').with['persist-credentials']=true;},
    job=>{job.steps.find(step=>step.name==='Check dependency vulnerabilities')['continue-on-error']=true;},
    job=>{job.steps.find(step=>step.name==='Check dependency vulnerabilities').if=false;}]){
    const job=structuredClone(workflow.jobs.security);mutate(job);assert.throws(()=>assertSecurityContracts(job));
  }
});


test('自动Preview已退役，PR关闭不再触发任何CI或写预览评论',()=>{
  assert.equal(workflow.jobs['preview-deploy'],undefined);
  assert.equal(workflow.jobs['preview-cleanup'],undefined);
  assert.ok(!workflow.on.pull_request.types.includes('closed'));
  for(const [id,job]of Object.entries(workflow.jobs)){
    assert.notEqual(job.permissions?.['pull-requests'],'write',id);
    assert.ok(!(job.steps??[]).some(step=>/preview-(deploy|cleanup)|preview-ui/.test(step.uses??step.run??'')),id);
  }
});
