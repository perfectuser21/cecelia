// 运行舱 Notion 四库的列定义 + 幂等补列。
//
// 血训（2026-09-06 记过一次，09-08 又踩同一个坑）：建库脚本只在**新建**库时带 properties，
// 复用已有库时不补列。于是代码里新加一个列 → 推送 400 "X is not a property that exists"
// → upsertOpsRows 的逐行 catch 吞掉 → 看板静默停更，没有任何人收到通知。
// 把列定义集中到这里 + 缺列即补做成幂等，以后加列只改这一处。
//
// 列分两类（决策：机器列单向 / 人工列回写）：
//   机器列——采集器算出来推上去，人在 Notion 改了会被下轮覆盖
//   人工列——只有人填，机器永不推（推了会把人改的冲掉），由 ops-notion-ingest 读回 Brain

/** 三库共用的人工列。类型必须与 buildOpsManualReadback 的读法严格对齐。 */
const MANUAL_PROPS = {
  Owner: { rich_text: {} },      // 负责人
  Note: { rich_text: {} },       // 备注
  Priority: { select: {} },      // P0/P1/P2/P3
  Starred: { checkbox: {} },     // 关注标记
};

export const OPS_DB_PROPS = {
  // 运行图谱库：一行 = 一个运行单元（agent 或排程）
  graph: {
    Name: { title: {} }, Source: { select: {} }, Machine: { select: {} },
    Role: { select: {} },
    Type: { rich_text: {} },
    Schedule: { rich_text: {} },
    Repeat: { checkbox: {} }, NextRun: { date: {} }, LastSeen: { date: {} },
    Status: { select: {} },
    // 模型账号配额列（刀2，机器列：采集器推 5h%/7d%/更新时间，缺列即补幂等）
    FiveHourPct: { number: {} },
    SevenDayPct: { number: {} },
    QuotaUpdatedAt: { date: {} },
    ...MANUAL_PROPS,
    Org: { rich_text: {} },          // 部门（人工，机器推断值留在 Brain 的 org 列）
    RoleManual: { rich_text: {} },   // 角色（人工，与机器推断的 Role 分开列免打架）
  },

  // 业务流程库：workflow = 业务流程（智能获客 8 阶段），与 agent（执行资源）分开
  workflows: {
    Name: { title: {} }, Source: { select: {} }, Active: { checkbox: {} },
    Stages: { number: {} }, Flow: { rich_text: {} },
    Nodes: { number: {} }, WfId: { rich_text: {} },
    Machine: { select: {} }, Runs: { number: {} }, SuccessRate: { number: {} },
    AvgMinutes: { number: {} }, LastRun: { date: {} }, LastStatus: { select: {} },
    // 活性告警（本次 400 的直接原因）
    Liveness: { select: {} },        // 🟢正常 / 🟡放缓 / 🔴失联 / ⚪数据不足
    SilentFor: { rich_text: {} },    // 「停了 20.4 小时」
    ...MANUAL_PROPS,
    // 停用意图入口。主理人拍板「直接生效真去停 n8n」——这个勾一改就会触达生产。
    Enabled: { checkbox: {} },
  },

  // 技能池：最小执行单元
  skills: {
    Name: { title: {} }, Source: { select: {} },
    UsedBy: { number: {} }, Generation: { number: {} },
    EvalScore: { number: {} }, Runs: { number: {} }, SuccessRate: { number: {} },
    AvgSeconds: { number: {} },
    DiscoStage: { select: {} },       // 机器自动判定（只读）
    StageReason: { rich_text: {} },   // 判定依据，让人看懂为什么是这档
    HasProbe: { checkbox: {} },
    ...MANUAL_PROPS,
    Stage: { select: {} },            // 档位人工覆盖，生效值取人工优先
  },

  // task_runs 投影库「Runs」（链 bf5088a3 棒1）：一次执行 = 一行 task_runs = 一页；库在
  // notion_projection_map 登记为 push+active 后由 notion-push-sync.pushTaskRuns 推送并补缺列
  task_runs: {
    Name: { title: {} }, Status: { select: {} }, Source: { select: {} },
    TaskId: { rich_text: {} }, RunId: { rich_text: {} },
    StartedAt: { date: {} }, EndedAt: { date: {} },
    ExitCode: { number: {} }, Artifacts: { rich_text: {} },
    Minutes: { number: {} }, Error: { rich_text: {} },
  },

  // run 记录库：只存业务流程的每次执行
  runs: {
    Name: { title: {} }, Status: { select: {} }, Machine: { select: {} },
    Mode: { select: {} }, Minutes: { number: {} }, StartedAt: { date: {} },
    RunId: { rich_text: {} },
  },
};

