import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
const yaml = createRequire(import.meta.url)('js-yaml');
const root = new URL('../../../', import.meta.url).pathname;
const load = name => yaml.load(readFileSync(join(root, '.github/workflows', name), 'utf8'));
const sentinel = load('heartbeat-sentinel.yml');
const reconciliation = sentinel.jobs.reconcile;
const issueStep = reconciliation?.steps.find(s => s.id === 'issue');
const barkStep = reconciliation?.steps.find(s => s.id === 'bark');
const closeStep = reconciliation?.steps.find(s => s.id === 'close');
function fixture(t, commands = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-alert-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, script] of Object.entries(commands)) {
    writeFileSync(join(dir, name), `#!/bin/bash\n${script}\n`); chmodSync(join(dir, name), 0o755);
  }
  return { dir, env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: join(dir, 'output'), GITHUB_STEP_SUMMARY: join(dir, 'summary') } };
}
function run(command, env, cwd = root) {
  return new Promise(resolve => {
    const child = spawn('bash', ['-e', '-o', 'pipefail', '-c', command], { cwd, env });
    let out = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => out += b);
    child.on('close', status => resolve({ status, out }));
  });
}
async function server(t, handler) {
  const instance = createServer(handler); await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => instance.close(resolve)));
  return `http://127.0.0.1:${instance.address().port}`;
}
function condition(expression, probe) {
  return Function('needs', 'always', `return (${expression})`)({ probe }, () => true);
}
for (const result of ['failure', 'cancelled', 'skipped']) test(`哨兵控制面 ${result} 且无输出仍走告警`, () => {
  assert.equal(condition(issueStep.if, { result, outputs: {} }), true);
  assert.equal(condition(barkStep.if, { result, outputs: {} }), true);
  assert.equal(condition(closeStep.if, { result, outputs: {} }), false);
  const outputs = { health_ok: 'true', kv_ok: 'true' };
  assert.equal(condition(issueStep.if, { result, outputs }), true);
  assert.equal(condition(barkStep.if, { result, outputs }), true);
  assert.equal(condition(closeStep.if, { result, outputs }), false);
});
test('哨兵成功必须有双份绿色证据，缺失输出触发告警', () => {
  assert.equal(condition(issueStep.if, { result: 'success', outputs: { health_ok: 'true' } }), true);
  assert.equal(condition(issueStep.if, { result: 'success', outputs: { health_ok: 'true', kv_ok: 'true' } }), false);
});
test('哨兵 Issue 故障保留失败并仍执行 Bark', async t => {
  const f = fixture(t, { gh: 'exit 22' });
  const job = reconciliation;
  const result = await run(job.steps[0].run, { ...f.env, REPO: 'fixture/repo', ISSUE_TITLE_PREFIX: '[heartbeat-sentinel]', ISSUE_LABEL: 'heartbeat-sentinel', HEALTH_OK: '', KV_OK: '', KV_AGE: '', PROBE_URL: '', RUN_URL: 'fixture' });
  assert.notEqual(result.status, 0, result.out);
  let notifications = 0;
  const url = await server(t, (_req, res) => { notifications++; res.end('{}'); });
  // 模拟 Actions 默认 success() 与显式 always() 的调度，再运行真实 Bark step。
  const bark = job.steps[1];
  const shouldRun = bark.if ? condition(bark.if, { result: 'failure', outputs: {} }) : result.status === 0;
  if (shouldRun) {
    const sent = await run(bark.run, { ...f.env, BARK_URL: url, HEALTH_OK: '', KV_OK: '', KV_AGE: '', PROBE_URL: 'fixture' });
    assert.equal(sent.status, 0, sent.out);
  }
  assert.equal(notifications, 1, 'Issue 故障不能阻止 Bark 的真实 HTTP 请求');
});

test('哨兵 Bark HTTP 故障不能被警告吞成成功', async t => {
  const url = await server(t, (_req, res) => { res.statusCode = 500; res.end('{}'); });
  const f = fixture(t);
  const result = await run(barkStep.run, { ...f.env, BARK_URL: url, HEALTH_OK: '', KV_OK: '', KV_AGE: '', PROBE_URL: 'fixture' });
  assert.notEqual(result.status, 0, result.out);
  assert.match(result.out, /curl_exit=22 http=500/);
});

