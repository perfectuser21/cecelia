/**
 * handoff.test.js — 方案B handoff 模块单测。
 * Spec: docs/superpowers/specs/2026-07-02-handoff-automation-design.md
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildHandoff, renderHandoffMarkdown,
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
