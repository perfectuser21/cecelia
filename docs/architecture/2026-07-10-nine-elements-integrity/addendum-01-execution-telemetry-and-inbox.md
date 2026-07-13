# Architecture Addendum 01：执行遥测复活 + 统一收件箱通电

日期：2026-07-10（同日追加，与 architecture.md 同一 initiative）
状态：设计稿（/architect Mode 2 追加，待主理人批准后 Tasks 进队列）
上游：`architecture.md`（09/10/11 要素设计，PR #3731 merged）
触发：主理人在同一天的另一 session 里排查"handoff/learning/decision 太粗"问题时，
连带发现四个 architecture.md 未覆盖的空转点。

## 概述

`architecture.md` 解决的是"九要素账本骨架已建但没通电"。本 addendum 解决的是四个
**account.md 审计时没扫到的独立空转点**，其中两个（T7/T8）是账本保鲜（要素⑩）范围内
本该发现但没发现的漏网案例，另两个（T9/T10）是全新缺口：

1. **`initiative_run_events` 断供**（07-04 起零写入）——LangGraph→skill-relay 架构切换时，
   细粒度阶段追踪的写入方（图节点）被移除，没人把等价逻辑接到新架构里。API 端点其实还在
   （`POST/PATCH /api/brain/harness/phase-event`，harness.js:1708-1768），只是没人调用。
2. **`decisions` 表被 `consciousness_loop` 灌水**——96,316 行空白记录（topic/decision 均为
   空字符串），`consciousness.graph.js` 触发，约每 20 分钟一次，内容是重复的"5 个失败任务建议
   重试"，且这 5 个任务从未被真正重试过（附带发现：这个自愈机制本身也是坏的）。
3. **`learnings` 表摘要覆盖率 6%**——8,307 行里仅 482 行有 `summary`；`digested=true` 的
   8,177 行里绝大多数是"标记已处理但未真正提炼"；`task_completion` 类目（常规巡检完成通知）
   本不该进这张表，纯噪音。
4. **统一收件箱未通电**——`capture_atoms` 表结构完备（07-07 928c6054 决策设计的"想法收件箱"），
   但只有 1 条记录；handoff/learning/issue 产出后不会自动进箱；分诊逻辑（紧急插队/挂Line
   backlog/变铁律/走OKR）从未实现。

## 数据模型变更

无新表、无 migration。全部复用既有 schema：

| 变更 | 表/文件 | 内容 | Task |
|---|---|---|---|
| 无 | `initiative_run_events` | 只补写入方，schema 不变 | T7 |
| 无 | `decisions` | 只改写入频率/去重，schema 不变 | T8 |
| 无 | `learnings` | 只改写入过滤 + 摘要生成可靠性，schema 不变 | T9 |
| 无 | `capture_atoms` | 只补写入方 + 新建分诊 tick，schema 不变 | T10 |

## 关键决策

| 决策 | 选项A | 选项B | 选择 | 理由 |
|---|---|---|---|---|
| phase-event 由谁写 | Brain 后端拦截 skill 调用自动记 | skill markdown 指令里显式 curl 自报 | **B** | skill-relay 架构下 Brain 后端看不到 session 内部的 Skill() 调用边界，只有 agent 自己知道；这也是当前 handoff/decision 写入的既有模式，不是新发明 |
| zombie-reaper 判活依据 | 保持看 `tasks.updated_at` | 改看 `initiative_run_events` 最后心跳 | **B（T7 完成后生效，先加为第二判据不替换）** | `updated_at` 判活是今天两次误杀 T5/T6 的根因之一；phase-event 心跳是任务是否真的在动的更强信号；先叠加不替换，避免 T7 未完全覆盖的任务类型被误伤 |
| consciousness_loop 治理 | 停写 decisions，改写专用健康日志表 | 保持写 decisions 但加去重（内容不变则跳过） | **B** | 06f78c9a"禁建平行表"原则延续；这条日志本质是重试建议的状态记录，去重后量级从 9.6万降到个位数（5个任务状态不变时不重复写） |
| learnings 噪音过滤点 | 在 `recordLearning()` 调用处按 category 拦截 | 在 DB 层加 trigger 拒绝 task_completion | **A** | 拦在应用层能给出清晰日志和后续可调整的白名单/黑名单逻辑；DB trigger 出错时难排查，且未来 category 分类可能变化 |
| 统一收件箱进箱方式 | handoff.js 等 3 处写入代码里加一行推送 | 独立 tick 扫描已有表拉取 | **A（推）** | 推没有扫描延迟、不用维护"扫到哪了"的状态；改动集中在 3-4 处現有写入函数，每处改动都是几行 |
| 收件箱分诊触发 | 写入时立即同步分诊 | 独立 tick job 异步分诊 | **B** | 解耦写入与 AI 判断调用，避免分诊调用阻塞/拖慢原有写入路径的响应时间；复用 T5 line-dreaming 已验证的 scheduler-job 模式 |
| 铁律候选写入前置检查 | 直接写 `decisions category=invariant` | 先过 Invariant Gate（4 查）再写，未过则 `pending_review` | **B** | 07-06 1ef6ec3e 决策原案就是四查（冲突/可验证/scope/矛盾），今天验证过的 decisions 表垃圾问题证明"先写后治理"这条路走不通，必须前置校验 |

## 模块变更

