/**
 * activity-contract-sync.test.js — 主干活动契约 git→Brain→Notion（决策 0834e2fb / 92f6226b，任务 2fdd5f12）
 *
 * 真身在 zenithjoy-workspace 仓 product-map/contracts/*.yaml；Brain journey_steps 只存只读副本（contract + 仓库哈希 + 正本链接）。
 * 钉：①哈希不变不拉 YAML ②变了才拉并按 (capability_key, activity_key) 写回 ③仓库删掉的活动标 deprecated
 * ④30min 自 gate ⑤同步连续失败超 2h 才告警且只告一次 ⑥Notion 属性只读标记 + 链回正本。
 */
import { describe, it, expect, vi } from 'vitest';
import yaml from 'js-yaml';
import { hash } from './fixtures/shared-activity-contracts.js';

vi.mock('../alerting.js', () => ({ raise: vi.fn(async () => {}) }));

import { raise } from '../alerting.js';
import {
  syncActivityContracts,
  runBackboneContractJob,
  buildBackboneActivityProps,
  CONTRACT_REPO,
  CHECK_INTERVAL_MS,
  DRIFT_ALERT_MS,
} from '../activity-contract-sync.js';

const HEAD = 'a'.repeat(40);
const YAML = `
version: 1
capability: keyword_acquisition
workflow: social-keyword-leadgen
name: 关键词获客
activities:
  - key: preflight
    name: 预检
    order: 1
    version: 1.0.0
    compatibility: backward
    owner: { department: line02 智能获客, agent: 获客采收员 }
    inputs: [{ type: Device, cardinality: one, fields: [serial] }]
    outputs: [{ type: Run, cardinality: one, effect: create, fields: [run_tag] }]
    preconditions: ["不在触达时窗"]
    postconditions: [{ probe: pf_lock_acquired, asserts: "本 run 持有设备锁" }]
    execution: { location: xian-m4, via: "crontab → harvest-cron.sh" }
    budget: { max_duration_s: 300, heartbeat_s: 60 }
    resources: { locks: ["device:<serial>"], limits: [] }
    idempotency: { dedupe_key: "Run.run_tag", on_duplicate: reject }
    failure:
      empty_ok: []
      retryable: ["lock_busy"]
      needs_human: { cases: ["device_offline"], alert: { channel: bark, object: "离线 → Bark" } }
      fatal: []
    side_effects: [{ kind: internal_write, target: 设备锁, description: "持锁期间独占手机" }]
    invokers: [code]
    steps:
      - { key: acquire_device_lock, name: 拿设备锁, order: 1, reads: [Device.serial], writes: [Device.lock_holder], check: "lock-acquire rc=0", implementation: { status: implemented, ref: "douyin-phone-adb:2131" }, uses_llm: false, on_fail: "retry:3", dod: { mode: checkpoint, readback: { type: metric, ref: metrics.lock_acquired, expect: { op: "==", value: 1 } } } }
      - { key: read_account_mark, name: 读账号标记, order: 2, reads: [Device.serial], writes: [], check: "我页抖音号 == sender_id", implementation: { status: missing, ref: "6b133a81" }, uses_llm: false, dod: { mode: hard, readback: { type: evidence, glob: "{tag}-acct.xml", match: "抖音号", expect: { op: ">=", value: 1 } } } }
  - key: discovery
    name: 发现
    order: 2
    version: 1.0.0
    compatibility: breaking
    owner: { department: line02 智能获客 }
    inputs: [{ type: Keyword, cardinality: many, fields: [word] }]
    outputs: [{ type: Video, cardinality: many, effect: create, fields: [video_id] }]
    preconditions: ["设备锁由本 run 持有"]
    postconditions: [{ probe: disc_candidates_persisted, asserts: "候选落库" }]
    execution: { location: phone, via: "harvest-keyword.sh" }
    budget: { max_duration_s: 600, heartbeat_s: 60 }
    resources: { locks: [], limits: [{ name: max_videos_per_word, value: 4 }] }
    idempotency: { dedupe_key: "Video.video_id", on_duplicate: skip }
    failure:
      empty_ok: ["no_cards"]
      retryable: []
      needs_human: { cases: [], alert: { channel: bark, object: "改版 → Bark" } }
      fatal: ["hash_mismatch"]
    side_effects: []
    invokers: [code, agent]
    model: [{ provider: openrouter, model: bytedance/ui-tars-1.5-7b, purpose: 视觉定位兜底 }]
    steps:
      - { key: open_search, name: 打开搜索, order: 1, reads: [Keyword.word], writes: [], check: "搜索框回读", implementation: { status: implemented, ref: "x" }, uses_llm: true, dod: { mode: checkpoint, readback: { type: metric, ref: metrics.search_opened } } }
    known_gaps: [{ gap: "现状在 delivery 才落库", task: 8bb3af55 }]
`;
const contract = yaml.load(YAML);
const activityHash = key => hash({...contract.activities.find(a=>a.key===key),from:'keyword_acquisition'});
const digestOf = () => {
  const activities=contract.activities.map(a=>({...a,from:'keyword_acquisition'}));
  return JSON.stringify({capabilities:{keyword_acquisition:{sha256:hash({...contract,activities}),activities:Object.fromEntries(activities.map(a=>[a.key,hash(a)]))}}});
};

