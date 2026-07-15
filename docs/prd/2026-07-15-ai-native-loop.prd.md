# PRD：刀 5 AI-Native 闭环——探针红自动开单修复，验尸自动产守卫

> 日期：2026-07-15
> 发起：Alex（主理人拍板：**直接写 PRD，不走 /architect 拆解**——07-15 handoff 202607151215 记录在案）
> 层级：Project（Ops 半环第 6 把刀，母 PRD = docs/prd/2026-07-14-ops-half-loop.prd.md 三.5 节立向；下分 4 把小刀，每把 = 1 个 Initiative）
> 前置：刀 0-4 全收官（测试自动入册 / TDD 接缝纪律 / Ops 守卫制度 / 心跳+棘轮+演习均已上生产）
> 关联决策：dc18d43d「无闸不成文」——本 PRD 的一切自动化不豁免任何闸

---

## 一、背景（为什么现在干）

母 PRD 已把系统推到 L2.5（守卫可信）：14 个巡检 job 在跑、心跳有机外 dead man's
switch、棘轮锁住关键健康数、告警有 P0-P3 分级预算。但**从"发现问题"到"修好问题"
中间仍然是人**：探针红 → Bark → 管家会话人工诊断 → 人工注册任务 → 人工 /dev。
07-15 一天三起事故（盘满、OrbStack 自杀、熔断烧穿）全部走的这条人肉链路。

母 PRD 的关键洞察仍然成立：AI-Native Ops 的"手术室"（harness：GAN 合同 → TDD
generator → CI → evaluator → judge → merge）已经建成并稳定交付；Ops 侧的感知、
分诊、诊断、告警也已建成。**缺的只是把 Ops 输出端接到 Dev 输入端这一根线，
以及修完之后自动长出新守卫的沉淀制度。**

目标回路（母 PRD 三.5 冻结）：

```
探针红/心跳断 → ①感知 → ②分诊 → ③诊断
→ ④修复: 见过的病→自愈动作 / 没见过的病→自动开 harness 修复单
→ ⑤沉淀: 验尸自动写 learnings + 自动产出新守卫
→ ⑥升级: 仅政策级 Bark Alex 拍板
```

---

## 二、现状摸底（2026-07-15 对代码实证，SSOT=代码，禁凭记忆）

| 环 | 机制 | 证据 | 成熟度 |
|---|---|---|---|
| ①感知 | 巡检注册表 14 job + 哨兵 | `scheduler-jobs.js:30-46` | ✅ 可复用 |
| ①感知 | launchd-patrol / pipeline-patrol / capability-probe / 心跳族 | `launchd-patrol.js:89-157` 等 | ✅ 可复用 |
| ②分诊 | 警觉阶梯 5 级 + 去抖 + 派发闸门 | `alertness/index.js:25-33,147-204,477-515` | ✅ 可复用 |
| ③诊断 | AI 巡检员自动立案（ci_patrol/arch_review，trigger_source='brain_auto'） | `daily-review-scheduler.js:105,313,432` | ✅ 可复用 |
| ④自愈 | healing 4 策略 / 熔断器 / zombie-reaper / preview-reaper | `alertness/healing.js:70-114`、`circuit-breaker.js:20-193` | ⚠️ 有雏形：动作是白名单散兵，无"指纹→playbook"路由 |
| ④开单 | 探针红→自动 INSERT tasks 仅一例（pipeline_rescue 普通单，非 harness 修复单） | `pipeline-patrol.js:456` | ❌ 通用开单器缺失 |
| ⑤沉淀 | learnings 表 + POST /api/brain/learnings-received | `routes/tasks.js:223-304` | ✅ 可复用 |
| ⑤沉淀 | postmortem/验尸机制 | 全仓 grep 零命中 | ❌ 完全缺失 |
| ⑤沉淀 | journey_features.guard_ref 列 | 全仓 grep 零命中（migration 282/295 均无） | ❌ **刀 3 立项未落地，欠账并入本刀** |
| 护栏 | 频控/去重/预算模式 | `lib/dedupe.js`、`alerting.js`、`ledger-hygiene.js:219-269` 棘轮 | ✅ 可复用 |

结论：①②③⑥四环齐备，本刀只需新建 **④的开单器 + ⑤的验尸机 + 守卫账本**，
且频控/去重/棘轮全部有现成模式照抄，不从零造轮子。

---

## 三、范围：四把小刀（按依赖排序）

### 刀 5a：事故归一层（incidents 档案）

开单频控、验尸、对账都需要一个统一挂点。现状是探针红散落在 Bark/飞书/
cecelia_events/tasks 四处，没有"一起事故一条记录"的归一实体。

