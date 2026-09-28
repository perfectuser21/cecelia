/**
 * activity-contract-sync.js — 主干活动契约 git→Brain→Notion（决策 0834e2fb / 92f6226b，任务 2fdd5f12）
 *
 * 真身：zenithjoy-workspace 仓 product-map/contracts/<能力>.yaml（CI 组装闸守，product-map/generated/contracts.json 带每活动 sha256）。
 * Brain：journey_steps（视图 backbone_activities）存只读副本 —— contract 原文 + 仓库活动哈希 + 钉在 commit 的正本链接。
 * Notion：「Backbone Activities」镜子（notion_projection_map 登记，迁移 482），每行带「正本（只读·改请走 git）」链接。
 *
 * scheduler job backbone-contract-sync：60s 一轮调用，同步段 30min 自 gate（只读 GitHub API，us-vps 零执行不受影响）；
 * 仓库哈希没变不拉 YAML、不写库；变了按 (capability_key, activity_key) 写回，仓库删掉的活动标 deprecated（不删行）。
 * 同步连续失败超 2h（副本落后真身）告 P1 一次，恢复即清。人在 Notion 手改镜子由 notion-projection-watch A8 抓。
 */
import yaml from 'js-yaml';
import { raise } from './alerting.js';
import { resolveGitHubToken } from './harness-credentials.js';
import { notionReq as defaultNotionReq, getToken } from './recurring-notion-sync.js';
import { pushRegisteredRows, resolveDbId } from './lib/notion-projection-engine.js';
import { ensureOpsDbProps } from './ops-quota-notion.js';

export const CONTRACT_REPO = 'perfectuser21/zenithjoy-workspace';
export const CONTRACTS_DIGEST_PATH = 'product-map/generated/contracts.json';
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const DRIFT_ALERT_MS = 2 * 60 * 60 * 1000;
const STATE_KEY = 'activity_contract_sync';
const HTTP_TIMEOUT_MS = 15_000;
const RT_MAX = 1900;
const SOURCE_COL = '正本（只读·改请走 git）';

const contractPath = (cap) => `product-map/contracts/${cap}.yaml`;

// ─── GitHub（只读）──────────────────────────────────────────────────────────

