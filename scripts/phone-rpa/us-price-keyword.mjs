#!/usr/bin/env node
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DATA_SOURCE, buildTask, claimTask, parseOptions, buildPrompt, validateReceipt, saveQuotes, unsupportedModel } from './us-price-keyword-core.mjs';

async function jsonRequest(base, path, method = 'GET', body, headers = {}) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${path}`);
  return response.json();
}
function child(command, args, env, input, timeout = 1800000) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'], timeout });
    let stdout = '', stderr = '';
    process.stdout.on('data', d => { stdout += d; }); process.stderr.on('data', d => { stderr += d; });
    process.on('error', () => reject(new Error('子进程启动失败')));
    process.on('close', code => resolve({ code, stdout, stderr }));
    process.stdin.end(input);
  });
}
async function notionToken() {
  if (process.env.NOTION_API_KEY) return process.env.NOTION_API_KEY;
  for (const name of ['notion.env', 'notion-rpa-validation.env']) {
    try {
      const file = await readFile(join(homedir(), '.credentials', name), 'utf8');
      const value = file.match(/^(?:export\s+)?NOTION_API_KEY\s*=\s*["']?([^\r\n"']+)/m)?.[1]?.trim();
      if (value) return value;
    } catch { /* 尝试下一份已缓存的凭据，不输出内容。 */ }
  }
  throw new Error('缺少1Password已缓存的Notion凭据');
}
// 只读证据：路径经JSON标准输入传入，禁止shell插值和执行Agent生成代码。
export async function verifyProof(quote) {
  const script = `import json,sys,hashlib,os,re,xml.etree.ElementTree as E
q=json.load(sys.stdin)
paths=[q['price_xml'],q['title_xml'],q.get('zip_xml'),q['screenshot_path']]
proof=[];texts=[]
for p in dict.fromkeys(filter(None,paths)):
 if not os.path.isabs(p) or not p.startswith(('/Users/jinnuoshengyuan/Library/Caches/us-price-native-staging/','/private/tmp/openclaw-phone/','/Volumes/EvidenceRAM/openclaw-phone/')): raise ValueError('证据路径不在设备运行目录')
 with open(p,'rb') as f: data=f.read(30000001)
 if len(data)>30000000 or not data: raise ValueError('证据大小无效')
 if p==q['screenshot_path']:
  if not (data.startswith(b'\\x89PNG\\r\\n\\x1a\\n') or data.startswith(b'\\xff\\xd8\\xff')): raise ValueError('截图格式无效')
 else:
  root=E.fromstring(data)
  if not any(n.attrib.get('package')==q['package'] for n in root.iter()): raise ValueError('XML缺少原生App包')
  texts.extend(n.attrib.get('text','')+' '+n.attrib.get('content-desc','') for n in root.iter())
 proof.append({'path':p,'sha256':hashlib.sha256(data).hexdigest()})
