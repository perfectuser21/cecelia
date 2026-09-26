/**
 * scripts/sync-step-probes.mjs 单测（链 bf5088a3 棒2，任务 ddf3fe8d）：
 * 假 YAML（真 js-yaml 解析）+ 假 fetch，验证「读 YAML → upsert → 按 journey_cell 绑 assertion_ref」
 * 的流水线副作用写（决策 df1ccf5a），以及找不到格子时报错不静默。
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProbesYaml, parseCliArgs, syncStepProbes } from '../../../../scripts/sync-step-probes.mjs';
import { sourceSha256, specHash } from '../lib/step-probe-spec.js';

const JOURNEY = 'afa6abca-53c0-4815-8594-b7fb81ca547f';
const BRAIN = 'http://127.0.0.1:5221';
const CELL = {
  delivery: { id: '97947882-52d7-410d-a503-40c860b63750', cell_key: 'stage:delivery', cell_kind: 'element', assertion_ref: null },
  scoring: { id: '851295b4-f2d7-4d55-8301-68b11ebe2a4f', cell_key: 'stage:scoring', cell_kind: 'element', assertion_ref: 'probe:scoring.scored_all' },
};

const YAML_TEXT = `
version: 1
workflow: social-keyword-leadgen
probes:
  - key: delivery.leads_count
    stage: delivery
    journey_cell: "stage:delivery"
    probe:
      type: sql
      target: leadgen_db
      query: SELECT count(*) AS n FROM leads WHERE run_id = :run_id
    expect: { op: ">=", ref: metrics.expected_leads }
    severity: error
    note: 交付 lead 数不少于计划
  - key: delivery.no_dup
    stage: delivery
    journey_cell: "stage:delivery"
    probe:
      type: sql
      target: leadgen_db
      query: SELECT count(*) - count(DISTINCT phone) AS dup FROM leads WHERE run_id = :run_id
    expect: { op: "==", value: 0 }
    severity: warn
  - key: scoring.scored_all
    stage: scoring
    journey_cell: "stage:scoring"
    probe:
      type: http
      target: feishu_jinuo
      url: https://open.feishu.cn/open-apis/bitable/v1/apps/GNuwbzY0da8GP0sv6MGcOTu9ntd/tables/tblmrJTyVgzTj89P/records
      filter:
        运行批次: "$RUN_TAG"
        处理状态: "待分拣"
      reduce: count
    expect: { op: "<=", value: 0 }
    severity: warn
`;

function writeYaml(text = YAML_TEXT) {
  const dir = mkdtempSync(join(tmpdir(), 'step-probes-'));
  const file = join(dir, 'social-keyword-leadgen.yaml');
  writeFileSync(file, text);
  return file;
}

/** 假 Brain：记录请求，按 URL 回应。cells 可注入。 */
function fakeBrain({ cells = Object.values(CELL), upsertStatus = 200, driftBody = null } = {}) {
  const calls = [];
  const fetchFn = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url: String(url), body, headers: init.headers || {} });
    const ok = (json, status = 200) => ({ ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json) });
    if (method === 'GET' && url.includes('/api/brain/journey_step_links')) return ok(cells);
    if (method === 'POST' && url.endsWith('/api/brain/step-probes/drift-check')) return ok(driftBody ?? { drift: false, missing: [], extra: [], changed: [], same: body.probes.map(p => p.key) });
    if (method === 'POST' && url.endsWith('/api/brain/step-probes')) {
      if (upsertStatus !== 200) return ok({ error: { code: 'BOOM' } }, upsertStatus);
      return ok({ upserted: body.probes.map(p => ({ probe_key: p.key, id: `id-${p.key}`, action: 'inserted' })) });
    }
    if (method === 'PATCH' && url.includes('/api/brain/journey_step_links/')) return ok({ id: url.split('/').pop(), assertion_ref: body.assertion_ref });
    return ok({ error: `unexpected ${method} ${url}` }, 404);
  });
  return { fetchFn, calls };
}

describe('parseCliArgs', () => {
  it('YAML 路径 + --journey-id 必填；--brain-url/--check/--token 可选', () => {
    expect(parseCliArgs(['a.yaml', '--journey-id', JOURNEY])).toEqual({
      yamlPath: 'a.yaml', journeyId: JOURNEY, brainUrl: 'http://localhost:5221', check: false, token: undefined,
    });
    expect(parseCliArgs(['a.yaml', '--journey-id', JOURNEY, '--brain-url', BRAIN, '--check', '--token', 't'])).toMatchObject({
      brainUrl: BRAIN, check: true, token: 't',
    });
    expect(() => parseCliArgs(['--journey-id', JOURNEY])).toThrow(/YAML/);
    expect(() => parseCliArgs(['a.yaml'])).toThrow(/--journey-id/);
    expect(() => parseCliArgs(['a.yaml', '--journey-id', 'not-a-uuid'])).toThrow(/--journey-id/);
  });
});