/** 假 fetch：按 URL 回 head / contracts.json / YAML，记录调用 */
function fakeGithub({ digest, yaml = YAML, fail = false }) {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (fail) return { ok: false, status: 502, text: async () => 'bad gateway' };
    if (url.includes('/commits/main')) return { ok: true, status: 200, text: async () => HEAD };
    if (url.includes('generated/contracts.json')) return { ok: true, status: 200, text: async () => digest };
    if (url.includes('contracts/keyword_acquisition.yaml')) return { ok: true, status: 200, text: async () => yaml };
    return { ok: false, status: 404, text: async () => '' };
  };
  return { fetchFn, calls };
}

/** 假 pool：journey_steps 行 + working_memory，按 SQL 文本路由 */
/** syncSteps 的 INSERT/UPDATE 参数顺序固定：key 或 (activity_id, step_order, key, activity_key, mode, readback, ...)；按列名取，不靠位置猜。 */
function stepRow(text, params) {
  const cols = {};
  const insert = text.match(/INSERT INTO steps\s*\(([^)]*)\)/);
  if (insert) insert[1].split(',').map((c) => c.trim()).forEach((c, i) => { cols[c] = params[i]; });
  else for (const m of text.matchAll(/(\w+)\s*=\s*(?:COALESCE\()?\$(\d+)/g)) cols[m[1]] = params[Number(m[2]) - 1];
  if (!insert) cols.key = params[0];
  for (const k of ['readback', 'inputs', 'outputs']) if (typeof cols[k] === 'string') cols[k] = JSON.parse(cols[k]);
  return cols;
}
function fakePool(stepRows = [], memory = {}) {
  const queries = [];
  const rows = stepRows.map((r) => ({ ...r }));
  return {
    rows, memory, queries, steps: [],
    async connect() { return {query:this.query.bind(this),release(){}}; },
    async query(text, params = []) {
      queries.push({ text, params });
      if (/INSERT INTO (activity|workflow)_definition_versions/.test(text)) return {rows:[{id:'version'}]};
      if (/FROM activities\s+WHERE capability_key = \$1/.test(text)) return { rows: rows.filter((r) => r.capability_key === params[0] && r.activity_key).map((r) => ({ activity_key: r.activity_key, id: r.id })) };
      if (/SELECT id,key FROM steps WHERE activity_id/.test(text)) return { rows: this.steps.filter((x) => x.activity_id === params[0]).map((x) => ({ id: x.key, key: x.key })) };
      if (/SELECT activity_id, step_order, source_sha256 FROM steps WHERE key/.test(text)) {
        const found = this.steps.filter((x) => x.key === params[0]);
        return { rows: found, rowCount: found.length };
      }
      if (/^\s*INSERT INTO steps/.test(text)) { this.steps.push(stepRow(text, params)); return { rows: [], rowCount: 1 }; }
      if (/^\s*UPDATE steps/.test(text)) { Object.assign(this.steps.find((x) => x.key === params[0]), stepRow(text, params)); return { rows: [], rowCount: 1 }; }
      if (/FROM workflows/.test(text)) return {rows: rows.length ? [{id:'w',key:'workflow',capability_id:'J',source_repo:CONTRACT_REPO,source_path:'product-map/contracts/keyword_acquisition.yaml',source_capability:'keyword_acquisition',source_workflow:'social-keyword-leadgen'}] : []};
      if (/FROM working_memory/.test(text)) {
        const v = memory[params[0]];
        return { rows: v ? [{ value_json: v }] : [] };
      }
      if (/INSERT INTO working_memory/.test(text)) { memory[params[0]] = JSON.parse(params[1]); return { rows: [] }; }
      if (/FROM activities/.test(text) && /capability_key IS NOT NULL/.test(text)) return { rows: rows.map((r) => ({ ...r })) };
      if (/^\s*UPDATE activities SET name/.test(text)) {
        const r = rows.find((x) => x.id === params[0]);
        Object.assign(r, { name: params[1], contract: JSON.parse(params[2]), contract_sha256: params[3], contract_source: params[4] });
        return { rows: [] };
      }
      if (/^\s*UPDATE activities SET status\s*=\s*'deprecated'/.test(text)) {
        rows.find((x) => x.id === params[0]).status = 'deprecated';
        return { rows: [{id:params[0]}] };
      }
      if (/^\s*INSERT INTO activities/.test(text)) {
        rows.push({ id: `new-${params[4]}`, journey_id: params[0], name: params[1], step_number: params[2], capability_key: params[3], activity_key: params[4], contract: JSON.parse(params[5]), contract_sha256: params[6], contract_source: params[7], status: 'planned' });
        return { rows: [{id:`new-${params[4]}`}] };
      }
      return { rows: [] };
    },
  };
}
const seeded = () => [
  { id: 's1', journey_id: 'J', capability_key: 'keyword_acquisition', activity_key: 'preflight', contract_sha256: null, status: 'planned' },
  { id: 's2', journey_id: 'J', capability_key: 'keyword_acquisition', activity_key: 'discovery', contract_sha256: null, status: 'planned' },
  { id: 's9', journey_id: 'J', capability_key: 'keyword_acquisition', activity_key: 'retired_step', contract_sha256: 'x', status: 'planned' },
];
const deps = (gh) => ({ fetchFn: gh.fetchFn, resolveToken: async () => 'tok' });

