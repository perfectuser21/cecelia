/**
 * Brain Manifest — 意识模块分块注册表
 *
 * 每个模块在此处声明所属块（block）、性质（nature）。
 * 前端从 GET /api/brain/manifest 拉取，自动构建分层视图。
 * 新增模块只需在此处注册，无需改前端代码。
 *
 * 5 块架构（自我中心意识）：
 *   外界接口 → 感知层 → 意识核心 → 行动层
 *                ↑                    ↓
 *            自我演化（慢回路）←──────┘
 *
 * nature 字段含义：
 *   dynamic  🔄 — 每 tick 更新 working_memory，状态易变
 *   growing  📈 — 随时间积累、演化，历史数据不断增长
 *   fixed    🔒 — 静态逻辑，不随时间变化（Cecelia 当前全动态）
 */

export const BRAIN_MANIFEST = {
  version: '4.0.0',

  blocks: [
    {
      id: 'interface',
      label: '外界接口',
      color: '#f97316',
      desc: '信息输入口——对话、飞书事件、任务回调',
      nodeIds: ['tick', 'dialog'],
      modules: [
        {
          id: 'tick',
          label: 'Tick 心跳',
          desc: '5s 循环驱动，Brain 心脏，每 5min 执行一次 tick',
          file: 'tick.js',
          nature: 'dynamic',
        },
        {
          id: 'dialog',
          label: '对话系统',
          desc: 'orchestrator-chat — 飞书/WebSocket 消息快速处理路径',
          file: 'orchestrator-chat.js',
          nature: 'dynamic',
        },
      ],
    },

    {
      id: 'perception',
      label: '感知层',
      color: '#6366f1',
      desc: '信号感知——16 个感知信号（工作+非工作）+ 情绪推导 + 记忆检索',
      nodeIds: ['emotion'],
      modules: [
        {
          id: 'perception_signals',
          label: '感知信号',
          desc: '16 个感知信号：工作 KR/任务/系统 + 非工作 好奇/对话质量/知识空白（点击查看详情）',
          file: 'desire/perception.js',
          nature: 'dynamic',
        },
        {
          id: 'emotion',
          label: '情绪层',
          desc: '基于感知信号推导当前情绪状态（calm/excited/curious/anxious/tired）',
          file: 'emotion-layer.js',
          nature: 'dynamic',
        },
        {
          id: 'memory_retriever',
          label: '记忆检索',
          desc: '从 memory_stream 检索相关情景记忆，注入意识核心上下文',
          file: 'memory-retriever.js',
          nature: 'dynamic',
        },
      ],
    },

    {
      id: 'core',
      label: '意识核心',
      color: '#a855f7',
      desc: '丘脑路由 + 皮层分析 + 欲望形成 + 反刍洞察',
      nodeIds: ['thalamus', 'cortex', 'cognitive', 'desire', 'rumination'],
      modules: [
        {
          id: 'thalamus',
          label: '丘脑 L1',
          desc: '快速事件路由，Action 白名单校验，Haiku 模型',
          file: 'thalamus.js',
          nature: 'dynamic',
        },
        {
          id: 'cortex',
          label: '皮层 L2',
          desc: '深度分析，RCA，战略调整，Sonnet 模型',
          file: 'cortex.js',
          nature: 'dynamic',
        },
        {
          id: 'cognitive',
          label: '认知核心',
          desc: '汇总情绪 + 记忆 + 自我模型，生成认知状态快照',
          file: 'cognitive-core.js',
          nature: 'dynamic',
        },
        {
          id: 'desire',
          label: '欲望系统',
          desc: '感知→情绪→记忆→反思→欲望形成→表达（6 层管道）',
          file: 'desire/index.js',
          nature: 'growing',
        },
        {
          id: 'rumination',
          label: '反刍',
          desc: '批量深度反思，30min 周期，洞察写回 self_model',
          file: 'rumination.js',
          nature: 'growing',
        },
      ],
    },

    {
      id: 'action',
      label: '行动层',
      color: '#22c55e',
      desc: '调度执行——规划任务、执行任务、建议路由与防护机制',
      nodeIds: ['planner', 'executor', 'suggestion', 'immune'],
      modules: [
        {
          id: 'planner',
          label: '调度规划',
          desc: '选择下一个任务，KR 轮转评分，资源检查',
          file: 'planner.js',
          nature: 'dynamic',
        },
        {
          id: 'executor',
          label: '执行器',
          desc: '派发并监控任务，bridge → claude -p /skill 调用链',
          file: 'executor.js',
          nature: 'dynamic',
        },
        {
          id: 'suggestion',
          label: '建议系统',
          desc: '欲望→行动建议评分（score >= 0.7）——⚠️ P0: 下游 planner 路径已废弃（PR #252）',
          file: 'suggestion-triage.js',
          nature: 'dynamic',
        },
        {
          id: 'immune',
          label: '免疫系统',
          desc: '隔离区管理，警觉等级（ALERT_1/2/3），自动熔断',
          file: 'alertness.js',
          nature: 'dynamic',
        },
      ],
    },

    {
      id: 'evolution',
      label: '自我演化',
      color: '#ec4899',
      desc: '慢回路——自我认知写回，学习沉淀，记忆系统，自我报告',
      nodeIds: ['self_model', 'learning', 'memory'],
      modules: [
        {
          id: 'self_model',
          label: '自我模型',
          desc: '动态自我认知（好奇心/审美/关系感/存在感），rumination 写回',
          file: 'self-model.js',
          nature: 'growing',
        },
        {
          id: 'learning',
          label: '学习',
          desc: 'PR 开发洞察 + 系统模式沉淀，content_hash 去重',
          file: 'learning.js',
          nature: 'growing',
        },
        {
          id: 'memory',
          label: '记忆系统',
          desc: 'memory_stream L0/L1 + 情景记忆，episodic + working_memory',
          file: 'memory-retriever.js',
          nature: 'growing',
        },
        {
          id: 'self_report',
          label: '自我报告',
          desc: '6h 欲望轨迹采集（⚠️ 待闭环：需要 consumer 分析下游）',
          file: 'self-report-collector.js',
          nature: 'growing',
        },
      ],
    },
  ],

  // 块间连接（用于 Overview Level 1 可视化）
  blockConnections: [
    {
      from: 'interface',
      to: 'perception',
      label: '外部信号',
      type: 'primary',
      desc: 'tick 信号 + 飞书事件 → 感知层量化处理',
      broken: false,
    },
    {
      from: 'interface',
      to: 'core',
      label: '对话→丘脑',
      type: 'fast_path',
      desc: 'orchestrator-chat 快速路径：不走深层感知，直接到丘脑路由',
      broken: false,
    },
    {
      from: 'perception',
      to: 'core',
      label: '感知→意识',
      type: 'primary',
      desc: '情绪状态 + 记忆检索结果 → 注入意识核心上下文',
      broken: false,
    },
    {
      from: 'core',
      to: 'action',
      label: '决策→行动',
      type: 'primary',
      desc: '丘脑路由任务 → 调度规划 → 执行器（⚠️ suggestion→planner 子路径已废弃）',
      broken: false,
    },
    {
      from: 'action',
      to: 'evolution',
      label: '结果→演化',
      type: 'feedback',
      desc: '任务结果 → memory_stream → rumination → self_model 写回',
      broken: false,
    },
    {
      from: 'evolution',
      to: 'perception',
      label: '自我→感知',
      type: 'feedback',
      desc: '更新的 self_model → 下一 tick 注入 perception 上下文',
      broken: false,
    },
  ],

  // 模块级别断路连接（Level 2 可视化标红）
  brokenConnections: [
    {
      from: 'suggestion',
      to: 'planner',
      reason: 'PR #252 废弃 suggestion-dispatcher.js，欲望信号现在直接到 executor',
      severity: 'P0',
    },
  ],

  // 已知问题（孤岛/盲场）
  issues: [
    {
      severity: 'P0',
      type: 'broken_connection',
      title: 'suggestion→planner 路径断路',
      detail: 'PR #252 后 suggestion-dispatcher.js 废弃，desire→suggestion→planner 路径不再工作。图上的线已是死路。',
      affected: ['suggestion', 'planner'],
    },
    {
      severity: 'P1',
      type: 'no_consumer',
      title: '3 个感知信号无下游消费者',
      detail: 'task_completed_today / time_aware_greeting / intellectual_idle 信号产生后无人消费，形成信息浪费。',
      affected: ['perception_signals'],
    },
  ],
};
