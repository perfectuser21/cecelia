/** CRM free text is not permission to move pages, databases or synced structures. */
export function validateCrmMarkdown(value) {
  if (typeof value !== 'string' || /<\s*(?:\/\s*)?(?:page|database|folder|synced[_-]block(?:[_-]reference)?|custom-block)\b/iu.test(value)) {
    throw Object.assign(new Error('CRM prose contains structural markup'), { code: 'invalid_markdown' });
  }
  return value;
}