**交付物**
- `incidents` 表（migration）：`probe_id`（哪只探针）、`fingerprint`（去重键，
  探针名+异常特征哈希）、`severity`、`evidence`（JSONB 取证包：探针输出、日志指针）、
  状态机 `open → triaged → fixing → resolved → postmortem_done`、
  `task_id`（关联修复单）、`recurrence_count`（同指纹复发只累加不重开）。
- `reportIncident()` 薄封装：现有探针**不重写**，红时多调一行。
  第一批接入 5 只：launchd-patrol、心跳静默检测器、circuit-breaker OPEN、
  assert-deploy-effect 红、smoke nightly 红。
- 后续新探针出生即接（合同模板「运行时守卫」段补一句：探针红必须 reportIncident）。

**用户能看到什么**：`GET /api/brain/incidents` 一屏看到最近事故、状态、谁在修；
不再靠翻 Bark 历史拼凑"今天到底发生了几起"。

### 刀 5b：自动开单器（Ops→Dev 那根线，本刀核心）

**交付物**
- triage 路由（挂 scheduler-jobs 新 job，消费 open incidents）：
  1. 指纹命中 playbook（见过的病）→ 执行白名单自愈动作（复用 healing.js 4 策略 +
     熔断复位 + reaper），记录到 incident；
  2. 自愈两次无效 或 指纹陌生（没见过的病）→ **自动开 harness 修复单**：
     `INSERT INTO tasks`（照 `pipeline-patrol.js:456` 先例），
     `trigger_source='probe_auto'`，payload 带 incident id + 取证包 +
     cecelia-harness-debug 七层 filter 的初步分层提示。
- playbook 注册表：指纹 → 自愈动作映射，起步硬编码白名单（healing 现有 4 类 +
  熔断复位），数据落 `working_memory` 或轻表，新 playbook 只能由验尸产出（刀 5c）。

**护栏（不可豁免，母 PRD 冻结 + 本刀落地形式）**
- 同一探针指纹 24h 只开一单：复用 `lib/dedupe.js` 的 `claimDedupeKey('incident', fingerprint, 24h)`。
- 全系统日开单封顶 N（默认 3，开放问题 1 拍板）：`working_memory` 日计数器；
  超限降级为 P1 告警不开单，预算余额进面板。
- 自动单走**完整 GAN + judge + CI 闸，零豁免**——"机器自己开的单"不减配任何验收
  （否则与 dc18d43d 自相矛盾）。
- alertness=PANIC 时开单器静默（复用 `canDispatch` 闸门）——系统濒死时不给自己加活。
- 自愈动作只限现有白名单，**不新增任何写生产的动作**（见非目标）。

**用户能看到什么**：staging 上一个东西死了，几分钟后 tasks 表里出现一张
trigger_source='probe_auto' 的修复单带全套取证，harness 自己开工——Alex 第一次
知道这件事可以是在 PR 已开好的 Bark 里。

### 刀 5c：验尸机（postmortem → 新守卫）

**交付物**
- 触发：incident 关联修复单 merge（或人工修复后标 resolved）→ 自动立
  `task_type=postmortem` AI 任务（照 arch_review 自动立案模式，
  `daily-review-scheduler.js:282-326` 同款 guard 去重）。
- 验尸产出（结构化，写 learnings，category=postmortem）：
  ① 根因；② **为什么现有守卫没有更早抓到**（守卫缺口分析，这是产新守卫的依据）；
  ③ 新守卫提案（四选：regression test / smoke 脚本 / 探针 job / 棘轮指标）；
  ④ 是否沉淀新 playbook（下次同指纹直接自愈）。
- 守卫提案落地路径（分型分权）：
  - 测试/smoke 类 → 自动开 harness 单生成，同走全闸（毕业机制刀 1 已建成，
    merge 即自动入册）；
  - 探针/棘轮类 → 生成 PR 提案（scheduler job / 指标），走 CI 闸自动合并；
  - 政策类（要改规矩、要花钱、要动生产架构）→ 仅 Bark Alex 拍板，不自动执行。
- 验尸单不占刀 5b 的日开单预算（它不改生产行为）；但验尸产出的"守卫生成单"占。

**用户能看到什么**：每起事故结案后 24h 内，learnings 里多一条验尸记录，
守卫提案挂在面板上；同一种病第二次发作时要么被新守卫提前抓住、要么被
playbook 直接自愈——**打地鼠循环从"人修"变成"系统每挨一刀长一块甲"**。

### 刀 5d：守卫账本 + 回路面板（含刀 3 欠账清偿）

**交付物**
- migration：`journey_features` 加 `guard_ref` 列（刀 3 立项未落地，实证 grep
  零命中）；编码形态待开放问题 4 拍板后落。
- 裸奔 FR 数（live FR 无 guard_ref）进面板一级指标，棘轮只许降（照
  `ledger-hygiene.js` 棘轮模式）。
