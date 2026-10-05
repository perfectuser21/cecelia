/**
 * activity-contract-sync.js — 主干活动契约 git→Brain→Notion（决策 0834e2fb / 92f6226b，任务 2fdd5f12）
 *
 * 真身：zenithjoy-workspace 仓 product-map/contracts/<能力>.yaml（CI 组装闸守，product-map/generated/contracts.json 带每活动 sha256）。
 * Brain：journey_steps（视图 backbone_activities）存只读副本 —— contract 原文 + 仓库活动哈希 + 钉在 commit 的正本链接。
 * Notion：「Backbone Activities」镜子（notion_projection_map 登记，迁移 482），每行带「正本（只读·改请走 git）」链接。
 *
 * scheduler job backbone-contract-sync：60s 一轮调用，同步段 30min 自 gate（只读 GitHub API，us-vps 零执行不受影响）；
 * 按显式登记工作流加载同commit所有契约与ref，验证digest后定义+使用关系单事务同步；无消费者旧活动标 deprecated。
 * 同步连续失败超 2h（副本落后真身）告 P1 一次，恢复即清。人在 Notion 手改镜子由 notion-projection-watch A8 抓。
 */
import { validateImplementationBindings } from './lib/implementation-bindings.js';
import { loadActivityContracts } from './lib/activity-contract-loader.js';
import { storeActivityContracts, REGISTRATIONS_SQL } from './lib/activity-contract-store.js';
import { raise } from './alerting.js';
import { resolveGitHubToken } from './harness-credentials.js';
import { notionReq as defaultNotionReq, getToken } from './recurring-notion-sync.js';
import { pushRegisteredRows, resolveDbId, propsDigest } from './lib/notion-projection-engine.js';
import { ensureOpsDbProps } from './ops-quota-notion.js';

export const CONTRACT_REPO = 'perfectuser21/zenithjoy-workspace';
export const CONTRACTS_DIGEST_PATH = 'product-map/generated/contracts.json';
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const DRIFT_ALERT_MS = 2 * 60 * 60 * 1000;
const STATE_KEY = 'activity_contract_sync';
const HTTP_TIMEOUT_MS = 15_000;
const RT_MAX = 1900;
const SOURCE_COL = '正本（只读·改请走 git）';

// ─── GitHub（只读）──────────────────────────────────────────────────────────