for (const [status, body, ok] of [
  [302, { status: 'healthy' }, false], [500, { status: 'healthy' }, false],
  [200, { status: 'unhealthy' }, false], [200, { status: 'healthy' }, true],
]) test(`哨兵真实 health HTTP ${status}/${body.status}`, async t => {
  const url = await server(t, (_req, res) => { res.statusCode = status; res.end(JSON.stringify(body)); });
  const f = fixture(t); writeFileSync(f.env.GITHUB_OUTPUT, '');
  const result = await run(sentinel.jobs.probe.steps.find(s => s.id === 'health').run, { ...f.env, PROBE_URL: url });
  const output = readFileSync(f.env.GITHUB_OUTPUT, 'utf8');
  assert.equal(result.status === 0 && output.includes('ok=true'), ok, result.out + output);
});
const deepRun = changes => ({id:41742520265,path:'.github/workflows/nightly-regression.yml',head_branch:'main',
  head_sha:'a'.repeat(40),status:'completed',conclusion:'success',updated_at:new Date(Date.now()-3600000).toISOString(),
  html_url:'https://github.com/fixture/repo/actions/runs/41742520265',...changes});
const deepBody = run => ({total_count:1,workflow_runs:[run]});
const deepCases = [
  ['近期成功',200,()=>deepBody(deepRun()),true],
  ['302绿色JSON',302,()=>deepBody(deepRun()),false],['500绿色JSON',500,()=>deepBody(deepRun()),false],
  ['空列表',200,()=>({total_count:0,workflow_runs:[]}),false],['缺列表',200,()=>({total_count:1}),false],
  ['false JSON',200,()=>false,false],['无效JSON',200,()=>'{bad',false],
  ['未来',200,()=>deepBody(deepRun({updated_at:new Date(Date.now()+3600000).toISOString()})),false],
  ['过期',200,()=>deepBody(deepRun({updated_at:new Date(Date.now()-27*3600000).toISOString()})),false],
  ['无时区',200,()=>deepBody(deepRun({updated_at:new Date(Date.now()-1000).toISOString().slice(0,-1)})),false],
  ['无效时间',200,()=>deepBody(deepRun({updated_at:'invalid'})),false],
  ['错误workflow',200,()=>deepBody(deepRun({path:'.github/workflows/smoke-e2e-nightly.yml'})),false],
  ['非main',200,()=>deepBody(deepRun({head_branch:'feature/other'})),false],
  ['未完成',200,()=>deepBody(deepRun({status:'in_progress'})),false],
  ['失败后旧green',200,()=>({total_count:2,workflow_runs:[deepRun({conclusion:'failure'}),deepRun({id:2,updated_at:new Date().toISOString()})]}),false],
  ['最近完成失败',200,()=>deepBody(deepRun({conclusion:'failure'})),false],
  ['合法字段却跳过',200,()=>deepBody(deepRun({conclusion:'skipped'})),false],
  ...['id','path','head_branch','head_sha','status','conclusion','updated_at','html_url'].map(field=>
    ['缺'+field,200,()=>{const run=deepRun();delete run[field];return deepBody(run);},false]),
  ...[0,-1,true,'41742520265'].map(id=>['非法runId '+id,200,()=>deepBody(deepRun({id})),false]),
  ['非法SHA',200,()=>deepBody(deepRun({head_sha:'fixture-sha'})),false],
  ['伪造receipt地址',200,()=>deepBody(deepRun({html_url:'https://fixture.invalid/green'})),false],
];
for(const [name,status,body,ok] of deepCases) test(`哨兵真实Deep回归源 ${name}`,async t=>{
 let calls=0;
 const url=await server(t,(req,res)=>{calls++;assert.equal(req.headers.authorization,'Bearer isolated-deep-token');
   res.statusCode=status;const value=body();res.end(typeof value==='string'?value:JSON.stringify(value));});
 const f=fixture(t,{curl:'args=(); for arg in "$@"; do case "$arg" in https://api.github.com/*) printf "%s" "$arg" > "$FIXTURE_REQUEST_URL"; arg="$FIXTURE_URL";; esac; args+=("$arg"); done; exec /usr/bin/curl "${args[@]}"'});
 const request=join(f.dir,'request-url');
 const result=await run(sentinel.jobs.probe.steps.find(s=>s.id==='kv').run,{...f.env,FIXTURE_URL:url,FIXTURE_REQUEST_URL:request,GH_TOKEN:'isolated-deep-token',GITHUB_REPOSITORY:'fixture/repo'});
 const output=readFileSync(f.env.GITHUB_OUTPUT,'utf8');
 assert.equal(calls,1);
 assert.equal(result.status===0,ok,result.out+output);
 assert.equal(output.includes('ok=true'),ok,result.out+output);
 assert.equal(readFileSync(request,'utf8'),'https://api.github.com/repos/fixture/repo/actions/workflows/nightly-regression.yml/runs?branch=main&status=completed&per_page=1');
 assert.ok(!result.out.includes('isolated-deep-token'));
});
test('哨兵Deep回归HTTP传输截断不能通过',async t=>{
 const url=await server(t,(_req,res)=>{res.writeHead(200,{'Content-Length':'999'});res.write('{');res.destroy();});
 const f=fixture(t,{curl:'args=(); for arg in "$@"; do case "$arg" in https://api.github.com/*) arg="$FIXTURE_URL";; esac; args+=("$arg"); done; exec /usr/bin/curl "${args[@]}"'});
 const result=await run(sentinel.jobs.probe.steps.find(s=>s.id==='kv').run,{...f.env,FIXTURE_URL:url,GH_TOKEN:'isolated-deep-token',GITHUB_REPOSITORY:'fixture/repo'});
 assert.notEqual(result.status,0,result.out);
 assert.doesNotMatch(readFileSync(f.env.GITHUB_OUTPUT,'utf8'),/ok=true/);
});
test('哨兵Deep回归缺token在任何HTTP前失败，权限仅actions读取',async t=>{
 const f=fixture(t,{curl:'exit 99'});
 const result=await run(sentinel.jobs.probe.steps.find(s=>s.id==='kv').run,{...f.env,GH_TOKEN:'',GITHUB_REPOSITORY:'fixture/repo'});
 assert.notEqual(result.status,0,result.out);
 assert.deepEqual(sentinel.jobs.probe.permissions,{actions:'read'});
});
test('哨兵 Bark 302 不能声明推送成功', async t => {
  const url = await server(t, (_req, res) => { res.statusCode = 302; res.end('{}'); });
  const f = fixture(t);
  const result = await run(barkStep.run, { ...f.env, BARK_URL: url, HEALTH_OK: '', KV_OK: '', KV_AGE: '', PROBE_URL: 'fixture' });
  assert.notEqual(result.status, 0, result.out);
  assert.doesNotMatch(result.out, /Bark ok/);
});
for (const status of [200, 302, 500]) test(`nightly真实HTTP ${status}绿色JSON证据`, async t => {
  let calls = 0;
  const url = await server(t, (_req, res) => {
    calls++; res.statusCode = status;
    res.end(JSON.stringify({ total_count: 1, workflow_runs: [{ id: 1, conclusion: 'success', updated_at: new Date(Date.now() - 3600000).toISOString(), head_sha: 'fixture-sha', html_url: 'https://example.invalid/1' }] }));
  });
  // 仅改写网络目的地，真实 curl 参数和真实响应状态保留。
  const f = fixture(t, { curl: 'args=(); for arg in "$@"; do case "$arg" in https://api.github.com/*) arg="$FIXTURE_URL";; esac; args+=("$arg"); done; exec /usr/bin/curl "${args[@]}"' });
  const result = await run('bash scripts/ci/check-nightly-green.sh', { ...f.env, FIXTURE_URL: url, GITHUB_TOKEN: 'isolated-fixture', GITHUB_REPOSITORY: 'fixture/repo', BYPASS_NIGHTLY_GATE: '' });
  assert.equal(calls, 1);
  assert.equal(result.status === 0, status === 200, result.out);
  if (status !== 200) assert.doesNotMatch(result.out, /Release Gate 通过/);
});

