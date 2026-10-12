import { describe, it, expect } from 'vitest';
import { readHuman, brainHuman, mergeHuman, humanProps } from '../lib/project-notion-human.js';

const base = { status: 'In Progress', priority: null, remark: '', due: null, ai_tier: '知情' };
const row = (extra = {}) => ({ id: 'p', status: 'active', ai_tier: '知情', custom_props: {},
  notion_props: { human_baseline: base }, ...extra });
describe('项目人工列三方合并', () => {
  it('推送回声不改变 active 或写重复审计', () => {
    const merged = mergeHuman(row(), base);
    expect(merged.changed).toBe(false);
    expect(merged.root.status).toBe('active');
    expect(merged.overrides).toEqual([]);
  });
  it('双改时人工状态和备注胜出，保留被覆盖值', () => {
    const merged = mergeHuman(row({ status: 'completed', custom_props: { remark: '机器', keep: 1 } }),
      { ...base, status: 'On Hold', remark: '人工' });
    expect(merged.root.status).toBe('paused');
    expect(merged.root.custom_props).toEqual({ remark: '人工', keep: 1 });
    expect(merged.overrides).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'status', brain_value: 'Completed', notion_value: 'On Hold' }),
      expect.objectContaining({ field: 'remark', brain_value: '机器', notion_value: '人工' }),
    ]));
  });
  it('只有 Brain 改值时保留 Brain 值等待推送', () => {
    const merged = mergeHuman(row({ ai_tier: '介入' }), base);
    expect(merged.root.ai_tier).toBe('介入');
    expect(merged.baseline.ai_tier).toBe('知情');
  });
  it('待推值已到远端但基线落库失败，不把机器回声覆盖后来的 Brain 改动', () => {
    const merged = mergeHuman(row({ ai_tier: '盯着', notion_props: {
      human_baseline: base, pending_human_push: { ...base, ai_tier: '介入' },
    } }), { ...base, ai_tier: '介入' });
    expect(merged.root.ai_tier).toBe('盯着');
    expect(merged.baseline.ai_tier).toBe('介入');
    expect(merged.overrides).toEqual([]);
  });
  it('旧页初始化将摘要移出 Remark，保留历史人工状态', () => {
    const merged = mergeHuman(row({ notion_props: {} }), { ...base, status: 'Completed', remark: '1/2 棒完成' });
    expect(merged.root.status).toBe('completed');
    expect(merged.root.custom_props.remark ?? '').toBe('');
    expect(merged.baseline.remark).toBe('1/2 棒完成');
  });
  it('规范日期、空选项、清空备注，未知状态和档位拒绝', () => {
    const page = { properties: { Status: { status: { name: 'On Hold' } }, Priority: { select: null },
      Remark: { rich_text: [] }, 'Due Date': { date: { start: '2026-10-12' } }, 'AI 参与': { select: null } } };
    expect(readHuman(page)).toEqual({ ...base, status: 'On Hold', due: '2026-10-12' });
    expect(brainHuman(row({ end_date: new Date('2026-10-12T00:00:00Z') })).due).toBe('2026-10-12');
    expect(humanProps(base).Priority).toEqual({ select: null });
    expect(() => readHuman({ properties: { ...page.properties, 'AI 参与': { select: { name: '主导' } } } })).toThrow();
    expect(() => readHuman({ properties: { ...page.properties, Status: { status: { name: '未知' } } } })).toThrow();
  });
});
