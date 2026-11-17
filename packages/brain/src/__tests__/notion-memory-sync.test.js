/**
 * notion-memory-sync.test.js
 * 历史恢复工具共享联系人解析与字段映射测试
 */

import { describe, it, expect, vi } from 'vitest';

// mock pool
const mockPool = {
  query: vi.fn(),
};
vi.mock('../db.js', () => ({ default: mockPool }));

const {
  parseContactContent,
  contactFieldsToNotionProps,
} = await import('../notion-memory-sync.js');

describe('parseContactContent', () => {
  it('解析标准 key:value 格式', () => {
    const r = parseContactContent('姓名:胡月萍 称呼:糊糊 实际关系:妻子 生日:1989-07-02 分类:至亲');
    expect(r['姓名']).toBe('胡月萍');
    expect(r['称呼']).toBe('糊糊');
    expect(r['实际关系']).toBe('妻子');
    expect(r['生日']).toBe('1989-07-02');
    expect(r['分类']).toBe('至亲');
  });

  it('解析包含职业和朋友分类的联系人', () => {
    const r = parseContactContent('姓名:贾得巍 实际关系:法务专家 分类:朋友 职业:律师');
    expect(r['姓名']).toBe('贾得巍');
    expect(r['职业']).toBe('律师');
    expect(r['分类']).toBe('朋友');
  });

  it('无冒号时整体作为备注', () => {
    const r = parseContactContent('普通文本没有冒号');
    expect(r['备注']).toBe('普通文本没有冒号');
  });

  it('空/null 输入返回空对象', () => {
    expect(parseContactContent('')).toEqual({});
    expect(parseContactContent(null)).toEqual({});
    expect(parseContactContent(undefined)).toEqual({});
  });
});

describe('contactFieldsToNotionProps', () => {
  it('关系字段映射到 select', () => {
    const p = contactFieldsToNotionProps({ 实际关系: '妻子' });
    expect(p['关系']).toEqual({ select: { name: '妻子' } });
  });

  it('分类字段映射到 multi_select（逗号分隔）', () => {
    const p = contactFieldsToNotionProps({ 分类: '朋友,至亲' });
    expect(p['分类']).toEqual({ multi_select: [{ name: '朋友' }, { name: '至亲' }] });
  });

  it('生日字段映射到 date（格式规范化）', () => {
    const p = contactFieldsToNotionProps({ 生日: '1989-07-02' });
    expect(p['生日']).toEqual({ date: { start: '1989-07-02' } });
  });

  it('生日斜杠格式规范化为连字符', () => {
    const p = contactFieldsToNotionProps({ 生日: '1989/07/02' });
    expect(p['生日']).toEqual({ date: { start: '1989-07-02' } });
  });

  it('邮箱字段映射到 email', () => {
    const p = contactFieldsToNotionProps({ 邮箱: 'alice@example.com' });
    expect(p['邮箱']).toEqual({ email: 'alice@example.com' });
  });

  it('电话字段映射到 phone_number', () => {
    const p = contactFieldsToNotionProps({ 电话: '13800138000' });
    expect(p['电话']).toEqual({ phone_number: '13800138000' });
  });

  it('网址字段映射到 url', () => {
    const p = contactFieldsToNotionProps({ 网址: 'https://example.com' });
    expect(p['网址']).toEqual({ url: 'https://example.com' });
  });

  it('职业映射到 rich_text', () => {
    const p = contactFieldsToNotionProps({ 职业: '律师' });
    expect(p['职业']).toEqual({ rich_text: [{ text: { content: '律师' } }] });
  });

  it('称呼映射到 rich_text', () => {
    const p = contactFieldsToNotionProps({ 称呼: '糊糊' });
    expect(p['称呼']).toEqual({ rich_text: [{ text: { content: '糊糊' } }] });
  });

  it('姓名字段被跳过（title 字段单独处理）', () => {
    const p = contactFieldsToNotionProps({ 姓名: '张三', 称呼: '小张' });
    expect(p['姓名']).toBeUndefined();
    expect(p['称呼']).toBeDefined();
  });

  it('sourceName 写入来源 select', () => {
    const p = contactFieldsToNotionProps({}, 'import', null);
    expect(p['来源']).toEqual({ select: { name: 'import' } });
  });

  it('updatedAt 写入更新时间 date', () => {
    const d = new Date('2026-01-01');
    const p = contactFieldsToNotionProps({}, null, d);
    expect(p['更新时间']).toEqual({ date: { start: '2026-01-01' } });
  });

  it('未知 key 但值为邮箱格式时自动检测', () => {
    const p = contactFieldsToNotionProps({ 联络: 'bob@test.com' });
    expect(p['邮箱']).toEqual({ email: 'bob@test.com' });
  });

  it('未知 key 但值为 URL 格式时自动检测', () => {
    const p = contactFieldsToNotionProps({ 主页: 'https://github.com/bob' });
    expect(p['网址']).toEqual({ url: 'https://github.com/bob' });
  });
});
