import { createHash } from 'node:crypto';
export const DATA_SOURCE = '81b9a684-bc40-44dd-840b-235e56296bd3';
const platforms = { 'com.amazon.mShop.android.shopping': 'Amazon US', 'com.thehomedepot': 'Home Depot US' };
const demand = (value, reason) => { if (!value) throw new Error(reason); };
const rich = value => ({ rich_text: [{ text: { content: String(value ?? '').slice(0, 2000) } }] });
export function parseOptions(args) {
  const o = { keyword: '', zip: '53132', count: 3, model: 'openai/gpt-6-luna' };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    demand(['keyword', 'zip', 'count', 'model', 'taskId', 'receipt', 'dataSource'].includes(key) && args[i + 1], '未知参数或缺少参数值');
    o[key] = args[i + 1];
  }
  o.keyword = o.keyword.trim(); o.count = Number(o.count);
  demand(o.keyword.length > 0 && o.keyword.length <= 200, '关键词应为1–200字符');
  demand(/^\d{5}$/.test(o.zip), '需要五位美国邮编');
  demand(Number.isInteger(o.count) && o.count >= 1 && o.count <= 3, '单次商品数量应为1–3');
  demand(['openai/gpt-6-luna', 'openai/gpt-6-sol'].includes(o.model), '模型仅支持本流程授权的 Luna 或 Sol');
  return o;
}
export function buildPrompt(o, taskId) {
  return `执行真实原生App关键词比价任务，Brain任务 ${taskId}。关键词 ${JSON.stringify(o.keyword)}；美国ZIP ${o.zip}；最多 ${o.count} 个不同SKU，最多 ${o.count * 2} 条报价。先在原生App内搜索关键词发现候选，再按品牌+型号+规格套装在另一原生App查相同商品。不得把固定验收商品作为通用结果。找不到配对保留单平台有效报价并报告未匹配原因，不凑数。
必须实际调用 node_exec，在 XIAN-M4-PHONE（node beb0fec23dc75b6b1172379f783cf6d9d4cdc9934ffc2c1522de07f952094654）小黄ANGYVB4402004137执行；controller /Users/jinnuoshengyuan/.local/bin/douyin-phone-adb --profile legacy with-lock 唯一owner。每步确保锁同owner、call idle。用户批准043693f2-c703-406b-96c6-90a0176eff0b允许此手机切mac-mini-m4-us出口，完毕恢复None/国内并HOME释放锁；小彩不动。若当前出口不是None/国内或已有锁，拒绝执行报告原因。
只用Amazon US com.amazon.mShop.android.shopping和Home Depot US com.thehomedepot。禁止网页采价、登录、购买、加购物车。Home Depot通过App内搜索点击，禁止外部商品深链；Amazon按页面就绪等待并拒绝可选读取应用列表权限。只有截图/XML实际存在、明确价格/型号/规格/ZIP才算报价；所有证据新采集不可复用历史报价。不向Notion自行写入。
工具收尾约束：优先node_exec在设备上解析XML并只返回紧凑字段/脚本结构化结果，禁止把全文XML返回模型；同一证据最多读取1次。截图生成后只需返回已存在路径，由CLI独立审计和上传，不要调用 file_fetch，也不要为获取图片内容重复拉取同一文件。恢复网络/桌面并释放锁后立即输出JSON，不再读图或继续检查已验收项目。
最终只输出JSON：{quotes:[{title,brand,model,specification,category,package,zip,price_usd,seller,availability,conditions,url,collected_at,screenshot_path,price_xml,title_xml,zip_xml,action_owner}],network_restored:true,home_verified:true,lock_free_verified:true,unmatched:[],blocking_reason:null}。category限电动工具/家居五金/园艺/其他，collected_at用ISO时间，conditions明确运费/税费未知项。截图和XML用小黄绝对路径；保留证据供调度器SSH读取校验。结束即使失败也恢复网络/桌面并释放锁。`;
}
export function unsupportedModel(text) {
  return /(?:model[^\n]{0,100}(?:not supported|unsupported|not found|does not exist)|unsupported[^\n]{0,50}model)/i.test(text);
}
export function validateReceipt(receipt, o) {
  demand(receipt.status === 'ok' && receipt.runId, 'Agent未成功结束');
  const meta = receipt.result?.meta?.agentMeta;
  const terminal = meta?.terminalReceipt;
  demand(meta?.provider === 'openai' && ['gpt-6-luna', 'gpt-6-sol'].includes(meta?.model), '缺少实际provider模型');
  demand(terminal?.effective?.model === meta.model && terminal.effective.provider === meta.provider, '实际模型回执不一致');
  demand(terminal.successfulToolNames?.includes('node_exec'), '没有真实手机工具调用回执');
  const reports = (receipt.result?.payloads ?? []).flatMap(p => { try { return [JSON.parse(p.text.replace(/^```(?:json)?\s*|\s*```$/g, ''))]; } catch { return []; } });
  const r = reports.find(x => Array.isArray(x.quotes));
  demand(r && r.network_restored === true && r.home_verified === true && r.lock_free_verified === true, '缺少恢复网络/桌面/释放锁验收');
  if (r.report_only) demand(typeof r.source_action_run_id === 'string' && r.source_action_run_id && typeof r.source_action_owner === 'string' && r.source_action_owner, '补报告缺少原采集来源');
  demand(r.quotes.length > 0 && r.quotes.length <= o.count * 2, '没有有效报价或报价超量');
  const keys = new Set(), skus = new Set();
  r.quotes = r.quotes.map(q => ({ ...q, package: q.package ?? q.app_package, specification: q.specification ?? q.pack, url: q.url ?? q.product_url, collected_at: q.collected_at ?? q.collected_at_utc }));
  for (const q of r.quotes) {
    demand(platforms[q.package] && q.zip === o.zip, '平台不是原生App或邮编不符');
    demand(typeof q.price_usd === 'number' && Number.isFinite(q.price_usd) && q.price_usd > 0, '价格无效');
    for (const key of ['title', 'brand', 'model', 'specification', 'seller', 'conditions', 'screenshot_path', 'price_xml', 'title_xml', 'action_owner']) demand(typeof q[key] === 'string' && q[key].trim(), `缺少报价字段 ${key}`);
    demand(!Number.isNaN(Date.parse(q.collected_at)), '采集时间无效');
    const url = new URL(q.url);
    demand(url.protocol === 'https:' && (q.package === 'com.thehomedepot' ? url.hostname === 'www.homedepot.com' : url.hostname === 'www.amazon.com'), '商品链接平台不符');
    const sku = [q.brand, q.model, q.specification].map(x => x.trim().toLowerCase()).join('|');
    demand(!keys.has(`${sku}|${q.package}`), 'SKU平台重复'); keys.add(`${sku}|${q.package}`); skus.add(sku);
  }
  demand(skus.size <= o.count, '不同商品超过本次上限');
  const matched = [...skus].filter(sku => [...keys].filter(key => key.startsWith(sku + '|')).length === 2).length;
  return { ...r, matched_sku_count: matched, claimed_result: matched === o.count ? 'passed' : 'partial', run_id: receipt.runId, actual_model: `${meta.provider}/${meta.model}` };
}
export function notionProperties(q, o, taskId, runId, actualModel, proofIndex) {
  const key = createHash('sha256').update([taskId, q.brand, q.model, q.specification, q.package].join('|').toLowerCase()).digest('hex');
  const properties = {
    商品: { title: [{ text: { content: q.title.slice(0, 2000) } }] },
    关键词: rich(o.keyword), 分类: { select: { name: ['电动工具', '家居五金', '园艺'].includes(q.category) ? q.category : '其他' } },
    品牌: rich(q.brand), 型号: rich(q.model), 规格套装: rich(q.specification), 平台: { select: { name: platforms[q.package] } },
    '标价 USD': { number: q.price_usd }, 邮编: rich(q.zip), 卖家: rich(q.seller), 库存配送: rich(q.availability), 运费税费条件: rich(q.conditions),
    商品链接: { url: q.url }, 采集时间: { date: { start: q.collected_at } }, 任务编号: rich(taskId), 执行编号: rich(runId), 实际模型: rich(actualModel),
    状态: { select: { name: '已核验' } }, 证据索引: rich(proofIndex), 幂等键: rich(key),
  };
  if (q.evidence_file_id) properties.证据 = { files: [{ name: `${q.model}-${platforms[q.package]}`, type: 'file_upload', file_upload: { id: q.evidence_file_id } }] };
  else if (q.evidence_url) {
    const url = new URL(q.evidence_url); demand(url.protocol === 'https:', '证据链接必须HTTPS');
    properties.证据 = { files: [{ name: `${q.model}-${platforms[q.package]}`, type: 'external', external: { url: q.evidence_url } }] };
  }
  return properties;
}
export async function saveQuotes(result, options, taskId, request, dataSource, verifyProof) {
  // 先完成全量证据审计，再开始写入，避免半批未经审计的数据。
  const proofs = [];
  for (const quote of result.quotes) proofs.push(await verifyProof(quote));
  const rows = [];
  for (const [i, quote] of result.quotes.entries()) {
    const execution = result.report_only ? `采集:${result.source_action_run_id};报告:${result.run_id}` : result.run_id;
    const properties = notionProperties(quote, options, taskId, execution, result.actual_model, proofs[i]);
    const matches = await request(`/data_sources/${dataSource}/query`, 'POST', { filter: { property: '幂等键', rich_text: { equals: properties.幂等键.rich_text[0].text.content } } });
    demand(matches.results.length <= 1, '发现重复幂等键，停止写入');
    const page = matches.results[0]
      ? await request(`/pages/${matches.results[0].id}`, 'PATCH', { properties })
      : await request('/pages', 'POST', { parent: { type: 'data_source_id', data_source_id: dataSource }, properties });
    const check = await request(`/pages/${page.id}`, 'GET');
    demand(check.properties?.['标价 USD']?.number === quote.price_usd && check.properties?.幂等键?.rich_text?.[0]?.text?.content === properties.幂等键.rich_text[0].text.content, 'Notion回读校验失败');
    rows.push({ id: page.id, url: check.url ?? page.url, price_usd: quote.price_usd, platform: platforms[quote.package] });
  }
  return rows;
}

