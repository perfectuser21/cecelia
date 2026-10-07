/** runs → Notion「最近执行」投影：属性构造（纯函数）+ 库未登记时安静跳过。全程注入假 notionReq，绝不碰真 Notion。 */
import { describe, it, expect, vi } from 'vitest';
import { buildRunProps, runRunsNotionPush, RUNS_DB_PROPS, IN_WINDOW_SQL } from '../runs-notion-projection.js';

const COLUMNS = ['Brain ID', '任务', '执行者', '开始时间', '摘要', '来源', '结果', '耗时（秒）', '错误'];

const openclawFail = {
  id: 'u1', run_id: 'openclaw:abc', trigger_kind: 'schedule', trigger_ref: '每日简报',
  executor_id: 'openclaw:main', started_at: new Date('2026-10-05T01:02:03.000Z'),
  duration_ms: 12345, outcome: 'fail', error: '炸了'.repeat(1000),
  detail: { source: 'openclaw', summary: '摘'.repeat(3000) },
};
const brainPass = {
  id: 'u2', run_id: 'brain:xyz', trigger_kind: 'schedule', trigger_ref: 'tick-loop',
  executor_id: 'brain-scheduler', started_at: '2026-10-06T00:00:00.000Z',
  duration_ms: null, outcome: 'pass', error: null, detail: {},
};

describe('buildRunProps', () => {
  it('OpenClaw 失败行：结果/来源/耗时换算，摘要与错误截到 1900', () => {
    const p = buildRunProps(openclawFail);
    expect(Object.keys(p).sort()).toEqual([...COLUMNS].sort());
    expect(p['任务']).toEqual({ title: [{ text: { content: '每日简报' } }] });
    expect(p['开始时间']).toEqual({ date: { start: '2026-10-05T01:02:03.000Z' } });
    expect(p['结果']).toEqual({ select: { name: '失败' } });
    expect(p['耗时（秒）']).toEqual({ number: 12.3 });
    expect(p['执行者']).toEqual({ rich_text: [{ text: { content: 'openclaw:main' } }] });
    expect(p['来源']).toEqual({ select: { name: 'OpenClaw' } });
    expect(p['摘要'].rich_text[0].text.content).toHaveLength(1900);
    expect(p['错误'].rich_text[0].text.content).toHaveLength(1900);
    expect(p['Brain ID']).toEqual({ rich_text: [{ text: { content: 'openclaw:abc' } }] });
  });

  it('Brain 内部 pass 行：耗时 null 保持 null，空摘要/错误给空 rich_text，来源=Brain', () => {
    const p = buildRunProps(brainPass);
    expect(p['结果']).toEqual({ select: { name: '成功' } });
    expect(p['耗时（秒）']).toEqual({ number: null });
    expect(p['来源']).toEqual({ select: { name: 'Brain' } });
    expect(p['摘要']).toEqual({ rich_text: [] });
    expect(p['错误']).toEqual({ rich_text: [] });
    expect(p['开始时间']).toEqual({ date: { start: '2026-10-06T00:00:00.000Z' } });
  });

  it('结果与来源映射表', () => {
    const o = (outcome) => buildRunProps({ ...brainPass, outcome })['结果'].select.name;
    expect([o('timeout'), o('running'), o('skipped'), o('unknown'), o('weird')]).toEqual(['超时', '运行中', '跳过', '未知', '未知']);
    expect(buildRunProps({ ...brainPass, trigger_kind: 'external' })['来源'].select.name).toBe('外部上报');
    expect(buildRunProps({ ...brainPass, run_id: 'openclaw:1', trigger_kind: 'external' })['来源'].select.name).toBe('OpenClaw');
  });

  it('trigger_ref 缺失时标题回退 run_id', () => {
    expect(buildRunProps({ ...brainPass, trigger_ref: null })['任务'].title[0].text.content).toBe('brain:xyz');
  });
});

describe('RUNS_DB_PROPS / IN_WINDOW_SQL', () => {
  it('9 列齐全，select 选项写全', () => {
    expect(Object.keys(RUNS_DB_PROPS).sort()).toEqual([...COLUMNS].sort());
    expect(RUNS_DB_PROPS['任务']).toEqual({ title: {} });
    expect(RUNS_DB_PROPS['结果'].select.options.map((o) => o.name)).toEqual(['成功', '失败', '超时', '运行中', '跳过', '未知']);
    expect(RUNS_DB_PROPS['来源'].select.options.map((o) => o.name)).toEqual(['OpenClaw', 'Brain', '外部上报']);
  });
  it('窗口 SQL 含 7 天与 30 天两档', () => {
    expect(IN_WINDOW_SQL).toContain("interval '7 days'");
    expect(IN_WINDOW_SQL).toContain("interval '30 days'");
  });
});

describe('runRunsNotionPush', () => {
  it('库未注册（projection_map 无 active 行）→ skipped，不调 Notion、不读 runs', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const notionReq = vi.fn();
    const r = await runRunsNotionPush({ query }, { notionReq });
    expect(r).toEqual({ skipped: 'db_not_registered' });
    expect(notionReq).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('库已注册但缺 NOTION_API_KEY → skipped no_token，不调 Notion', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ notion_db_id: 'db1' }] });
    const notionReq = vi.fn();
    const r = await runRunsNotionPush({ query }, { notionReq, getToken: () => { throw new Error('NOTION_API_KEY 未配置'); } });
    expect(r).toEqual({ skipped: 'no_token' });
    expect(notionReq).not.toHaveBeenCalled();
  });
});
