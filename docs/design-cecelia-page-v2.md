---
id: design-cecelia-page-v2
version: 1.0.0
created: 2026-02-25
updated: 2026-02-25
changelog:
  - 1.0.0: 初始版本 — 完整设计方案
---

# Cecelia Page V2 — 有意识的管家指挥室

## 一、核心问题

> "我不动她就不动"

当前 CeceliaPage 是一个**被动聊天窗口**：
- 数据靠 30-60s 轮询，不是实时推送
- Cecelia 不会主动开口，永远等用户先说
- 左右栏是静态列表，没有生命感
- 状态指示器太小（6px 圆点），感知不到系统在运作

## 二、设计理念

### 管家的五个行为

| 行为 | 当前 | 目标 |
|------|------|------|
| **迎接** | 空白 + "跟 Cecelia 说些什么" | 打开页面 = Cecelia 主动播报晨简报 |
| **汇报** | 等用户问 | 有事就在聊天流中主动插入状态卡片 |
| **盯盘** | 看不见 | 右侧活动面板实时显示 agent 在干什么 |
| **记忆** | 没展示 | 偶尔在对话中自然提起"我记得你上周..." |
| **呼吸** | 死寂 | 页面边缘随 alertness 缓慢脉动光晕 |

### 参考产品

| 设计元素 | 来源 |
|----------|------|
| 边缘光晕（Ambient Glow） | Apple Intelligence Siri |
| 分屏活动面板 | OpenAI Operator |
| 进度时间线 | Devin AI |
| 主动浮现通知 | ChatGPT Tasks / Linear Agents |
| 状态拟人化 | Tamagotchi 式情感设计 |

---

## 三、页面布局

### 整体结构