async function ghText(path, accept, { fetchFn, token }, repo = CONTRACT_REPO) {
  const res = await fetchFn(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { Accept: accept, Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res?.ok) throw new Error(`github_${path.split('?')[0]}_http_${res?.status ?? 'unknown'}`);
  return res.text();
}
const fetchHead = async (d) => (await ghText('commits/main', 'application/vnd.github.sha', d)).trim();
const fetchFile = (path, sha, d) => ghText(`contents/${path}?ref=${sha}`, 'application/vnd.github.raw', d);

// ─── 同步：GitHub → journey_steps ───────────────────────────────────────────

/**
 * @returns {{head_sha, updated:string[], inserted:string[], deprecated:string[], unmapped:string[]}}
 * GitHub 任一请求失败直接抛错（调用方记滞后），此前不写库。
 */
export async function syncActivityContracts(pool, { fetchFn = globalThis.fetch, resolveToken = resolveGitHubToken, readBinding, expectedRevision, beforeCommit, synchronizeSteps = false } = {}) {
  // 在网络取HEAD之前固定数据库版本，避免慢请求拿旧HEAD覆盖先完成的新同步。
  const registrations = (await pool.query(REGISTRATIONS_SQL,[CONTRACT_REPO])).rows;
  const d = { fetchFn, token: await resolveToken() };
  const head = await fetchHead(d);
  if(expectedRevision !== undefined && head !== expectedRevision) throw Object.assign(new Error('远端main已变化'),{code:'IMPLEMENTATION_CI_MAIN_MOVED',status:409});
  const digest = JSON.parse(await fetchFile(CONTRACTS_DIGEST_PATH, head, d));
  const consumers = registrations.filter(w=>w.status !== 'retired');
  const plans = await loadActivityContracts(consumers,digest,path=>fetchFile(path,head,d),registrations);
  const checked=new Map();
  for(const plan of plans) for(const item of plan.activities) {
    const key=`${item.activity.from}.${item.activity.key}`;
    if(!checked.has(key)) checked.set(key,await validateImplementationBindings(item.activity,readBinding||
      (binding=>ghText(`contents/${binding.path}?ref=${binding.revision}`,'application/vnd.github.raw',d,binding.repo)),{repo:CONTRACT_REPO,commit:head}));
    item.bindings=checked.get(key);
  }
  return storeActivityContracts(pool,plans,head,CONTRACT_REPO,registrations,{beforeCommit,synchronizeSteps});
}

// ─── Notion 镜子：journey_steps（带契约的行）→「Backbone Activities」─────────

const rt = (s) => {
  const t = s === null || s === undefined ? '' : String(s);
  return t === '' ? [] : [{ type: 'text', text: { content: t.slice(0, RT_MAX) } }];
};
const rich = (s) => ({ rich_text: rt(s) });
const sel = (v) => ({ select: { name: String(v).slice(0, 100) } });
const lines = (arr) => (arr || []).join('\n');
const io = (x) => `${x.type}${x.cardinality === 'many' ? '[]' : ''}${x.effect ? ` ${x.effect}` : ''}(${(x.fields || []).join(', ')})`;
const list = (arr) => ((arr || []).length ? arr.join('; ') : '—');

function runsAs(invokers = []) {
  const agent = invokers.includes('agent');
  const code = invokers.includes('code');
  if (agent && code) return 'Hybrid';
  return agent ? 'Agent' : 'Code';
}

function describeFailure(f = {}) {
  const nh = f.needs_human || {};
  return [
    `正常为空: ${list(f.empty_ok)}`,
    `可重试: ${list(f.retryable)}`,
    `需人处理: ${list(nh.cases)} → ${nh.alert?.channel ?? '?'}（${nh.alert?.object ?? '无告警对象'}）`,
    `致命: ${list(f.fatal)}`,
  ].join('\n');
}

function describeSteps(steps = []) {
  return [...steps].sort((x, y) => x.order - y.order).map((s) =>
    `${s.order}. ${s.name}（${s.key}）— 判定: ${s.check}${s.implementation?.status === 'missing' ? ' ⚠未实现' : ''}${s.uses_llm ? ' 🤖' : ''}`).join('\n');
}

/** journey_steps 一行（contract 为仓库原文）→「Backbone Activities」properties。人工/关系列（Capability/Agent/Steps/Type/Accuracy）不发。 */
export function buildBackboneActivityProps(r) {
  const c = r.contract || {};
  const [maj, min] = String(c.version || '0.0.0').split('.');
  const res = c.resources || {};
  return {
    Name: { title: rt(c.name) },
    Order: { number: c.order ?? null },
    Key: rich(`${r.capability_key}.${r.activity_key}`),
    Version: { number: Number(`${maj}.${min}`) },
    '契约版本': rich(c.version),
    'Breaking?': { checkbox: c.compatibility === 'breaking' },
    '负责人': rich([c.owner?.department, c.owner?.agent].filter(Boolean).join(' / ')),
    Input: rich(lines((c.inputs || []).map(io))),
    Output: rich(lines((c.outputs || []).map(io))),
    Preconditions: rich(lines(c.preconditions)),
    Postconditions: rich(lines((c.postconditions || []).map((p) => `${p.probe}: ${p.asserts}`))),
    '执行位置': sel(c.execution?.location ?? 'unknown'),
    Code: rich(c.execution?.via),
    Latency: rich(c.budget ? `预算 ${c.budget.max_duration_s}s / 心跳 ${c.budget.heartbeat_s}s` : ''),
    Config: rich([`锁: ${list(res.locks)}`, `限额: ${list((res.limits || []).map((l) => `${l.name}=${l.value}`))}`].join('\n')),
    '幂等': rich(c.idempotency ? `${c.idempotency.dedupe_key}（重复=${c.idempotency.on_duplicate}）` : ''),
    Failure: rich(describeFailure(c.failure)),
    '副作用': rich(lines((c.side_effects || []).map((s) => `${s.kind}@${s.target}: ${s.description}`)) || '无'),
    'Runs as': sel(runsAs(c.invokers)),
    Cost: rich((c.model || []).length ? lines(c.model.map((m) => `${m.provider}/${m.model}: ${m.purpose}`)) : (c.invokers || []).includes('agent') ? '调用大模型；实际型号见运行记录' : '不调大模型'),
    '步骤清单': rich(describeSteps(c.steps)),
    Notes: rich(lines((c.known_gaps || []).map((g) => `${g.gap}（${g.task}）`))),
    '对外承诺': rich(r.promise),
    '状态': sel(r.status || 'planned'),
    '契约哈希': rich(String(r.contract_sha256 || '').slice(0, 12)),
    [SOURCE_COL]: { url: r.contract_source || null },
  };
}

/** 推前缺列即补（Notion 缺列 400 血训）；已有列（Order/Version/Breaking?/Runs as 等）类型沿用库定义。 */
export const BACKBONE_DB_PROPS = {
  Name: { title: {} }, Order: { number: {} }, Key: { rich_text: {} }, Version: { number: {} },
  '契约版本': { rich_text: {} }, 'Breaking?': { checkbox: {} }, '负责人': { rich_text: {} },
  Input: { rich_text: {} }, Output: { rich_text: {} }, Preconditions: { rich_text: {} }, Postconditions: { rich_text: {} },
  '执行位置': { select: {} }, Code: { rich_text: {} }, Latency: { rich_text: {} }, Config: { rich_text: {} },
  '幂等': { rich_text: {} }, Failure: { rich_text: {} }, '副作用': { rich_text: {} }, 'Runs as': { select: {} },
  Cost: { rich_text: {} }, '步骤清单': { rich_text: {} }, Notes: { rich_text: {} }, '对外承诺': { rich_text: {} },
  '状态': { select: {} }, '契约哈希': { rich_text: {} }, [SOURCE_COL]: { url: {} },
};

export async function pushBackboneActivities(pool, token, { notionReq = defaultNotionReq, logSyncError = async () => {} } = {}) {
  const dbId = await resolveDbId(pool, 'activities');
  if (!dbId || !token) return null;
  const { rows } = await pool.query(
    `SELECT id, capability_key, activity_key, contract, contract_sha256, contract_source, promise, status, notion_id, notion_digest
       FROM activities
      WHERE contract IS NOT NULL AND capability_key IS DISTINCT FROM 'company_kr_analysis'
        AND (notion_synced_at IS NULL OR updated_at > notion_synced_at)
      ORDER BY capability_key, step_number
      LIMIT 50`);
  if (rows.length === 0) return { created: 0, patched: 0, skipped: 0, failed: 0, cleared: 0 };
  const { added } = await ensureOpsDbProps(token, dbId, BACKBONE_DB_PROPS, { notionReq });
  if (added.length) console.log(`[backbone-contract-sync] Backbone Activities 补列: ${added.join(', ')}`);
  return pushRegisteredRows(pool, token, {
    table: 'activities', dbId, rows, buildProps: buildBackboneActivityProps,
    notionReq, logSyncError, label: 'backbone_activity',
  });
}

// ─── Notion 页面正文：契约给人读（任务 d852c852）──────────────────────────────
// 正文完全由 contract 生成、单向只读；指纹（notion_body_digest）没变不打 Notion，变了整段替换。

export const BODY_PAGES_PER_RUN = 3;
const NOTION_APPEND_MAX = 100;

const span = (s, link) => ({ type: 'text', text: { content: String(s ?? '').slice(0, RT_MAX), ...(link ? { link: { url: link } } : {}) } });
const block = (type, content) => ({ object: 'block', type, [type]: { rich_text: [span(content)] } });
const h2 = (s) => block('heading_2', s);
const para = (s) => block('paragraph', s);
const bullets = (items, empty = '无') => ((items || []).length ? items : [empty]).map((s) => block('bulleted_list_item', s));
const listOr = (arr) => ((arr || []).length ? arr.join('；') : '无');

/** journey_steps 一行 → 页面正文 blocks（顺序按人读：先看承诺和输入输出，再看怎么判、怎么错、花多少）。 */
export function buildBackboneActivityBody(r) {
  const c = r.contract || {};
  const nh = c.failure?.needs_human || {};
  const res = c.resources || {};
  const steps = [...(c.steps || [])].sort((x, y) => x.order - y.order);
  return [
    { object: 'block', type: 'callout', callout: {
      icon: { type: 'emoji', emoji: '🔒' },
      rich_text: [span('只读镜子：本页由契约自动生成，手改会被覆盖。改契约请改 '), span('git 正本', r.contract_source || null), span('，合并后约 30 分钟自动同步。')],
    } },
    h2('对外承诺'),
    para(r.promise || '（内部活动，无直接客户承诺）'),
    h2('输入 → 输出'),
    ...bullets([...(c.inputs || []).map((x) => `输入：${io(x)}`), ...(c.outputs || []).map((x) => `输出：${io(x)}`)]),
    h2('开工前提'),
    ...bullets(c.preconditions),
    h2('做完怎么判定'),
    ...bullets((c.postconditions || []).map((p) => `探针 ${p.probe}：${p.asserts}`)),
    h2('步骤'),
    ...steps.map((s) => block('numbered_list_item',
      `${s.name} — 判定：${s.check}${s.implementation?.status === 'missing' ? ' ⚠ 未实现' : ''}${s.uses_llm ? ' 🤖' : ''}（${s.key}）`)),
    h2('出错怎么办'),
    ...bullets([
      `正常为空：${listOr(c.failure?.empty_ok)}`,
      `可重试：${listOr(c.failure?.retryable)}`,
      `需人处理：${listOr(nh.cases)} → ${nh.alert?.channel ?? '?'}（${nh.alert?.object ?? '无告警对象'}）`,
      `致命：${listOr(c.failure?.fatal)}`,
    ]),
    h2('预算与限额'),
    ...bullets([
      c.budget ? `时长上限 ${c.budget.max_duration_s}s，心跳 ${c.budget.heartbeat_s}s` : '时长：未声明',
      `锁：${listOr(res.locks)}`,
      `限额：${listOr((res.limits || []).map((l) => `${l.name}=${l.value}`))}`,
      c.idempotency ? `防重复：${c.idempotency.dedupe_key}（重复时 ${c.idempotency.on_duplicate}）` : '防重复：未声明',
    ]),
    h2('副作用与模型'),
    ...bullets([
      ...(c.side_effects || []).map((s) => `${s.kind === 'external_visible' ? '对外可见' : '内部写入'} · ${s.target}：${s.description}`),
      ...((c.model || []).length ? c.model.map((m) => `模型 ${m.provider}/${m.model}：${m.purpose}`) : [(c.invokers || []).includes('agent') ? '调用大模型；实际型号见运行记录' : '不调大模型']),
    ]),
    h2('已知缺口'),
    ...bullets((c.known_gaps || []).map((g) => `${g.gap}（任务 ${g.task}）`)),
    { object: 'block', type: 'divider', divider: {} },
    para([
      `负责人 ${[c.owner?.department, c.owner?.agent].filter(Boolean).join(' / ') || '未声明'}`,
      `执行 ${c.execution?.location ?? '?'}（${c.execution?.via ?? '?'}）`,
      `调用方式 ${runsAs(c.invokers)}`,
      `版本 ${c.version ?? '?'}（${c.compatibility === 'breaking' ? '破坏性' : '兼容'}）`,
      `指纹 ${String(r.contract_sha256 || '').slice(0, 12)}`,
    ].join(' · ')),
  ];
}

/** 整段替换：先列旧块→逐块删→分批追加。任一步抛错由调用方兜，不记指纹即下轮重来。 */
async function replacePageBody(token, pageId, blocks, notionReq) {
  const old = [];
  let cursor = null;
  do {
    const q = `?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`;
    const res = await notionReq(token, `/blocks/${pageId}/children${q}`, 'GET');
    old.push(...(res?.results || []).map((b) => b.id));
    cursor = res?.has_more ? res.next_cursor : null;
  } while (cursor);
  for (const id of old) await notionReq(token, `/blocks/${id}`, 'DELETE');
  for (let i = 0; i < blocks.length; i += NOTION_APPEND_MAX) {
    await notionReq(token, `/blocks/${pageId}/children`, 'PATCH', { children: blocks.slice(i, i + NOTION_APPEND_MAX) });
  }
}

export async function syncBackboneBodies(pool, token, { notionReq = defaultNotionReq, logSyncError = async () => {} } = {}) {
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT id, notion_id, capability_key, activity_key, contract, contract_sha256, contract_source, promise, status, notion_body_digest
       FROM activities
      WHERE contract IS NOT NULL AND notion_id IS NOT NULL
      ORDER BY capability_key, step_number`);
  const stat = { rewritten: 0, unchanged: 0, failed: 0 };
  for (const r of rows) {
    const blocks = buildBackboneActivityBody(r);
    const digest = propsDigest({}, blocks);
    if (r.notion_body_digest === digest) { stat.unchanged++; continue; }
    if (stat.rewritten + stat.failed >= BODY_PAGES_PER_RUN) break;
    try {
      await replacePageBody(token, r.notion_id, blocks, notionReq);
      await pool.query(`UPDATE activities SET notion_body_digest = $2 WHERE id = $1`, [r.id, digest]);
      stat.rewritten++;
    } catch (err) {
      stat.failed++;
      console.warn(`[backbone-contract-sync] 正文重写失败 ${r.capability_key}.${r.activity_key}: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
  return stat;
}

// ─── scheduler job ─────────────────────────────────────────────────────────

async function readState(pool) {
  const { rows } = await pool.query('SELECT value_json FROM working_memory WHERE key = $1', [STATE_KEY]);
  let v = rows?.[0]?.value_json;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return v && typeof v === 'object' ? v : null;
}

async function writeState(pool, state) {
  await pool.query(
    `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
    [STATE_KEY, JSON.stringify(state)]);
}

/**
 * scheduler-jobs handler。同步段 30min 自 gate（force 跳过）；推送段每轮跑（无变化的行不打 Notion）。
 * 两段各自吞错：推送失败不影响同步记账。
 * @param {object} [opts] 测试注入：fetchFn / resolveToken / now / force / push / notionToken
 */
export async function runBackboneContractJob(pool, opts = {}) {
  const now = opts.now ?? Date.now();
  const prev = await readState(pool);
  let sync = { skipped: true, reason: 'interval_gate' };
  const last = Date.parse(prev?.checked_at);
  if (opts.force || !(Number.isFinite(last) && now - last < CHECK_INTERVAL_MS)) {
    const at = new Date(now).toISOString();
    try {
      // 生产同步同时落 Step（读回/名字/动作/进出/失败处理照合同）；合同有 Step 没读回则整轮拒绝，按滞后告警
      const r = await syncActivityContracts(pool, { fetchFn: opts.fetchFn, resolveToken: opts.resolveToken, synchronizeSteps: opts.synchronizeSteps ?? true });
      sync = { ok: true, ...r };
      await writeState(pool, { checked_at: at, ok: true, head_sha: r.head_sha, lag_since: null, alerted: false, last: r });
    } catch (err) {
      const lagSince = prev?.ok === false && prev?.lag_since ? prev.lag_since : at;
      let alerted = prev?.ok === false && prev?.alerted === true;
      if (!alerted && now - Date.parse(lagSince) >= DRIFT_ALERT_MS) {
        await raise('P1', 'activity_contract_sync_stale',
          `主干活动契约同步已失败超 2h（自 ${lagSince}）：Brain/Notion 副本落后 git 正本。最近错误: ${err.message}`).catch(() => {});
        alerted = true;
      }
      sync = { ok: false, error: err.message };
      await writeState(pool, { checked_at: at, ok: false, error: err.message, head_sha: prev?.head_sha ?? null, lag_since: lagSince, alerted });
    }
  }
  // 无 Notion 凭据（CI/测试环境）→ 两段都收到空 token 安静跳过，不每分钟刷失败日志
  const safeToken = () => { try { return getToken(); } catch { return null; } };
  const token = () => opts.notionToken ?? safeToken();
  // 属性先推（新页面在这一步建出 notion_id），正文再写；两段各自吞错
  let push;
  try {
    const pushFn = opts.push ?? ((p) => pushBackboneActivities(p, token()));
    push = await pushFn(pool);
  } catch (err) {
    console.warn(`[backbone-contract-sync] 推 Notion 失败（非阻断）: ${err.message}`);
    push = { error: err.message };
  }
  let body;
  try {
    const bodyFn = opts.body ?? ((p) => syncBackboneBodies(p, token()));
    body = await bodyFn(pool);
  } catch (err) {
    console.warn(`[backbone-contract-sync] 写 Notion 正文失败（非阻断）: ${err.message}`);
    body = { error: err.message };
  }
  return { sync, push, body };
}
