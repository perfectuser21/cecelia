---
id: design-proactive-cecelia-ui
version: 1.0.0
created: 2026-02-26
updated: 2026-02-26
changelog:
  - 1.0.0: 初始版本 — Ambient Agent + Mission Control 混合型设计
---

# Cecelia 主动式前端设计方案

> **核心转变**：从"你说她回"的反应式仪表盘，变成"她主动汇报、你一键决策"的管家界面。

## 一、设计理念

### 当前问题

CeceliaPage V2 本质是 **监控仪表盘 + 被动聊天框**：
- PulseStrip / AgentMonitor / EventStream = Grafana
- CommandPalette (Cmd+K) = Slack bot

后端已有的 **6 层意识管道 + 反刍回路** 完全没展示：

| 后端能力 | 数据 | 前端现状 |
|---------|------|---------|
| 感知 (perception) | 9 类系统信号 | 不展示 |
| 记忆打分 (memory) | importance 1-10 | 不展示 |
| 反思洞察 (reflection) | 30+ 分触发深度思考 | 不展示 |
| 反刍消化 (rumination) | 知识→OKR 关联→洞察 | 不展示 |
| 欲望形成 (desire) | 7 种类型意图 | 仅 CommandPalette 弱展示 |
| 表达决策 (expression) | 多维评分 > 0.35 | 不展示 |
| 自主行动 (act/follow_up) | 自动创建任务 | 不展示 |

### 目标设计

**Ambient Agent + Mission Control 混合型**：

1. **Cecelia 先说话** — 她的想法/洞察/建议占据主区域
2. **你一键决策** — 待审批项像 inbox，批准/否决/推迟
3. **内心可见** — 她在想什么、消化什么、计划做什么，全部透明
4. **监控降级** — 数据指标退到次要位置，不再是主角

### 行业参考

| 范式 | 代表 | 我们取什么 |
|------|------|----------|
| Ambient Agent | Moveworks / ZBrain | 后台运行 + 主动推送洞察 |
| Mission Control | Linear / Datadog | 需要决策的项高亮 + 一键操作 |
| Proactive Nudge | Codewave Agentic UI | 合适时机主动出现 |
| Activity Feed | bprigent 7 UX Patterns | 逆序任务流 + oversight inbox |

---

## 二、页面布局

### 整体结构（单页，不分 tab）

```
┌──────────────────────────────────────────────────────────────┐
│  ⬤ Cecelia 在线 · 反刍中(2/10) · 上次思考 3min · 警觉:正常   │  ← StatusBar
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ Cecelia 说 ───────────────────────────────────────────┐  │
│  │  "PR #23 合并了。我消化了你分享的 RAG 文章，发现和       │  │  ← VoiceCard
│  │   Cecelia 记忆系统 KR 有关联。7 个 P0 等排队。           │  │
│  │   建议先做 Task Intelligence。"                         │  │
│  │                                                         │  │
│  │   [同意] [换一个] [对话]              2 分钟前            │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 等你决策 (3) ─────────────────────────────────────────┐  │
│  │  📋 秋米拆完 "对话记忆" KR          [批准] [打回]        │  │  ← DecisionInbox
│  │  🧠 反刍洞察: RAG+记忆关联          [采纳] [忽略]        │  │
│  │  🔬 Cecelia 想研究 Vector DB        [同意] [推迟]        │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 正在做 ─────────┐  ┌─ 内心活动 ─────────────────────┐  │
│  │ ● /dev task-xyz   │  │  🧠 反思累积 25/30             │  │  ← 双列
│  │   ██████░ 60%     │  │  📖 反刍: 消化 "RAG入门" ...   │  │
│  │   Caramel · 10min │  │  👁 感知: system_idle           │  │
│  │                   │  │  💭 欲望队列: 2 pending         │  │
│  │ （无其他任务）      │  │  📝 记忆: 写入 3 条 (avg 6.2)  │  │
│  └───────────────────┘  └────────────────────────────────┘  │
│                                                              │
│  ┌─ 今日动态 ─────────────────────────────────────────────┐  │
│  │  18:30 🧠 [反刍] 消化"RAG入门"→ 洞察: 可用于记忆检索优化 │  │  ← ActivityFeed
│  │  18:22 ✅ PR #23 合并到 main                            │  │
│  │  17:45 🧠 [反思] "CI 覆盖率不足，建议加测试"             │  │
│  │  17:00 📦 派发 task-xyz 给 Caramel                      │  │
│  │  16:30 💡 [欲望] 想研究 Vector DB (urgency: 6)          │  │
│  │  15:00 👁 [感知] 检测到 queue_buildup: 7 tasks          │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─ 快速指令 ─────────────────────────────────────────────┐  │
│  │  [对话] [触发Tick] [查看全部任务] [暂停Cecelia] [设置]    │  │  ← QuickActions
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、组件设计

### 3.1 StatusBar（状态条）

替代现有 PulseStrip，一行展示 Cecelia 的"生命体征"。

```
⬤ 在线 · 反刍 2/10 · 累积 25/30 · 思考 3min 前 · 警觉:正常 · 今日: 5完成 2失败
```

| 指标 | 数据源 | 更新方式 |
|------|-------|---------|
| 在线状态 | /api/brain/health | 定时轮询 |
| 反刍进度 | tick result → rumination.digested / DAILY_BUDGET | WebSocket tick:executed |
| 反思累积 | working_memory[desire_importance_accumulator] | WebSocket tick:executed |
| 上次思考 | reflection.triggered 时间 | WebSocket tick:executed |
| 警觉等级 | /api/brain/alertness | WebSocket alertness:changed |
| 今日统计 | /api/brain/briefing | WebSocket tick:executed |

### 3.2 VoiceCard（Cecelia 的话）

**核心组件**：展示 Cecelia 最近的主动表达（desires + briefing + rumination insights）。

数据来源：
1. **desire:expressed** 事件（type=inform/warn/propose/celebrate）→ 主动推送
2. **反刍洞察**（memory_stream 中 `[反刍洞察]` 前缀）→ 消化知识后的发现
3. **反思洞察**（memory_stream 中 `[反思洞察]` 前缀）→ 深度思考结果
4. **briefing.greeting** → 首次打开页面时的简报

**交互**：
- 如果是 propose 类型 → 显示 [同意] [换一个] 按钮
- 如果是 warn 类型 → 显示 [处理] [知道了] 按钮
- 如果是 inform/celebrate → 无按钮，自动淡出
- 总是显示 [对话] 按钮 → 打开聊天面板深入讨论

**反刍融入**：当反刍产出洞察时，VoiceCard 显示类似：
```
"我刚消化了你分享的《RAG 入门》。
 发现它和你的 KR '记忆系统优化' 直接相关 ——
 RAG 的检索增强生成可以用来改进 memory-retriever。"

 [深入研究] [记下了] [对话]