/**
 * Tasks 投影库（NOTION_TASKS_DB）的缺列即补清单（链 bf5088a3 棒5·PR B）。
 * 库既有列（2026-09-25 实测）：Name / Status / Description / Project(dual→Projects) / Blocked by(dual 自关联) ...
 * 这里只列「pushTasks 会用到、且可能缺」的列：Blocked by 是自关联，database_id 必须是 Tasks 库自己，
 * 所以是函数不是常量。已存在则 diffMissingProps 不重发（不覆盖人在 Notion 上调过的配置）。
 */
export function buildTasksDbProps(tasksDbId) {
  return {
    'Blocked by': { relation: { database_id: tasksDbId, dual_property: {} } },
  };
}

/**
 * 验证层两库（链 bf5088a3 棒4-2，决策 10a68212）：step_probes 全行 →「探针」库；
 * journey_assertion_receipts 业务探针行 →「判定回执」库。列名按主理人口径中文；
 * 建库脚本 scripts/ops/create-probe-notion-dbs.js 与推送方 notion-probe-projection.js 共用，缺列即补。
 */
export const PROBE_DB_PROPS = {
  step_probes: {
    '探针键': { title: {} }, '工作流': { select: {} }, '步骤': { select: {} },
    '查什么': { rich_text: {} }, '期望': { rich_text: {} }, '严重级': { select: {} },
    '启用': { checkbox: {} }, '哈希前缀': { rich_text: {} }, '关联格子': { rich_text: {} },
    '说明': { rich_text: {} },
  },
  probe_receipts: {
    '名称': { title: {} }, '时间': { date: {} }, '批次': { rich_text: {} },
    '路径名': { rich_text: {} }, '步骤名': { rich_text: {} }, '探针': { rich_text: {} },
    '读回': { rich_text: {} }, '期望': { rich_text: {} }, '判定': { select: {} },
    '严重级': { select: {} }, '原因': { rich_text: {} },
  },
};

/**
 * 「价值流 Value Streams」库（map_projection_nodes value_stream 节点的只读镜子，决策 e00d9cc3 / 9d5fce74）：
 * 一行 = 一条价值流（scope + node_key），能力列 = contains 边指向的 capability 名逐行列出。
 * 建库脚本 scripts/ops/create-value-stream-notion-db.js 与推送方 notion-map-value-streams.js 共用，缺列即补。
 * 「状态」列：active run 里节点消失 → 已归档（不删页面）。
 */
export const VALUE_STREAM_DB_PROPS = {
  Name: { title: {} },
  Key: { rich_text: {} },
  Scope: { select: { options: [{ name: 'cecelia' }, { name: 'zenithjoy-workspace' }] } },
  Persona: { rich_text: {} },
  '能力': { rich_text: {} },
  '能力数': { number: {} },
  '地图版本': { rich_text: {} },
  '同步时间': { date: {} },
  '状态': { select: { options: [{ name: '在册' }, { name: '已归档' }] } },
};

/**
 * 「承诺地图格子」库（journey_step_links 的镜子，迁移 479 起）：格子列 + Journey 文本列。
 * Journey 不做 relation：AI Journey 库 358c… 与旧 Backbone-Step Map 369c… 2026-09-19 一起进了回收站
 * （GET 200 但写入/建 relation 404，09-27 上产实证），journeys.notion_id 全指向死页，只能投路径名文本。
 */
export function buildStepLinkDbProps() {
  return {
    CellKind: { select: {} }, CellKey: { rich_text: {} }, CellStatus: { select: {} },
    AssertionRef: { rich_text: {} }, Journey: { rich_text: {} },
    FlowP50Ms: { number: { format: 'number' } }, FlowFirstPassYield: { number: { format: 'percent' } },
    FlowPassRate: { number: { format: 'percent' } }, FlowSpanCount: { number: { format: 'number' } },
    FlowMetrics: { rich_text: {} },
  };
}

/**
 * 算出目标库缺哪些列。只返回缺的——已存在的列绝不重发，
 * 免得 PATCH 覆盖掉人在 Notion 上手动调过的列配置（比如 select 的选项颜色）。
 * 列名大小写敏感：Notion 本身就敏感，归一化只会制造重复列。
 */
export function diffMissingProps(existingProps, wantedProps) {
  const have = existingProps && typeof existingProps === 'object' ? existingProps : {};
  const out = {};
  for (const [k, v] of Object.entries(wantedProps || {})) {
    if (!(k in have)) out[k] = v;
  }
  return out;
}