test('哨兵缺少Bark配置必须明确失败，不能缺key跳过却显示告警成功', async t => {
  const f=fixture(t);
  const result=await run(barkStep.run,{...f.env,BARK_URL:'',BARK_TOKEN:'',HEALTH_OK:'true',KV_OK:'false',KV_AGE:'2000',PROBE_URL:'fixture'});
  assert.notEqual(result.status,0,result.out);
});


test('哨兵Bark运输失败保留curl与HTTP诊断且不泄露通知地址', async t => {
 const f=fixture(t,{curl:"printf '000'; exit 7"});
 const result=await run(barkStep.run,{...f.env,BARK_URL:'https://fixture.invalid/private-token',BARK_TOKEN:'',HEALTH_OK:'true',KV_OK:'false',KV_AGE:'2000',PROBE_URL:'fixture'});
 assert.notEqual(result.status,0,result.out);
 assert.match(result.out,/curl_exit=7 http=000/);
 assert.doesNotMatch(result.out,/private-token|fixture\.invalid/);
});

for (const mode of ['url', 'token']) test(`哨兵 ${mode} 正文中的网址必须编码成一个路径段`, async t => {
 let received;
 const url = await server(t, (req, res) => {
   received = req.url;
   const path = req.url.split('?')[0].split('/');
   res.statusCode = path.length === 4 && decodeURIComponent(path[3]).includes('http://127.0.0.1:5221/a?x=中%25#片') ? 200 : 404;
   res.end();
 });
 const f = fixture(t, { curl: 'args=(); for arg in "$@"; do case "$arg" in https://api.day.app/*) arg="$FIXTURE_URL/${arg#https://api.day.app/}";; esac; args+=("$arg"); done; exec /usr/bin/curl "${args[@]}"' });
 const result = await run(barkStep.run, { ...f.env, FIXTURE_URL: url, BARK_URL: mode === 'url' ? `${url}/device` : '', BARK_TOKEN: mode === 'token' ? 'device' : '', HEALTH_OK: 'true', KV_OK: 'false', KV_AGE: '-1', PROBE_URL: 'http://127.0.0.1:5221/a?x=中%25#片' });
 assert.equal(result.status, 0, `${result.out}\n${received}`);
});