```

### 3.3 DecisionInbox（决策收件箱）

**核心组件**：所有需要用户决策的事项，inbox zero 为目标。

数据来源：
1. **desires (type=question/propose, status=pending)** → Cecelia 的提问/建议
2. **pending decisions** (/api/brain/decisions?status=pending) → 系统决策
3. **reviewing goals** (status=reviewing) → 等待审批的 KR 拆解
4. **反刍洞察 (importance≥7)** → 重要知识关联需要确认

每条决策项：
```
┌──────────────────────────────────────────────────────┐
│ 📋 秋米拆完 "对话记忆" KR                             │
│    3 个 Initiative / 12 个 Task / 预估 2 周            │
│    [批准] [打回并说明] [查看详情]         5 分钟前       │
└──────────────────────────────────────────────────────┘
```

### 3.4 InnerLife（内心活动面板）

**核心创新**：让用户看到 Cecelia 的"思维过程"——她在感知什么、想什么、消化什么。

#### 反刍进度条

```
📖 知识消化
   ████████░░ 8/10 今日已消化
   当前: "RAG 入门" → 关联 KR "记忆系统"
   下一条: "向量数据库对比" (30min 后)

   最近洞察:
   · RAG 检索增强可用于 memory-retriever 优化
   · Pinecone vs pgvector：pgvector 更适合当前架构
```

数据来源：
- `tick.rumination.digested` / `DAILY_BUDGET` → 进度
- `tick.rumination.insights[]` → 最近洞察
- `getUndigestedCount()` → 待消化数量
- `perception.undigested_knowledge` → 感知信号

#### 反思状态

```
🧠 反思累积
   ████████████████████████░░░░░░ 25/30
   再积累 5 分就触发深度反思
   上次洞察: "CI 覆盖率不足，建议补测试" (2h 前)
```

数据来源：
- `working_memory[desire_importance_accumulator]` → 累积值
- reflection 触发阈值 = 30
- memory_stream 中 `[反思洞察]` 条目

#### 感知雷达

```
👁 系统感知
   ✅ system_idle (空闲)
   ✅ user_online (你在线)
   ⚠️ queue_buildup: 7 tasks
   ⚠️ undigested_knowledge: 3 条