describe('syncActivityContracts', () => {
  it('哈希变了 → 拉 YAML，按 activity_key 写契约+仓库哈希+正本链接（钉在 commit）', async () => {
    const gh = fakeGithub({ digest: digestOf({ preflight: 'p1', discovery: 'd1' }) });
    const pool = fakePool(seeded());
    const out = await syncActivityContracts(pool, deps(gh));
    expect(out.head_sha).toBe(HEAD);
    const pf = pool.rows.find((r) => r.id === 's1');
    expect(pf.contract.key).toBe('preflight');
    expect(pf.contract_sha256).toBe(activityHash('preflight'));
    expect(pf.contract_source).toBe(`https://github.com/${CONTRACT_REPO}/blob/${HEAD}/product-map/contracts/keyword_acquisition.yaml`);
    expect(out.updated.sort()).toEqual(['keyword_acquisition.discovery', 'keyword_acquisition.preflight']);
  });

  it('仓库已删的活动 → 标 deprecated，不删行', async () => {
    const gh = fakeGithub({ digest: digestOf({ preflight: 'p1', discovery: 'd1' }) });
    const pool = fakePool(seeded());
    const out = await syncActivityContracts(pool, deps(gh));
    expect(pool.rows.find((r) => r.id === 's9').status).toBe('deprecated');
    expect(out.deprecated).toEqual(['keyword_acquisition.retired_step']);
  });

  it('哈希全一致 → 仍校验同commit契约，定义不重复更新', async () => {
    const gh = fakeGithub({ digest: digestOf({ preflight: 'p1', discovery: 'd1' }) });
    const rows = seeded().filter((r) => r.id !== 's9');
    rows[0].contract_sha256 = activityHash('preflight'); rows[1].contract_sha256 = activityHash('discovery');
    const pool = fakePool(rows);
    const out = await syncActivityContracts(pool, deps(gh));
    expect(gh.calls.some((u) => u.includes('.yaml'))).toBe(true);
    expect(pool.queries.some((q) => /UPDATE activities SET name/.test(q.text))).toBe(false);
    expect(out.updated).toEqual([]);
  });

  it('仓库新增活动 → 按 order 插入同 journey 新行（backbone 3.0）', async () => {
    const gh = fakeGithub({ digest: digestOf({ preflight: 'p1', discovery: 'd1' }) });
    const pool = fakePool(seeded().filter((r) => r.activity_key === 'preflight'));
    const out = await syncActivityContracts(pool, deps(gh));
    const d = pool.rows.find((r) => r.activity_key === 'discovery');
    expect(d).toMatchObject({ journey_id: 'J', step_number: 2, contract_sha256: activityHash('discovery') });
    expect(out.inserted).toEqual(['keyword_acquisition.discovery']);
  });

  it('GitHub 失败 → 抛错（由 job 记滞后），不写库', async () => {
    const gh = fakeGithub({ digest: '{}', fail: true });
    const pool = fakePool(seeded());
    await expect(syncActivityContracts(pool, deps(gh))).rejects.toThrow(/502/);
    expect(pool.queries.some((q) => /UPDATE activities|INSERT INTO activities/.test(q.text))).toBe(false);
  });
});