```
┌─ Ambient Glow Border (alertness 颜色脉动) ──────────────────────────────┐
│                                                                          │
│  ┌─ Pulse Strip (顶部状态条，48px) ──────────────────────────────────┐  │
│  │  ● CALM  │  ↺ 下次 tick: 2:34  │  ▶ 3 运行中  │  ☁ 今日 $1.24  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─────────────────────────────────┐  ┌──────────────────────────────┐  │
│  │                                 │  │                              │  │
│  │       CONSCIOUSNESS FLOW        │  │       ACTIVITY PANEL         │  │
│  │       (意识流 = 聊天区)          │  │       (活动面板)              │  │
│  │                                 │  │                              │  │
│  │  ┌─ Cecelia 晨简报 ──────────┐  │  │  ▶ 运行中                    │  │
│  │  │ 早上好。昨晚完成了 3 个任务 │  │  │  ┌─────────────────────┐   │  │
│  │  │ 有 1 个需要你决策。       │  │  │  │ 🧪 caramel           │   │  │
│  │  │                          │  │  │  │ PR #552 修复导入      │   │  │
│  │  │ 📊 完成: 3  失败: 0       │  │  │  │ ██████████░░ 14分钟  │   │  │
│  │  │ 💰 Token: $0.87          │  │  │  │ 步骤: 写测试          │   │  │
│  │  └──────────────────────────┘  │  │  └─────────────────────┘   │  │
│  │                                 │  │  ┌─────────────────────┐   │  │
│  │  ┌─ 🔴 需要决策 ────────────┐  │  │  │ 🔍 reviewer          │   │  │
│  │  │ PR #551 CI 连续失败 2 次  │  │  │  │ 审查 cecelia-core    │   │  │
│  │  │ 同一个测试文件出错。      │  │  │  │ ████░░░░░░░░ 3分钟   │   │  │
│  │  │                          │  │  │  └─────────────────────┘   │  │
│  │  │ [安排修复]  [暂时跳过]    │  │  │                              │  │
│  │  └──────────────────────────┘  │  │  ⏳ 队列                     │  │
│  │                                 │  │  ┌─────────────────────┐   │  │
│  │  ┌─ ⚡ 任务完成 ────────────┐  │  │  │ ○ 代码审查 core #553 │   │  │
│  │  │ ✅ PR #550 已合并         │  │  │  │ ○ 日报生成           │   │  │
│  │  │ cecelia-core v1.97.0     │  │  │  └─────────────────────┘   │  │
│  │  └──────────────────────────┘  │  │                              │  │
│  │                                 │  │  ─────────────────────────  │  │
│  │  (你) 今天的重点是什么？       │  │                              │  │
│  │                                 │  │  📊 集群                     │  │
│  │  ┌─ Cecelia ────────────────┐  │  │  US: CPU 23% │ RAM 4.2G    │  │
│  │  │ 根据 OKR 进度，今天建议   │  │  │  HK: CPU 11% │ RAM 2.1G    │  │
│  │  │ 优先推进 Task Intelligence │  │  │                              │  │
│  │  │ 目前完成度 45%，还有 3 个  │  │  │  📈 今日                     │  │
│  │  │ Initiative 未拆解。       │  │  │  完成: 7  失败: 1  排队: 3  │  │
│  │  └──────────────────────────┘  │  │  成功率: 87.5%               │  │
│  │                                 │  │                              │  │
│  │  ┌──────────────────────────┐  │  └──────────────────────────────┘  │
│  │  │ [输入框]           🎤 ⏎  │  │                                    │
│  │  └──────────────────────────┘  │                                    │
│  └─────────────────────────────────┘                                    │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 布局规格

| 区域 | 宽度 | 说明 |
|------|------|------|
| Ambient Glow | 页面边缘 4px | 根据 alertness 变色脉动 |
| Pulse Strip | 100%, 48px 高 | 关键指标一行展示 |
| Consciousness Flow | flex: 1, max-w: 680px | 聊天 + 状态卡片混合流 |
| Activity Panel | 320px, 可折叠 | 运行中任务 + 集群状态 |

---

## 四、核心交互设计

### 4.1 意识流（Consciousness Flow）

**核心创新：聊天区不只是对话，而是 Cecelia 的"意识流"。**

传统聊天只有两种消息：用户说的、AI 回复的。
意识流增加第三种：**Cecelia 主动推送的状态卡片**。

#### 消息类型

| 类型 | 来源 | 视觉 | 触发 |
|------|------|------|------|
| `user` | 用户输入 | 右对齐，紫色气泡 | 用户发送 |
| `assistant` | Cecelia 回复 | 左对齐，深色气泡 | API 响应 |
| `briefing` | 晨简报 | 全宽卡片，渐变边框 | 页面打开 |
| `decision` | 需要决策 | 红色左边框卡片，带操作按钮 | WebSocket desire 推送 |
| `alert` | 异常告警 | 橙色闪烁边框卡片 | WebSocket alertness 变化 |
| `completion` | 任务完成 | 绿色左边框，简洁一行 | WebSocket task:completed |
| `progress` | 进度更新 | 灰色，小字体 | WebSocket task:progress |
| `memory` | 记忆关联 | 虚线边框，淡紫色 | 对话上下文触发 |

#### 晨简报卡片（Briefing Card）

打开页面时，Cecelia 自动生成一张简报卡片（不调 LLM，纯数据拼接）：

```
┌─ 🌅 Cecelia 简报 ─────────────────────────────────┐
│                                                     │
│  早上好，Alex。                                     │
│                                                     │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌──────────┐ │
│  │ ✅ 完成 │  │ ❌ 失败 │  │ ⏳ 排队 │  │ 💰 $1.24 │ │
│  │   7    │  │   1    │  │   3    │  │  Token   │ │
│  └────────┘  └────────┘  └────────┘  └──────────┘ │
│                                                     │
│  🔴 需要你决策:                                     │
│  • PR #551 CI 连续失败（安排修复 / 跳过）            │
│                                                     │
│  🎯 今日焦点: Task Intelligence (45%)               │
│                                                     │
│  ⚡ 上次离开后发生了:                                │
│  • 03:22 caramel 完成了 PR #550                     │
│  • 05:41 夜间日报已生成                              │
│  • 06:15 reviewer 开始审查 core                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

数据来源：
- `GET /api/brain/cecelia/overview` → 完成/失败/排队数
- `GET /api/brain/token-usage` → 今日费用
- `GET /api/brain/desires?status=pending` → 需要决策的事
- `GET /api/brain/focus` → 今日焦点
- `GET /api/brain/events?since=<last_visit>` → 离开后发生的事件

#### 决策卡片（Decision Card）

Desire 不再是侧边栏列表，而是在意识流中以卡片形式出现：

```
┌─🔴─────────────────────────────────────────────────┐
│  PR #551 的 CI 已连续失败 2 次                       │
│  错误都在 test/brain-status.test.js 第 47 行         │
│                                                     │
│  💡 建议: 安排 caramel 修复，预计 30 分钟             │
│                                                     │
│  [🔧 安排修复]   [⏭ 暂时跳过]   [💬 问 Cecelia]     │
│                                                     │
│  2 分钟前                                            │
└─────────────────────────────────────────────────────┘
```