text=' '.join(texts).replace(',','')
if q['model'].lower() not in text.lower() or q['zip'] not in text: raise ValueError('XML缺少型号或邮编')
price=format(q['price_usd'],'.2f')
if price not in text: raise ValueError('XML缺少完整标价')
print(json.dumps(proof,ensure_ascii=False))`;
  const r = await child('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'xian-m4', 'python3', '-c', `'${script.replaceAll("'", "'\\''")}'`], process.env, JSON.stringify(quote), 60000);
  if (r.code !== 0) throw new Error('独立证据审计失败（文件/原生包/型号/邮编/价格不匹配），未写入Notion');
  return r.stdout.trim();
}
export async function main(args) {
  if (args.includes('--help')) {
    console.log('用法: node scripts/phone-rpa/us-price-keyword.mjs --keyword "cordless drill" [--count 3] [--zip 53132] [--model openai/gpt-6-luna] [--task-id 已登记任务ID] [--receipt 真实OpenClaw回执JSON]');
    return;
  }
  const o = parseOptions(args);
  const brain = process.env.CECELIA_BRAIN_URL ?? 'http://localhost:5221';
  const requestBrain = (path, method, body) => jsonRequest(brain, '/api/brain' + path, method, body);
  let taskId = o.taskId;
  if (!taskId) {
    const registered = await requestBrain('/tasks', 'POST', buildTask(o));
    taskId = registered.id ?? registered.task?.id;
    if (!taskId) throw new Error('Brain未返回任务ID，未派发');
  } else {
    const existing = await requestBrain(`/tasks/${taskId}`);
    const task = existing.task ?? existing;
    if (['completed', 'cancelled'].includes(task.status)) throw new Error('不能重新派发已结束任务');
  }
  await claimTask(taskId, `us-price-keyword:${randomUUID()}`, requestBrain);
  const dir = join(homedir(), 'Library', 'Caches', 'cecelia-us-price', taskId);
  await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700);
  const actor = 'OpenClaw/us-price-compare';
  try {
    const token = await notionToken();
    const requestNotion = (path, method, body) => jsonRequest('https://api.notion.com/v1', path, method, body, { Authorization: `Bearer ${token}`, 'Notion-Version': '2025-09-03' });
    const dataSource = o.dataSource ?? DATA_SOURCE;
    // 先检查目标库授权，避免真机执行结束才发现无写入权限。
    await requestNotion(`/data_sources/${dataSource}`, 'GET');
    let receipt;
    if (o.receipt) receipt = JSON.parse(await readFile(o.receipt, 'utf8'));
    else {
      const config = JSON.parse(await readFile(join(homedir(), '.openclaw', 'openclaw.json'), 'utf8'));
      const env = { ...process.env, OPENCLAW_GATEWAY_TOKEN: config.gateway.auth.token };
      const message = join(dir, 'prompt.txt'); await writeFile(message, buildPrompt(o, taskId), { mode: 0o600 });
      for (const model of [...new Set([o.model, 'openai/gpt-6-sol'])]) {
        const r = await child('openclaw', ['agent', '--agent', 'us-price-compare', '--session-id', `price-${taskId}-${randomUUID()}`, '--model', model, '--message-file', message, '--thinking', 'low', '--timeout', '1200', '--json'], env);
        await writeFile(join(dir, `${model.split('/')[1]}-receipt.json`), r.stdout, { mode: 0o600 });
        if (r.code === 0) { try { receipt = JSON.parse(r.stdout); } catch { throw new Error('OpenClaw响应不是JSON'); } }
        if (receipt?.status === 'ok') break;
        if (model === 'openai/gpt-6-luna' && unsupportedModel(r.stdout + r.stderr)) continue;
        throw new Error('OpenClaw执行失败；回执保留，未写入Notion');
      }
    }
    const result = validateReceipt(receipt, o);
    const proofAndUpload = async quote => {
      const proof = await verifyProof(quote);
      const image = await child('ssh', ['-o', 'BatchMode=yes', 'xian-m4', 'python3', '-c', "'import sys,json,base64; p=json.load(sys.stdin); print(base64.b64encode(open(p, \"rb\").read()).decode())'"], process.env, JSON.stringify(quote.screenshot_path), 60000);
      if (image.code !== 0) throw new Error('截图读取失败');
      const bytes = Buffer.from(image.stdout.trim(), 'base64');
      if (bytes.length > 20000000) throw new Error('截图超过单文件上传上限');
      const upload = await requestNotion('/file_uploads', 'POST', { mode: 'single_part', filename: `${quote.model}.png`, content_type: 'image/png' });
      const form = new FormData(); form.append('file', new Blob([bytes], { type: 'image/png' }), `${quote.model}.png`);
      const sent = await fetch(`https://api.notion.com/v1/file_uploads/${upload.id}/send`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2025-09-03' }, body: form, signal: AbortSignal.timeout(60000) });
      if (!sent.ok || (await sent.json()).status !== 'uploaded') throw new Error('Notion截图上传未成功');
      quote.evidence_file_id = upload.id;
      return proof;
    };
    const rows = await saveQuotes(result, o, taskId, requestNotion, dataSource, proofAndUpload);
    const completion = { actor, facts: { keyword: o.keyword, requested_count: o.count, quotes_written: rows.length, matched_sku_count: result.matched_sku_count, claimed_result: result.claimed_result, actual_model: result.actual_model, network_restored: result.network_restored, home_verified: true, lock_free_verified: true }, evidence: { run_id: result.run_id, notion_rows: rows, receipt_directory: dir }, next_steps: [] };
    await writeFile(join(dir, 'completion.json'), JSON.stringify(completion, null, 2), { mode: 0o600 });
    await requestBrain(`/tasks/${taskId}`, 'PATCH', { status: result.claimed_result === 'passed' ? 'completed' : 'in_progress', result: completion, handoff: completion });
    console.log(JSON.stringify({ task_id: taskId, status: result.claimed_result === 'passed' ? 'completed' : 'partial', ...completion }, null, 2));
  } catch (error) {
    // 保持未完成，拒绝把部分报价/采集失败写成已成功。
    const old = await requestBrain(`/tasks/${taskId}`).catch(() => ({}));
    const oldResult = (old.task ?? old).result ?? {};
    await requestBrain(`/tasks/${taskId}`, 'PATCH', { result: { ...oldResult, last_attempt: { actor, facts: { outcome: 'failed', reason: error.message }, evidence: { receipt_directory: dir } } } }).catch(() => {});
    throw new Error(`任务 ${taskId} 未完成：${error.message}`);
  }
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