describe('runBackboneContractJob', () => {
  const noPush = async () => null;

  it('生产同步按合同落 Step：读回取 dod.readback、模式取 dod.mode，名字/动作/进出/失败处理照合同，没声明的不编造', async () => {
    const gh = fakeGithub({ digest: digestOf({}) });
    const pool = fakePool(seeded());
    const now = Date.parse('2026-10-05T05:00:00Z');
    const r = await runBackboneContractJob(pool, { ...deps(gh), now, force: true, push: noPush });
    expect(r.sync.ok).toBe(true);
    const lock = pool.steps.find((x) => x.key === 'keyword_acquisition.preflight.acquire_device_lock');
    expect(lock).toMatchObject({
      mode: 'checkpoint', readback: { type: 'metric', ref: 'metrics.lock_acquired', expect: { op: '==', value: 1 } },
      name: '拿设备锁', action: 'douyin-phone-adb:2131', inputs: ['Device.serial'], outputs: ['Device.lock_holder'], on_fail: 'retry:3',
    });
    const mark = pool.steps.find((x) => x.key === 'keyword_acquisition.preflight.read_account_mark');
    expect(mark).toMatchObject({ mode: 'hard', readback: { type: 'evidence' } });
    expect(mark.on_fail ?? null).toBeNull();
  });

  it('合同里有 Step 没写读回：整轮同步拒绝（不写库），按滞后处理', async () => {
    const bad = YAML.replace(', dod: { mode: checkpoint, readback: { type: metric, ref: metrics.search_opened } }', '');
    const digestBad = () => {
      const c = yaml.load(bad); const acts = c.activities.map((a) => ({ ...a, from: 'keyword_acquisition' }));
      return JSON.stringify({ capabilities: { keyword_acquisition: { sha256: hash({ ...c, activities: acts }), activities: Object.fromEntries(acts.map((a) => [a.key, hash(a)])) } } });
    };
    const gh = fakeGithub({ digest: digestBad(), yaml: bad });
    const pool = fakePool(seeded());
    const r = await runBackboneContractJob(pool, { ...deps(gh), now: Date.parse('2026-10-05T05:00:00Z'), force: true, push: noPush });
    expect(r.sync.ok).toBe(false);
    expect(r.sync.error).toMatch(/step_readback_missing.*keyword_acquisition\.discovery\.open_search/);
    expect(pool.steps).toEqual([]);
  });

  it('30min 自 gate：上次检查未满间隔 → 不打 GitHub', async () => {
    const gh = fakeGithub({ digest: digestOf({}) });
    const now = Date.parse('2026-09-28T05:00:00Z');
    const pool = fakePool([], { activity_contract_sync: { checked_at: new Date(now - CHECK_INTERVAL_MS + 60_000).toISOString(), ok: true } });
    const r = await runBackboneContractJob(pool, { ...deps(gh), now, push: noPush });
    expect(r.sync).toMatchObject({ skipped: true });
    expect(gh.calls).toEqual([]);
  });

  it('同步连续失败未满 2h 不告警；满 2h 告 P1 一次，再失败不重复告', async () => {
    raise.mockClear();
    const gh = fakeGithub({ digest: '{}', fail: true });
    const t0 = Date.parse('2026-09-28T00:00:00Z');
    const pool = fakePool([]);
    await runBackboneContractJob(pool, { ...deps(gh), now: t0, force: true, push: noPush });
    expect(raise).not.toHaveBeenCalled();
    expect(pool.memory.activity_contract_sync).toMatchObject({ ok: false, lag_since: new Date(t0).toISOString() });
    await runBackboneContractJob(pool, { ...deps(gh), now: t0 + DRIFT_ALERT_MS + 1, force: true, push: noPush });
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0][0]).toBe('P1');
    await runBackboneContractJob(pool, { ...deps(gh), now: t0 + DRIFT_ALERT_MS + 120_000, force: true, push: noPush });
    expect(raise).toHaveBeenCalledTimes(1);
  });

  it('恢复后清滞后状态', async () => {
    const gh = fakeGithub({ digest: digestOf({}) });
    const pool = fakePool([], { activity_contract_sync: { ok: false, lag_since: '2026-09-28T00:00:00.000Z', alerted: true } });
    await runBackboneContractJob(pool, { ...deps(gh), now: Date.parse('2026-09-28T05:00:00Z'), force: true, push: noPush });
    expect(pool.memory.activity_contract_sync).toMatchObject({ ok: true, lag_since: null, alerted: false, head_sha: HEAD });
  });

  it('推送失败不影响同步结果（各自吞错）', async () => {
    const gh = fakeGithub({ digest: digestOf({}) });
    const pool = fakePool([]);
    const r = await runBackboneContractJob(pool, { ...deps(gh), now: Date.now(), force: true, push: async () => { throw new Error('notion 429'); } });
    expect(r.sync.ok).toBe(true);
    expect(r.push).toMatchObject({ error: 'notion 429' });
  });

  it('正文写失败不影响属性推送与同步（各自吞错）', async () => {
    const gh = fakeGithub({ digest: digestOf({}) });
    const pool = fakePool([]);
    const r = await runBackboneContractJob(pool, { ...deps(gh), now: Date.now(), force: true, push: async () => ({ created: 8 }), body: async () => { throw new Error('notion 503'); } });
    expect(r.sync.ok).toBe(true);
    expect(r.push).toEqual({ created: 8 });
    expect(r.body).toMatchObject({ error: 'notion 503' });
  });
});

