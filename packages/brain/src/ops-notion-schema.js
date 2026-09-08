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

  // run 记录库：只存业务流程的每次执行
  runs: {
    Name: { title: {} }, Status: { select: {} }, Machine: { select: {} },
    Mode: { select: {} }, Minutes: { number: {} }, StartedAt: { date: {} },
    RunId: { rich_text: {} },
  },
};

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
