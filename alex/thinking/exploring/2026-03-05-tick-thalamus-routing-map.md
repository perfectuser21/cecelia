# Tick + 丘脑 双路由完整脑图

两个路由器，一个用代码，一个用脑子。

---

## 视角 1：Tick 路由（总调度器，代码驱动）

```
                         executeTick()
                         每 2 分钟触发
                              │
        ┌─────────────────────┼──────────────────────────┐
        │                     │                          │
        ▼                     ▼                          ▼
   ┌─────────┐         ┌──────────┐              ┌────────────┐
   │ 步骤 0  │         │ 步骤 0.7 │              │ 步骤 0.5   │
   │ 丘脑    │         │ 拆解检查 │              │ PR Plans   │
   │         │         │          │              │ 完成检查   │
   │事件路由 │         │ 纯代码   │              │ 纯代码     │
   └────┬────┘         └────┬─────┘              └────────────┘
        │                   │
   (见视角2)                │
        │              ┌────┴──────────────────┐
        │              │                       │
        │              ▼                       ▼
        │     ┌──────────────┐        ┌──────────────────┐
        │     │   Check A    │        │    Check B       │
        │     │              │        │                  │
        │     │ pending KR?  │        │ ready KR 下      │
        │     │  ↓           │        │ Initiative 无    │
        │     │ INSERT 拆解  │        │ 活跃 Task?       │
        │     │ 任务(queued) │        │  ↓               │
        │     │              │        │ INSERT           │
        │     │ → 秋米拆解   │        │ initiative_plan  │
        │     │ → Vivian审查  │        │ 任务(queued)     │
        │     └──────────────┘        └──────────────────┘
        │
        │         ┌──────────────────────────────────┐
        │         │            步骤 6a               │
        │         │           规划器                  │
        ▼         │         （纯代码）                │
   Tick 继续      │                                  │
        │         │ 条件: queued 任务 < 3 才跑        │
        │         │                                  │
        ├────────►│ 做什么:                          │
        │         │  1. 读 goals 表所有 KR            │
        │         │  2. 每个 KR 打分:                 │
        │         │     优先级 + 进度 + 截止日        │
        │         │     + 学习惩罚 + 洞察加成         │
        │         │  3. 选最高分 KR                   │
        │         │  4. 找它的 Project → Task         │
        │         │  5. 没 Task? INSERT               │
        │         │     initiative_plan               │
        │         │                                  │
        │         │ OUT: 选中的 task                  │
        │         └──────────────────────────────────┘
        │
        │         ┌──────────────────────────────────┐
        │         │            步骤 6b               │
        │         │           执行器                  │
        ├────────►│                                  │
        │         │ 前置检查:                        │
        │         │  ① 排空模式? → 跳过              │
        │         │  ② 槽位满? → 跳过                │
        │         │  ③ 熔断器? → 跳过                │
        │         │  ④ billing暂停? → 跳过           │
        │         │                                  │
        │         │ 选任务:                          │
        │         │  selectNextDispatchableTask()    │
        │         │  → queued 任务                   │
        │         │  → Initiative 锁（同一个         │
        │         │    Initiative 只跑一个）          │
        │         │                                  │
        │         │ pre-flight 检查:                 │
        │         │  → 任务描述质量够吗?              │
        │         │                                  │
        │         │ 派发:                            │
        │         │  → 选 Claude 账号（轮转）         │
        │         │  → Bridge → Agent 进程           │
        │         │                                  │
        │         │ skill 路由:                      │
        │         │  initiative_plan → /decomp       │
        │         │  dev            → /dev           │
        │         │  code_review    → /code-review   │
        │         │  拆解任务       → /decomp        │
        │         └──────────┬───────────────────────┘
        │                    │
        │                    ▼
        │         ┌──────────────────────────────────┐
        │         │        外部 Agent 进程            │
        │         │                                  │
        │         │  ┌────────────────────────────┐  │
        │         │  │ initiative_plan 任务        │  │
        │         │  │ → /decomp skill            │  │
        │         │  │ → LLM 规划下一个 PR         │  │
        │         │  │ → 创建 dev 任务(带PRD)      │  │
        │         │  │ → 回调 Brain                │  │
        │         │  └────────────────────────────┘  │
        │         │                                  │
        │         │  ┌────────────────────────────┐  │
        │         │  │ dev 任务                    │  │
        │         │  │ → /dev skill (Caramel)     │  │
        │         │  │ → 写代码 → PR → CI → 合并   │  │
        │         │  │ → 回调 Brain                │  │
        │         │  └────────────────────────────┘  │
        │         │                                  │
        │         │  ┌────────────────────────────┐  │
        │         │  │ 拆解任务                    │  │
        │         │  │ → /decomp skill (秋米)     │  │
        │         │  │ → KR → Project → Init.     │  │
        │         │  │ → 回调 Brain                │  │
        │         │  └────────────────────────────┘  │
        │         └──────────┬───────────────────────┘
        │                    │
        │                    │ execution-callback
        │                    ▼
        │         ┌──────────────────────────────────┐
        │         │    回调更新 tasks 表              │
        │         │                                  │
        │         │  完成 → status = completed       │
        │         │  失败 → status = failed          │
        │         │       → 丘脑收到 TASK_FAILED     │
        │         │         事件（下一轮处理）         │
        │         └──────────────────────────────────┘
        │
        │  （Tick 还有更多步骤，第 2-4 层再展开）
        │
        ├── 步骤 7:  欲望系统（第 4 层）
        ├── 步骤 8:  反刍（第 3 层）
        ├── 步骤 9:  任务存活检查
        ├── 步骤 10: 过期任务清理
        └── ...
```