describe('buildBackboneActivityProps', () => {
  const doc = yaml.load(YAML);
  const row = (i, extra = {}) => ({
    id: 'x', capability_key: 'keyword_acquisition', activity_key: doc.activities[i].key, contract: doc.activities[i],
    contract_sha256: 'f'.repeat(64), contract_source: 'https://github.com/perfectuser21/zenithjoy-workspace/blob/abc/product-map/contracts/keyword_acquisition.yaml',
    promise: null, status: 'planned', ...extra,
  });

  it('只读标记：正本链接指向 git、契约哈希、Key=能力.活动', () => {
    const p = buildBackboneActivityProps(row(0, { promise: '中台显示可用小号数' }));
    expect(p['正本（只读·改请走 git）'].url).toMatch(/zenithjoy-workspace\/blob\/abc\//);
    expect(p['契约哈希'].rich_text[0].text.content).toBe('f'.repeat(12));
    expect(p.Key.rich_text[0].text.content).toBe('keyword_acquisition.preflight');
    expect(p['对外承诺'].rich_text[0].text.content).toBe('中台显示可用小号数');
    expect(p.Name.title[0].text.content).toBe('预检');
    expect(p.Order.number).toBe(1);
  });

  it('15 字段都落列：后置条件带探针、失败四类、步骤清单标未实现', () => {
    const p = buildBackboneActivityProps(row(0));
    const t = (k) => p[k].rich_text.map((x) => x.text.content).join('');
    expect(t('Postconditions')).toContain('pf_lock_acquired');
    expect(t('Failure')).toMatch(/正常为空[\s\S]*可重试: lock_busy[\s\S]*需人处理: device_offline → bark[\s\S]*致命/);
    expect(t('步骤清单')).toMatch(/1\. 拿设备锁（acquire_device_lock）/);
    expect(t('步骤清单')).toMatch(/读账号标记.*未实现/);
    expect(p['执行位置'].select.name).toBe('xian-m4');
    expect(p['Runs as'].select.name).toBe('Code');
    expect(t('Cost')).toBe('不调大模型');
    expect(p['Breaking?'].checkbox).toBe(false);
  });

  it('调大模型 → Cost 列出模型、Runs as=Hybrid、breaking 勾选、缺口进 Notes', () => {
    const p = buildBackboneActivityProps(row(1));
    const t = (k) => p[k].rich_text.map((x) => x.text.content).join('');
    expect(t('Cost')).toContain('openrouter/bytedance/ui-tars-1.5-7b');
    expect(p['Runs as'].select.name).toBe('Hybrid');
    expect(p['Breaking?'].checkbox).toBe(true);
    expect(t('Notes')).toContain('8bb3af55');
  });
});

// KR 专用投影独占创建这些活动，两个调度lane不可同时POST同一行。
describe('KR活动投影唯一写口', () => {
  it('通用活动推送从SQL选行时排除KR，不能在创建后才分流', async () => {
    const { pushBackboneActivities } = await import('../activity-contract-sync.js');
    const pool = { query: vi.fn().mockResolvedValueOnce({ rows: [{ notion_db_id: 'db' }] }).mockResolvedValueOnce({ rows: [] }) };
    const notionReq = vi.fn();
    await pushBackboneActivities(pool, 'token', { notionReq });
    expect(pool.query.mock.calls[1][0]).toContain("capability_key IS DISTINCT FROM 'company_kr_analysis'");
    expect(notionReq).not.toHaveBeenCalled();
  });
});

describe('活动模型信息',()=>{
  it('agent未固定模型时不能显示不调大模型',()=>{
    const properties=buildBackboneActivityProps({contract:{name:'分析',invokers:['agent']}});
    expect(properties.Cost.rich_text[0].text.content).toBe('调用大模型；实际型号见运行记录');
  });
});

describe('活动正文模型信息',()=>{
  it('正文与属性一致，未固定型号的agent仍标明调用大模型',async()=>{
    const {buildBackboneActivityBody}=await import('../activity-contract-sync.js');
    const blocks=buildBackboneActivityBody({contract:{name:'分析',invokers:['agent']}});
    expect(JSON.stringify(blocks)).toContain('调用大模型；实际型号见运行记录');
    expect(JSON.stringify(blocks)).not.toContain('不调大模型');
  });
});
