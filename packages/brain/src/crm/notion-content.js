import { validateCrmMarkdown } from './markdown.js';
import { renderCustomerDossier } from './notion-dossier.js';
// Notion omits blank separators between paragraph blocks on Markdown readback.
// Keep literal whitespace inside fenced code: those lines are customer content.
function comparable(markdown) {
  let fence = null;
  return markdown.split('\n').filter(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && marker[2].trim() === '') fence = null;
      return true;
    }
    return fence !== null || line.trim() !== '';
  }).join('\n');
}
/** Own only the marked region, plus an explicitly authorized exact legacy machine note. */
export async function projectManagedProfile(request, customer, binding = {}) {
  const dossier = binding.fields?.dossier_template === 'v1';
  if (!dossier && customer.profile_managed !== true) return;
  const content = dossier ? renderCustomerDossier(customer) : customer.profile_markdown;
  validateCrmMarkdown(content);
  const start = `**BRAIN-CRM-START:${customer.id}**`, end = `**BRAIN-CRM-END:${customer.id}**`;
  const error = () => Object.assign(new Error('CRM managed content boundary conflict'), { code: 'content_conflict' });
  if (content.includes('BRAIN-CRM-')) throw error();
  const page = await request(`/pages/${customer.source_page_id}/markdown`);
  if (page.truncated || typeof page.markdown !== 'string') throw error();
  const desired = `${start}\n${content}\n${end}`;
  const begin = page.markdown.indexOf(start), finish = page.markdown.indexOf(end);
  const legacy = dossier && binding.fields?.dossier_legacy_status;
  const migrate = legacy?.page_id === customer.source_page_id && typeof legacy.previous === 'string' && legacy.previous.trim()
    ? page.markdown.split('\n').filter(line => line === legacy.previous).length : 0;
  if (migrate > 1) throw error();
  if (begin < 0 && finish < 0) {
    await request(`/pages/${customer.source_page_id}/markdown`, 'PATCH', {
      type: 'insert_content', insert_content: { content: `\n${desired}\n`, position: { type: dossier ? 'start' : 'end' } }, allow_async: false,
    });
  } else {
    if (begin < 0 || finish < begin || page.markdown.indexOf(start, begin + start.length) >= 0 ||
        page.markdown.indexOf(end, finish + end.length) >= 0) throw error();
    const previous = page.markdown.slice(begin, finish + end.length);
    if (comparable(previous) !== comparable(desired)) await request(`/pages/${customer.source_page_id}/markdown`, 'PATCH', {
      type: 'update_content', update_content: { content_updates: [{ old_str: previous, new_str: desired }] }, allow_async: false,
    });
  }
  // Only a per-page, exact prior machine-note receipt can authorize this migration.
  if (migrate === 1) {
    await request(`/pages/${customer.source_page_id}/markdown`, 'PATCH', {
      type: 'update_content', update_content: { content_updates: [{ old_str: legacy.previous,
        new_str: '对应关系已更新：本页已登记 Brain 客户主档；客户身份仍以核验状态为准。飞书链接保留为原记录导航，不代表飞书常驻同步或微信接待已接通。' }] }, allow_async: false,
    });
  }
}