---

## 视角 2：丘脑路由（有脑子的路由器）

```
                    丘脑 processEvent()
                          │
                    ┌─────┴─────┐
                    │ 收到事件   │
                    │           │
                    │ 来源:     │
                    │  Tick     │ ← 每轮 Tick 发 TICK 事件
                    │  嘴巴     │ ← 用户对话产生 OWNER_INTENT
                    │  回调     │ ← Agent 完成/失败 TASK_COMPLETED/FAILED
                    │  Goal评估 │ ← OKR 停滞 GOAL_STALLED
                    └─────┬─────┘
                          │
                ┌─────────┴─────────┐
                │                   │
                ▼                   ▼
    ┌───────────────────┐  ┌────────────────────┐
    │  第 1 层: quickRoute │  │ quickRoute 返回 null │
    │  （纯代码，不调LLM）  │  │ → 需要 LLM 判断     │
    │                     │  │                      │
    │ TICK(无异常)        │  └──────────┬───────────┘
    │  → fallback_to_tick │             │
    │  → Tick 继续        │             ▼
    │                     │  ┌────────────────────┐
    │ HEARTBEAT           │  │ 第 2 层: MiniMax   │
    │  → no_action        │  │ analyzeEvent()     │
    │                     │  │                    │
    │ TICK(resource异常)  │  │ 调 MiniMax M2.1    │
    │  → log + fallback   │  │ 注入记忆上下文     │
    │                     │  │ 注入 learnings     │
    │ TICK(stale异常)     │  │                    │
    │  → log + fallback   │  │ 适用事件:          │
    │                     │  │  TASK_FAILED       │
    │ 99% 的事件走这里     │  │  TASK_TIMEOUT      │
    └───────────────────┘  │  OWNER_INTENT      │
                           │  GOAL_STALLED      │
                           │  复杂异常 TICK     │
                           │                    │
                           │ 输出: Decision     │
                           │  {level, actions,  │
                           │   rationale,       │
                           │   confidence}      │
                           └────────┬───────────┘
                                    │
                          ┌─────────┴─────────┐
                          │                   │
                          ▼                   ▼
                   level = 0 或 1       level = 2
                          │                   │
                          │                   ▼
                          │         ┌──────────────────┐
                          │         │ 第 3 层: L2 皮层  │
                          │         │ cortex.analyzeDeep │
                          │         │                    │
                          │         │ 调 Opus（深度思考） │
                          │         │                    │
                          │         │ 触发条件:          │
                          │         │  KR 停滞 >14天     │
                          │         │  失败率 >60%       │
                          │         │  方向冲突          │
                          │         │  用户要求复盘      │
                          │         │                    │
                          │         │ 输出:              │
                          │         │  RCA 根因分析      │
                          │         │  战略调整建议      │
                          │         │  → 写入 self_model │
                          │         └────────┬───────────┘
                          │                  │
                          └────────┬─────────┘
                                   │
                                   ▼
                      ┌────────────────────────┐
                      │   decision-executor    │
                      │   executeDecision()    │
                      │                        │
                      │ 遍历 actions 数组:      │
                      │                        │
                      │ ┌────────────────────┐ │
                      │ │ 非危险 action       │ │
                      │ │ → 直接执行          │ │
                      │ │                    │ │
                      │ │ create_task        │ │
                      │ │  → INSERT tasks    │ │
                      │ │                    │ │
                      │ │ retry_task         │ │
                      │ │  → UPDATE tasks    │ │
                      │ │    status=queued   │ │
                      │ │                    │ │
                      │ │ create_learning    │ │
                      │ │  → INSERT learnings│ │
                      │ │                    │ │
                      │ │ no_action          │ │
                      │ │  → 什么都不做       │ │
                      │ │                    │ │
                      │ │ fallback_to_tick   │ │
                      │ │  → 什么都不做       │ │
                      │ │    Tick 继续       │ │
                      │ └────────────────────┘ │
                      │                        │
                      │ ┌────────────────────┐ │
                      │ │ 危险 action        │ │
                      │ │ → 不执行！          │ │
                      │ │ → pending_actions  │ │
                      │ │   表等审批          │ │
                      │ │                    │ │
                      │ │ quarantine_task    │ │
                      │ │ propose_decomp     │ │
                      │ │ adjust_resource    │ │
                      │ │ heartbeat_finding  │ │
                      │ │                    │ │
                      │ │ → Dashboard 显示   │ │
                      │ │ → Alex 批准/拒绝   │ │
                      │ │ → 批准后才执行      │ │
                      │ └────────────────────┘ │
                      │                        │
                      │ 全部写入:               │
                      │  PostgreSQL cecelia DB  │
                      │  + decision_log 记录    │
                      └────────────┬───────────┘
                                   │
                                   ▼
                         ┌──────────────────┐
                         │                  │
                         │  PostgreSQL DB   │
                         │  (cecelia)       │
                         │                  │
                         │ goals 表         │
                         │ projects 表      │
                         │ tasks 表    ◄────┼── 规划器从这读
                         │ pending_actions  │
                         │ learnings 表     │
                         │ memory_stream    │
                         │ cecelia_events   │
                         │ decision_log     │
                         │                  │
                         └──────────────────┘
                                   │
                                   │ 下一轮 Tick
                                   │ 从 DB 读到新状态
                                   ▼
                            回到 executeTick()
```