按钮直接调 API：
- 「安排修复」→ `POST /api/brain/tasks/:id/dispatch`
- 「暂时跳过」→ `PATCH /api/brain/desires/:id { status: 'suppressed' }`
- 「问 Cecelia」→ 自动把 desire 内容填入输入框

#### 实时事件卡片

WebSocket 推送的事件以轻量卡片形式插入聊天流：

```
  ─── ✅ 10:32 ───────────────────────
  caramel 完成了 PR #552 (cecelia-core)
  ────────────────────────────────────

  ─── ▶ 10:33 ───────────────────────
  reviewer 开始审查 PR #552
  ────────────────────────────────────
```

这些事件卡片比正常消息小（字体更小、颜色更淡），不抢主视觉焦点，但让用户感知到"系统一直在动"。

---

### 4.2 Ambient Glow（呼吸光晕）

页面最外层容器的边缘产生微弱光晕，根据 alertness 等级变色：

| 等级 | 颜色 | 动画 | 含义 |
|------|------|------|------|
| 0 SLEEPING | `#1e293b` 深蓝灰 | 6s 周期极慢呼吸 | 系统休眠 |
| 1 CALM | `#10b981` 翡翠绿 | 4s 周期慢呼吸 | 一切正常 |
| 2 AWARE | `#3b82f6` 蓝色 | 3s 周期中速呼吸 | 有活动在进行 |
| 3 ALERT | `#f59e0b` 琥珀色 | 2s 周期快呼吸 | 需要关注 |
| 4 PANIC | `#ef4444` 红色 | 1s 周期急促 + 闪烁 | 紧急状况 |

CSS 实现（box-shadow + animation）：

```css
.ambient-glow {
  animation: glow-breathe var(--glow-duration) ease-in-out infinite;
}

@keyframes glow-breathe {
  0%, 100% { box-shadow: inset 0 0 30px 0 var(--glow-color-dim); }
  50%      { box-shadow: inset 0 0 60px 5px var(--glow-color-bright); }
}
```

光晕颜色通过 CSS 变量控制，WebSocket alertness 变化时平滑过渡（transition: 2s）。

---

### 4.3 Pulse Strip（顶部脉搏条）

一行关键指标，让用户一眼看到系统生命体征：

```
● CALM  │  ↺ 下次 tick: 2:34  │  ▶ 3 运行中  │  📋 5 排队  │  ☁ 今日 $1.24
```

| 指标 | 数据源 | 更新方式 |
|------|--------|---------|
| 警觉状态 | `GET /alertness` | WebSocket 推（需新增事件） |
| Tick 倒计时 | `GET /tick/status` → lastTickAt | 前端本地计时 |
| 运行中任务 | WebSocket task:started/completed | 实时增减 |
| 排队任务 | WebSocket task:created | 实时增减 |
| 今日 Token 费用 | `GET /token-usage` | 60s 轮询（不频繁变化） |

**Tick 倒计时**是关键设计：不是显示"上次 tick: 3分钟前"（死数据），而是一个从 5:00 → 0:00 的动态倒计时弧形进度条，到 0 时闪一下表示 tick 执行了。这让用户**持续感知到系统在运作**。

```
Tick 倒计时视觉：

  ╭─────╮
  │ 2:34│   ← 环形进度条，从满到空
  ╰─────╯
```

---

### 4.4 Activity Panel（活动面板）

右侧 320px 面板，展示"Cecelia 正在监控什么"：

#### 运行中的 Agent

```
▶ 运行中 (2)
┌─────────────────────────────────┐
│  🧪 caramel                     │
│  cecelia-core › PR #552         │
│  ██████████░░░░ 67%   14 分钟   │
│  当前步骤: 写测试                │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│  🔍 reviewer                    │
│  cecelia-core › PR #552         │
│  ████░░░░░░░░░░ 25%   3 分钟    │
│  当前步骤: 代码审查              │
└─────────────────────────────────┘
```

数据来源：
- `GET /api/brain/dev/tasks` → 活跃 dev/review 任务 + 11步状态
- WebSocket `task:progress` → 实时进度更新
- `GET /api/brain/cluster/status` → 哪台服务器在跑