export function buildTask(o) {
  return { title: `美国原生App比价：${o.keyword}`, description: `关键词=${o.keyword}；最多${o.count}SKU；ZIP=${o.zip}；两平台原生App；报价写Notion；小黄测试后恢复网络。`, task_type: 'research', priority: 'P1', lane: 'AI', status: 'queued', actor: 'OpenClaw/us-price-compare', source: 'us-price-keyword-cli', payload: { headed_manual: true, workflow: 'us-price-keyword', keyword: o.keyword, count: o.count, zip: o.zip, requested_model: o.model, network_approval_decision: '043693f2-c703-406b-96c6-90a0176eff0b' } };
}
export async function claimTask(taskId, owner, requestBrain) {
  await requestBrain(`/tasks/${taskId}/claim`, 'POST', { claimer: owner, executor_kind: 'headed-session' });
  await requestBrain(`/tasks/${taskId}`, 'PATCH', { status: 'in_progress' });
}

export function buildCompletion(result, o, rows, dir) {
  return {
    actor: 'OpenClaw/us-price-compare',
    facts: { keyword: o.keyword, requested_count: o.count, quotes_written: rows.length, matched_sku_count: result.matched_sku_count, claimed_result: result.claimed_result, actual_model: result.actual_model, network_restored: result.network_restored, home_verified: true, lock_free_verified: true, report_only: result.report_only === true },
    evidence: { run_id: result.run_id, report_run_id: result.run_id, source_action_run_id: result.source_action_run_id ?? null, source_action_owner: result.source_action_owner ?? null, collection_runs: result.collection_runs ?? [], quote_provenance: result.quotes.map(q => ({ package: q.package, model: q.model, action_owner: q.action_owner, collected_at: q.collected_at, source_action_run_id: q.source_action_run_id ?? result.source_action_run_id ?? result.run_id })), notion_rows: rows, receipt_directory: dir },
    next_steps: [],
  };
}
