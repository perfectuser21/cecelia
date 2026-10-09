import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, validateReceipt, buildPrompt, notionProperties, saveQuotes, unsupportedModel } from './us-price-keyword-core.mjs';
const options = { keyword: 'cordless drill', count: 3, zip: '53132', model: 'openai/gpt-6-luna' };
const quote = { title: 'Brand Drill', brand: 'Brand', model: 'ABC123', specification: '2 batteries kit', category: '电动工具', package: 'com.amazon.mShop.android.shopping', zip: '53132', price_usd: 19.99, seller: 'Amazon.com', availability: 'In stock', conditions: 'Tax unknown', url: 'https://www.amazon.com/dp/EXAMPLE', collected_at: '2026-10-09T01:00:00Z', screenshot_path: '/tmp/proof.png', price_xml: '/tmp/price.xml', title_xml: '/tmp/title.xml', action_owner: 'owner' };
function receipt() {
  return { runId: 'run1', status: 'ok', result: { payloads: [{ text: JSON.stringify({ quotes: [quote], network_restored: true, home_verified: true, lock_free_verified: true }) }], meta: { agentMeta: { provider: 'openai', model: 'gpt-6-luna', terminalReceipt: { effective: { provider: 'openai', model: 'gpt-6-luna' }, successfulToolNames: ['node_exec'] } } } } };
}
test('输入数量有界，邮编保留前导零', () => {
  assert.deepEqual(parseOptions(['--keyword', 'drill', '--zip', '00501']), { keyword: 'drill', zip: '00501', count: 3, model: 'openai/gpt-6-luna' });
  for (const count of ['0', '4', '1.5']) assert.throws(() => parseOptions(['--keyword', 'drill', '--count', count]));
  assert.throws(() => parseOptions(['--keyword', '   ']));
});
test('通用提示词使用关键词发现候选而非固定商品，包含恢复与原生约束', () => {
  const prompt = buildPrompt(options, 'task1');
  assert.ok(prompt.includes('cordless drill'));
  assert.ok(prompt.includes('node_exec'));
  assert.ok(prompt.includes('network_restored'));
  assert.ok(!prompt.includes('DCD771C2'));
});
test('成功报价必须真实工具执行、模型元数据一致、原生包、ZIP、价格、证据和恢复', () => {
  assert.equal(validateReceipt(receipt(), options).actual_model, 'openai/gpt-6-luna');
  const edits = [
    x => { x.result.meta.agentMeta.terminalReceipt.successfulToolNames = []; },
    x => { x.result.meta.agentMeta.terminalReceipt.effective.model = 'gpt-6-sol'; },
    x => { x.result.payloads[0].text = x.result.payloads[0].text.replace('53132', '10001'); },
    x => { x.result.payloads[0].text = x.result.payloads[0].text.replace('com.amazon.mShop.android.shopping', 'com.android.chrome'); },
    x => { x.result.payloads[0].text = x.result.payloads[0].text.replace('"network_restored":true', '"network_restored":false'); },
    x => { x.result.payloads[0].text = x.result.payloads[0].text.replace('19.99', '-1'); },
  ];
  for (const edit of edits) { const r = receipt(); edit(r); assert.throws(() => validateReceipt(r, options)); }
});
test('超过数量和同一SKU平台重复报价拒绝', () => {
  const r = receipt(); const report = JSON.parse(r.result.payloads[0].text); report.quotes.push({...quote}); r.result.payloads[0].text = JSON.stringify(report);
  assert.throws(() => validateReceipt(r, options));
});
test('幂等键按任务+品牌型号规格+平台，模型来自provider元数据', () => {
  const p = notionProperties(quote, options, 'task1', 'run1', 'openai/gpt-6-luna', 'sha256:abc');
  assert.equal(p['标价 USD'].number, 19.99);
  assert.equal(p['平台'].select.name, 'Amazon US');
  assert.equal(p['实际模型'].rich_text[0].text.content, 'openai/gpt-6-luna');
  assert.equal(p['采集时间'].date.start, quote.collected_at);
  assert.equal(p['幂等键'].rich_text[0].text.content, notionProperties({...quote, price_usd: 18}, options, 'task1', 'run2', 'other', 'other')['幂等键'].rich_text[0].text.content);
});
test('写入后回读验证；重复运行更新已有行，不新建重复行', async () => {
  let page; const requests = [];
  async function request(path, method, body) {
    requests.push([path, method]);
    if (path.endsWith('/query')) return {results: page ? [page] : []};
    if (method === 'POST') { page = {id: 'page1', properties: body.properties}; return page; }
    if (method === 'PATCH') { page.properties = body.properties; return page; }
    return page;
  }
  const result = validateReceipt(receipt(), options);
  await saveQuotes(result, options, 'task1', request, 'ds1', async () => 'sha256:proof');
  await saveQuotes(result, options, 'task1', request, 'ds1', async () => 'sha256:proof');
  assert.equal(requests.filter(([p,m]) => p === '/pages' && m === 'POST').length, 1);
  assert.equal(requests.filter(([p,m]) => p === '/pages/page1' && m === 'GET').length, 2);
});
test('没有证据审计通过或回读价格不一致均失败', async () => {
  const result = validateReceipt(receipt(), options);
  await assert.rejects(saveQuotes(result, options, 'task1', async () => { throw Error('must not write'); }, 'ds1', async () => { throw Error('proof missing'); }));
  await assert.rejects(saveQuotes(result, options, 'task1', async (p,m,b) => p.endsWith('/query') ? {results: []} : m === 'POST' ? {id:'x'} : {properties: {}}, 'ds1', async () => 'proof'));
});
test('只在明确模型不支持时fallback，商品/网络错误不重复跑', () => {
  assert.equal(unsupportedModel('model is not supported'), true);
  assert.equal(unsupportedModel('Home Depot Error Page'), false);
  assert.equal(unsupportedModel('Timeout'), false);
});
test('报价字段别名规范化，未满足目标数量标partial', () => {
  const r = receipt(), report = JSON.parse(r.result.payloads[0].text);
  report.quotes = [{...quote, app_package: quote.package, pack: quote.specification, product_url: quote.url, collected_at_utc: quote.collected_at}];
  for (const key of ['package','specification','url','collected_at']) delete report.quotes[0][key];
  r.result.payloads[0].text = JSON.stringify(report);
  const result = validateReceipt(r, options);
  assert.equal(result.quotes[0].package, quote.package);
  assert.equal(result.claimed_result, 'partial');
  assert.equal(result.matched_sku_count, 0);
});
test('Notion附件采用上传文件ID', () => {
  const p = notionProperties({...quote, evidence_file_id:'upload1'}, options, 't','r','model','proof');
  assert.equal(p.证据.files[0].file_upload.id, 'upload1');
});
test('任务登记归属有头执行，原子claim失败时不得更新状态', async () => {
  const { buildTask, claimTask } = await import('./us-price-keyword-core.mjs');
  assert.equal(buildTask(options).payload.headed_manual, true);
  assert.equal(buildTask(options).task_type, 'research');
  const calls=[];
  await assert.rejects(claimTask('t1','owner',async (p,m,b) => { calls.push(p); throw Error('409'); }));
  assert.deepEqual(calls,['/tasks/t1/claim']);
});
test('原生采集完成后直接报告，禁止重复拉图和全文XML导致模型不收尾', () => {
  const prompt=buildPrompt(options,'task1');
  assert.ok(prompt.includes('不要调用 file_fetch'));
  assert.ok(prompt.includes('同一证据最多读取1次'));
  assert.ok(prompt.includes('禁止把全文XML返回模型'));
  assert.ok(prompt.includes('恢复网络/桌面并释放锁后立即输出JSON'));
});
test('分阶段补报告保留真实采集与报告run、owner、时间', async () => {
  const { buildCompletion }=await import('./us-price-keyword-core.mjs');
  const result={...validateReceipt(receipt(),options),report_only:true,source_action_run_id:'original-failed-run',source_action_owner:'original-owner'};
  const completion=buildCompletion(result,options,[],'/evidence');
  assert.equal(completion.evidence.report_run_id,'run1');
  assert.equal(completion.evidence.source_action_run_id,'original-failed-run');
  assert.equal(completion.evidence.source_action_owner,'original-owner');
  assert.equal(completion.facts.report_only,true);
  assert.equal(completion.evidence.quote_provenance[0].action_owner,quote.action_owner);
  assert.equal(completion.evidence.quote_provenance[0].collected_at,quote.collected_at);
});
