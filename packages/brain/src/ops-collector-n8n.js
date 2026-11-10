
// ─── run 记录（n8n 执行历史）────────────────────────────────────────────
// 数据源实证：n8n 用 Postgres（非 sqlite），hk-vps 容器 zenithjoy-db-postgres 库 n8n
// 表 execution_entity。字段 workflowId/status(success|error|crashed)/startedAt/stoppedAt/mode。
// 频次实证（12天）：业务流程日均 10-21 轮、每轮 38-70 分钟；通道类日均 154-234 次、4秒-9分钟。
// token 消耗 n8n 不记录（在 OpenClaw 会话侧），本模块不含。

export function parseN8nRuns(list, machine) {
  if (!Array.isArray(list)) return [];
  return list.map((e) => {
    const started = e?.startedAt ? new Date(e.startedAt) : null;
    const stopped = e?.stoppedAt ? new Date(e.stoppedAt) : null;
    // crashed 常无 stoppedAt → duration 留 null，禁编造耗时
    const duration = started && stopped ? Math.round((stopped - started) / 1000) : null;
    return {
      run_id: String(e?.id ?? ''),
      wf_id: String(e?.workflowId ?? ''),
      status: String(e?.status ?? ''),
      mode: e?.mode ? String(e.mode) : null,
      machine: machine || null,
      started_at: started ? started.toISOString() : null,
      stopped_at: stopped ? stopped.toISOString() : null,
      duration_sec: duration,
    };
  }).filter((r) => r.run_id && r.wf_id);
}

/**
 * 业务流程 vs 通道/触发器：有业务阶段的才是业务流程。
 * 用途：业务流程的 run 全量推 Notion（一天几十条）；通道类只推汇总（日均上百次会淹没视线）。
 */
export function isBusinessWorkflow(wf) {
  return (wf?.stage_count ?? 0) > 0;
}

/** 流程健康汇总：次数/成功率/平均耗时/最近一次。没样本不编造成功率。 */
export function summarizeRuns(runs = []) {
  const list = Array.isArray(runs) ? runs : [];
  const total = list.length;
  const success = list.filter((r) => r.status === 'success').length;
  const withDur = list.filter((r) => typeof r.duration_sec === 'number');
  const sorted = [...list].filter((r) => r.started_at)
    .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  return {
    total,
    success,
    failed: total - success,                       // error + crashed 都算失败
    success_rate: total ? Math.round((success / total) * 100) : null,
    avg_duration_sec: withDur.length
      ? Math.round(withDur.reduce((s, r) => s + r.duration_sec, 0) / withDur.length)
      : null,                                      // 全崩无耗时 → null 而非 0
    last_run_at: sorted[0]?.started_at ?? null,
    last_status: sorted[0]?.status ?? null,
  };
}

// n8n 执行历史查询（hk-vps 容器内 psql，输出 JSON）。限 45 天窗口避免拉全表。
// SQL 是代码内固定常量（无任何外部输入拼接），双引号按 shell 需要**直接写成转义形态**，
// 不做运行时 replace 转义——避免不完整转义（未处理反斜杠）的安全告警。
const N8N_RUNS_SQL_ESCAPED = [
  'SELECT json_agg(t) FROM (',
  '  SELECT id, \\"workflowId\\", status, mode, \\"startedAt\\", \\"stoppedAt\\"',
  '  FROM execution_entity',
  '  WHERE \\"startedAt\\" > NOW() - make_interval(days => 45)',
  '  ORDER BY \\"startedAt\\" DESC LIMIT 5000',
  ') t',
].join(' ');

export const N8N_RUNS_CMD =
  'ssh -o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=no root@100.86.118.99 ' +
  `'docker exec zenithjoy-db-postgres psql -U n8n -d n8n -tAc "${N8N_RUNS_SQL_ESCAPED}"'`;


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


// ─── 阶段级归因（刀8-A）───────────────────────────────────────────────
// n8n execution_data.data 是**扁平化指针格式**：顶层数组，字符串数字=索引引用。
// 实证：runData 含全部节点，每个「阶段 X」节点带 executionStatus 与 executionTime（毫秒）。
// 价值：流程级 status=success ≠ 每阶段都成功（实测有 success 的 run 走了中止归档），
// 逐 skill 的真实成功率只能从这里来。

/** 扁平指针解引用：字符串数字 → 取数组对应项；否则原样。 */
function derefFlat(flat, v) {
  return (typeof v === 'string' && /^\d+$/.test(v)) ? flat[Number(v)] : v;
}

