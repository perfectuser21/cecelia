/**
 * 便宜闸永远在 Jev 前（铁律 6eb0dff5）；设备判定以注册表/字段命中为主（主理人拍板），Jev 只补判。
 *
 * 注册表读取现役 ops_agents 与手机台账；旧 n8n workflow 不再作为路由候选。
 *
 * 手机池（任务 b923b1f7，决策 432172f7 方案 C）：优先读手机台账 phone_registry（迁移 490，昵称/别名/抖音号
 * → 手机的唯一真身），只有台账表不存在或为空时才回退 device_locks 旧口径。台账模式下正文里的手机描述交给
 * routing/phone-resolver.js 定案，代码里不写任何一台手机。
 */
import { resolvePhone, hasDeviceLine } from './phone-resolver.js';

const UNDEFINED_TABLE = '42P01';

/** 台账全量行（含 disabled——resolver 自己过滤）；表不存在返回 null，其余错误照抛。 */
async function loadPhoneRegistry(query) {
  try {
    const r = await query(
      `SELECT serial, nickname, aliases, host, profile, model, owner, role, douyin_accounts, wechat, enabled
         FROM phone_registry ORDER BY serial`,
    );
    return r?.rows ?? [];
  } catch (err) {
    if (err?.code === UNDEFINED_TABLE) return null;
    throw err;
  }
}

export async function loadRegistryPool(query) {
  const a = await query(`SELECT name, notion_id FROM ops_agents WHERE status = 'active' ORDER BY name`);
  const p = await query(`SELECT device_name AS serial, host FROM device_locks WHERE device_type = 'phone' ORDER BY device_name`);
  const registryRows = await loadPhoneRegistry(query);
  const useRegistry = Array.isArray(registryRows) && registryRows.length > 0;
  const phoneRows = useRegistry ? registryRows : [];
  const phoneSrc = useRegistry ? registryRows.filter((r) => r.enabled !== false) : (p?.rows ?? []);
  return {
    agents: (a?.rows ?? []).map((r) => ({ name: r.name, notionId: r.notion_id ?? null })),
    phones: phoneSrc.map((r) => ({ serial: r.serial, host: r.host ?? null })),
    workflows: [], // 保持路由上下文形状；退休 n8n 工作流不再装入候选池。
    phoneSource: useRegistry ? 'phone_registry' : 'device_locks',
    phoneRows,
  };
}

const ENGINE_RES = [
  [/claude\s*code|(?<!不)用\s*claude/i, 'claude'],
  [/用\s*codex|codex\s*做/i, 'codex'],
];
const DEPT_LEAD_WORDS = '让|叫|找|由';

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ASCII工具名须是独立token；UUID、哈希及标识符中的同字母片段不是设备意图。
function deviceKeywordHit(text, keyword) {
  if (/^[A-Za-z0-9_]+$/.test(keyword)) {
    return new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(keyword)}(?![A-Za-z0-9_])`, 'i').test(text);
  }
  return text.includes(keyword);
}

/**
 * 按**用户在 Notion 的选择顺序**取首个命中的注册表行（不是遍历池——池是
 * ORDER BY name，用户选两个时赢的会是字母序靠前的那个，反直觉）。
 * 命中即 return，不存在"后续 id 把已命中值覆盖掉"的写法陷阱。
 */
function firstHit(normalizedIds, rows, norm) {
  for (const id of normalizedIds) {
    const hit = rows.find((r) => r.notionId && norm(r.notionId) === id);
    if (hit) return hit;
  }
  return undefined;
}

export function cheapGates(task, pool, env) {
  const src = task?.payload?.qiumi_source ?? {};
  const text = [src.title, src.remark, src.body].filter(Boolean).join('\n');
  const norm = (s) => String(s ?? '').replace(/-/g, '');
  const out = { isDevice: false, serial: null, workflowRef: null, department: null, agentRef: null, hardEngine: null, hardModel: null, matchedBy: [] };

  // 混合 relation 只匹配现役 Agent；旧 Workflow id 不再决定执行路由。
  const relIds = (src.agent_workflow_ids ?? []).map(norm);
  const agHit = firstHit(relIds, pool.agents, norm);
  if (agHit) {
    if (env.departments.includes(agHit.name)) { out.department = agHit.name; }
    else { out.agentRef = agHit.name; }
    out.matchedBy.push('relation:agent');
  }

  if (src.channel) { out.isDevice = true; out.workflowRef = out.workflowRef ?? src.channel; out.matchedBy.push('channel'); }

  if (pool.phoneSource === 'phone_registry') {
    // 台账模式：唯一命中才定 serial；定不下（ambiguous/none）留 phoneResolution 给路由决定是否退回
    const res = resolvePhone(text, pool.phoneRows);
    out.phoneResolution = res;
    if (res.status === 'unique') {
      out.isDevice = true;
      out.serial = res.phone.serial;
      out.matchedBy.push(res.matchedBy === 'serial' ? 'text:serial' : `registry:${res.matchedBy}`);
    } else if (res.status === 'ambiguous') {
      out.isDevice = true;
      out.matchedBy.push(`registry:${res.matchedBy}`);
    }
    if (hasDeviceLine(text) && !out.isDevice) { out.isDevice = true; out.matchedBy.push('text:device_line'); }
  } else if (!out.serial) {
    const s = pool.phones.find((p) => p.serial && text.includes(p.serial));
    if (s) { out.isDevice = true; out.serial = s.serial; out.matchedBy.push('text:serial'); }
  }
  if (!out.department) {
    const d = env.departments.find((dep) => new RegExp(`(?:${DEPT_LEAD_WORDS})\\s*${escapeRegExp(dep)}(?![A-Za-z0-9_])`, 'i').test(text));
    if (d) { out.department = d; out.matchedBy.push('text:department'); }
  }
  if (!out.isDevice && env.deviceKeywords.some((k) => deviceKeywordHit(text, k))) { out.isDevice = true; out.matchedBy.push('text:keyword'); }
  // 模型不再从正文文字里猜（任务 0d4215f2）：「调用Agent：」曾被当成「用 agent」命中 grok-4.20-multi-agent。
  // 模型只认正文【执行参数】块，见 routing/exec-params.js；hardModel 恒为 null，字段保留给既有读方。
  for (const [re, eng] of ENGINE_RES) if (re.test(text)) { out.hardEngine = eng; out.matchedBy.push('text:engine'); break; }
  return out;
}
