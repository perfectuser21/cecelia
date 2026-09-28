/**
 * Notion 页面正文全读（任务 0d4215f2）：分页读完、下钻子块、表格按行、2 万字上限、部分失败保留已读。
 * 此前只读顶层前 100 块的 10 种类型——模板里的「运行记录表」、折叠块里的 SOP 全部丢失。
 */
import { describe, it, expect, vi } from 'vitest';
import { readPageContent, TRUNCATION_NOTE } from '../notion-page-content.js';

const rt = (text) => [{ plain_text: text }];
const p = (text, extra = {}) => ({ type: 'paragraph', paragraph: { rich_text: rt(text) }, ...extra });

/** 假 Notion：按「块 id + 游标」返回预置页；未预置的路径抛错。 */
function fakeRequest(pages) {
  return vi.fn(async (path) => {
    const m = path.match(/^\/blocks\/([^/]+)\/children\?page_size=100(?:&start_cursor=(.+))?$/);
    const key = m ? `${m[1]}|${m[2] ?? ''}` : path;
    if (!(key in pages)) throw new Error(`unexpected ${path}`);
    const v = pages[key];
    if (v instanceof Error) throw v;
    return v;
  });
}

describe('readPageContent', () => {
  it('分页：has_more 时带 start_cursor 读下一页，两页内容都在', async () => {
    const request = fakeRequest({
      'P|': { results: [p('第一页')], has_more: true, next_cursor: 'c2' },
      'P|c2': { results: [p('第二页')], has_more: false },
    });
    expect(await readPageContent('P', { request })).toBe('第一页\n第二页');
  });

  it('折叠块 has_children → 下钻读子块', async () => {
    const request = fakeRequest({
      'P|': { results: [{ id: 'T', type: 'toggle', toggle: { rich_text: rt('执行步骤（SOP）') }, has_children: true }] },
      'T|': { results: [p('打开抖音'), p('浏览 5 个视频')] },
    });
    expect(await readPageContent('P', { request })).toBe('执行步骤（SOP）\n打开抖音\n浏览 5 个视频');
  });

  it('表格：逐行 table_row，单元格用 " | " 连接', async () => {
    const cell = (s) => rt(s);
    const request = fakeRequest({
      'P|': { results: [{ id: 'TB', type: 'table', table: {}, has_children: true }] },
      'TB|': { results: [
        { type: 'table_row', table_row: { cells: [cell('步骤'), cell('结果')] } },
        { type: 'table_row', table_row: { cells: [cell('打开抖音'), cell('成功')] } },
      ] },
    });
    expect(await readPageContent('P', { request })).toBe('步骤 | 结果\n打开抖音 | 成功');
  });

  it('超过 maxChars → 截断并在末尾标注', async () => {
    const request = fakeRequest({ 'P|': { results: [p('x'.repeat(30))] } });
    const text = await readPageContent('P', { request, maxChars: 10 });
    expect(text).toBe(`${'x'.repeat(10)}\n${TRUNCATION_NOTE}`);
  });

  it('第二页请求失败 → 返回第一页已读内容，不抛', async () => {
    const request = fakeRequest({
      'P|': { results: [p('已读部分')], has_more: true, next_cursor: 'c2' },
      'P|c2': new Error('Notion 500'),
    });
    expect(await readPageContent('P', { request })).toBe('已读部分');
  });

  it('深度超过 maxDepth 不再下钻', async () => {
    const request = fakeRequest({
      'P|': { results: [{ id: 'A', type: 'toggle', toggle: { rich_text: rt('一层') }, has_children: true }] },
      'A|': { results: [{ id: 'B', type: 'toggle', toggle: { rich_text: rt('二层') }, has_children: true }] },
    });
    expect(await readPageContent('P', { request, maxDepth: 1 })).toBe('一层\n二层');
    expect(request).toHaveBeenCalledTimes(2);
  });
});
