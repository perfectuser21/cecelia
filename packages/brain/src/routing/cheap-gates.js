/**
 * 便宜闸永远在 Jev 前（铁律 6eb0dff5）；设备判定以注册表/字段命中为主（主理人拍板），Jev 只补判。
 *
 * 注册表真身三源（审查修复 2026-09-23，team-lead 核实 ops-collector.js 白名单/迁移 448）：
 *  - ops_agents：无 serial/channel 元字段，只提供 name/notionId
 *  - device_locks（migrations/448）：手机序列号真身，device_name=序列号，device_type='phone'
 *  - ops_workflows：无 channel 列，是否设备工作流用 env.deviceKeywords 对工作流名做启发式判断
 *
 * 手机池（任务 b923b1f7，决策 432172f7 方案 C）：优先读手机台账 phone_registry（迁移 489，昵称/别名/抖音号
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
  // 只取 n8n 业务流程：ops_workflows 从 09-24 起也装 Brain 调度 job（source='scheduler'，active=FALSE），
  // 任务正文出现 ci-patrol / daily-backup 之类 job 名不能被当成 workflowRef 命中。
  const w = await query(`SELECT name, notion_id FROM ops_workflows WHERE active = TRUE AND source = 'n8n' ORDER BY name`);
  const registryRows = await loadPhoneRegistry(query);
  const useRegistry = Array.isArray(registryRows) && registryRows.length > 0;
  const phoneRows = useRegistry ? registryRows : [];
  const phoneSrc = useRegistry ? registryRows.filter((r) => r.enabled !== false) : (p?.rows ?? []);
  return {
    agents: (a?.rows ?? []).map((r) => ({ name: r.name, notionId: r.notion_id ?? null })),
    phones: phoneSrc.map((r) => ({ serial: r.serial, host: r.host ?? null })),
    workflows: (w?.rows ?? []).map((r) => ({ name: r.name, notionId: r.notion_id ?? null })),
    phoneSource: useRegistry ? 'phone_registry' : 'device_locks',
    phoneRows,
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

  // Notion 列「执行 Agent / Workflow」是一个**混合**数组：同一列里既可能是 Agent 行
  // 的 page id，也可能是 Workflow 行的。写入方见 notion-push-sync.js 的
  // qiumiSourceFromNotion → lib/qiumi-source.js（唯一真身）。
  //
  // 必须**分两趟**（先 workflows 后 agents），不可合成一趟按 id 顺序遍历：
  // matchedBy 的元素顺序是承重的——vitest 的 toMatchObject 对数组是「长度相等 +
  // 严格按序」（本仓 @vitest/expect 实跑确认，子集与乱序均报错），合成一趟会让
  // 顺序随 id 顺序变，打破与本改动无关的既有用例。
  //
  // 每趟内遍历**用户在 Notion 的选择顺序**取首个命中，而不是遍历池（池是
  // ORDER BY name，用户选两个时赢的会是字母序靠前的那个，反直觉）。
  // 对照：text 分支有显式 tie-break「取最长命中」（见下方 + 用例 cheap-gates.test.js）。
  const relIds = (src.agent_workflow_ids ?? []).map(norm);

  // 两趟的**先后**决定 matchedBy 的元素顺序（承重：vitest 的 toMatchObject 对数组是
  // 长度相等 + 严格按序，已实跑确认）。顺序在这两行，不在函数内部。
  const wfHit = firstHit(relIds, pool.workflows, norm);
  const agHit = firstHit(relIds, pool.agents, norm);
  if (wfHit) {
    out.workflowRef = wfHit.name;
    if (isDeviceWorkflow(wfHit.name, env)) out.isDevice = true;
    out.matchedBy.push('relation:workflow');
  }

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
  // 模型不再从正文文字里猜（任务 0d4215f2）：「调用Agent：」曾被当成「用 agent」命中 grok-4.20-multi-agent。
  // 模型只认正文【执行参数】块，见 routing/exec-params.js；hardModel 恒为 null，字段保留给既有读方。
  for (const [re, eng] of ENGINE_RES) if (re.test(text)) { out.hardEngine = eng; out.matchedBy.push('text:engine'); break; }
  return out;
}