test('独立只读探测与通知runner保留故障域隔离', () => {
  assert.deepEqual(sentinel.jobs.probe.permissions, { actions: 'read' });
  assert.equal(reconciliation.needs, 'probe');
  assert.equal(reconciliation.if, 'always()');
  assert.deepEqual(reconciliation.permissions, { issues: 'write' });
  assert.equal(sentinel.jobs.probe['timeout-minutes'], 10);
});
for (const outputs of [{}, { health_ok: 'true' }, { kv_ok: 'true' }, { health_ok: 'false', kv_ok: 'true' }]) test(`健康证据不完整不关闭issue ${JSON.stringify(outputs)}`, () => {
  const probe = { result: 'success', outputs };
  assert.equal(condition(issueStep.if, probe), true);
  assert.equal(condition(barkStep.if, probe), true);
  assert.equal(condition(closeStep.if, probe), false);
});
test('健康时仅关闭issue且不因always误发Bark', () => {
  const probe = { result: 'success', outputs: { health_ok: 'true', kv_ok: 'true' } };
  assert.equal(condition(issueStep.if, probe), false);
  assert.equal(condition(barkStep.if, probe), false);
  assert.equal(condition(closeStep.if, probe), true);
});
for (const mode of ['empty', 'success', 'list-failure', 'close-failure']) test(`恢复关闭issue真实命令 ${mode}`, async t => {
  const f = fixture(t, { gh: `case "$*" in *issues\\?*) ${mode === 'list-failure' ? 'exit 22' : mode === 'empty' ? 'exit 0' : "printf '41\\n42\\n'"};; *) printf '%s\\n' "$*" >> "$CLOSE_CALLS"; ${mode === 'close-failure' ? 'exit 22' : 'exit 0'};; esac` });
  const calls = join(f.dir, 'closed'); writeFileSync(calls, '');
  const result = await run(closeStep.run, { ...f.env, REPO: 'fixture/repo', ISSUE_LABEL: 'heartbeat-sentinel', CLOSE_CALLS: calls, RUN_URL: 'https://fixture.invalid/run/1' });
  assert.equal(result.status === 0, ['empty', 'success'].includes(mode), result.out);
  const closed = readFileSync(calls, 'utf8');
  if (mode === 'success') {
    assert.match(closed, /issue close 41 --repo fixture\/repo/);
    assert.match(closed, /issue close 42 --repo fixture\/repo/);
    assert.equal(closed.trim().split('\n').length, 2);
    assert.match(closed, /Run: https:\/\/fixture\.invalid\/run\/1/);
  }
  if (['empty', 'list-failure'].includes(mode)) assert.equal(closed, '');
});
test('解析URL将shell元字符当输入数据而非执行脚本', async t => {
  const f = fixture(t); const marker = join(f.dir, 'injected');
  const input = `http://fixture.invalid/"; touch ${marker}; #$(touch ${marker})`;
  const resolve = sentinel.jobs.probe.steps.find(s => s.id === 'resolve');
  assert.equal(resolve.env.INPUT_URL, '${{ github.event.inputs.probe_url }}');
  const result = await run(resolve.run, { ...f.env, INPUT_URL: input, DEFAULT_PROBE_URL: 'http://default.invalid' });
  assert.equal(result.status, 0, result.out);
  assert.equal(readFileSync(f.env.GITHUB_OUTPUT, 'utf8'), `url=${input}\n`);
  const { existsSync } = await import('node:fs'); assert.equal(existsSync(marker), false);
});

for (const input of ['', 'http://fixture.invalid/a?x=1&y=2']) test(`解析URL保留默认与自定义目标 ${input || '默认'}`, async t => {
  const f = fixture(t);
  const resolve = sentinel.jobs.probe.steps.find(s => s.id === 'resolve');
  const result = await run(resolve.run, { ...f.env, INPUT_URL: input, DEFAULT_PROBE_URL: 'http://default.invalid' });
  assert.equal(result.status, 0, result.out);
  assert.equal(readFileSync(f.env.GITHUB_OUTPUT, 'utf8'), `url=${input || 'http://default.invalid'}\n`);
});