| 模块 | 变更 | 说明 | Task |
|---|---|---|---|
| `packages/engine/skills/harness-controller/SKILL.md`（zenithjoy-skills repo） | 修改 | 每次 `Skill(harness-planner\|proposer\|reviewer\|generator\|evaluator\|report)` 调用前后插入固定 curl：`POST /api/brain/harness/phase-event` → 调用返回后 `PATCH .../phase-event/:id`（含 cost_usd/model） | T7 |
| `packages/brain/src/zombie-reaper.js` | 修改 | 判活逻辑叠加查 `initiative_run_events` 最后心跳时间，任一信号"活"即不判死 | T7 |
| `packages/brain/src/workflows/consciousness.graph.js` | 修改 | 写 decisions 前先查上一条同 `trigger='consciousness_loop'` 的记录内容是否相同，相同则跳过写入 | T8 |
| （一次性数据清理，随 T8 PR 附带 migration 或脚本） | `decisions` 表 | 删除 `topic IS NULL AND decision IS NULL` 的历史垃圾行 | T8 |
| `packages/brain/src/learning.js` | 修改 | `recordLearning()` 入口对 `category='task_completion'` 直接跳过不落库；排查 `generateL0Summary` 低成功率原因并修复 | T9 |
| `packages/brain/src/handoff.js` | 修改 | `saveHandoff()` 收尾时顺手 `INSERT INTO capture_atoms`（content=handoff 摘要，target_type='handoff'，routed_to_table='tasks'，routed_to_id=task_id） | T10 |
| `packages/brain/src/learning.js` | 修改 | `recordLearning()` 成功落库后（非 task_completion 噪音）顺手写一条 capture_atoms | T10 |
| `packages/brain/src/routes/issues.js`（或等价创建 issue 的入口） | 修改 | 创建 issue 时顺手写一条 capture_atoms | T10 |
| `packages/brain/src/capture-triage.js` | 新建 | tick job：读 `capture_atoms WHERE status='pending_review'`，先过便宜规则（见下表），规则打不中的调 LLM 分类；四路分诊结果写回 `routed_to_table`/`routed_to_id` + 更新 status | T10 |
| `packages/brain/src/invariant-gate.js` | 新建 | 四查（与既有铁律冲突/可验证/scope恰当/与累积FR矛盾）单次 LLM 调用，PASS 才允许 T10 分诊结果写 `decisions category=invariant`，否则落 `pending_review` | T10 |
| `packages/brain/src/tick-runner.js` | 修改 | 注册 `runCaptureTriageIfNeeded`（复用 scheduler-jobs 注册表模式） | T10 |

## 便宜规则表（capture-triage 第一层，T10）

| 条件 | 判定 | confidence |
|---|---|---|
| `source_type='issue' AND priority IN ('P0','P1')` | 紧急插队 | 1.0 |
| `source_type='learning' AND content LIKE '%根本原因%'` | 候选铁律（进 Invariant Gate） | 0.8 |
| `source_type='handoff' AND verdict='FAIL'` | 挂 Line backlog | 0.9 |
| `source_type='handoff' AND verdict='PASS' AND next_steps <> '["完成，无下一步"]'` | 挂 Line backlog | 0.7 |
| 以上都不命中（含全部人工输入） | 交给 LLM 判断，输出 confidence < 0.7 一律落 `pending_review` 待人工复核 | — |

## 执行顺序与依赖

```
T7 phase-event 复活（独立，跟 architecture.md 原 T1-T6 无依赖，可并行开工）
T8 decisions 去重清理（独立，可并行开工）
T9 learnings 噪音过滤+摘要修复（独立，可并行开工）
 → T10 统一收件箱通电（依赖 T8/T9 先把 decisions/learnings 治理干净，
    否则箱子分诊的"变铁律"路径会立刻被脏数据污染）
```

T7/T8/T9 三个互相独立，理论上可以三路并行；本 initiative 沿用既有串行 task 注册惯例
（`sequence_order` 连续），实际派发时可由主理人决定是否拆成并行 headed 会话跑。

## 测试策略

- T7：单测 mock harness.js phase-event 路由被正确调用（skill 侧走 skill-eval 流程验证 markdown
  指令真的产生 curl）；zombie-reaper 单测覆盖"仅 phase-event 心跳新鲜但 updated_at 过期"场景不误杀
- T8：单测 consciousness.graph.js 内容不变时跳过写入；手工验证脚本跑一次清理确认垃圾行归零
- T9：单测 recordLearning 对 task_completion 类目直接 return；集成测试验证真实 learning 内容
  能生成非空 summary
- T10：单测三处写入函数正确调用 capture_atoms 插入；集成测试 capture-triage 对四类样例数据
  分诊结果符合规则表；Invariant Gate 单测四查各自独立可控（mock LLM 输出）

## 风险与缓解

- **T7 依赖 zenithjoy-skills 仓库改动，需独立 PR 且需要 skill-eval 验证**，跟 brain 仓库改动
  不在同一条 CI 流水线，注意两个 PR 的合并顺序（skill 侧改动可以先合，brain 侧 zombie-reaper
  改动依赖 phase-event 数据存在才有意义，但不阻塞代码合并本身）
- **T8 清理垃圾行是一次性大批量 DELETE**（9.6万行），需确认不在业务高峰期跑，且删除前先
  确认没有任何代码路径依赖这些空白 decisions 行（审计：`topic IS NULL` 的行没有被任何
  查询用 topic 做筛选条件，安全）
- **T10 的 Invariant Gate 引入额外 LLM 调用成本**——每条候选铁律一次调用，量级取决于
  learnings 噪音过滤后的真实产出速率（T9 完成后可估算），如果量级过大需要考虑批量化