async function ghText(path, accept, { fetchFn, token }) {
  const res = await fetchFn(`https://api.github.com/repos/${CONTRACT_REPO}/${path}`, {
    headers: { Accept: accept, Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res?.ok) throw new Error(`github_${path.split('?')[0]}_http_${res?.status ?? 'unknown'}`);
  return (await res.text()).trim();
}
const fetchHead = (d) => ghText('commits/main', 'application/vnd.github.sha', d);
const fetchFile = (path, sha, d) => ghText(`contents/${path}?ref=${sha}`, 'application/vnd.github.raw', d);

// ─── 同步：GitHub → journey_steps ───────────────────────────────────────────

/**
 * @returns {{head_sha, updated:string[], inserted:string[], deprecated:string[], unmapped:string[]}}
 * GitHub 任一请求失败直接抛错（调用方记滞后），此前不写库。
 */
export async function syncActivityContracts(pool, { fetchFn = globalThis.fetch, resolveToken = resolveGitHubToken } = {}) {
  const d = { fetchFn, token: await resolveToken() };
  const head = await fetchHead(d);
  const digest = JSON.parse(await fetchFile(CONTRACTS_DIGEST_PATH, head, d));
  const { rows } = await pool.query(
    `SELECT id, journey_id, capability_key, activity_key, contract_sha256, status
       FROM journey_steps WHERE capability_key IS NOT NULL AND activity_key IS NOT NULL`);
  const out = { head_sha: head, updated: [], inserted: [], deprecated: [], unmapped: [] };

  const byCap = new Map();
  for (const r of rows) byCap.set(r.capability_key, [...(byCap.get(r.capability_key) || []), r]);

  for (const [cap, capRows] of byCap) {
    const want = digest?.capabilities?.[cap]?.activities;
    if (!want) { out.unmapped.push(cap); continue; }
    const stale = Object.entries(want).filter(([k, sha]) => !capRows.some((r) => r.activity_key === k && r.contract_sha256 === sha && r.status !== 'deprecated'));
    if (stale.length) {
      const doc = yaml.load(await fetchFile(contractPath(cap), head, d));
      const source = `https://github.com/${CONTRACT_REPO}/blob/${head}/${contractPath(cap)}`;
      const own = new Map((doc.activities || []).filter((a) => !a.ref).map((a) => [a.key, a]));
      for (const [key, sha] of stale) {
        const a = own.get(key);
        if (!a) { out.unmapped.push(`${cap}.${key}`); continue; }
        const row = capRows.find((r) => r.activity_key === key);
        if (row) {
          await pool.query(
            `UPDATE journey_steps SET name = $2, contract = $3, contract_sha256 = $4, contract_source = $5,
                    status = CASE WHEN status = 'deprecated' THEN 'planned' ELSE status END, updated_at = NOW()
              WHERE id = $1`,
            [row.id, a.name, JSON.stringify(a), sha, source]);
          out.updated.push(`${cap}.${key}`);
        } else {
          await pool.query(
            `INSERT INTO journey_steps (journey_id, name, step_number, capability_key, activity_key, contract, contract_sha256, contract_source, status, backbone_version)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'planned', '3.0')
             ON CONFLICT (journey_id, step_number) DO NOTHING`,
            [capRows[0].journey_id, a.name, Math.round(a.order), cap, key, JSON.stringify(a), sha, source]);
          out.inserted.push(`${cap}.${key}`);
        }
      }
    }
    for (const r of capRows) {
      if (r.status !== 'deprecated' && !(r.activity_key in want)) {
        await pool.query(`UPDATE journey_steps SET status = 'deprecated', updated_at = NOW() WHERE id = $1`, [r.id]);
        out.deprecated.push(`${cap}.${r.activity_key}`);
      }
    }
  }
  return out;
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
    Cost: rich((c.model || []).length ? lines(c.model.map((m) => `${m.provider}/${m.model}: ${m.purpose}`)) : '不调大模型'),
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
  const dbId = await resolveDbId(pool, 'journey_steps');
  if (!dbId || !token) return null;
  const { rows } = await pool.query(
    `SELECT id, capability_key, activity_key, contract, contract_sha256, contract_source, promise, status, notion_id, notion_digest
       FROM journey_steps
      WHERE contract IS NOT NULL AND (notion_synced_at IS NULL OR updated_at > notion_synced_at)
      ORDER BY capability_key, step_number
      LIMIT 50`);
  if (rows.length === 0) return { created: 0, patched: 0, skipped: 0, failed: 0, cleared: 0 };
  const { added } = await ensureOpsDbProps(token, dbId, BACKBONE_DB_PROPS, { notionReq });
  if (added.length) console.log(`[backbone-contract-sync] Backbone Activities 补列: ${added.join(', ')}`);
  return pushRegisteredRows(pool, token, {
    table: 'journey_steps', dbId, rows, buildProps: buildBackboneActivityProps,
    notionReq, logSyncError, label: 'backbone_activity',
  });
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
      const r = await syncActivityContracts(pool, { fetchFn: opts.fetchFn, resolveToken: opts.resolveToken });
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
  let push;
  try {
    // 无 Notion 凭据（CI/测试环境）→ pushBackboneActivities 收到空 token 安静跳过，不每分钟刷失败日志
    const safeToken = () => { try { return getToken(); } catch { return null; } };
    const pushFn = opts.push ?? ((p) => pushBackboneActivities(p, opts.notionToken ?? safeToken()));
    push = await pushFn(pool);
  } catch (err) {
    console.warn(`[backbone-contract-sync] 推 Notion 失败（非阻断）: ${err.message}`);
    push = { error: err.message };
  }
  return { sync, push };
}
