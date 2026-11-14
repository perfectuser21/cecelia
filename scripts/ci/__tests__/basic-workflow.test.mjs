import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { planChecks } from '../basic-scope.mjs';
import { commandsFor } from '../run-basic-check.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const workflow = yaml.load(readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'));

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
  assert.deepEqual([...reached].sort(), Object.keys(workflow.jobs).filter(id => !['preview-deploy','preview-cleanup'].includes(id)).sort());
  assert.equal(workflow.jobs['ci-passed'].if, "always() && github.event_name != 'schedule' && github.event.action != 'closed'");
  assert.equal(workflow.jobs['ci-passed'].name, '源码保底通过');
  assert.equal(workflow.jobs.checks.strategy['fail-fast'], false);
  assert.equal(workflow.jobs.checks.name, "${{ format('Check ({0} {1})', matrix.component, matrix.shard) }}");
  assert.equal(workflow.jobs.checks.if, "github.event_name != 'schedule' && github.event.action != 'closed'");
  const run = workflow.jobs.checks.steps.find(step => step.name === 'Run actual checks');
  assert.equal(run.run, 'node scripts/ci/run-basic-check.mjs "$COMPONENT" "$SHARD"');
  for (const paths of [[], ['docs/current/README.md'], ['packages/brain/src/server.js']]) {
    assert.equal(planChecks(paths, {full: paths.length === 0}).filter(row => row.component === 'scripts').length, 1);
  }
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
      env: { ...process.env, NEEDS_JSON: JSON.stringify(Object.fromEntries(workflow.jobs['ci-passed'].needs.map(job => [job,{result:job === 'checks' ? status : 'success', outputs:job === 'plan' ? {resource_plan:JSON.stringify({linux:true,app_server:true,legacy:true})} : {linux:'success',app_server:'success',app_server_rpc:'success',legacy:'success'}}]))) },
    });
    assert.equal(result.status === 0, status === 'success', result.stderr);
  }
});

test('每个现役矩阵项都能解析到非空真实命令', () => {
  for (const row of planChecks([], { full: true })) {
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
  for (const id of ['plan','security','checks','ci-passed']) assert.doesNotMatch(JSON.stringify(workflow.jobs[id]), /secrets\.|skills-source|GH_PAT_BOT|CECELIA_INTERNAL_TOKEN/);
});

test('只给实际PG跑道设置数据库URI，不能意外启用单测文件里的真实PG describe', () => {
  assert.equal(workflow.jobs.checks.env.DATABASE_URL,
    "${{ matrix.component == 'brain-integration' && 'postgresql://ci:isolated-ci@127.0.0.1:5432/cecelia_scratch' || '' }}");
});






test('退出旧API集成跑道，只有现役Brain PG组件可启动数据库', () => {
  const job = workflow.jobs.checks;
  assert.equal(job.env.API_PG_INTEGRATION, '0');
  assert.equal(job.services.postgres.image,
    "${{ matrix.component == 'brain-integration' && 'mirror.gcr.io/pgvector/pgvector:pg15' || '' }}");
  assert.ok(!planChecks(['apps/api/src/system/routes.ts']).some(row => row.component === 'api-integration'));
});


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
  assert.equal(Object.keys(workflow.jobs).length, 10);
  const baseline=yaml.load(execFileSync('git',['show','0e2c3c81717ab08ae678a869f526a258f850fec8:.github/workflows/ci.yml'],{cwd:root,encoding:'utf8'}));
  for (const oldId of ['app-server-canary','attempt-runtime-limits','linux-resource-canary']) {
    assert.equal(workflow.jobs[oldId], undefined);
    for (const step of baseline.jobs[oldId].steps.filter(step => step.run?.includes('| tee '))) {
      assert.equal(workflow.jobs['resource-canaries'].steps.filter(actual => actual.run === step.run).length, 1, step.name);
    }
  }
  const runtime=workflow.jobs['runtime-integration'];
  assert.deepEqual(runtime.services, baseline.jobs['node-onboarding'].services);
  for (const step of baseline.jobs['node-onboarding'].steps.filter(step => step.run && step.run !== 'npm ci')) {
    assert.ok(runtime.steps.some(actual => actual.run === step.run && JSON.stringify(actual.env) === JSON.stringify(step.env)), step.name);
  }
  const recovery=runtime.steps.find(step => step.run?.includes('commander-dbos-recovery-smoke.mjs'));
  assert.equal(recovery.if, '!cancelled()');
  assert.equal(recovery.env.TEST_DB_URL, 'postgresql://onboarding_ci:onboarding_ci@127.0.0.1:5432/cecelia_scratch');
  assert.equal(runtime.steps.filter(step => step.uses === 'actions/checkout@v4').length, 1);
  assert.equal(runtime.steps.filter(step => step.uses === 'actions/setup-node@v4').length, 1);
  assert.equal(runtime.steps.filter(step => step.run === 'npm ci').length, 1);
  assert.equal(runtime.steps.some(step => step['continue-on-error']), false);
  const browser=structuredClone(workflow.jobs['pwa-upgrade']);
  const preparation=browser.steps.filter(step=>step.name==='Prepare Ubuntu package sources');
  assert.deepEqual(preparation,[{name:'Prepare Ubuntu package sources',run:'node scripts/ci/prepare-ubuntu-archive.mjs','working-directory':'.'}]);
  const preparationIndex=browser.steps.indexOf(preparation[0]);
  assert.equal(browser.steps[preparationIndex+1]?.name,'Install Chromium');
  browser.steps.splice(preparationIndex,1);
  browser.name=baseline.jobs['pwa-upgrade'].name;
  assert.deepEqual(browser, baseline.jobs['pwa-upgrade']);
  assert.equal(workflow.jobs['pwa-upgrade'].name, 'Browser regression (Chromium)');
  assert.deepEqual(workflow.jobs.security, baseline.jobs.security);
  assert.deepEqual(workflow.jobs.codeql, baseline.jobs.codeql);
});

