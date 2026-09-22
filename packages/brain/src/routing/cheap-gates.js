/**
 * 便宜闸永远在 Jev 前（铁律 6eb0dff5）；设备判定以注册表/字段命中为主（主理人拍板），Jev 只补判。
 *
 * 注册表真身三源（审查修复 2026-09-23，team-lead 核实 ops-collector.js 白名单/迁移 448）：
 *  - ops_agents：无 serial/channel 元字段，只提供 name/notionId
 *  - device_locks（migrations/448）：手机序列号真身，device_name=序列号，device_type='phone'
 *  - ops_workflows：无 channel 列，是否设备工作流用 env.deviceKeywords 对工作流名做启发式判断
 */
export async function loadRegistryPool(query) {
  const a = await query(`SELECT name, notion_id FROM ops_agents WHERE status = 'active' ORDER BY name`);
  const p = await query(`SELECT device_name AS serial, host FROM device_locks WHERE device_type = 'phone' ORDER BY device_name`);
  const w = await query(`SELECT name, notion_id FROM ops_workflows WHERE active = TRUE ORDER BY name`);
  return {
    agents: (a.rows ?? []).map((r) => ({ name: r.name, notionId: r.notion_id ?? null })),
    phones: (p.rows ?? []).map((r) => ({ serial: r.serial, host: r.host ?? null })),
    workflows: (w.rows ?? []).map((r) => ({ name: r.name, notionId: r.notion_id ?? null })),
  };
}

const ENGINE_RES = [
  [/claude\s*code|(?<!不)用\s*claude/i, 'claude'],
  [/用\s*codex|codex\s*做/i, 'codex'],
];
const DEPT_LEAD_WORDS = '让|叫|找|由';
const MIN_WORKFLOW_NAME_LEN = 3;

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 工作流是否为设备类：名字含任一设备关键词（诚实的启发式，registry 无 channel 列可查）。 */
function isDeviceWorkflow(name, env) {
  return env.deviceKeywords.some((k) => name.includes(k));
}

export function cheapGates(task, pool, env) {
  const src = task?.payload?.qiumi_source ?? {};
  const text = [src.title, src.remark, src.body].filter(Boolean).join('\n');
  const norm = (s) => String(s ?? '').replace(/-/g, '');
  const out = { isDevice: false, serial: null, workflowRef: null, department: null, agentRef: null, hardEngine: null, matchedBy: [] };

  const relWf = (src.relations?.workflows ?? []).map(norm);
  const wfHit = pool.workflows.find((w) => w.notionId && relWf.includes(norm(w.notionId)));
  if (wfHit) {
    out.workflowRef = wfHit.name;
    if (isDeviceWorkflow(wfHit.name, env)) out.isDevice = true;
    out.matchedBy.push('relation:workflow');
  }

  const relAg = (src.relations?.agents ?? []).map(norm);
  const agHit = pool.agents.find((a) => a.notionId && relAg.includes(norm(a.notionId)));
  if (agHit) {
    if (env.departments.includes(agHit.name)) { out.department = agHit.name; }
    else { out.agentRef = agHit.name; }
    out.matchedBy.push('relation:agent');
  }

  if (src.channel) { out.isDevice = true; out.workflowRef = out.workflowRef ?? src.channel; out.matchedBy.push('channel'); }

  if (!out.serial) {
    const s = pool.phones.find((p) => p.serial && text.includes(p.serial));
    if (s) { out.isDevice = true; out.serial = s.serial; out.matchedBy.push('text:serial'); }
  }
  if (!out.workflowRef) {
    const candidates = pool.workflows.filter((w) => w.name.length >= MIN_WORKFLOW_NAME_LEN && text.includes(w.name));
    if (candidates.length) {
      const w = candidates.reduce((best, cur) => (cur.name.length > best.name.length ? cur : best));
      out.workflowRef = w.name;
      if (isDeviceWorkflow(w.name, env)) out.isDevice = true;
      out.matchedBy.push('text:workflow');
    }
  }
  if (!out.department) {
    const d = env.departments.find((dep) => new RegExp(`(?:${DEPT_LEAD_WORDS})\\s*${escapeRegExp(dep)}(?![A-Za-z0-9_])`, 'i').test(text));
    if (d) { out.department = d; out.matchedBy.push('text:department'); }
  }
  if (!out.isDevice && env.deviceKeywords.some((k) => text.includes(k))) { out.isDevice = true; out.matchedBy.push('text:keyword'); }
  for (const [re, eng] of ENGINE_RES) if (re.test(text)) { out.hardEngine = eng; out.matchedBy.push('text:engine'); break; }
  return out;
}