```

数据来源：`perception.observations[]`

#### 欲望队列

```
💭 欲望队列 (2 pending)
   · [propose] 建议研究 Vector DB (urgency: 6, score: 0.42)
   · [inform] CI 覆盖率提升到 85% (urgency: 3, score: 0.28)
   阈值: 0.35 | 下次表达评估: 下个 tick
```

数据来源：`desires` 表 (status=pending) + expression score

### 3.5 ActivityFeed（今日动态）

替代现有 EventStream，但增加"内心活动"类型的事件。

事件类型和图标映射：

| 类型 | 图标 | 来源 | 颜色 |
|------|------|------|------|
| 反刍洞察 | 📖 | rumination.insights | amber |
| 反思洞察 | 🧠 | reflection.insight | purple |
| 欲望形成 | 💭 | desire:created | blue |
| 欲望表达 | 💬 | desire:expressed | green |
| 自主行动 | ⚡ | desire (act/follow_up) | orange |
| 感知信号 | 👁 | perception | gray |
| 任务完成 | ✅ | task:completed | green |
| 任务失败 | ❌ | task:failed | red |
| 任务派发 | 📦 | task:created | blue |
| PR 合并 | 🔀 | cecelia_events | green |
| 决策执行 | ⚖️ | decision | teal |
| 知识学习 | 📝 | learnings insert | amber |

**关键区别**：不再只展示"系统事件"（task created/completed），而是展示 Cecelia 的**思维过程**（感知→记忆→反思→反刍→欲望→表达）。

### 3.6 RunningTasks（执行中任务）

保留现有 AgentMonitor 的核心功能，但简化为卡片列表：

```
● /dev task-xyz "Parser 单元测试"
  ██████████████░░░░░░░░ 60%
  Agent: Caramel · US VPS · 10 分钟前开始
  [查看日志] [终止]
```

数据源：WebSocket task:progress 事件 + /api/brain/cluster/scan-sessions

### 3.7 QuickActions（快速指令）

底部固定操作栏：

| 按钮 | 动作 |
|------|------|
| 对话 | 打开聊天面板（侧边抽屉，不是 Cmd+K） |
| 触发 Tick | POST /api/brain/tick |
| 全部任务 | 导航到任务列表页 |
| 暂停 Cecelia | 暂停 tick loop |
| 设置 | 导航到系统设置 |

---

## 四、数据流架构

### 需要新增的 API 端点

| 端点 | 方法 | 返回数据 | 用途 |
|-----|------|---------|------|
| /api/brain/rumination/status | GET | { dailyCount, dailyBudget, lastRunAt, cooldownMs, undigestedCount } | StatusBar + InnerLife |
| /api/brain/memory-stream | GET | 最近 N 条 memory_stream（可按 memory_type/importance 过滤） | InnerLife 反思+反刍展示 |
| /api/brain/desires | GET | 当前 desires 列表（可按 status 过滤） | DecisionInbox + InnerLife |
| /api/brain/desires/:id/acknowledge | POST | 用户确认/否决 desire | DecisionInbox 操作 |
| /api/brain/inner-life | GET | 聚合：perception 信号 + accumulator + 最近洞察 + 欲望队列 | InnerLife 一站式 |

### WebSocket 事件扩展

| 事件 | 数据 | 触发时机 |
|------|------|---------|
| rumination:completed | { digested, insights, dailyCount } | runRumination 完成时 |
| reflection:triggered | { insight, accumulator_before } | 反思触发时 |
| perception:updated | { observations[] } | 每个 tick 感知完成时 |

### 前端订阅策略

```
页面加载:
  GET /api/brain/briefing → VoiceCard 初始内容
  GET /api/brain/inner-life → InnerLife 初始状态
  GET /api/brain/events?limit=20 → ActivityFeed 初始数据
  GET /api/brain/desires?status=pending → DecisionInbox 初始数据

WebSocket 实时:
  desire:expressed → 更新 VoiceCard（新的主动表达）
  desire:created → 更新 DecisionInbox + InnerLife
  rumination:completed → 更新 StatusBar 反刍进度 + ActivityFeed
  reflection:triggered → 更新 InnerLife 反思状态 + ActivityFeed
  tick:executed → 更新所有面板的统计数据
  task:* → 更新 RunningTasks
```

---

## 五、反刍回路（PR #24）的界面融入

反刍是 Cecelia "消化知识"的过程，等同于人类的"思考"。它应该在 UI 上可见：

### 5.1 反刍在 StatusBar 的体现

```
⬤ 在线 · 📖 反刍 2/10 · 🧠 25/30 · ...
```

当反刍正在进行时，图标变为动画（书页翻动效果）。

### 5.2 反刍在 VoiceCard 的体现

当 `rumination.insights` 产出新洞察时，VoiceCard 更新：

```
📖 "我刚消化了你分享的《RAG 入门》。
    它和你的 KR '记忆系统优化' 有直接关联 —
    RAG 的检索增强生成可以改进 memory-retriever 的语义匹配。"

    [深入研究] [记下了]
