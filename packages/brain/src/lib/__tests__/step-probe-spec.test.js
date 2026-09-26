import { describe, expect, it } from 'vitest';
import {
  canonicalJson, compareProbeHashes, groupProbesByCell, normalizeProbe,
  parseProbeRef, parseProbesDocument, probeRef, sourceSha256, specHash,
} from '../step-probe-spec.js';

const HEX64 = /^[0-9a-f]{64}$/;
const WORKFLOW = 'social-keyword-leadgen';

function rawProbe(overrides = {}) {
  return {
    key: 'delivery.leads_count',
    stage: 'delivery',
    journey_cell: 'stage:delivery',
    probe: { type: 'sql', target: 'leadgen_db', query: 'SELECT count(*) AS n FROM leads WHERE run_id = :run_id' },
    expect: { op: '>=', ref: 'metrics.expected_leads' },
    severity: 'error',
    note: '交付的 lead 数不少于计划数',
    ...overrides,
  };
}

describe('canonicalJson / specHash', () => {
  it('键序无关：同内容不同键序哈希相同', () => {
    const a = { b: 1, a: { d: [1, 2], c: 'x' } };
    const b = { a: { c: 'x', d: [1, 2] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(specHash(a)).toBe(specHash(b));
    expect(specHash(a)).toMatch(HEX64);
  });

  it('数组顺序参与哈希（顺序是语义）', () => {
    expect(specHash({ a: [1, 2] })).not.toBe(specHash({ a: [2, 1] }));
  });

  it('改一个字节哈希即变', () => {
    const spec = normalizeProbe(rawProbe(), { workflow: WORKFLOW });
    const changed = normalizeProbe(rawProbe({ expect: { op: '>=', value: 1 } }), { workflow: WORKFLOW });
    expect(specHash(spec)).not.toBe(specHash(changed));
  });
});

describe('normalizeProbe', () => {
  it('合法 sql 探针 → 归一化 spec（含 workflow，字段固定）', () => {
    const spec = normalizeProbe(rawProbe(), { workflow: WORKFLOW });
    expect(spec).toEqual({
      key: 'delivery.leads_count',
      workflow: WORKFLOW,
      stage: 'delivery',
      journey_cell: 'stage:delivery',
      probe: { type: 'sql', target: 'leadgen_db', query: 'SELECT count(*) AS n FROM leads WHERE run_id = :run_id' },
      expect: { op: '>=', ref: 'metrics.expected_leads' },
      severity: 'error',
      note: '交付的 lead 数不少于计划数',
    });
  });

  it('合法 http 探针（workspace checks/schema.json 形状）：url+filter+reduce 必填，minus 可选且原样保留', () => {
    const url = 'https://open.feishu.cn/open-apis/bitable/v1/apps/GNuwbzY0da8GP0sv6MGcOTu9ntd/tables/tbleP4LgzkcwAhiZ/records';
    const minusUrl = 'https://open.feishu.cn/open-apis/bitable/v1/apps/GNuwbzY0da8GP0sv6MGcOTu9ntd/tables/tblmrJTyVgzTj89P/records';
    const spec = normalizeProbe(rawProbe({
      key: 'effective_count',
      stage: 'scoring',
      journey_cell: 'stage:scoring',
      probe: {
        type: 'http', target: 'feishu_jinuo', url,
        filter: { '抖音获客-关键词配置': '$WORD' },
        reduce: 'field:有效线索数',
        minus: { url: minusUrl, filter: { 命中关键词: '$WORD', 进入最终线索: true }, reduce: 'count' },
      },
      expect: { op: '==', value: 0 },
      severity: 'warn',
    }), { workflow: WORKFLOW });
    expect(spec.probe).toEqual({
      type: 'http', target: 'feishu_jinuo', url,
      filter: { '抖音获客-关键词配置': '$WORD' },
      reduce: 'field:有效线索数',
      minus: { url: minusUrl, filter: { 命中关键词: '$WORD', 进入最终线索: true }, reduce: 'count' },
    });
    expect(spec.expect).toEqual({ op: '==', value: 0 });
  });

  it('http 探针无 minus 时 spec.probe 不带 minus 键（哈希稳定）', () => {
    const spec = normalizeProbe(rawProbe({
      key: 'comments_readback',
      probe: { type: 'http', target: 'feishu_jinuo', url: 'https://open.feishu.cn/x/records', filter: { 运行批次: '$RUN_TAG' }, reduce: 'count' },
      expect: { op: '>=', ref: 'metrics.leads_written' },
    }), { workflow: WORKFLOW });
    expect(spec.probe).toEqual({ type: 'http', target: 'feishu_jinuo', url: 'https://open.feishu.cn/x/records', filter: { 运行批次: '$RUN_TAG' }, reduce: 'count' });
    expect(Object.keys(spec.probe)).not.toContain('minus');
  });

  it('not_null_all 不带 value/ref', () => {
    const spec = normalizeProbe(rawProbe({
      key: 'collection.fields_filled',
      stage: 'collection',
      journey_cell: 'stage:collection',
      expect: { op: 'not_null_all' },
      severity: 'warn',
    }), { workflow: WORKFLOW });
    expect(spec.expect).toEqual({ op: 'not_null_all' });
    expect(spec.severity).toBe('warn');
  });

  it('不把调用方私货（journey_step_link_id 等未知字段）带进 spec', () => {
    const spec = normalizeProbe(rawProbe({ journey_step_link_id: 'abc', extra: 1 }), { workflow: WORKFLOW });
    expect(spec).not.toHaveProperty('journey_step_link_id');
    expect(spec).not.toHaveProperty('extra');
  });

  it.each([
    ['key 非法字符', rawProbe({ key: 'delivery count' }), 'STEP_PROBE_KEY_INVALID'],
    ['key 缺失', rawProbe({ key: undefined }), 'STEP_PROBE_KEY_INVALID'],
    ['journey_cell 与 stage 不一致', rawProbe({ journey_cell: 'stage:scoring' }), 'STEP_PROBE_CELL_MISMATCH'],
    ['journey_cell 不是 stage:<name> 形状', rawProbe({ journey_cell: 'delivery' }), 'STEP_PROBE_CELL_MISMATCH'],
    ['probe.type 未知', rawProbe({ probe: { type: 'shell', target: 'x', query: 'rm -rf /' } }), 'STEP_PROBE_TYPE_INVALID'],
    ['sql 缺 query', rawProbe({ probe: { type: 'sql', target: 'db' } }), 'STEP_PROBE_TARGET_INVALID'],
    ['sql 带 url', rawProbe({ probe: { type: 'sql', target: 'db', query: 'select 1', url: 'http://x' } }), 'STEP_PROBE_TARGET_INVALID'],
    ['http 缺 url', rawProbe({ probe: { type: 'http', target: 'crm', filter: { a: 1 }, reduce: 'count' } }), 'STEP_PROBE_TARGET_INVALID'],
    ['http url 非 http(s)', rawProbe({ probe: { type: 'http', target: 'crm', url: 'file:///etc/passwd', filter: { a: 1 }, reduce: 'count' } }), 'STEP_PROBE_TARGET_INVALID'],
    ['http 缺 filter', rawProbe({ probe: { type: 'http', target: 'crm', url: 'https://x/records', reduce: 'count' } }), 'STEP_PROBE_TARGET_INVALID'],
    ['http filter 为空对象', rawProbe({ probe: { type: 'http', target: 'crm', url: 'https://x/records', filter: {}, reduce: 'count' } }), 'STEP_PROBE_TARGET_INVALID'],
    ['http filter 值非标量', rawProbe({ probe: { type: 'http', target: 'crm', url: 'https://x/records', filter: { a: { b: 1 } }, reduce: 'count' } }), 'STEP_PROBE_TARGET_INVALID'],
    ['http reduce 不是 count|field:<列>', rawProbe({ probe: { type: 'http', target: 'crm', url: 'https://x/records', filter: { a: 1 }, reduce: 'sum' } }), 'STEP_PROBE_TARGET_INVALID'],
    ['http minus 缺 reduce', rawProbe({ probe: { type: 'http', target: 'crm', url: 'https://x/records', filter: { a: 1 }, reduce: 'count', minus: { url: 'https://y/records', filter: { b: 2 } } } }), 'STEP_PROBE_TARGET_INVALID'],
    ['http 带未知键', rawProbe({ probe: { type: 'http', target: 'crm', url: 'https://x/records', filter: { a: 1 }, reduce: 'count', headers: {} } }), 'STEP_PROBE_TARGET_INVALID'],
    ['sql 带 filter（未知键）', rawProbe({ probe: { type: 'sql', target: 'db', query: 'select 1', filter: { a: 1 } } }), 'STEP_PROBE_TARGET_INVALID'],
    ['expect.op 未知', rawProbe({ expect: { op: '!=', value: 1 } }), 'STEP_PROBE_EXPECT_INVALID'],
    ['比较 op 同时带 value 和 ref', rawProbe({ expect: { op: '>=', value: 1, ref: 'metrics.x' } }), 'STEP_PROBE_EXPECT_INVALID'],
    ['比较 op 既无 value 也无 ref', rawProbe({ expect: { op: '>=' } }), 'STEP_PROBE_EXPECT_INVALID'],
    ['ref 不是 metrics.<k>', rawProbe({ expect: { op: '>=', ref: 'env.SECRET' } }), 'STEP_PROBE_EXPECT_INVALID'],
    ['not_null_all 带 value', rawProbe({ expect: { op: 'not_null_all', value: 1 } }), 'STEP_PROBE_EXPECT_INVALID'],
    ['severity 未知', rawProbe({ severity: 'fatal' }), 'STEP_PROBE_SEVERITY_INVALID'],
    ['severity 缺失（不默认，防手滑）', rawProbe({ severity: undefined }), 'STEP_PROBE_SEVERITY_INVALID'],
    ['workflow 缺失', rawProbe(), 'STEP_PROBE_WORKFLOW_INVALID', {}],
  ])('拒收：%s', (_label, raw, code, opts = { workflow: WORKFLOW }) => {
    expect(() => normalizeProbe(raw, opts)).toThrow(expect.objectContaining({ code }));
  });
});

describe('parseProbesDocument', () => {
  const doc = {
    version: 1,
    workflow: WORKFLOW,
    probes: [
      rawProbe(),
      rawProbe({ key: 'delivery.no_dup', expect: { op: '==', value: 0 } }),
      rawProbe({ key: 'scoring.scored_all', stage: 'scoring', journey_cell: 'stage:scoring', expect: { op: 'not_null_all' } }),
    ],
  };

  it('整份 YAML 文档 → {version, workflow, probes[]}，每条已归一化且带 spec_hash', () => {
    const parsed = parseProbesDocument(doc);
    expect(parsed.version).toBe(1);
    expect(parsed.workflow).toBe(WORKFLOW);
    expect(parsed.probes).toHaveLength(3);
    for (const p of parsed.probes) {
      expect(p.spec.workflow).toBe(WORKFLOW);
      expect(p.spec_hash).toBe(specHash(p.spec));
    }
  });

  it('重复 key 报错，不静默覆盖', () => {
    expect(() => parseProbesDocument({ ...doc, probes: [rawProbe(), rawProbe()] }))
      .toThrow(expect.objectContaining({ code: 'STEP_PROBE_KEY_DUPLICATE' }));
  });

  it.each([
    ['probes 不是数组', { ...doc, probes: {} }, 'STEP_PROBE_DOC_INVALID'],
    ['workflow 缺失', { ...doc, workflow: '' }, 'STEP_PROBE_WORKFLOW_INVALID'],
    ['version 不是正整数', { ...doc, version: 'v1' }, 'STEP_PROBE_DOC_INVALID'],
    ['探针里的 workflow 与文档不一致', { ...doc, probes: [rawProbe({ workflow: 'other' })] }, 'STEP_PROBE_WORKFLOW_INVALID'],
  ])('拒收：%s', (_label, bad, code) => {
    expect(() => parseProbesDocument(bad)).toThrow(expect.objectContaining({ code }));
  });

  it('groupProbesByCell：同一格子多条探针聚在一起，保持 YAML 顺序', () => {
    const { probes } = parseProbesDocument(doc);
    const groups = groupProbesByCell(probes);
    expect([...groups.keys()]).toEqual(['stage:delivery', 'stage:scoring']);
    expect(groups.get('stage:delivery').map(p => p.spec.key)).toEqual(['delivery.leads_count', 'delivery.no_dup']);
  });
});

describe('sourceSha256（文件级哈希，与 workspace probes-lib loadChecks().sha256 同口径：原文 utf8 sha256）', () => {
  it('同文本同哈希；改一个字节即变；与逐条 spec_hash 无关', () => {
    const text = 'version: 1\nworkflow: w\nprobes: []\n';
    expect(sourceSha256(text)).toMatch(HEX64);
    expect(sourceSha256(text)).toBe(sourceSha256(text));
    expect(sourceSha256(`${text}# c\n`)).not.toBe(sourceSha256(text));
  });
});

describe('probeRef / parseProbeRef', () => {
  it('单 key 与多 key 往返', () => {
    expect(probeRef(['delivery.leads_count'])).toBe('probe:delivery.leads_count');
    expect(probeRef(['a', 'b.c'])).toBe('probe:a,b.c');
    expect(parseProbeRef('probe:delivery.leads_count')).toEqual({ keys: ['delivery.leads_count'] });
    expect(parseProbeRef('probe:a,b.c')).toEqual({ keys: ['a', 'b.c'] });
  });

  it.each(['probe:', 'probe:a,,b', 'probe:$(id)', 'probe:a b', 'tests/x.test.js', null, 'probe:a,a'])(
    '非法/非探针引用 → null: %s', (ref) => {
      expect(parseProbeRef(ref)).toBeNull();
    },
  );

  it('probeRef 拒绝非法 key', () => {
    expect(() => probeRef(['ok', 'bad key'])).toThrow(expect.objectContaining({ code: 'STEP_PROBE_KEY_INVALID' }));
    expect(() => probeRef([])).toThrow(expect.objectContaining({ code: 'STEP_PROBE_KEY_INVALID' }));
  });
});

describe('compareProbeHashes（漂移比对：仓库 YAML 是真身，库是投影）', () => {
  const yamlSide = [
    { key: 'a', spec_hash: '1'.repeat(64) },
    { key: 'b', spec_hash: '2'.repeat(64) },
    { key: 'c', spec_hash: '3'.repeat(64) },
  ];

  it('一致 → drift=false', () => {
    const rows = yamlSide.map(p => ({ probe_key: p.key, spec_hash: p.spec_hash, active: true }));
    expect(compareProbeHashes(rows, yamlSide)).toEqual({
      drift: false, missing: [], extra: [], changed: [], same: ['a', 'b', 'c'],
    });
  });

  it('库缺 / 库多 / 哈希不同 各归各类', () => {
    const rows = [
      { probe_key: 'a', spec_hash: '1'.repeat(64), active: true },
      { probe_key: 'b', spec_hash: '9'.repeat(64), active: true },
      { probe_key: 'z', spec_hash: '5'.repeat(64), active: true },
    ];
    expect(compareProbeHashes(rows, yamlSide)).toEqual({
      drift: true, missing: ['c'], extra: ['z'], changed: ['b'], same: ['a'],
    });
  });

  it('库里 active=false 的行不算库有（已下线）', () => {
    const rows = [
      { probe_key: 'a', spec_hash: '1'.repeat(64), active: true },
      { probe_key: 'b', spec_hash: '2'.repeat(64), active: false },
      { probe_key: 'c', spec_hash: '3'.repeat(64), active: true },
    ];
    expect(compareProbeHashes(rows, yamlSide)).toMatchObject({ drift: true, missing: ['b'], extra: [] });
  });
});
