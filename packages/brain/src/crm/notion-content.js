import { validateCrmMarkdown } from './markdown.js';
/** Only the explicit machine-owned region may change. The rest of the customer's page is human-owned. */
export async function projectManagedProfile(request, customer) {
  if (customer.profile_managed !== true) return;
  validateCrmMarkdown(customer.profile_markdown);
  const start = `**BRAIN-CRM-START:${customer.id}**`, end = `**BRAIN-CRM-END:${customer.id}**`;
  const error = () => Object.assign(new Error('CRM managed content boundary conflict'), { code: 'content_conflict' });
  if (customer.profile_markdown.includes('BRAIN-CRM-')) throw error();
  const page = await request(`/pages/${customer.source_page_id}/markdown`);
  if (page.truncated || typeof page.markdown !== 'string') throw error();
  const desired = `${start}\n${customer.profile_markdown}\n${end}`;
  const begin = page.markdown.indexOf(start), finish = page.markdown.indexOf(end);
  if (begin < 0 && finish < 0) {
    await request(`/pages/${customer.source_page_id}/markdown`, 'PATCH', {
      type: 'insert_content', insert_content: { content: `\n${desired}\n`, position: { type: 'end' } }, allow_async: false,
    });
    return;
  }
  if (begin < 0 || finish < begin || page.markdown.indexOf(start, begin + start.length) >= 0 ||
      page.markdown.indexOf(end, finish + end.length) >= 0) throw error();
  const previous = page.markdown.slice(begin, finish + end.length);
  if (previous === desired) return;
  await request(`/pages/${customer.source_page_id}/markdown`, 'PATCH', {
    type: 'update_content', update_content: { content_updates: [{ old_str: previous, new_str: desired }] }, allow_async: false,
  });
}