---

## 视角 3：拆解到执行的完整生命周期

```
                    ┌────────────────┐
                    │   goals 表     │
                    │  KR status=    │
                    │  'pending'     │
                    └───────┬────────┘
                            │
              Tick 步骤 0.7 │ decomposition-checker
                            │ Check A: 发现 pending KR
                            ▼
                    ┌────────────────┐
                    │  tasks 表      │
                    │  INSERT 拆解   │
                    │  任务(queued)  │
                    │  payload:      │
                    │  decomp=true   │
                    └───────┬────────┘
                            │
                            │ KR status → 'decomposing'
                            │
              Tick 步骤 6a  │ 规划器选中
              Tick 步骤 6b  │ 执行器派发
                            ▼
                    ┌────────────────┐
                    │  秋米 Agent    │
                    │  /decomp skill │
                    │                │
                    │ LLM 拆解:      │
                    │ KR → Project   │
                    │    → Initiative│
                    │                │
                    │ 调 Brain API:  │
                    │ 创建 Project   │
                    │ 创建 Initiative│
                    └───────┬────────┘
                            │
                            │ 回调 → 拆解任务 completed
                            │ KR status → 'reviewing'
                            ▼
                    ┌────────────────┐
                    │  Vivian 审查   │
                    │  /decomp-check │
                    │                │
                    │ 不通过 → 秋米  │
                    │   重拆(回上面) │
                    │                │
                    │ 通过 →         │
                    │ KR status →    │
                    │ 'ready'        │
                    └───────┬────────┘
                            │
              Tick 步骤 0.7 │ decomposition-checker
                            │ Check B: ready KR 下
                            │ Initiative 无活跃 Task
                            ▼
                    ┌────────────────┐
                    │  tasks 表      │
                    │  INSERT        │
                    │  initiative_   │
                    │  plan(queued)  │
                    │                │
                    │ 纯 SQL，无 LLM │
                    └───────┬────────┘
                            │
              Tick 步骤 6a  │ 规划器选中
              Tick 步骤 6b  │ 执行器派发
                            │ skill = /decomp
                            ▼
                    ┌────────────────┐
                    │ /decomp Agent  │
                    │                │
                    │ LLM 规划:      │
                    │ 1. 读 Init 描述│
                    │ 2. 读已完成 PR │
                    │ 3. Init 达成?  │
                    │   ├ 是 → close │
                    │   └ 否 →       │
                    │     创建 dev   │
                    │     任务(带PRD)│
                    └───────┬────────┘
                            │
                            │ 新 dev 任务出现
                            │
              Tick 步骤 6a  │ 规划器选中
              Tick 步骤 6b  │ 执行器派发
                            │ skill = /dev
                            ▼
                    ┌────────────────┐
                    │ Caramel Agent  │
                    │ /dev skill     │
                    │                │
                    │ 写代码         │
                    │ → PR           │
                    │ → CI           │
                    │ → 合并         │
                    └───────┬────────┘
                            │
                            │ 回调 → dev 任务 completed
                            │
              Tick 步骤 0.7 │ Check B 再次检查
                            │ Initiative 下还有事做?
                            │
                    ┌───────┴────────┐
                    │                │
                    ▼                ▼
              还有 →            没有了 →
              再创建一个         Initiative
              initiative_plan   completed
              (循环)                │
                                   ▼
                            KR progress 更新
                            所有 Init 完成?
                            → KR completed
```

---

## 总结：两个路由器的关系

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   Tick（代码路由器 / 心脏）                           │
│   固定节拍，确定性调度                                │
│                                                     │
│   ┌─────────────────────────────────────────────┐   │
│   │                                             │   │
│   │  丘脑（有脑子的路由器）                       │   │
│   │  MiniMax LLM，处理意外事件                   │   │
│   │                                             │   │
│   │  是 Tick 流水线上的步骤 0                     │   │
│   │  不是独立运行的                               │   │
│   │  99% 直接放行                                │   │
│   │                                             │   │
│   └─────────────────────────────────────────────┘   │
│                                                     │
│   decomposition-checker → 规划器 → 执行器 → Agent    │
│   这些都是 Tick 直接调的，不经过丘脑                   │
│                                                     │
│   所有组件通过 PostgreSQL DB 传递状态                  │
│   没有组件直接调另一个组件                             │
│                                                     │
└─────────────────────────────────────────────────────┘
```
