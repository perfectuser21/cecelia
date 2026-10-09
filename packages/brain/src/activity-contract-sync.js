/**
 * activity-contract-sync.js — 主干活动契约 git→Brain→Notion（决策 0834e2fb / 92f6226b，任务 2fdd5f12）
 *
 * 真身：zenithjoy-workspace 仓 product-map/contracts/<能力>.yaml（CI 组装闸守，product-map/generated/contracts.json 带每活动 sha256）。
 * Brain：journey_steps（视图 backbone_activities）存只读副本 —— contract 原文 + 仓库活动哈希 + 钉在 commit 的正本链接。
 * Notion：Activity 库的列与页面正文都归六层目录投影写（projection/directory-*.js、activity-body.js）；本模块不写 Notion。
 *
 * scheduler job backbone-contract-sync：60s 一轮调用，同步段 30min 自 gate（只读 GitHub API，us-vps 零执行不受影响）；
 * 按显式登记工作流加载同commit所有契约与ref，验证digest后定义+使用关系单事务同步；无消费者旧活动标 deprecated。
 * 同步连续失败超 2h（副本落后真身）告 P1 一次，恢复即清。
 */
import { validateImplementationBindings } from './lib/implementation-bindings.js';
import { loadActivityContracts } from './lib/activity-contract-loader.js';
import { storeActivityContracts, REGISTRATIONS_SQL } from './lib/activity-contract-store.js';
import { raise } from './alerting.js';
import { resolveGitHubToken } from './harness-credentials.js';

export const CONTRACT_REPO = 'perfectuser21/zenithjoy-workspace';
export const CONTRACTS_DIGEST_PATH = 'product-map/generated/contracts.json';
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
export const DRIFT_ALERT_MS = 2 * 60 * 60 * 1000;
const STATE_KEY = 'activity_contract_sync';
const HTTP_TIMEOUT_MS = 15_000;

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
 * scheduler-jobs handler。同步段 30min 自 gate（force 跳过）。Notion（列与页面正文）全归六层目录投影，本 job 不写 Notion。
 * @param {object} [opts] 测试注入：fetchFn / resolveToken / now / force
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
  return { sync };
}