#### 集群状态

```
📊 集群
┌─────────────────────────────────┐
│  🇺🇸 US                          │
│  CPU ████░░░░░░ 23%              │
│  RAM ██████░░░░ 4.2 / 8 GB      │
│  Agent: 2 活跃 / 4 可用          │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│  🇭🇰 HK                          │
│  CPU ██░░░░░░░░ 11%              │
│  RAM ███░░░░░░░ 2.1 / 4 GB      │
│  Agent: 0 活跃 / 2 可用          │
└─────────────────────────────────┘
```

数据来源：`GET /api/brain/cluster/status`，WebSocket `executor:status` 实时更新。

#### 今日统计

```
📈 今日
┌─────────────────────────────────┐
│  完成: 7   失败: 1   排队: 3     │
│  成功率: ████████░░ 87.5%        │
│  Token: $1.24                    │
│  活跃时间: 6h 23m                │
└─────────────────────────────────┘
```

---

### 4.5 记忆浮现（Memory Moments）

不是独立面板，而是**在对话流中自然出现**。

当用户提到某个话题时，如果 Cecelia 的记忆中有相关 fact，自动在回复前插入一条淡色记忆卡片：

```
┌ · · · · · · · · · · · · · · · · · · · · ┐
│  💭 我记得你上周提到想优先处理 schema 迁移  │
│     — 记录于 2026-02-18                   │
└ · · · · · · · · · · · · · · · · · · · · ┘
```

触发逻辑：
1. 用户发送消息时，同时调用 `POST /api/brain/memory/search` 语义搜索
2. 如果找到相关记忆（similarity > 0.7），在 AI 回复前插入记忆卡片
3. 每次对话最多触发 1 次，避免打扰

---

## 五、数据流架构

### 从轮询到推送

```
                    ┌─────────────┐
                    │  Brain API  │
                    │  (5221)     │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         WebSocket      HTTP         SSE (未来)
         (实时推送)    (按需请求)     (流式回复)
              │            │            │
              ▼            ▼            ▼
┌──────────────────────────────────────────────┐
│              CeceliaPage V2                   │
│                                               │
│  useWebSocket('/ws')                          │
│  ├── task:created   → 更新排队计数 + 事件卡片  │
│  ├── task:started   → 更新运行中 + 事件卡片    │
│  ├── task:progress  → 更新 Activity Panel      │
│  ├── task:completed → 更新统计 + 事件卡片       │
│  ├── task:failed    → 触发决策卡片              │
│  ├── executor:status → 更新集群状态            │
│  ├── proposal:*     → 决策卡片                  │
│  └── profile:changed → Pulse Strip 更新        │
│                                               │
│  页面打开时 HTTP 请求（一次性）：               │
│  ├── GET /cecelia/overview   → 简报数据        │
│  ├── GET /desires?status=pending → 待决策      │
│  ├── GET /focus              → 今日焦点        │
│  ├── GET /alertness          → 初始状态        │
│  ├── GET /token-usage        → 今日费用        │
│  ├── GET /cluster/status     → 集群状态        │
│  ├── GET /dev/tasks          → 活跃任务        │
│  └── GET /orchestrator/chat/history → 历史消息 │
│                                               │
│  低频轮询（补充 WebSocket 未覆盖的数据）：      │
│  ├── GET /token-usage        → 60s             │
│  └── GET /cluster/status     → 30s             │
│                                               │
└──────────────────────────────────────────────┘
```

### Core 需要新增的 WebSocket 事件

| 事件 | 触发时机 | 用途 |
|------|----------|------|
| `alertness:changed` | alertness 等级变化时 | 光晕颜色切换 |
| `desire:created` | 新 desire 产生时 | 决策卡片插入聊天流 |
| `desire:updated` | desire 状态变化时 | 更新卡片状态 |
| `tick:executed` | 每次 tick 完成时 | 倒计时归零闪烁 |
| `briefing:data` | 连接时自动发送 | 初始化简报（可选） |

---

## 六、Core API 变更清单

### 6.1 WebSocket 增强（websocket.js）

新增 4 个事件类型到 `WS_EVENTS`：

```js
// 新增
ALERTNESS_CHANGED: 'alertness:changed',
DESIRE_CREATED: 'desire:created',
DESIRE_UPDATED: 'desire:updated',
TICK_EXECUTED: 'tick:executed',
```

