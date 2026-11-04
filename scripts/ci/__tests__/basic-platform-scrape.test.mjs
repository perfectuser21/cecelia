import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {commandsFor} from '../run-basic-check.mjs';

const script = resolve('packages/workflows/n8n/scripts/platform_scrape.sh');

function run({status = '200', curlExit = 0, writeback = true, platformEnv, scraperExit = 0} = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'platform-scrape-contract-'));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const capture = join(directory, 'request.json');
  // Only the scraper and curl boundary are fixtures; execute the real shell and Node parsers.
  writeFileSync(join(directory, 'scraper-douyin-v3.js'),
    `console.log(JSON.stringify({success:true, platform:'douyin', count:1, items:[{contentId:'fixture-1', views:7}]})); process.exit(${scraperExit});\n`);
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
  try {
    const result = spawnSync('bash', [script, 'douyin'], {env, encoding:'utf8', timeout:10000});
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
  const {output, request} = run({scraperExit:9});
  assert.equal(output.success, false);
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
