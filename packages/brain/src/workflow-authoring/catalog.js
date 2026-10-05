import { registrationError } from './registration.js';

// 只读真实目录；不输出凭据、整块 metadata 或凭空推断可复用性。
export async function loadCatalog(client) {
  const specifications = {
    workflows: `SELECT id,key,name,capability_id,version,status FROM workflows WHERE status<>'retired' ORDER BY key LIMIT 2001`,
    activities: `SELECT id,name,activity_key,workflow_id,executor_kind,status,contract_sha256,contract FROM activities WHERE activity_key IS NOT NULL AND status<>'deprecated' ORDER BY name LIMIT 2001`,
    skills: `SELECT id,name,description,location,status FROM skill_registry WHERE status IN ('active','planned') ORDER BY name LIMIT 2001`,
  };
  const catalog = { captured_at: new Date().toISOString() };
  for (const [kind, sql] of Object.entries(specifications)) {
    catalog[kind] = (await client.query(sql)).rows;
    if (catalog[kind].length > 2000) throw registrationError('catalog_too_large', '目录超过完整检索上限，不能把截断目录当无匹配结果');
  }
  return catalog;
}
