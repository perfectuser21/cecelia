import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {commandsFor} from '../run-basic-check.mjs';

const script = resolve('packages/workflows/n8n/scripts/platform_scrape.sh');

function run({status = '200', curlExit = 0, writeback = true, platformEnv, scraperExit = 0,
  scraperStderr, platform = 'douyin', missingScraper = false, missingNode = false} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'platform-scrape-contract-'));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const capture = join(directory, 'request.json');
  // Only the scraper and curl boundary are fixtures; execute the real shell and Node parsers.
  writeFileSync(join(directory, 'scraper-douyin-v3.js'),
    `${scraperStderr === undefined ? "console.log(JSON.stringify({success:true, platform:'douyin', count:1, items:[{contentId:'fixture-1', views:7}]}));" : `process.stderr.write(${JSON.stringify(scraperStderr)});`} process.exit(${scraperExit});\n`);
  writeFileSync(join(bin, 'curl'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.FIXTURE_CAPTURE, JSON.stringify({args, payload:JSON.parse(args[args.indexOf('-d')+1])}));
process.stdout.write(process.env.FIXTURE_HTTP_STATUS);
process.exit(Number(process.env.FIXTURE_CURL_EXIT));
`, {mode: 0o755});
  // GNU date is used on the target VPS; this keeps the same numeric contract on macOS.
  writeFileSync(join(bin, 'date'), '#!/bin/sh\nprintf "1700000000000\\n"\n', {mode: 0o755});
  const env = {...process.env, PATH: `${bin}:${process.env.PATH}`, SCRAPER_DIR:directory,
    BRAIN_API_URL:writeback ? 'http://fixture.invalid' : '', FIXTURE_CAPTURE:capture,
    FIXTURE_HTTP_STATUS:status, FIXTURE_CURL_EXIT:String(curlExit),
    PUBLISH_TASK_ID:'fixture-task', PIPELINE_ID:'fixture-pipeline'};
  delete env.PLATFORM;
  if (platformEnv !== undefined) env.PLATFORM = platformEnv;
  if (missingScraper) env.SCRAPER_DIR = join(directory, 'missing "path\\\n');
  if (missingNode) env.PATH = bin;
  try {
    const result = spawnSync('/bin/bash', [script, platform], {env, encoding:'utf8', timeout:10000});
    assert.ifError(result.error);
    // This is the workflow consumer's exact whole-stdout parsing contract.
    const output = JSON.parse(result.stdout.trim());
    let request = null;
    try { request = JSON.parse(readFileSync(capture, 'utf8')); } catch {}
    return {output, request, status:result.status, stderr:result.stderr};
  } finally { rmSync(directory, {recursive:true, force:true}); }
}

test('Basic scripts集合永久选择此真实CLI回归', () => {
  assert.ok(commandsFor('scripts').some(step => step.args.includes('scripts/ci/__tests__/basic-platform-scrape.test.mjs')));
});

test('argv平台进入写回payload，stdout仅一个可解析JSON', () => {
  const {output, request, status} = run();
  assert.equal(status, 0);
  assert.equal(request.payload.platform, 'douyin');
  assert.equal(request.payload.publishTaskId, 'fixture-task');
  assert.equal(request.payload.pipelineId, 'fixture-pipeline');
  assert.deepEqual(request.payload.items, [{contentId:'fixture-1', views:7}]);
  assert.equal(output.success, true);
  assert.equal(output.count, 1);
});

test('argv平台优先于继承的错误PLATFORM', () => {
  assert.equal(run({platformEnv:'wrong-platform'}).request.payload.platform, 'douyin');
});

for (const status of ['400', '503', '302']) {
  test(`HTTP ${status}不能伪装成功，n8n仍能解析业务JSON`, () => {
    const result = run({status});
    const {output} = result;
    assert.equal(result.status, 1);
    assert.equal(output.success, true, '采集成功与写回失败分别记录');
    assert.match(result.stderr, /writeback/i);
    assert.equal(output.writeback.http_status, Number(status));
    assert.equal(output.writeback.ok, false);
  });
}

test('curl失败即使输出200也不能伪装写回成功', () => {
  const {output, status} = run({status:'200', curlExit:7});
  assert.equal(status, 1);
  assert.equal(output.success, true);
  assert.equal(output.writeback.ok, false);
  assert.equal(output.writeback.curl_exit, 7);
});

test('未配置写回保持采集JSON，不调用curl', () => {
  const {output, request} = run({writeback:false});
  assert.equal(output.success, true);
  assert.equal(output.count, 1);
  assert.equal(request, null);
});

test('采集器退出失败不写回，不因curl成功转绿', () => {
  const {output, request, status} = run({scraperExit:9});
  assert.equal(status, 1);
  assert.equal(output.success, false);
  assert.equal(request, null);
});

test('失败采集器多行和反斜线错误保留为合法单JSON且非零退出', () => {
  const message = 'first failure\\path\nsecond "failure"\t\r\b\f';
  const {output, request, status, stderr} = run({scraperExit:9, scraperStderr:message});
  assert.equal(status, 1);
  assert.equal(output.success, false);
  assert.ok(output.error.includes(message));
  assert.equal(request, null);
  assert.equal(stderr, '');
});

test('未知平台的引号、反斜线及全部JSON控制字符安全编码', () => {
  const platform = 'unknown"\\' + Array.from({length:31}, (_, i) => String.fromCharCode(i + 1)).join('');
  const {output, status, request} = run({platform});
  assert.equal(status, 1);
  assert.equal(output.platform, platform);
  assert.equal(output.error, `unknown platform: ${platform}`);
  assert.equal(request, null);
});

test('找不到采集器的含引号换行路径安全编码', () => {
  const {output, status, request} = run({missingScraper:true});
  assert.equal(status, 1);
  assert.match(output.error, /missing "path\\\n/);
  assert.equal(request, null);
});

test('Node缺失也能输出合法错误JSON，无需Node编码器', () => {
  const {output, status, request} = run({missingNode:true, platform:'douyin"\\\n'});
  assert.equal(status, 1);
  assert.equal(output.platform, 'douyin"\\\n');
  assert.equal(output.error, 'node is not installed or not in PATH');
  assert.equal(request, null);
});

const media = resolve('packages/workflows/n8n/workflows/media');
const units = ['抖音', '快手', '小红书', '今日头条', '头条ai测试', '微博', '公众号', '视频号'];
for (const unit of units) {
  test(`${unit}真实workflow消费者执行正反分支，不能只解析后返回`, () => {
    const workflow = JSON.parse(readFileSync(join(media, `unit-${unit}数据爬取.json`), 'utf8'));
    const ssh = workflow.nodes.find(n => n.type === 'n8n-nodes-base.ssh');
    assert.match(ssh.parameters.command, /platform_scrape\.sh /);
    const parse = workflow.nodes.find(n => n.type === 'n8n-nodes-base.code');
    // Execute the literal stored body: escaped backslash-n must not pass as valid JS.
    const consume = new Function('$input', parse.parameters.jsCode);
    const invoke = json => consume({first:() => ({json})});
    const business = {success:true, count:1};
    assert.equal(invoke({code:0, stdout:JSON.stringify(business)})[0].json.count, 1);
    assert.equal(invoke({code:0, stdout:JSON.stringify({...business, writeback:{ok:true, http_status:200}})})[0].json.success, true);
    for (const json of [
      {code:7, stdout:JSON.stringify(business)},
      {code:0, error:'ssh failed', stdout:JSON.stringify(business)},
      {stdout:JSON.stringify(business)},
      {code:0, stdout:'broken'},
      {code:0, stdout:JSON.stringify({count:0})},
      {code:0, stdout:JSON.stringify({success:false, error:'scraper failed'})},
      {code:0, stdout:JSON.stringify({...business, writeback:{ok:false, http_status:400}})},
      {code:0, stdout:JSON.stringify({...business, writeback:{}})},
    ]) assert.throws(() => invoke(json));
  });
}

for (const responseStatus of [200, 400]) {
  test(`真实curl到本人临时HTTP ${responseStatus}：平台入参、退出和stdout合同`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'platform-scrape-http-'));
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'date'), '#!/bin/sh\nprintf "1700000000000\\n"\n', {mode:0o755});
    writeFileSync(join(directory, 'scraper-douyin-v3.js'),
      'console.log(JSON.stringify({success:true, count:1, items:[{contentId:"owned-http"}]}));');
    const requests = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        requests.push({url:req.url, method:req.method, body:JSON.parse(body)});
        res.writeHead(responseStatus, {'Content-Type':'application/json'});
        res.end(JSON.stringify({written:responseStatus === 200 ? 1 : 0}));
      });
    });
    try {
      await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
      const env = {...process.env, PATH:`${bin}:${process.env.PATH}`, SCRAPER_DIR:directory,
        BRAIN_API_URL:`http://127.0.0.1:${server.address().port}`, NO_PROXY:'127.0.0.1', no_proxy:'127.0.0.1'};
      delete env.PLATFORM;
      const child = spawn('bash', [script, 'douyin'], {env, timeout:10000});
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const exit = await new Promise((resolveExit, reject) => {
        child.on('error', reject);
        child.on('close', (code, signal) => resolveExit({code, signal}));
      });
      assert.equal(exit.signal, null, stderr);
      assert.equal(exit.code, responseStatus === 200 ? 0 : 1);
      assert.deepEqual(requests.map(r => [r.method, r.url, r.body.platform]),
        [['POST', '/api/brain/analytics/scrape-result', 'douyin']]);
      const output = JSON.parse(stdout.trim());
      assert.equal(output.success, true);
      assert.deepEqual(output.writeback, {ok:responseStatus === 200, http_status:responseStatus, curl_exit:0});
      const workflow = JSON.parse(readFileSync(join(media, 'unit-抖音数据爬取.json'), 'utf8'));
      const consume = new Function('$input', workflow.nodes.find(n => n.type === 'n8n-nodes-base.code').parameters.jsCode);
      const input = {first:() => ({json:{code:exit.code, stdout}})};
      if (responseStatus === 200) assert.equal(consume(input)[0].json.success, true);
      else assert.throws(() => consume(input));
    } finally {
      await new Promise(resolveClose => server.close(resolveClose));
      rmSync(directory, {recursive:true, force:true});
    }
  });
}
