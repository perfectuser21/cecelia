/**
 * handoff.test.js — 方案B handoff 模块单测。
 * Spec: docs/superpowers/specs/2026-07-02-handoff-automation-design.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildHandoff, renderHandoffMarkdown, saveHandoff,
  getRecentHandoffs, formatHandoffsForPrompt,
  HANDOFF_SCHEMA_VERSION, BASELINE_DATA_SOURCES,
} from '../handoff.js';

const TASK_ID = '11111111-2222-3333-4444-555555555555';

describe('buildHandoff', () => {
  it('缺 task_id 抛错', () => {
    expect(() => buildHandoff({})).toThrow(/task_id/);
  });

  it('最小输入产完整 schema：默认值 + 基线 data_sources', () => {
    const h = buildHandoff({ task_id: TASK_ID });
    expect(h.schema_version).toBe(HANDOFF_SCHEMA_VERSION);
    expect(h.task_id).toBe(TASK_ID);
    expect(h.initiative_id).toBeNull();
    expect(h.journey_id).toBeNull();
    expect(h.verdict).toBeNull();
    expect(h.done).toEqual([]);
    expect(h.data_sources).toEqual(BASELINE_DATA_SOURCES);
    expect(h.artifacts).toEqual({ pr_urls: [], sprint_dir: null, branch: null, docs: [] });
    expect(new Date(h.created_at).toString()).not.toBe('Invalid Date');
  });

  it('截断：每组 >20 条截到 20，单条 >200 字截断加省略号', () => {
    const long = 'x'.repeat(300);
    const h = buildHandoff({ task_id: TASK_ID, done: Array.from({ length: 30 }, () => long) });
    expect(h.done).toHaveLength(20);
    expect(h.done[0].length).toBeLessThanOrEqual(201);
    expect(h.done[0].endsWith('…')).toBe(true);
  });

  it('过滤非字符串与空白项', () => {
    const h = buildHandoff({ task_id: TASK_ID, done: ['ok', '', '  ', null, 42] });
    expect(h.done).toEqual(['ok']);
  });
});

describe('renderHandoffMarkdown', () => {
  it('含全部关键段与字段', () => {
    const h = buildHandoff({
      task_id: TASK_ID, title: '测试任务', verdict: 'PASS',
      done: ['ws1 已合并'], not_done: ['ws2 未完成'], next_steps: ['加厚'],
      artifacts: { pr_urls: ['https://github.com/x/y/pull/1'], sprint_dir: 'sprints/x', branch: null, docs: [] },
    });
    const md = renderHandoffMarkdown(h);
    for (const t of ['# Handoff', '测试任务', 'PASS', '完成了什么', 'ws1 已合并', '没完成什么', 'ws2 未完成', '下一步', '加厚', '数据源', 'pull/1', 'sprints/x']) {
      expect(md).toContain(t);
    }
  });
});

describe('saveHandoff', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-test-'));
    process.env.HANDOFF_DOCS_DIR = tmpDir;
  });
  afterEach(() => {
    delete process.env.HANDOFF_DOCS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('先写 DB（jsonb 合并 UPDATE）再写 markdown 镜像', async () => {
    const pool = { query: vi.fn(async () => ({ rowCount: 1 })) };
    const h = buildHandoff({ task_id: TASK_ID, title: 't' });
    const r = await saveHandoff({ pool }, h);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/UPDATE tasks SET result = COALESCE\(result, '\{\}'::jsonb\) \|\| jsonb_build_object\('handoff', \$2::jsonb\)/);
    expect(params[0]).toBe(TASK_ID);
    expect(JSON.parse(params[1]).task_id).toBe(TASK_ID);
    expect(r.dbWritten).toBe(true);
    expect(r.mirrorPath).toMatch(new RegExp(`${TASK_ID.slice(0, 8)}\\.md$`));
    expect(fs.readFileSync(r.mirrorPath, 'utf8')).toContain('# Handoff');
  });

  it('DB 失败 → 抛错且不写镜像文件（防分裂态）', async () => {
    const pool = { query: vi.fn(async () => { throw new Error('db down'); }) };
    const h = buildHandoff({ task_id: TASK_ID });
    await expect(saveHandoff({ pool }, h)).rejects.toThrow('db down');
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  it('镜像写失败 → 不抛错，dbWritten 仍 true，mirrorPath=null', async () => {
    // 注：不能用 '\0' 注入（process.env 赋值会在 \0 处截断，mkdirSync 反而成功）；
    // 改用"父级是普通文件"让 mkdirSync 必抛 ENOTDIR。
    const blocker = path.join(tmpDir, 'blocker');
    fs.writeFileSync(blocker, '');
    process.env.HANDOFF_DOCS_DIR = path.join(blocker, 'sub');
    const pool = { query: vi.fn(async () => ({ rowCount: 1 })) };
    const r = await saveHandoff({ pool }, buildHandoff({ task_id: TASK_ID }));
    expect(r.dbWritten).toBe(true);
    expect(r.mirrorPath).toBeNull();
  });
});

describe('getRecentHandoffs', () => {
  it('无 journeyId 直接返回空数组不查库', async () => {
    const pool = { query: vi.fn() };
    expect(await getRecentHandoffs({ pool }, {})).toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('按 journey 查、排除自身、带 limit', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ id: 'a' }] })) };
    const rows = await getRecentHandoffs({ pool }, { journeyId: 'j1', limit: 3, excludeTaskId: TASK_ID });
    expect(rows).toEqual([{ id: 'a' }]);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/payload->>'journey_id' = \$1/);
    expect(sql).toMatch(/result \? 'handoff'/);
    expect(sql).toMatch(/ORDER BY completed_at DESC NULLS LAST/);
    expect(params).toEqual(['j1', TASK_ID, 3]);
  });
});

describe('formatHandoffsForPrompt', () => {
  it('空/无数据 → 空字符串', () => {
    expect(formatHandoffsForPrompt([])).toBe('');
    expect(formatHandoffsForPrompt(null)).toBe('');
  });

  it('压缩：每份 ≤ done3/not_done2/next2 条，含段头', () => {
    const rows = [{
      id: 'a', title: 'ta',
      handoff: {
        title: 'ta', verdict: 'PASS',
        done: ['d1', 'd2', 'd3', 'd4'], not_done: ['n1', 'n2', 'n3'], next_steps: ['s1', 's2', 's3'],
      },
    }];
    const t = formatHandoffsForPrompt(rows);
    expect(t).toContain('## 最近 Handoff');
    expect(t).toContain('ta（verdict=PASS）');
    expect(t).toContain('✅ d3');
    expect(t).not.toContain('d4');
    expect(t).not.toContain('n3');
    expect(t).not.toContain('s3');
  });

  it('总长截断 ≤2000 字', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: String(i), title: 't', handoff: { title: 'x'.repeat(400), verdict: 'FAIL', done: [], not_done: [], next_steps: [] },
    }));
    expect(formatHandoffsForPrompt(rows).length).toBeLessThanOrEqual(2001);
  });
});
