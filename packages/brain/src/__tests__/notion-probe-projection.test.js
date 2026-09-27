/**
 * [BEHAVIOR] 验证层投影 notion-probe-projection（链 bf5088a3 棒4-2，任务 bf8d6ffb，决策 10a68212）。
 *
 * 三根血管：step_probes 全行 →「探针」库；journey_assertion_receipts 业务探针行 →「判定回执」库；
 * journey_step_links 格子行 → Backbone-Step Map（格子列 + 可更新）。
 * 血管注册制：库在 notion_projection_map 未登记为 push+active → 整段跳过；指纹相同不打 Notion。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNotionReq = vi.fn();
vi.mock('../recurring-notion-sync.js', () => ({
  notionReq: (...a) => mockNotionReq(...a),
  getToken: () => 'fake-token',
}));

const PROBE = {
  id: 'probe-row-1', probe_key: 'videos_readback', workflow: 'social-keyword-leadgen', stage: 'delivery',
  severity: 'warn', active: true, spec_hash: '7f88e04b'.padEnd(64, '0'),
  spec: {
    key: 'videos_readback', stage: 'delivery', journey_cell: 'stage:delivery',
    probe: { type: 'sql', target: 'pg_zenithjoy', query: 'SELECT count(*)\n  FROM zenithjoy.leadgen_videos\n WHERE harvest_batch = $RUN_TAG' },
    expect: { op: '>=', ref: 'metrics.videos_processed' }, severity: 'warn', note: '对账基准 videos_processed。\n',
  },
  cell_key: 'stage:delivery', journey_name: '客户智能获客路径',
  notion_id: null, notion_digest: null, updated_at: '2026-09-27T00:00:00Z',
};

const RECEIPT = {
  id: 'receipt-1', run_id: 'social-keyword-leadgen-crontab-auto09262230__a1.delivery',
  assertion_ref_snapshot: 'probe:videos_readback', verdict: 'FAIL',
  scenario_evidence: { op: '>=', reason: 'value_mismatch', expected: 7, observed: '6', severity: 'warn' },
  completed_at: '2026-09-27T00:35:05.197Z', cell_key: 'stage:delivery', journey_name: '客户智能获客路径',
  notion_id: null, notion_digest: null,
};

function makePool({ registered = [], probes = [], receipts = [] } = {}) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (/FROM notion_projection_map/.test(text)) {
        const table = params?.[0];
        return { rows: registered.includes(table) ? [{ notion_db_id: `db-${table}` }] : [] };
      }
      if (/FROM step_probes sp/.test(text)) return { rows: probes };
      if (/FROM journey_assertion_receipts r/.test(text)) return { rows: receipts };
      return { rows: [] };
    }),
  };
}

beforeEach(() => {
  mockNotionReq.mockReset();
  mockNotionReq.mockImplementation(async (token, p, method) => {
    if (method === 'GET') return { properties: { '探针键': { type: 'title' }, '名称': { type: 'title' } } };
    if (p === '/pages' && method === 'POST') return { id: 'notion-page-new' };
    return {};
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('buildStepProbeProps — 探针行渲染', () => {
  it('探针键/工作流/步骤/查什么/期望/严重级/启用/哈希前缀/关联格子/说明 全在', async () => {
    const { buildStepProbeProps } = await import('../notion-probe-projection.js');
    const p = buildStepProbeProps(PROBE);
    expect(p['探针键'].title[0].text.content).toBe('videos_readback');
    expect(p['工作流'].select.name).toBe('social-keyword-leadgen');
    expect(p['步骤'].select.name).toBe('delivery');
    const what = p['查什么'].rich_text[0].text.content;
    expect(what).toContain('sql@pg_zenithjoy');
    expect(what).toContain('SELECT count(*) FROM zenithjoy.leadgen_videos');
    expect(p['期望'].rich_text[0].text.content).toBe('>= metrics.videos_processed');
    expect(p['严重级'].select.name).toBe('warn');
    expect(p['启用'].checkbox).toBe(true);
    expect(p['哈希前缀'].rich_text[0].text.content).toBe('7f88e04b');
    expect(p['关联格子'].rich_text[0].text.content).toBe('客户智能获客路径 · stage:delivery');
    expect(p['说明'].rich_text[0].text.content).toBe('对账基准 videos_processed。');
  });

  it('期望 value 形态 / http 探针 / 未挂格子', async () => {
    const { buildStepProbeProps } = await import('../notion-probe-projection.js');
    const p = buildStepProbeProps({
      ...PROBE, active: false, cell_key: null, journey_name: null,
      spec: { ...PROBE.spec, probe: { type: 'http', target: 'feishu_jinuo', url: 'https://x/records', reduce: 'count' }, expect: { op: '<=', value: 0 } },
    });
    expect(p['查什么'].rich_text[0].text.content).toBe('http@feishu_jinuo → count: https://x/records');
    expect(p['期望'].rich_text[0].text.content).toBe('<= 0');
    expect(p['启用'].checkbox).toBe(false);
    expect(p['关联格子'].rich_text).toEqual([]);
  });
});

describe('buildProbeReceiptProps — 判定回执行渲染', () => {
  it('批次去 <workflow>-crontab- 前缀；路径名/步骤名/探针/读回/期望/判定/严重级/原因/时间', async () => {
    const { buildProbeReceiptProps, stripCrontabPrefix } = await import('../notion-probe-projection.js');
    expect(stripCrontabPrefix(RECEIPT.run_id)).toBe('auto09262230__a1.delivery');
    expect(stripCrontabPrefix('no-prefix-run')).toBe('no-prefix-run');
    const p = buildProbeReceiptProps(RECEIPT);
    expect(p['名称'].title[0].text.content).toBe('FAIL videos_readback · auto09262230__a1.delivery');
    expect(p['批次'].rich_text[0].text.content).toBe('auto09262230__a1.delivery');
    expect(p['路径名'].rich_text[0].text.content).toBe('客户智能获客路径');
    expect(p['步骤名'].rich_text[0].text.content).toBe('stage:delivery');
    expect(p['探针'].rich_text[0].text.content).toBe('videos_readback');
    expect(p['读回'].rich_text[0].text.content).toBe('6');
    expect(p['期望'].rich_text[0].text.content).toBe('7');
    expect(p['判定'].select.name).toBe('FAIL');
    expect(p['严重级'].select.name).toBe('warn');
    expect(p['原因'].rich_text[0].text.content).toBe('value_mismatch');
    expect(p['时间'].date.start).toBe('2026-09-27T00:35:05.197Z');
  });

  it('PASS 行无原因；not_null_all 期望为空不编造', async () => {
    const { buildProbeReceiptProps } = await import('../notion-probe-projection.js');
    const p = buildProbeReceiptProps({
      ...RECEIPT, verdict: 'PASS',
      scenario_evidence: { op: 'not_null_all', expected: null, observed: 'jinuo,jinuo', severity: 'warn' },
    });
    expect(p['判定'].select.name).toBe('PASS');
    expect(p['原因'].rich_text).toEqual([]);
    expect(p['期望'].rich_text).toEqual([]);
    expect(p['读回'].rich_text[0].text.content).toBe('jinuo,jinuo');
  });
});

describe('pushStepProbes / pushProbeReceipts — 注册表门 + 业务行过滤 + 指纹去重', () => {
  it('库未登记 → 不查表、不打 Notion', async () => {
    const { pushStepProbes, pushProbeReceipts } = await import('../notion-probe-projection.js');
    const pool = makePool({ registered: [] });
    expect(await pushStepProbes(pool, 'fake-token')).toBeNull();
    expect(await pushProbeReceipts(pool, 'fake-token')).toBeNull();
    expect(mockNotionReq).not.toHaveBeenCalled();
    expect(pool.calls.some((c) => /FROM step_probes|FROM journey_assertion_receipts/.test(c.sql))).toBe(false);
  });

  it('探针：登记后先补缺列，POST 建页到登记库并回写 notion_id/指纹', async () => {
    const { pushStepProbes } = await import('../notion-probe-projection.js');
    const pool = makePool({ registered: ['step_probes'], probes: [PROBE] });
    const stat = await pushStepProbes(pool, 'fake-token');
    expect(stat.created).toBe(1);
    const patchDb = mockNotionReq.mock.calls.find((c) => c[1] === '/databases/db-step_probes' && c[2] === 'PATCH');
    expect(Object.keys(patchDb[3].properties)).toEqual(expect.arrayContaining(['工作流', '哈希前缀', '关联格子']));
    expect(Object.keys(patchDb[3].properties)).not.toContain('探针键');
    const post = mockNotionReq.mock.calls.find((c) => c[1] === '/pages' && c[2] === 'POST');
    expect(post[3].parent.database_id).toBe('db-step_probes');
    const wb = pool.calls.find((c) => /UPDATE step_probes SET notion_id/.test(c.sql));
    expect(wb.params).toContain('notion-page-new');
  });

  it('探针 SELECT 走 updated_at 增量（新行或改过的行），LIMIT 50', async () => {
    const { pushStepProbes } = await import('../notion-probe-projection.js');
    const pool = makePool({ registered: ['step_probes'] });
    await pushStepProbes(pool, 'fake-token');
    const q = pool.calls.find((c) => /FROM step_probes sp/.test(c.sql)).sql;
    expect(q).toMatch(/sp\.notion_synced_at IS NULL OR sp\.updated_at > sp\.notion_synced_at/);
    expect(q).toMatch(/LIMIT 50/);
    expect(q).toMatch(/LEFT JOIN journey_step_links jsl/);
  });

  it('回执 SELECT 只捞 business_probe_runner 且 notion_synced_at IS NULL（行不可变，只增）', async () => {
    const { pushProbeReceipts } = await import('../notion-probe-projection.js');
    const pool = makePool({ registered: ['journey_assertion_receipts'] });
    await pushProbeReceipts(pool, 'fake-token');
    const q = pool.calls.find((c) => /FROM journey_assertion_receipts r/.test(c.sql)).sql;
    expect(q).toMatch(/r\.executor_kind = 'business_probe_runner'/);
    expect(q).toMatch(/r\.notion_synced_at IS NULL/);
    expect(q).not.toMatch(/brain_assertion_runner/);
  });

  it('指纹相同的已推行不打 Notion，只抬 synced', async () => {
    const { pushProbeReceipts, buildProbeReceiptProps } = await import('../notion-probe-projection.js');
    const { propsDigest } = await import('../lib/notion-projection-engine.js');
    const synced = { ...RECEIPT, notion_id: 'page-old', notion_digest: propsDigest(buildProbeReceiptProps(RECEIPT)) };
    const pool = makePool({ registered: ['journey_assertion_receipts'], receipts: [synced] });
    const stat = await pushProbeReceipts(pool, 'fake-token');
    expect(stat.skipped).toBe(1);
    expect(mockNotionReq.mock.calls.some((c) => c[1] === '/pages' || /^\/pages\//.test(c[1]))).toBe(false);
    expect(pool.calls.some((c) => /UPDATE journey_assertion_receipts SET notion_synced_at = NOW\(\)/.test(c.sql))).toBe(true);
  });

  it('runProbeReceipts 内容变了（digest 不同）→ PATCH 既有页而非新建', async () => {
    const { pushProbeReceipts } = await import('../notion-probe-projection.js');
    const pool = makePool({ registered: ['journey_assertion_receipts'], receipts: [{ ...RECEIPT, notion_id: 'page-old', notion_digest: 'stale' }] });
    const stat = await pushProbeReceipts(pool, 'fake-token');
    expect(stat.patched).toBe(1);
    expect(mockNotionReq).toHaveBeenCalledWith('fake-token', '/pages/page-old', 'PATCH', expect.objectContaining({ properties: expect.any(Object) }));
  });

  it('runProbeProjection：一根血管炸了不连坐另一根', async () => {
    const { runProbeProjection } = await import('../notion-probe-projection.js');
    const pool = makePool({ registered: ['step_probes', 'journey_assertion_receipts'], probes: [PROBE], receipts: [RECEIPT] });
    const inner = pool.query.getMockImplementation();
    pool.query.mockImplementation(async (sql, params) => {
      if (/FROM step_probes sp/.test(String(sql))) throw new Error('pg down');
      return inner(sql, params);
    });
    const out = await runProbeProjection(pool, { token: 'fake-token' });
    expect(out.step_probes.error).toContain('pg down');
    expect(out.probe_receipts.created).toBe(1);
  });
});

describe('buildStepLinkNotionProperties — 格子行 props（承诺地图翻色进 Notion）', () => {
  it('格子行：Name=journey — cell_key，CellKind/CellKey/CellStatus/AssertionRef + Journey 文本（AI Journey 库在回收站，不做 relation）', async () => {
    const { buildStepLinkNotionProperties } = await import('../notion-probe-projection.js');
    const p = buildStepLinkNotionProperties({
      journey_name: '客户智能获客路径', step_name: 'delivery', step_order: 4, status: 'planned',
      cell_kind: 'element', cell_key: 'stage:delivery', cell_status: 'pending',
      assertion_ref: 'probe:videos_readback,comments_readback', journey_notion_id: 'jn-1',
    }, { Order: { type: 'number' } });
    expect(p.Name.title[0].text.content).toBe('客户智能获客路径 — stage:delivery');
    expect(p.Status.select.name).toBe('planned');
    expect(p.Order.number).toBe(4);
    expect(p.CellKind.select.name).toBe('element');
    expect(p.CellKey.rich_text[0].text.content).toBe('stage:delivery');
    expect(p.CellStatus.select.name).toBe('pending');
    expect(p.AssertionRef.rich_text[0].text.content).toBe('probe:videos_readback,comments_readback');
    expect(p.Journey.rich_text[0].text.content).toBe('客户智能获客路径');
    expect('relation' in p.Journey).toBe(false); // AI Journey 358c… 在回收站，relation 建不了（09-27 实证 404）
    expect('Step' in p).toBe(false); // 库里没有 Step 列（09-27 实查），不能再发
  });

  it('旧连接行（无 cell_kind）：不带 Cell* 键；无 Order 列不发 Order；无 journey_name 不发 Journey', async () => {
    const { buildStepLinkNotionProperties } = await import('../notion-probe-projection.js');
    const p = buildStepLinkNotionProperties({ journey_name: 'J', step_name: 'S', step_order: 1, status: 'done' }, {});
    expect(p.Name.title[0].text.content).toBe('J — S');
    expect('CellStatus' in p).toBe(false);
    expect('Order' in p).toBe(false);
    expect(p.Journey.rich_text[0].text.content).toBe('J');
    const q = buildStepLinkNotionProperties({ journey_name: null, step_name: 'S', step_order: 1, status: 'done' }, {});
    expect('Journey' in q).toBe(false);
  });
});
