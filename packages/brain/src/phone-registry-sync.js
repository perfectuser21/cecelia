/** cda0e3e8：人写设备信息回灌台账，经 MMV 下发镜子并在空闲时核验账号。 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { notionReq as defaultNotionReq } from './recurring-notion-sync.js';
import { defaultExecAsync, buildHostCmd } from './host-exec.js';
import { planPhoneChanges } from './lib/phone-registry-content.js';
import { sendBark } from './notifier.js';

export const PHONE_REGISTRY_SYNC_KEY = 'phone_registry_notion_sync';
const TASK_ID = 'cda0e3e8-f2e8-48fb-b60a-55434f3dc531';
const LOCK_ID = 4901001;
const INTERVAL_MS = 30 * 60 * 1000;
const DB_ID = '3d4c40c2-ba63-816d-b72d-d520f2cd090a';
const RUNNERS = ['xian-m1', 'xian-m4'];
const programPath = fileURLToPath(new URL('../scripts/phone-registry-agent.py', import.meta.url));
const quote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function buildPhoneAgentCommand(host, bundle, program, inContainer, keyExistsFn) {
  if (!RUNNERS.includes(host)) throw new Error('非法手机执行机');
  const code = Buffer.from(program).toString('base64');
  const input = Buffer.from(JSON.stringify(bundle)).toString('base64');
  const remote = `echo ${code} | (base64 -d 2>/dev/null || base64 -D) | python3 - --bundle-b64 ${input}`;
  const via = `ssh -o BatchMode=yes -o ConnectTimeout=10 ${host} ${quote(remote)}`;
  return buildHostCmd(`ssh -o BatchMode=yes -o ConnectTimeout=10 mmv ${quote(via)}`, inContainer, keyExistsFn);
}
async function readAllPages(req, token, timeoutMs) {
  const pages = []; const seen = new Set(); let cursor;
  const deadline = Date.now() + timeoutMs;
  for (let n = 0; n < 100; n++) {
    let timer; let out;
    try {
      out = await Promise.race([
        req(token, `/databases/${DB_ID}/query`, 'POST', {
          page_size: 100, filter: { property: '类型', select: { equals: '安卓手机' } }, ...(cursor ? { start_cursor: cursor } : {}),
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('设备清单整轮读取超时')), Math.max(0, deadline - Date.now())); }),
      ]);
    } finally { clearTimeout(timer); }
    if (!Array.isArray(out?.results)) throw new Error('设备清单分页无效');
    pages.push(...out.results);
    if (!out.has_more) return pages;
    if (!out.next_cursor || seen.has(out.next_cursor)) throw new Error('设备清单分页截断');
    cursor = out.next_cursor; seen.add(cursor);
  }
  throw new Error('设备清单分页超界');
}
async function connectBounded(pool) {
  let expired = false; let timer;
  const pending = pool.connect().then(c => { if (expired) c.release(true); return c; });
  try {
    return await Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error('台账同步连接超时')); }, 10000);
    })]);
  } finally { clearTimeout(timer); }
}
const writeState = (q, state) => q(
  `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2::jsonb, NOW())
   ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW()`,
  [PHONE_REGISTRY_SYNC_KEY, JSON.stringify(state)],
);
const record = (q, type, payload) => q(
  `INSERT INTO task_events (task_id, event_type, payload, created_at) VALUES ($1, $2, $3::jsonb, NOW())`,
  [TASK_ID, type, JSON.stringify({ actor: 'phone-registry-sync', ...payload })],
);

export async function runPhoneRegistrySync(pool, opts = {}) {
  const { token = process.env.NOTION_API_KEY, notionReq = defaultNotionReq, now = Date.now(),
    exec = defaultExecAsync, bark = sendBark, force = false, keyExistsFn } = opts;
  if (!token) return { skipped: 'no_token' };
  const client = await connectBounded(pool);
  const q = (text, values) => client.query({ text, values, query_timeout: 10000 });
  let locked = false; let transaction = false; let destroy = false;
  try {
    locked = Boolean((await q('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID])).rows?.[0]?.locked);
    if (!locked) return { skipped: 'locked' };
    const stored = (await q('SELECT value_json FROM working_memory WHERE key = $1', [PHONE_REGISTRY_SYNC_KEY])).rows?.[0]?.value_json ?? {};
    if (!force && stored.completed_at && now - Date.parse(stored.completed_at) < INTERVAL_MS) return { skipped: 'interval_gate' };
    const pages = await readAllPages(notionReq, token, opts.notionTimeoutMs ?? 60000);
    await q('BEGIN'); transaction = true;
    await q("SET LOCAL statement_timeout = '10s'");
    const rows = (await q('SELECT * FROM phone_registry ORDER BY serial FOR UPDATE')).rows;
    const plan = planPhoneChanges(pages, rows, stored.baselines);
    for (const change of plan.changes) {
      const keys = Object.keys(change.fields);
      const values = keys.map(k => ['douyin_accounts', 'wechat'].includes(k) ? JSON.stringify(change.fields[k]) : change.fields[k]);
      const assigns = keys.map((k, i) => `${k} = $${i + 2}${['douyin_accounts', 'wechat'].includes(k) ? '::jsonb' : ''}`);
      const updated = await q(`UPDATE phone_registry SET ${assigns.join(', ')}, updated_by = 'notion-phone-inlet', updated_at = NOW() WHERE serial = $1 RETURNING serial`, [change.serial, ...values]);
      if (updated.rows.length !== 1) throw new Error('台账行已消失');
      await record(q, 'phone_registry_human_edit', { ...change, evidence: { notion_page_id: change.pageId } });
      Object.assign(rows.find(r => r.serial === change.serial), change.fields);
    }
    const state = { baselines: plan.baselines, invalid: plan.invalid, started_at: new Date(now).toISOString() };
    await writeState(q, state);
    await q('COMMIT'); transaction = false;
    const tasks = (await q("SELECT id, task_type, status, payload FROM tasks WHERE status = 'in_progress'")).rows;
    const program = opts.program ?? readFileSync(programPath, 'utf8');
    const inContainer = opts.inContainer ?? existsSync('/.dockerenv');
    const results = await Promise.all(RUNNERS.map(async host => {
      try {
        const raw = await exec(buildPhoneAgentCommand(host, { host, phones: rows, tasks, now }, program, inContainer, keyExistsFn), { timeoutMs: 90000 });
        const result = JSON.parse(raw.trim());
        if (result.ok !== true || !Array.isArray(result.receipts)) throw new Error('执行机同步返回无效');
        return { host, ...result };
      } catch { return { host, ok: false, error: '执行机同步失败，未确认下发' }; }
    }));
    const failed = results.filter(r => !r.ok);
    let accountFailures = 0;
    for (const result of results) {
      await record(q, 'phone_registry_runner_sync', { ...result, evidence: { host: result.host } });
      for (const receipt of result.receipts ?? []) if (['mismatch', 'unreadable', 'unreachable', 'unknown_account'].includes(receipt.status)) {
        accountFailures += 1;
        const mismatch = receipt.status === 'mismatch';
        await bark(mismatch ? '手机账号与台账不一致' : '手机账号核验未确认',
          mismatch ? `${receipt.serial}：期望 ${receipt.expected_id}，实读 ${receipt.actual_id}，请检查账号`
            : `${receipt.serial}：${receipt.status}，未确认当前账号，保留台账`, {
          dedupeKey: `phone-account:${receipt.serial}:${receipt.day}`, dedupeTtlSec: 86400,
        });
      }
    }
    if (failed.length || plan.invalid.length) {
      await bark('手机台账同步未全部确认', `失败执行机 ${failed.length}，需核对记录 ${plan.invalid.length}`, {
        dedupeKey: 'phone-registry-sync-failed', dedupeTtlSec: 1800,
      });
    }
    await writeState(q, { ...state, runners: results, ...(failed.length ? {} : { completed_at: new Date(now).toISOString() }) });
    return { ok: failed.length === 0 && plan.invalid.length === 0 && accountFailures === 0, updated: plan.changes.length, invalid: plan.invalid, failed, runners: results };
  } finally {
    if (transaction) await q('ROLLBACK').catch(() => { destroy = true; });
    if (locked) await q('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => { destroy = true; });
    client.release(destroy);
  }
}