describe('loadProbesYaml', () => {
  it('真 YAML 解析 → 归一化探针 + spec_hash + 文件级 source_sha256（原文 sha256，同 probes-lib）', () => {
    const file = writeYaml();
    const doc = loadProbesYaml(file);
    expect(doc.workflow).toBe('social-keyword-leadgen');
    expect(doc.probes.map(p => p.spec.key)).toEqual(['delivery.leads_count', 'delivery.no_dup', 'scoring.scored_all']);
    expect(doc.probes[0].spec_hash).toBe(specHash(doc.probes[0].spec));
    expect(doc.source_sha256).toBe(sourceSha256(readFileSync(file, 'utf8')));
    expect(doc.probes[2].spec.probe).toMatchObject({ type: 'http', filter: { 运行批次: '$RUN_TAG', 处理状态: '待分拣' }, reduce: 'count' });
  });

  it('YAML 里 spec 非法 → 抛 STEP_PROBE_* 错误，不吞', () => {
    const file = writeYaml(YAML_TEXT.replace('severity: warn', 'severity: fatal'));
    expect(() => loadProbesYaml(file)).toThrow(expect.objectContaining({ code: 'STEP_PROBE_SEVERITY_INVALID' }));
  });
});

describe('syncStepProbes', () => {
  it('全链：GET cells → POST upsert（带 journey_step_link_id）→ 每格 PATCH assertion_ref=probe:<keys>', async () => {
    const doc = loadProbesYaml(writeYaml());
    const { fetchFn, calls } = fakeBrain();
    const result = await syncStepProbes({ doc, journeyId: JOURNEY, sourcePath: 'services/phone-adb-controller/checks/social-keyword-leadgen.yaml', brainUrl: BRAIN, fetchFn, token: 'tok' });

    const get = calls.find(c => c.method === 'GET');
    expect(get.url).toBe(`${BRAIN}/api/brain/journey_step_links?journey_id=${JOURNEY}&cells=1&limit=500`);

    const upsert = calls.find(c => c.method === 'POST' && c.url.endsWith('/step-probes'));
    expect(upsert.headers['X-Internal-Token']).toBe('tok');
    expect(upsert.body.workflow).toBe('social-keyword-leadgen');
    expect(upsert.body.source_path).toBe('services/phone-adb-controller/checks/social-keyword-leadgen.yaml');
    expect(upsert.body.source_sha256).toBe(doc.source_sha256);
    expect(upsert.body.probes.map(p => [p.key, p.journey_step_link_id])).toEqual([
      ['delivery.leads_count', CELL.delivery.id],
      ['delivery.no_dup', CELL.delivery.id],
      ['scoring.scored_all', CELL.scoring.id],
    ]);

    const patches = calls.filter(c => c.method === 'PATCH');
    // delivery 两条探针合成一个 ref；scoring 已是同值 → 不重复 PATCH（避免无谓 bump assertion_revision）
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toBe(`${BRAIN}/api/brain/journey_step_links/${CELL.delivery.id}`);
    expect(patches[0].body).toEqual({ assertion_ref: 'probe:delivery.leads_count,delivery.no_dup' });

    expect(result.bound).toEqual([
      { cell_key: 'stage:delivery', journey_step_link_id: CELL.delivery.id, assertion_ref: 'probe:delivery.leads_count,delivery.no_dup', changed: true },
      { cell_key: 'stage:scoring', journey_step_link_id: CELL.scoring.id, assertion_ref: 'probe:scoring.scored_all', changed: false },
    ]);
    expect(result.upserted).toHaveLength(3);
  });

  it('journey 下找不到某个 journey_cell → 抛错列出缺的格子，且不写任何东西', async () => {
    const doc = loadProbesYaml(writeYaml());
    const { fetchFn, calls } = fakeBrain({ cells: [CELL.delivery] });
    await expect(syncStepProbes({ doc, journeyId: JOURNEY, brainUrl: BRAIN, fetchFn }))
      .rejects.toMatchObject({ code: 'STEP_PROBE_CELL_NOT_FOUND', message: expect.stringContaining('stage:scoring') });
    expect(calls.filter(c => c.method !== 'GET')).toEqual([]);
  });

  it('upsert 被 Brain 拒（非 2xx）→ 抛错带状态码，不去 PATCH 格子', async () => {
    const doc = loadProbesYaml(writeYaml());
    const { fetchFn, calls } = fakeBrain({ upsertStatus: 400 });
    await expect(syncStepProbes({ doc, journeyId: JOURNEY, brainUrl: BRAIN, fetchFn }))
      .rejects.toMatchObject({ code: 'STEP_PROBE_SYNC_HTTP', message: expect.stringContaining('400') });
    expect(calls.filter(c => c.method === 'PATCH')).toEqual([]);
  });

  it('--check：只做漂移比对（POST drift-check），不 upsert 不 PATCH', async () => {
    const doc = loadProbesYaml(writeYaml());
    const { fetchFn, calls } = fakeBrain({ driftBody: { drift: true, missing: ['delivery.no_dup'], extra: [], changed: [], same: ['delivery.leads_count', 'scoring.scored_all'] } });
    const result = await syncStepProbes({ doc, journeyId: JOURNEY, brainUrl: BRAIN, fetchFn, check: true });
    expect(result).toMatchObject({ check: true, drift: true, missing: ['delivery.no_dup'] });
    const check = calls.find(c => c.url.endsWith('/drift-check'));
    expect(check.body).toEqual({
      workflow: 'social-keyword-leadgen',
      source_sha256: doc.source_sha256,
      probes: doc.probes.map(p => ({ key: p.spec.key, spec_hash: p.spec_hash })),
    });
    expect(calls.filter(c => c.method === 'PATCH' || c.url.endsWith('/step-probes'))).toEqual([]);
  });
});