- 回路指标页（复用刀 0 面板守卫模式，保证自身不是僵尸）：
  本周自动开单数/预算余额、自愈成功率、incident MTTR、验尸产守卫数、
  同指纹复发数（这是回路有效性的终极指标：应趋零）。
- 周期对账兜底（07-15 新规矩「事件式清理必配周期对账」）：每日对账
  incidents ↔ tasks ↔ learnings 三表，悬空 incident（open >48h 无 triage 动作）= 红
  → 开 Issue。

**用户能看到什么**：一页看清"这台机器这周自己发现了几起、自己修了几起、
自己长了几块甲、还有几个功能在裸奔"。

---

## 四、非目标（本期不做）

- **不做高危自愈**：自动回滚部署、自动改生产配置、自动 rm/reset 类动作一律不进
  playbook 白名单——这类永远走 Bark 拍板（OrbStack 盘损的 `orbctl reset docker`
  就是反面教材：需主理人点头）。
- 不追求 L4 全自治：政策级决定永远升级给 Alex，⑥环只做通道不做决策。
- 不重写现有探针/告警/警觉阶梯（它们刚验完火），只加 reportIncident 薄接入。
- 不动 harness 编排（relay/controller/GAN/judge 零改动——开单器只是多一个
  往 tasks 表投单的客户，harness 不感知单子来自人还是探针）。
- 不给存量 FR 一次性补齐守卫：制度管新增 + 验尸管复发，存量按裸奔榜分批还债。
- 演习（chaos drill）只打 staging（5222/preview），生产演习不在本刀范围。

---

## 五、成功标准（用户语言 → 可验证断言）

1. **演习验收（Final E2E，全链零人工）**：在 staging 故意弄死首条接入探针覆盖的
   服务 → 分钟级 incidents 表落一条记录（DB 断言存在且 evidence 非空）→
   tasks 表出现 `trigger_source='probe_auto'` 修复单且 payload 带 incident id →
   该单走完 GAN+judge 出 PR。全程无人碰键盘。
2. **频控验收**：同一指纹 24h 内第二次红 → DB 断言修复单数仍=1、
   recurrence_count=2；日预算耗尽后再来一起 → 只有 P1 告警，无新单。
3. **验尸验收**：任一 probe_auto 修复单 merge 后 24h 内，learnings 出现
   category=postmortem 记录（DB 断言含守卫缺口分析 + 提案字段），提案面板可见。
4. **守卫账本**：journey_features.guard_ref 列存在；面板显示裸奔 FR 数且棘轮
   守卫生效（人为造一次倒退 → CI 红）。
5. **30 天观察指标**（不作验收硬闸，同母 PRD 五.5 口径）：同指纹复发 incident
   占比下降；「修机器」类人工救火会话次数下降。

---

## 六、排期建议

| 小刀 | 内容 | 依赖 | 方式 | 预估 |
|---|---|---|---|---|
| 刀 5a | incidents 归一层 + 5 只探针接入 | 无 | /decomp → 2 个 /dev 任务 | 1-2 天 |
| 刀 5b | 自动开单器 + 护栏 + 首条端到端验火 | 5a | /decomp → 2-3 个 /dev 任务 | 2-3 天 |
| 刀 5d | guard_ref + 面板 + 对账（可与 5b 并行） | 5a | /decomp → 2 个 /dev 任务 | 1-2 天 |
| 刀 5c | 验尸机 + 守卫提案落地 | 5b | /decomp → 2-3 个 /dev 任务 | 2-3 天 |

顺序：5a → 5b（先用首条探针把"红→开单→PR"端到端打通）→ 5d 与 5c 并行收尾。
合计约 1-1.5 周。与在飞工作无冲突（不碰 harness 编排、不碰部署链）。

---

## 七、开放问题（已拍板，2026-07-15）

1. **日开单预算 N 默认值**：3（建议值，用户未反对）。decision `0f8e2780`。
2. **自动单目标范围**：一期覆盖 cecelia + zenithjoy-skills 两个 repo（用户拍板：不局限
   cecelia，skill 层 bug 也纳入自动开单——推翻原建议"仅 cecelia"）。decision `902df145`。
3. **验尸产出的探针/棘轮类守卫 PR 合并权限**：走 CI 闸自动合并；政策类仍走 Bark 人批。
   decision `89588cf2`。
4. **`guard_ref` 编码形态**：JSONB `{type, ref}`。decision `612ab0db`。
5. **首条端到端验火探针**：smoke nightly 红（建议值，用户未反对）。decision `b16ef682`。
6. **自动单与人工队列优先级**：继承 incident severity；PANIC 时开单器静默兜底。
   decision `814e05f2`。

> 拍板已解除本 PRD 的 Contract 前置阻塞，可进入 /decomp 拆 Initiative（按六.排期建议
> 顺序 5a → 5b → 5d/5c 并行）。