在对应代码路径添加 `broadcast()` 调用：
- `alertness.js` → 等级变化时 broadcast
- `desires` 相关路由 → 创建/更新时 broadcast
- `tick.js` → tick 完成时 broadcast（含 next tick 预计时间）

### 6.2 简报 API（新端点）

```
GET /api/brain/briefing
```

返回格式：

```json
{
  "greeting": "早上好，Alex",
  "since_last_visit": {
    "completed": 3,
    "failed": 0,
    "queued": 5,
    "events": [
      { "time": "03:22", "text": "caramel 完成了 PR #550" },
      { "time": "05:41", "text": "夜间日报已生成" }
    ]
  },
  "pending_decisions": [
    {
      "desire_id": "xxx",
      "summary": "PR #551 CI 连续失败 2 次",
      "suggestion": "安排 caramel 修复",
      "actions": ["dispatch_fix", "suppress"]
    }
  ],
  "today_focus": {
    "title": "Task Intelligence",
    "progress": 45,
    "remaining_initiatives": 3
  },
  "token_cost_usd": 1.24,
  "last_visit": "2026-02-25T02:30:00Z"
}
```

逻辑：
- 聚合 `/cecelia/overview` + `/desires` + `/focus` + `/token-usage` + `/events`
- 记录用户上次访问时间（cecelia_events 表 或 localStorage 传参）
- 纯数据聚合，不调 LLM

### 6.3 desires acknowledged 状态

已在当前 PRD 中，migration 076 添加 `acknowledged` 到 CHECK 约束。

### 6.4 任务手动派发

已在当前 PRD 中，`POST /api/brain/tasks/:id/dispatch`。

---

## 七、Workspace 组件拆解

### 新组件清单

```
apps/core/features/cecelia/
├── pages/
│   └── CeceliaPage.tsx          ← 重写（布局容器）
├── components/
│   ├── AmbientGlow.tsx          ← 呼吸光晕
│   ├── PulseStrip.tsx           ← 顶部脉搏条
│   ├── ConsciousnessFlow.tsx    ← 意识流（聊天区）
│   ├── ActivityPanel.tsx        ← 右侧活动面板
│   ├── cards/
│   │   ├── BriefingCard.tsx     ← 晨简报卡片
│   │   ├── DecisionCard.tsx     ← 决策卡片（带操作按钮）
│   │   ├── EventCard.tsx        ← 实时事件卡片（轻量）
│   │   ├── MemoryCard.tsx       ← 记忆浮现卡片
│   │   └── CompletionCard.tsx   ← 任务完成卡片
│   ├── activity/
│   │   ├── RunningAgent.tsx     ← 单个运行中 agent 卡片
│   │   ├── ClusterStatus.tsx    ← 集群 CPU/RAM 指标
│   │   └── TodayStats.tsx       ← 今日统计
│   └── TickCountdown.tsx        ← tick 倒计时环形进度
├── hooks/
│   ├── useCeceliaWS.ts          ← WebSocket 封装（接 /ws）
│   ├── useBriefing.ts           ← 简报数据获取
│   └── useActivityData.ts       ← 活动面板数据
```

### 状态管理

```
CeceliaPageProvider
├── messages: Message[]           ← 意识流消息（含所有类型）
├── alertness: AlertnessLevel     ← 当前警觉等级
├── runningTasks: Task[]          ← 运行中任务
├── queuedCount: number           ← 排队数
├── clusterStatus: ClusterInfo    ← 集群状态
├── todayStats: DayStats          ← 今日统计
├── nextTickIn: number            ← tick 倒计时秒数
└── ws: WebSocket                 ← WebSocket 连接
```

WebSocket 消息统一进入 `messages` 数组，由 `ConsciousnessFlow` 按类型渲染不同卡片组件。

---

## 八、视觉规范

### 配色延续

保持当前深色主题（`#09090f` 背景 + `#a78bfa` 紫色主调），增加状态色：

| 用途 | 颜色 | 场景 |
|------|------|------|
| 主调 | `#a78bfa` 紫色 | 用户消息、强调元素 |
| 成功 | `#10b981` 翡翠绿 | 完成卡片、CALM 光晕 |
| 警告 | `#f59e0b` 琥珀色 | 需关注、ALERT 光晕 |
| 危险 | `#ef4444` 红色 | 决策卡片、PANIC 光晕 |
| 信息 | `#60a5fa` 蓝色 | 进度更新、AWARE 光晕 |
| 记忆 | `#c4b5fd` 淡紫 | 记忆浮现卡片 |
| 事件 | `rgba(255,255,255,0.3)` | 实时事件卡片文字 |