export function parseN8nExecutionStages(flat) {
  const empty = { stages: [], last_node: null };
  if (!Array.isArray(flat) || flat.length === 0) return empty;
  try {
    const resultData = derefFlat(flat, flat[0]?.resultData);
    if (!resultData || typeof resultData !== 'object') return empty;
    const runData = derefFlat(flat, resultData.runData);
    if (!runData || typeof runData !== 'object') return empty;
    const lastNode = derefFlat(flat, resultData.lastNodeExecuted);
    const stages = [];
    for (const [nodeName, ptr] of Object.entries(runData)) {
      if (!String(nodeName).startsWith('阶段')) continue;   // 裁决/准备等非业务阶段不计
      const runs = derefFlat(flat, ptr);
      const first = Array.isArray(runs) ? derefFlat(flat, runs[0]) : null;
      if (!first || typeof first !== 'object') continue;
      const ms = Number(derefFlat(flat, first.executionTime));
      stages.push({
        stage: String(nodeName).replace(/^阶段\s*/, ''),
        status: String(derefFlat(flat, first.executionStatus) || 'unknown'),
        duration_sec: Number.isFinite(ms) ? Math.round(ms / 1000) : null,
      });
    }
    return { stages, last_node: typeof lastNode === 'string' ? lastNode : null };
  } catch {
    return empty;   // 一条坏记录不能让整条采集腿死
  }
}

/** 按 阶段→skill 映射汇总：每个 skill 跑了几次、成功率、平均耗时。映射不到的阶段跳过。 */
export function aggregateStageStats(executions, stageToSkill = {}) {
  const acc = new Map();
  for (const ex of (Array.isArray(executions) ? executions : [])) {
    for (const st of (ex?.stages || [])) {
      const skill = stageToSkill[st.stage];
      if (!skill) continue;                              // 未知阶段绝不硬塞给某个 skill
      if (!acc.has(skill)) acc.set(skill, { runs: 0, success: 0, _sum: 0, _n: 0 });
      const a = acc.get(skill);
      a.runs += 1;
      if (st.status === 'success') a.success += 1;
      if (typeof st.duration_sec === 'number') { a._sum += st.duration_sec; a._n += 1; }
    }
  }
  const out = new Map();
  for (const [skill, a] of acc) {
    out.set(skill, {
      runs: a.runs,
      success: a.success,
      success_rate: Math.round((a.success / a.runs) * 100),
      avg_sec: a._n ? Math.round(a._sum / a._n) : null,
    });
  }
  return out;
}


/**
 * 阶段名 → 执行它的 skill（刀8）。目前手工维护：n8n 阶段名与 skill 名不同源，
 * 无法自动推断。改阶段名会让映射失效且**不报错**——故 aggregateStageStats 对
 * 未知阶段一律跳过（禁硬塞给某个 skill），未映射阶段可由 /agent-ops/graph 观察到。
 */
export const STAGE_TO_SKILL = {
  手机预检: 'douyin-phone-runtime',
  视频发现: 'social-video-discovery',
  全文判定: 'social-video-qualifier',
  评论采集: 'social-comment-lead-collector',
  线索评分: 'social-comment-lead-scorer',
  去重配送: 'social-lead-delivery',
  线索触达: 'social-lead-outreach',
  手机归位: 'douyin-phone-runtime',
};

// 阶段级执行数据查询（限量避免拉爆：每条 ~80KB）
const N8N_STAGE_SQL = [
  'SELECT json_agg(t.d) FROM (',
  '  SELECT d.data::json AS d FROM execution_data d',
  '  JOIN execution_entity e ON e.id = d.$$executionId$$',
  '  WHERE e.$$startedAt$$ > NOW() - make_interval(days => 30)',
  // 只拉真正含业务阶段的执行：120 条里仅 7 条有（其余是通道/触发器的轻量 run），
  // 不筛的话 19.5MB 里 96% 是废数据，95 秒贴近超时上限（2026-09-08 实证）
  // 用 chr() 拼中文字面量，避开 shell/psql 多层引号转义（LIKE 里不能用双引号）
  '    AND position(chr(38454) || chr(27573) || chr(32) IN d.data) > 0',
  '  ORDER BY d.$$executionId$$ DESC LIMIT 30',
  ') t',
].join(' ').replace(/[$][$]/g, String.fromCharCode(92, 34));  // $$ → \" （shell 内的转义双引号）

export const N8N_STAGE_DATA_CMD =
  'ssh -o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=no root@100.86.118.99 ' +
  `'docker exec zenithjoy-db-postgres psql -U n8n -d n8n -tAc "${N8N_STAGE_SQL}"'`;


/**
 * eval 分数入库通道（刀8-B 框架）。真机评测跑完后调它把分数落成新的一代，
 * Notion 上自动出演进曲线。评测执行本身需真机（xian-m4/HONOR/抖音）+ 评测集，另行安排。
 * 判据来自 09-05 A/B 实测方法：有 skill 臂 vs 无 skill 臂同题同模型对照。
 */