test('周扫描仅CodeQL执行，closed仅cleanup；评论写权限限于预览生命周期', () => {
  const normal="github.event_name != 'schedule' && github.event.action != 'closed'";
  for(const [id,job]of Object.entries(workflow.jobs)) {
    if(!['codeql','preview-deploy','preview-cleanup'].includes(id)) assert.equal(job.if,(['ci-passed','skill-passed'].includes(id)?'always() && ':'')+normal+(id==='resource-canaries' ? " && contains(needs.plan.outputs.resource_plan, 'true')" : ''),id);
    if(!['preview-deploy','preview-cleanup'].includes(id))assert.notEqual(job.permissions?.['pull-requests'],'write',id);
    if(id!=='codeql')assert.notEqual(job.permissions?.['security-events'],'write',id);
  }
  assert.deepEqual(workflow.on.schedule,[{cron:'0 3 * * 1'}]);
  assert.equal(workflow.jobs.codeql.if,"github.event.action != 'closed'");
  assert.deepEqual(workflow.jobs.codeql.strategy.matrix.language,['actions','javascript-typescript','python']);
  const init=workflow.jobs.codeql.steps.find(step=>step.uses==='github/codeql-action/init@v4');
  assert.deepEqual(init.with,{languages:'${{ matrix.language }}','build-mode':'none'});
  assert.deepEqual(workflow.jobs.codeql.steps.find(step=>step.uses==='github/codeql-action/analyze@v4').with,{category:'/language:${{ matrix.language }}'});
  assert.deepEqual(workflow.jobs.codeql.permissions,{contents:'read','security-events':'write'});
  assert.equal(workflow.jobs['preview-cleanup'].needs,undefined);
  assert.equal(workflow.jobs['preview-cleanup'].if,"github.event_name == 'pull_request' && github.event.action == 'closed'");
  assert.equal(workflow.jobs['preview-deploy'].needs,'plan');
  assert.ok(workflow.jobs['preview-deploy'].if.includes("needs.plan.outputs.preview_ui == 'true'"));
  assert.equal(workflow.jobs.plan.outputs.preview_ui,'${{ steps.scope.outputs.preview_ui }}');
  assert.ok(workflow.concurrency.group.includes("'closed-pr-{0}'"));
  assert.ok(workflow.concurrency.group.includes("'weekly-codeql'"));
  assert.ok(workflow.concurrency['cancel-in-progress'].includes("github.event.action != 'closed'"));
});

test('现役全量PR含UI预览实际展开21个runner，不重复计算定义合并', () => {
  const selected = planChecks(['apps/dashboard/src/App.tsx'], {full:true});
  assert.equal(selected.length, 11);
  const expanded = Object.entries(workflow.jobs).filter(([id]) => id !== 'preview-cleanup').map(([id, job]) => {
    if (id === 'checks') return selected.length;
    const matrix = job.strategy?.matrix;
    if (!matrix) return 1;
    if (matrix.include) {
      assert.deepEqual(Object.keys(matrix), ['include']);
      return matrix.include.length;
    }
    return Object.values(matrix).reduce((count, axis) => count * axis.length, 1);
  });
  assert.equal(expanded.reduce((sum, count) => sum + count, 0), 21);
});


test('真实YAML事件表达式隔离closed/weekly，普通PR push manual严格汇总', () => {
  function context(name, action='', ui='true') {
    return {github:{event_name:name,actor:'owner',repository:'example/repo',head_ref:'feature/ui',ref:'refs/heads/main',event:{action,pull_request:{number:42,user:{login:'owner'},head:{repo:{full_name:'example/repo'}},labels:[]}}},
      needs:{plan:{outputs:{preview_ui:ui,resource_plan:'{"linux":true,"app_server":true,"legacy":true}'}}},always:()=>true,contains:(xs,x)=>xs.includes(x),startsWith:(s,p)=>s.startsWith(p),format:(s,...values)=>s.replace(/\{(\d+)\}/g,(_,i)=>values[Number(i)])};
  }
  const evaluate=(expression,ctx)=>runInNewContext(expression.replace(/github\.event\.pull_request\.labels\.\*\.name/g,'github.event.pull_request.labels.map(label => label.name)'),ctx);
  for(const event of ['pull_request','push','workflow_dispatch']) {
    const ctx=context(event,event==='pull_request'?'opened':'');
    for(const [id,job]of Object.entries(workflow.jobs))if(!['preview-deploy','preview-cleanup'].includes(id)) assert.equal(evaluate(job.if,ctx),true,event+':'+id);
  }
  const closed=context('pull_request','closed'),scheduled=context('schedule');
  for(const [id,job]of Object.entries(workflow.jobs)) {
    assert.equal(evaluate(job.if,closed),id==='preview-cleanup','closed:'+id);
    assert.equal(evaluate(job.if,scheduled),id==='codeql','schedule:'+id);
  }
  const deploy=workflow.jobs['preview-deploy'];
  assert.equal(evaluate(deploy.if,context('pull_request','opened','false')),false);
  assert.equal(evaluate(deploy.if,context('pull_request','opened')),true);
  const group=ctx=>evaluate(workflow.concurrency.group.match(/\$\{\{([\s\S]+)\}\}/)[1],ctx);
  assert.notEqual(group(closed),group(context('push')));
  assert.notEqual(group(closed),group(context('pull_request','synchronize')));
  assert.notEqual(group(scheduled),group(context('push')));
  assert.equal(evaluate(workflow.concurrency['cancel-in-progress'].match(/\$\{\{([\s\S]+)\}\}/)[1],closed),false);
});