```

### 5.3 反刍在 InnerLife 的体现

InnerLife 面板展示完整的知识消化管道：

```
📖 知识消化管道

   待消化 (3)          消化中              已产出洞察
   ┌──────────┐      ┌──────────┐      ┌──────────┐
   │ Vector DB│  →   │ RAG 入门 │  →   │ CI 最佳  │
   │ LLM 对比 │      │ (关联中) │      │ 实践     │
   │ 微服务   │      └──────────┘      │ → 记忆优 │
   └──────────┘                        │   化建议  │
                                       └──────────┘
```

### 5.4 反刍在 ActivityFeed 的体现

```
18:30 📖 [反刍] 消化 "RAG 入门"
         → 洞察: RAG 检索增强可用于 memory-retriever 优化
         → 关联: KR "记忆系统优化"
         → 已写入长期记忆 (重要性: 7, 保留 30 天)
```

### 5.5 反刍→欲望→表达 的完整链路

反刍洞察写入 memory_stream → 下个 tick 被 perception 感知 →
accumulator 累积 → 触发 reflection → 产生 desire →
expression 决策 → VoiceCard 展示

**这条链路的 UI 可见性**：

```
ActivityFeed 时间线:
  18:30 📖 消化 "RAG 入门" → 洞察写入记忆
  18:35 👁 感知: memory_stream 新增高重要性条目
  18:35 📝 记忆打分: importance=7, type=long
  18:35 🧠 累积达到 32/30 → 触发反思
  18:36 🧠 反思洞察: "RAG 技术可以显著改善记忆检索质量"
  18:36 💭 欲望形成: [propose] "建议研究 RAG 应用到记忆系统"
  18:36 💬 表达: score=0.52 > 0.35 → 推送到界面
  18:36 → VoiceCard 更新: "我建议研究 RAG 应用到记忆系统..."
```

---

## 六、与现有组件的关系

### 保留（重新定位）

| 现有组件 | 新角色 |
|---------|--------|
| PulseStrip | → StatusBar（精简为一行，加反刍/反思指标） |
| EventStream | → ActivityFeed（扩展事件类型，加内心活动） |
| CommandPalette | → QuickActions 中的 [对话] 按钮（保留 Cmd+K 快捷键） |

### 替代

| 现有组件 | 替代为 |
|---------|--------|
| ActionZone | → VoiceCard + DecisionInbox（从"快捷按钮"变为"Cecelia 主动说话"） |
| AgentMonitor | → RunningTasks（简化，只显示执行中的） |
| TodayOverview | → StatusBar 的一部分 + VoiceCard 的 briefing |

### 新增

| 新组件 | 用途 |
|--------|------|
| VoiceCard | Cecelia 的主动表达（最核心的组件） |
| DecisionInbox | 待决策项收件箱 |
| InnerLife | 内心活动面板（反刍/反思/感知/欲望） |

---

## 七、时序感知（Anticipatory）

页面内容根据时间和上下文自动调整：

| 场景 | VoiceCard 内容 | DecisionInbox |
|------|--------------|---------------|
| 早上首次打开 | 简报："昨晚完成 X，今天建议做 Y" | 积累的待审项 |
| 工作中（有任务执行） | "task-xyz 进展 60%，预计 20 分钟完成" | 实时决策 |
| 空闲时（反刍中） | "我正在消化你分享的知识..." | 反刍洞察确认 |
| 反思触发时 | "我刚深度思考了一下..." + 洞察 | 建议行动 |
| 出错时 | "task-abc 失败了，原因是 X" | [重试] [跳过] [分析] |

---

## 八、实现优先级

### Phase 1（最小可行）
1. VoiceCard — 展示 desire:expressed + briefing
2. DecisionInbox — 展示 pending desires/decisions
3. StatusBar — 替代 PulseStrip，加反刍/反思指标
4. 新增 API: /api/brain/desires, /api/brain/inner-life

### Phase 2（完整内心）
5. InnerLife 面板 — 反刍进度、反思累积、感知雷达、欲望队列
6. ActivityFeed — 扩展事件类型（反刍/反思/欲望）
7. 新增 WebSocket: rumination:completed, reflection:triggered

### Phase 3（智能化）
8. 时序感知 — 根据时间和上下文自动调整布局
9. 知识消化管道可视化
10. 反刍→欲望→表达的完整链路追踪
