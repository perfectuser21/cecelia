/**
 * 便宜闸永远在 Jev 前（铁律 6eb0dff5）；设备判定以注册表/字段命中为主（主理人拍板），Jev 只补判。
 *
 * 注册表真身三源（审查修复 2026-09-23，team-lead 核实 ops-collector.js 白名单/迁移 448）：
 *  - ops_agents：无 serial/channel 元字段，只提供 name/notionId
 *  - device_locks（migrations/448）：手机序列号真身，device_name=序列号，device_type='phone'
 *  - ops_workflows：无 channel 列，是否设备工作流用 env.deviceKeywords 对工作流名做启发式判断
 */
import { resolveModelRef } from './env.js';

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
  // 「用 <型号>」：只认 QIUMI_MODEL_ALLOWLIST 里的（全名或短名），第一个命中即定案。
  const MODEL_RE = /(?<![不别])用\s*([A-Za-z][A-Za-z0-9._/-]{2,})/g;
  for (const m of text.matchAll(MODEL_RE)) {
    const ref = resolveModelRef(m[1], env);
    if (ref) { out.hardModel = ref; out.matchedBy.push('text:model'); break; }
  }
  for (const [re, eng] of ENGINE_RES) if (re.test(text)) { out.hardEngine = eng; out.matchedBy.push('text:engine'); break; }
  return out;
}
