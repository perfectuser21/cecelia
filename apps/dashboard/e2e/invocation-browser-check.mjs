// 显式连接受控本机preview，不拦截或伪造API；只用于已批准的无副作用样板。
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const origin = process.env.INVOCATION_CHECK_URL;
const workflowId = process.env.INVOCATION_CHECK_WORKFLOW;
const head = process.env.INVOCATION_CHECK_HEAD;
const authoringTask = process.env.INVOCATION_CHECK_AUTHORING_TASK;
const compose = process.env.INVOCATION_CHECK_COMPOSE;
const input = JSON.parse(process.env.INVOCATION_CHECK_INPUT_JSON || '{}');
const expected = JSON.parse(process.env.INVOCATION_CHECK_EXPECTED_JSON || 'null');
const outputDir = process.env.INVOCATION_CHECK_OUTPUT || '/tmp/workflow-invocation-browser';
assert(origin && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), '必须指定受控本机preview URL');
assert(workflowId && head && authoringTask && compose && expected !== null, '必须提供固定head、候选目标/摘要和预期真实产物');
await mkdir(outputDir, {recursive:true});
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const creates = [];
page.on('request', request => {
  if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/brain/invocations') {
    assert.equal(request.headers()['x-internal-token'],undefined);
    assert.equal(request.headers()['authorization'],undefined);
    creates.push(request.postDataJSON());
  }
});
try {
  await page.goto(origin+'/map');
  const build = await page.evaluate(async () => (await fetch('/build-info.json')).json());
  assert.equal(build.git_sha,head,'preview静态产物必须匹配固定head');
  await page.getByLabel('工作流',{exact:true}).selectOption(workflowId);
  const panel = page.getByLabel('工作流调用',{exact:true});
  await panel.getByLabel('调用用途',{exact:true}).selectOption('candidate');
  await panel.getByText('候选验证来源',{exact:true}).click();
  await panel.getByLabel('编写任务',{exact:true}).fill(authoringTask);
  await panel.getByLabel('候选摘要',{exact:true}).fill(compose);
  for (const [key,value] of Object.entries(input)) {
    const field = panel.getByLabel(key,{exact:true});
    if (typeof value === 'boolean') await field.setChecked(value);
    else await field.fill(typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  await panel.getByRole('button',{name:'启动调用',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(() => !document.querySelector('section[aria-label="工作流调用"] button[type="submit"]')?.disabled);
  await panel.getByRole('button',{name:'启动调用',exact:true}).click();
  await panel.getByText(/任务：/).waitFor();
  assert.equal(creates.length,1,'单次点击只创建一次调用');
  assert.equal(creates[0].target.definition_version_id,`candidate:${compose}`);
  const requestKey = creates[0].request_key;
  const accepted = await page.evaluate(async key => (await fetch('/api/brain/invocations/by-request/'+encodeURIComponent(key))).json(),requestKey);
  assert(accepted.task_id,'应有真实任务回执');
  process.stdout.write(JSON.stringify({event:'invocation_created',task_id:accepted.task_id,request_key:requestKey})+'\n');
  await panel.getByText('已完成',{exact:true}).waitFor({timeout:180000});
  const readback = await page.evaluate(async id => (await fetch('/api/brain/invocations/'+encodeURIComponent(id))).json(),accepted.task_id);
  assert.equal(readback.status,'completed');
  assert.deepEqual(readback.outputs,expected);
  assert.equal(readback.target.definition_version_id,`candidate:${compose}`);
  assert(readback.run_id && readback.evidence,'应有真实运行与证据');
  assert(readback.evidence.runs?.length && readback.evidence.events?.length,'应有真实运行账和事件账');
  await panel.getByLabel('调用结果',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:outputDir+'/completed.png',fullPage:true});
  await writeFile(outputDir+'/readback.json',JSON.stringify({url:origin+'/map',frontend_head:head,backend_head:process.env.INVOCATION_CHECK_BACKEND_HEAD,build,request:creates[0],readback},null,2));
  process.stdout.write(JSON.stringify({event:'browser_verified',task_id:accepted.task_id,run_id:readback.run_id,output_dir:outputDir})+'\n');
} finally { await browser.close(); }
