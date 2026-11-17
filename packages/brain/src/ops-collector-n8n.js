// ─── DisCo 成熟度（刀7）─────────────────────────────────────────────────
// 判据来自主理人拍板（决策「Workflow 执行体形态定线：走 Skill-DisCo 路线」）：
//   三档 = software3(提示词即程序,跑完即弃) / disco(技能体+契约+LLM调度层) / code(不可逆写入,永远纯代码)
//   固化三条必须同时满足：形状跨多次重复 + 变体已探明 + 碎了能当场发现(有探针)
//   分档看**执行频率与变体收敛度**，不是任务复杂度
// 成熟度挂 skill（被蒸馏的主体，有版本演进）；agent/workflow 的成熟度是**算出来的**。

export const DISCO_STAGES = ['software3', 'disco', 'code'];
const STAGE_RANK = { software3: 0, disco: 1, code: 2 };

/** 频率下限：低于此不值得固化（跑完即弃）。变体收敛线：成功率稳定在此之上才算探明。 */
export const DISCO_MIN_RUNS = 20;
export const DISCO_CONVERGED_RATE = 90;

/** 从 skill_registry.metadata.eval_score 提分数。非分数文本返回 null，禁编造。 */
export function parseEvalScore(raw) {
  const text = raw == null ? '' : String(raw);
  const out = { score: null, baseline: null, raw: text };
  if (!text) return out;
  // 对照式：with_skill 16/16 (100%) vs without_skill 6/16 (38%)
  const pair = text.match(/with_skill[^(]*\((\d+)%\)[\s\S]*?without_skill[^(]*\((\d+)%\)/i);
  if (pair) { out.score = Number(pair[1]); out.baseline = Number(pair[2]); return out; }
  // 单值：27/27 (100%)
  const single = text.match(/\((\d+)%\)/);
  if (single) { out.score = Number(single[1]); return out; }
  return out;
}

/**
 * 判 DisCo 档位。机器只算它能算的（频率/成功率/有无探针），
 * 「变体已探明」需要看失败形状——机器给建议，confident=false 时等人确认。
 */
export function inferDiscoStage(m = {}) {
  // 不可逆写入永远纯代码（merge/publish/发帖/写生产库/发钱）
  if (m.irreversible) {
    return { stage: 'code', confident: true, reason: '不可逆写入，按决策永远纯代码' };
  }
  const { runs, successRate, hasPostcondition } = m;
  if (runs == null || successRate == null || hasPostcondition == null) {
    return { stage: 'software3', confident: false, reason: '数据不全（缺频率/成功率/探针信息），等人确认' };
  }
  if (!hasPostcondition) {
    return { stage: 'software3', confident: true, reason: '无探针（postcondition）不许固化——碎了发现不了' };
  }
  if (runs < DISCO_MIN_RUNS) {
    return { stage: 'software3', confident: true, reason: `执行 ${runs} 次未达固化门槛 ${DISCO_MIN_RUNS}，跑完即弃` };
  }
  if (successRate < DISCO_CONVERGED_RATE) {
    return { stage: 'software3', confident: true, reason: `成功率 ${successRate}% 仍在波动，变体未收敛（<${DISCO_CONVERGED_RATE}%）` };
  }
  return { stage: 'disco', confident: true, reason: `执行 ${runs} 次、成功率 ${successRate}%、有探针——三条固化判据齐备` };
}

/** agent 成熟度 = 它当前装备的 skill 的最低档（一个还在试错，整体就没固化）。 */
export function rollupAgentMaturity(skillNames = [], stageBySkill = new Map()) {
  const known = (skillNames || []).map((n) => [n, stageBySkill.get(n)]).filter(([, st]) => st);
  if (!known.length) return { stage: null, weakest: null };
  let weakest = known[0];
  for (const cur of known) if (STAGE_RANK[cur[1]] < STAGE_RANK[weakest[1]]) weakest = cur;
  return { stage: weakest[1], weakest: weakest[0] };
}

/** workflow 成熟度 = 各阶段 skill 的最低档（木桶），并点名瓶颈阶段——下一刀该固化谁。 */
export function rollupWorkflowMaturity(stages = [], stageBySkill = new Map()) {
  const known = (stages || [])
    .map((s) => ({ stage: s.stage, skill: s.skill, lvl: stageBySkill.get(s.skill) }))
    .filter((x) => x.lvl);
  if (!known.length) return { stage: null, bottleneck: null };
  let weakest = known[0];
  for (const cur of known) if (STAGE_RANK[cur.lvl] < STAGE_RANK[weakest.lvl]) weakest = cur;
  const allSame = known.every((x) => x.lvl === weakest.lvl);
  return { stage: weakest.lvl, bottleneck: allSame ? null : weakest.stage };
}


/**
 * 从 SKILL.md 判断有无探针（postcondition）。决策要求：无探针不许固化——
 * 因为"碎了能当场发现"是固化三条件之一。只认**结构化声明**，
 * 随口一句"记得验证"不算（那不是机器能检查的东西）。
 */
export function detectPostcondition(doc) {
  const t = String(doc || '');
  if (!t) return false;
  const PATTERNS = [
    /产出契约/,                       // 业务 skill 实际写法（含 metrics 必填 + 最小 evidence）
    /postcondition/i,
    /后置条件/,
    /最小\s*evidence/i,              // "真实模式 completed 的最小 evidence"
    /evidence\s*(必须|必填)/,
  ];
  return PATTERNS.some((re) => re.test(t));
}

// ─── 流程图（Notion 页正文画出每条 workflow 长什么样）──────────────────
const stageName = (n) => String(n || '').replace(/^阶段\s*/, '');
const isStage = (n) => String(n || '').startsWith('阶段');

/** 按真实连线走出业务阶段顺序（不靠 nodes 数组顺序，那是画布摆放次序不是执行序） */
export function buildStageFlow(w) {
  const nodes = w?.nodes || [];
  const conn = w?.connections || {};
  const stages = nodes.filter((n) => isStage(n?.name)).map((n) => n.name);
  if (!stages.length) return [];
  if (!Object.keys(conn).length) return stages.map(stageName);

  // 从入口出发走连线，记录遇到的阶段顺序；防环
  const entry = nodes.find((n) => String(n?.type || '').includes('webhook'))?.name
    || Object.keys(conn)[0];
  const order = [];
  const seen = new Set();
  const walk = (name) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    if (isStage(name) && !order.includes(name)) order.push(name);
    for (const out of conn[name]?.main || []) {
      for (const t of out || []) walk(t?.node);
    }
  };
  walk(entry);
  // 连线走不到的阶段（孤立分支）补在后面，不丢
  for (const s of stages) if (!order.includes(s)) order.push(s);
  return order.map(stageName);
}

/** 画成 mermaid flowchart。无业务阶段的流程返回 null（不画空图）。 */
export function buildWorkflowMermaid(w) {
  const flow = buildStageFlow(w);
  if (!flow.length) return null;
  const lines = ['flowchart TD'];
  const id = (i) => `S${i + 1}`;
  flow.forEach((s, i) => {
    lines.push(`  ${id(i)}["${i + 1}. ${s}"]`);
  });
  for (let i = 0; i < flow.length - 1; i++) {
    lines.push(`  ${id(i)}["${i + 1}. ${flow[i]}"] --> ${id(i + 1)}["${i + 2}. ${flow[i + 1]}"]`);
  }
  // 裁决可中止：每阶段后若有 switch 分支到归档，标一条中止出口
  const hasAbort = (w?.nodes || []).some((n) => String(n?.name || '').includes('中止'));
  if (hasAbort) {
    lines.push('  ABORT["⛔ 中止归档"]');
    flow.forEach((s, i) => lines.push(`  ${id(i)} -.裁决不通过.-> ABORT`));
  }
  return lines.join('\n');
}

/** Notion 页正文 blocks：流程图 + 阶段清单 + 节点构成说明 */
export function buildWorkflowPageBlocks(w, row = {}) {
  const blocks = [];
  const para = (t) => ({ object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: String(t).slice(0, 1800) } }] } });
  const head = (t) => ({ object: 'block', type: 'heading_3',
    heading_3: { rich_text: [{ type: 'text', text: { content: t } }] } });

  const mermaid = buildWorkflowMermaid(w);
  if (mermaid) {
    blocks.push(head('流程图'));
    blocks.push({ object: 'block', type: 'code',
      code: { language: 'mermaid', rich_text: [{ type: 'text', text: { content: mermaid.slice(0, 1900) } }] } });
    blocks.push(head('业务阶段'));
    buildStageFlow(w).forEach((s) => blocks.push({
      object: 'block', type: 'numbered_list_item',
      numbered_list_item: { rich_text: [{ type: 'text', text: { content: s } }] },
    }));
  }
  blocks.push(head('画布构成'));
  const types = {};
  for (const n of w?.nodes || []) {
    const t = String(n?.type || '').split('.').pop();
    types[t] = (types[t] || 0) + 1;
  }
  const detail = Object.entries(types).map(([t, c]) => `${t}×${c}`).join('、');
  blocks.push(para(
    `共 ${row.node_count ?? (w?.nodes || []).length} 个节点，其中业务阶段 ${row.stage_count ?? 0} 个。` +
    `\n节点构成：${detail || '无'}` +
    `\n（Nodes=画布全部节点，含入口/准备/裁决/告警等技术脚手架；Stages=真正的业务阶段）`));
  const agents = row.uses_agents || [];
  if (agents.length) blocks.push(para(`执行 agent：${agents.join('、')}`));
  return blocks;
}

