/**
 * notion-page-content.js — 读取 Notion 页面正文作为任务 prompt（任务 0d4215f2）。
 *
 * 原实现只读顶层前 100 块的 10 种文本块：模板里的「运行记录表」、折叠块里的 SOP 全部丢失。
 * 现在：分页读完、下钻 has_children（深度上限 maxDepth）、表格按行拼接、总长 maxChars 截断并标注。
 * 任一请求失败只影响那一段，已读到的内容照常返回；正文是增强件，绝不阻塞排单。
 *
 * 纯函数外壳：Notion 请求由调用方注入（request(path) → Promise<json>），便于测试与复用凭据。
 */

export const TRUNCATION_NOTE = '（正文过长已截断）';

// rich_text 承载体：直接取 plain_text
const TEXT_BLOCK_TYPES = new Set([
  'paragraph', 'heading_1', 'heading_2', 'heading_3',
  'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'callout', 'code', 'toggle',
]);

const plain = (arr) => (arr ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');

function blockText(block) {
  const type = block?.type;
  if (TEXT_BLOCK_TYPES.has(type)) return plain(block[type]?.rich_text);
  if (type === 'table_row') return (block.table_row?.cells ?? []).map(plain).join(' | ');
  if (type === 'child_page') return block.child_page?.title ?? '';
  return '';
}

/** 读一个块的全部子块（分页），逐块输出文本并按需下钻。失败时停止本层，保留已读。 */
async function readChildren(blockId, request, depth, maxDepth, lines, budget) {
  let cursor = '';
  do {
    let resp;
    try {
      const qs = cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : '';
      resp = await request(`/blocks/${blockId}/children?page_size=100${qs}`);
    } catch (err) {
      console.warn(`[notion-page-content] 读取块 ${blockId} 失败，保留已读部分: ${err.message}`);
      return;
    }
    for (const block of resp?.results ?? []) {
      if (budget.used >= budget.max) return;
      const text = blockText(block);
      if (text.trim()) { lines.push(text); budget.used += text.length + 1; }
      if (block.has_children && depth < maxDepth && block.id) {
        await readChildren(block.id, request, depth + 1, maxDepth, lines, budget);
      }
    }
    cursor = resp?.has_more ? resp.next_cursor : '';
  } while (cursor);
}

export async function readPageContent(pageId, { request, maxChars = 20000, maxDepth = 3 } = {}) {
  const lines = [];
  // 页面自身的块是第 0 层；maxDepth = 最多往下钻几层嵌套
  await readChildren(pageId, request, 0, maxDepth, lines, { used: 0, max: maxChars });
  const text = lines.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n${TRUNCATION_NOTE}` : text;
}