### 动画规范

| 效果 | 参数 | 用途 |
|------|------|------|
| 光晕呼吸 | ease-in-out, 1-6s | Ambient Glow |
| 卡片入场 | translateY(10px) → 0, 300ms | 新消息/卡片出现 |
| 进度条 | width transition 500ms | Activity Panel |
| 数字跳变 | 插值动画 300ms | 统计数字变化 |
| Tick 闪烁 | scale(1.2) + glow, 200ms | tick 执行瞬间 |

### 字体层级

| 层级 | 大小 | 颜色 | 用途 |
|------|------|------|------|
| H1 | 18px, 600 | `#e2e8f0` | 简报标题 |
| Body | 14px, 400 | `#cbd5e1` | 消息正文 |
| Caption | 12px, 400 | `rgba(255,255,255,0.4)` | 时间戳、事件卡片 |
| Badge | 11px, 600 | 各状态色 | 标签、计数 |

---

## 九、实施路线

### Phase 1: 基础管道（Core）— 本仓库

> 目标：让 WebSocket 推送所有必要事件 + 简报 API

1. WebSocket 新增 4 个事件类型（alertness/desire/tick）
2. 在 tick.js、alertness.js、desires 路由中添加 broadcast
3. 新增 `GET /api/brain/briefing` 聚合端点
4. Migration 076: desires acknowledged 状态
5. 测试覆盖

**预计**: 1-2 个 PR

### Phase 2: 骨架重写（Workspace）

> 目标：新布局上线，WebSocket 接通，替代轮询

1. CeceliaPage 布局重写（Ambient Glow + Pulse Strip + 双栏）
2. `useCeceliaWS` hook 封装，替代 setInterval 轮询
3. ConsciousnessFlow 基础版（用户消息 + AI 回复 + 事件卡片）
4. Activity Panel 基础版（运行中任务列表）
5. 简报卡片（打开页面自动展示）

**预计**: 1-2 个 PR

### Phase 3: 交互增强（Workspace）

> 目标：决策卡片可操作 + 记忆浮现

1. DecisionCard 带操作按钮（派发/跳过/询问）
2. EventCard 实时插入
3. Tick 倒计时环形进度
4. 集群状态面板
5. 记忆浮现（对话时语义搜索 + MemoryCard）

**预计**: 1-2 个 PR

### Phase 4: 打磨（Workspace）

> 目标：动效细节 + 响应式 + 全屏模式

1. Ambient Glow 呼吸动画调优
2. 卡片入场/退场动画
3. 数字插值动画
4. 响应式（Activity Panel 可折叠/mobile 隐藏）
5. 全屏模式适配
6. 深色/浅色主题支持（如果需要）

**预计**: 1 个 PR

---

## 十、不做什么

| 不做 | 原因 |
|------|------|
| 聊天流式输出（SSE） | 需要改造 orchestrator-chat，是独立工作项 |
| 语音界面重设计 | 已有 Realtime API 接入，保持现状 |
| 移动端适配 | Cecelia 主要在桌面使用 |
| AI 生成简报文案 | 纯数据拼接足够，避免 LLM 延迟和费用 |
| 重写 CeceliaChat 浮动组件 | 保留全局气泡，专注主页面 |

---

## 十一、成功标准

**打开页面后，不需要输入任何内容，用户就能感知到：**

1. ✅ Cecelia 在说话（自动简报）
2. ✅ 系统在运作（光晕在呼吸、tick 在倒计时）
3. ✅ 有事情在发生（事件卡片在出现、进度条在动）
4. ✅ 她记得我（简报中包含"上次离开后..."）
5. ✅ 需要我的地方很明确（红色决策卡片 + 操作按钮）

**量化指标：**

| 指标 | 当前 | 目标 |
|------|------|------|
| 页面打开到"有内容出现"延迟 | 需要用户先输入 | < 500ms（简报卡片） |
| 数据更新延迟 | 30-60s（轮询） | < 1s（WebSocket） |
| 用户首次交互前的信息量 | 0（空聊天区） | 晨简报 + 运行状态 + 待决策 |
| 需要决策时的操作步数 | 看到 → 理解 → 输入文字 | 看到卡片 → 点按钮（1步） |