export function buildEvalRecord({ skill, withSkill, withoutSkill, total, suite, note } = {}) {
  if (!skill) throw new Error('skill 必填');
  if (!Number.isFinite(total) || total <= 0) throw new Error('total（评测题数）必填且为正');
  if (!Number.isFinite(withSkill) || withSkill < 0) throw new Error('withSkill 必填');
  if (withSkill > total) throw new Error(`withSkill(${withSkill}) 超过 total(${total})`);
  if (withoutSkill != null && withoutSkill > total) throw new Error(`withoutSkill 超过 total`);
  const pct = (n) => Math.round((n / total) * 100);
  const score = pct(withSkill);
  const baseline = withoutSkill == null ? null : pct(withoutSkill);
  const raw = baseline == null
    ? `${withSkill}/${total} (${score}%)${suite ? ` [${suite}]` : ''}`
    : `with_skill ${withSkill}/${total} (${score}%) vs without_skill ${withoutSkill}/${total} (${baseline}%)${suite ? ` [${suite}]` : ''}`;
  return {
    skill_name: skill,
    eval_score: score,
    eval_baseline: baseline,
    lift: baseline == null ? null : score - baseline,   // 提升幅度=这个 skill 到底值不值
    eval_raw: raw,
    suite: suite || null,
    change_note: [suite ? `评测集 ${suite}` : null, note].filter(Boolean).join('；') || '评测入库',
  };
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

// ─── n8n workflow（真业务流程，非"谁召唤谁"）───────────────────────────
// 实证：AwrSocialLeadgenV4「Social Leadgen V4」8 阶段(手机预检/视频发现/全文判定/评论采集/
// 线索评分/去重配送…)，每阶段经 OpcCmdStageCallV4 通道单点调 agentId=work-commander。
// 故 agent 归属必须走**传递闭包**（主流程自身不含 agentId，只有子流程有）。

/** 只数「阶段 X」节点——裁决/入口/准备节点不算业务阶段 */
export function countStages(nodes = []) {
  return (nodes || []).filter((n) => String(n?.name || '').startsWith('阶段')).length;
}

export function parseN8nWorkflows(list) {
  if (!Array.isArray(list)) return [];
  return list.map((w) => {
    const nodes = w?.nodes || [];
    return {
      wf_id: String(w?.id || ''),
      name: String(w?.name || ''),
      active: w?.active === true,
      node_count: nodes.length,
      stage_count: countStages(nodes),
      meta: {
        stages: buildStageFlow(w),   // 按真实连线的执行序，非画布摆放序
        // 画布骨架（仅节点名/类型+连线，无参数/凭据）——供 Notion 页画流程图
        canvas: {
          nodes: nodes.map((n) => ({ name: n?.name, type: n?.type })),
          connections: w?.connections || {},
        },
      },
    };
  }).filter((r) => r.wf_id);
}

/** 一个画布调用的子流程 id（executeWorkflow 节点，workflowId 可能是字符串或 {value}） */
function subWorkflowIds(w) {
  const out = new Set();
  for (const n of w?.nodes || []) {
    if (!String(n?.type || '').includes('executeWorkflow')) continue;
    let wid = n?.parameters?.workflowId;
    if (wid && typeof wid === 'object') wid = wid.value || wid.cachedResultName;
    if (typeof wid === 'string' && wid) out.add(wid);
  }
  return out;
}

/**
 * 传递闭包解析一条流程真正用到的 agent：自身 agentId 引用 ∪ 所有子流程的（递归）。
 * seen 防循环调用死循环。
 */
export function resolveWorkflowAgents(wfId, allWorkflows, seen = new Set()) {
  if (!wfId || seen.has(wfId)) return [];
  seen.add(wfId);
  const w = (allWorkflows || []).find((x) => x?.id === wfId);
  if (!w) return [];
  // 真实格式（实证 OpcCmdStageCallV4）：agent 走 HTTP 头 x-openclaw-agent-id，
  // 形如 {"name":"x-openclaw-agent-id","value":"work-commander"}；也兼容 JSON 字段 agentId 写法。
  // 序列化后字符串参数内的引号会被转义，故正则容忍反斜杠。
  const raw = JSON.stringify(w);
  const found = new Set([
    ...[...raw.matchAll(/x-openclaw-agent-id\\?["'],?\s*\\?["']?value\\?["']?\s*:\s*\\?["']([a-z0-9-]{3,40})/gi)].map((m) => m[1]),
    ...[...raw.matchAll(/agentId\\?["']\s*:\s*\\?["']([a-z0-9-]{3,40})/gi)].map((m) => m[1]),
  ]);
  for (const sub of subWorkflowIds(w)) {
    for (const a of resolveWorkflowAgents(sub, allWorkflows, seen)) found.add(a);
  }
  return [...found].sort();
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

export const N8N_LIST_CMD =
  "ssh -o BatchMode=yes -o ConnectTimeout=6 -o StrictHostKeyChecking=no root@100.86.118.99 " +
  "'docker exec n8n sh -c \"n8n export:workflow --all --output=/tmp/ops-all.json >/dev/null 2>&1; cat /tmp/ops-all.json\"'";

