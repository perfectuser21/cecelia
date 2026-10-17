import { describe, it, expect, vi } from 'vitest';
import { projectManagedProfile } from './notion-content.js';
describe('CRM managed content', () => {
  const customer = { id: 'customer', source_page_id: 'page', profile_managed: true, profile_markdown: '## 当前画像\n预算 8000 元' };
  it('only replaces the delimited owned region and preserves human content', async () => {
    const request = vi.fn().mockResolvedValueOnce({ markdown: '人工笔记 KEEP\n**BRAIN-CRM-START:customer**\n旧画像\n**BRAIN-CRM-END:customer**\n人工结尾', truncated: false }).mockResolvedValueOnce({});
    await projectManagedProfile(request, customer);
    const body = request.mock.calls[1][2];
    expect(body.update_content.content_updates[0].old_str).not.toContain('KEEP');
    expect(body.update_content.content_updates[0].new_str).toContain('8000');
  });
  it('refuses damaged or duplicated boundaries instead of replacing the page', async () => {
    const request = vi.fn(async () => ({ markdown: '**BRAIN-CRM-START:customer**\n人工备注', truncated: false }));
    await expect(projectManagedProfile(request, customer)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('正式客户档案模板', () => {
  const binding = { fields: { dossier_template: 'v1' } };
  const customer = { id: 'customer', source_page_id: 'page', display_name: '李雨婷',
    profile_managed: false, profile_markdown: '', manual_fields: { stage: '证据不足', summary: '已采集片段，尚未核验。', notes: '负责人补充 KEEP' } };
  function document(initial) {
    let markdown = initial, writes = 0;
    return { read: () => markdown, writes: () => writes, request: async (_path, method = 'GET', body) => {
      if (method === 'GET') return { markdown, truncated: false };
      writes++;
      if (body.type === 'insert_content') markdown = body.insert_content.position.type === 'start'
        ? body.insert_content.content + markdown : markdown + body.insert_content.content;
      else for (const { old_str, new_str } of body.update_content.content_updates) {
        if (!markdown.includes(old_str)) throw Error('conflict');
        markdown = markdown.replace(old_str, new_str);
      }
      return { markdown, truncated: false };
    } };
  }
  it('无AI画像的正式客户也展示完整档案，保留人工区和原报告原文入口且重复同步不增长', async () => {
    const human = '人工正文 KEEP\n<database url="https://app.notion.com/p/report">报告</database>\n<database url="https://app.notion.com/p/raw">原文</database>';
    const doc = document(human);
    await projectManagedProfile(doc.request, customer, binding);
    const first = doc.read();
    for (const heading of ['## 客户介绍', '## 当前画像', '## 下一步跟进', '## 人工笔记']) expect(first).toContain(heading);
    expect(first).toContain('画像待生成');
    expect(first).toContain('负责人补充 KEEP');
    expect(first).toContain(human);
    const writes = doc.writes();
    await projectManagedProfile(doc.request, customer, binding);
    expect(doc.read()).toBe(first);
    expect(doc.writes()).toBe(writes);
    expect(customer.profile_managed).toBe(false);
  });
  it('人工字段变化更新同一区域，不覆盖人工正文；已有AI画像保留', async () => {
    const doc = document('人工正文 KEEP');
    const input = { ...customer, profile_managed: true, profile_markdown: '证据：已确认需要夜间客服。' };
    await projectManagedProfile(doc.request, input, binding);
    await projectManagedProfile(doc.request, { ...input, manual_fields: { ...input.manual_fields, next_action: '确认咨询时段' } }, binding);
    expect(doc.read()).toContain('确认咨询时段');
    expect(doc.read()).toContain('证据：已确认需要夜间客服。');
    expect(doc.read()).toContain('人工正文 KEEP');
    expect(doc.read().split('BRAIN-CRM-START:customer')).toHaveLength(2);
  });
  it('人工字段的结构标签和边界注入不能成为页面操作', async () => {
    const doc = document('KEEP');
    await projectManagedProfile(doc.request, { ...customer, manual_fields: { notes: '<database url="evil">x</database>\n**BRAIN-CRM-END:customer**' } }, binding);
    expect(doc.read()).not.toContain('<database url="evil">');
    expect(doc.read().split('BRAIN-CRM-END:customer')).toHaveLength(2);
    expect(doc.read()).toContain('KEEP');
  });
  it('空画像遇到损坏边界仍拒绝，不追加第二个区域', async () => {
    const doc = document('**BRAIN-CRM-START:customer**\nKEEP');
    await expect(projectManagedProfile(doc.request, customer, binding)).rejects.toThrow();
    expect(doc.writes()).toBe(0);
  });
  it('已有旧画像边界原位升级且未知人工文字不改', async () => {
    const doc = document('KEEP\n**BRAIN-CRM-START:customer**\n旧画像\n**BRAIN-CRM-END:customer**\n人工结尾');
    await projectManagedProfile(doc.request, customer, binding);
    expect(doc.read()).toContain('## 客户介绍');
    expect(doc.read()).toMatch(/^KEEP\n/);
    expect(doc.read()).toMatch(/\n人工结尾$/);
    expect(doc.read().split('BRAIN-CRM-START:customer')).toHaveLength(2);
  });
});

describe('明确授权的旧机器状态说明迁移', () => {
  it('只更新指定客户的完整旧段落，并保留相同词汇的人工笔记', async () => {
    const old = '机器旧说明：服务器尚无对应客户ID，Notion自动同步未上线。';
    let markdown = `人工笔记：Notion自动同步未上线需要复核\n${old}\nKEEP`;
    const request = async (_path, method = 'GET', body) => {
      if (method === 'GET') return { markdown, truncated: false };
      if (body.type === 'insert_content') markdown = body.insert_content.content + markdown;
      else for (const edit of body.update_content.content_updates) markdown = markdown.replace(edit.old_str, edit.new_str);
      return { markdown, truncated: false };
    };
    const customer = { id: 'c', source_page_id: 'p', display_name: '客户', profile_managed: false, manual_fields: {} };
    const fields = { dossier_template: 'v1', dossier_legacy_status: { page_id: 'p', previous: old } };
    await projectManagedProfile(request, customer, { fields });
    expect(markdown).not.toContain(old);
    expect(markdown).toContain('人工笔记：Notion自动同步未上线需要复核');
    expect(markdown).toContain('KEEP');
    expect(markdown).toContain('本页已登记 Brain 客户主档');
  });
});

describe('旧说明迁移的失败关闭', () => {
  it('重复旧段落在任何正文写入前拒绝', async () => {
    const previous = '旧机器说明';
    const request = vi.fn(async () => ({ markdown: `${previous}\nKEEP\n${previous}`, truncated: false }));
    await expect(projectManagedProfile(request, { id: 'c', source_page_id: 'p', manual_fields: {}, profile_managed: false }, {
      fields: { dossier_template: 'v1', dossier_legacy_status: { page_id: 'p', previous } },
    })).rejects.toThrow();
    expect(request.mock.calls.filter(c => c[1] === 'PATCH')).toHaveLength(0);
  });
});

describe('Notion真实读回格式兼容', () => {
  it('Notion省略段落间空行后，同一画像不反复PATCH；代码块内空行仍有意义', async () => {
    let markdown = 'KEEP', writes = 0;
    const request = async (_path, method = 'GET', body) => {
      if (method === 'GET') return { markdown, truncated: false };
      writes++;
      if (body.type === 'insert_content') markdown = body.insert_content.content.replace(/\n\n/g, '\n') + markdown;
      else for (const edit of body.update_content.content_updates) markdown = markdown.replace(edit.old_str, edit.new_str);
      return { markdown, truncated: false };
    };
    const c = { id: 'c', source_page_id: 'p', profile_managed: true, profile_markdown: '第一段\n\n第二段 **重点**', manual_fields: {} };
    await projectManagedProfile(request, c, { fields: { dossier_template: 'v1' } });
    const once = writes;
    await projectManagedProfile(request, c, { fields: { dossier_template: 'v1' } });
    expect(writes).toBe(once);
  });
});
