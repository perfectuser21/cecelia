# Kernel Harness × Golden Path 权威地图

> **本文件的铁律：只放指针，不放事实快照。**
> 版本号、行数、覆盖率等数字放进本文件必然腐烂（2026-08-04 审计实证：AGENTS.md 版本号漂移
> 50 个版本、skills-index 自称自动生成实际停摆 4 个月）。任何"当前状态"一律给查询命令，
> 读的人自己跑，跑出来的才是真的。
>
> **维护规则**：改了 governance 决策 / golden-path 系 skill / 下列任何表结构的人，
> 必须同步本文件对应指针（只改指针，不抄内容）。本文件挂在 `docs/current/README.md` 路由表。

---

## 一、Golden Path 治理体系（承诺地图）

### 概念定义在哪

| 要查什么 | 唯一权威源 | 注意 |
|---|---|---|
| 什么是 Line / 路 / 骨干 / 挂片，三问法，七动作，场景八格 | zenithjoy-skills 仓库 `golden-path/references/doctrine.md` | ⚠️ 07-24 版缺"GP级7项合同"层与"11要素封版"，补课 PR 未发前以下两行为准 |
| GP 级 7 项合同（key 清单与铁律） | zenithjoy-skills `golden-path-proposer/SKILL.md` 铁律第 8 条 | 7 个 key：fr_summary / lifelines_and_nfr / yield_order / external_commitment_changes / release_and_blast_radius / success_and_close / budget_guard，禁增第 8 个 |
| 11 要素封版判据与拒绝话术 | Brain DB：`SELECT topic, decision FROM decisions WHERE category='governance' AND status='active'` | 07-29 主理人拍板（migration 370 seed），11 要素 = 拍板4项(FR/NFR/判定点/两轴衔接) + 机器托管7项(不变量/失败语义/死亡告警/效果确认/对抗面/保质期/账本保鲜)，封版不增补 |

### 分层结构（07-29 拍板终版）

```
第一层  GP 级 7 项合同（人签字，每 GP 一次）      → golden_path_contract_versions 表
第二层  步骤级 11 要素（封版；AI 起草人审）        → journey_step_links 格子账本
第三层  流水线机制（盖章/裁决记账/退役触发/红方）  → 不是要素，是引擎行为
第四层  审判指标（终点验收打回率）                → 首席指标非唯一审判
```

新想法分流判据（防膨胀，任何人提"加要素"先过这两句）：
- 要素层："每步单独回答、逐步不同、且未被四区收留" 才有资格成为要素
- 合同层："每 GP 单独回答、且必须人签字" 才有资格进合同

### 数据账本在哪（全部用 psql 现查，禁引用文档里的旧行数）

| 表 | 装什么 | 常用查询 |
|---|---|---|
| `journeys` | Line（业务线）；WarRoom 的"Line"就是这张表 | `SELECT name, journey_type, maturity FROM journeys WHERE status='active'` |
| `journey_steps` | 每条路的承诺式骨干（3-5 步） | 按 journey_id 查 |
| `golden_paths` | GP 业务账本（立项→交付状态机） | `SELECT title, status FROM golden_paths` |
| `journey_step_links` | 格子账本（11 要素 / 场景格 / 断言的落点） | cell_kind ∈ capability/element/scenario/base_ref |
| `golden_path_contract_versions` | 7 项合同的版本+签字 | ⚠️ 2026-08-04 审计时为空表——机制已建，一笔签字未落 |
| `decisions` (category=governance) | 封版判据等 6 条治理裁决 | 见上 |
| `decisions` (category=invariant) | 铁律注册表（滚动增长） | `WHERE status='active'` |
| `journey_features` | ⚠️ **旧 Ability 轴，07-24 拍板废弃**，但仍有存量与写入——待治理，禁按它做新设计 | — |

⚠️ 命名地雷：DB 里同时存在 `golden_path`（单数，sprint 级 FR 记录）和 `golden_paths`
（复数，GP 业务账本），不是一张表，别混。

### skill 家族分工（SSOT 全在 zenithjoy-skills 仓库）

| skill | 管什么 |
|---|---|
| golden-path-mapper | 领域→切几条路（Mode 1）；新东西归位到哪条路哪一步（Mode 2） |
| golden-path-proposer | 单条 GP 的提案文档 + 7 项合同起草 |
| golden-path-reviewer | 对抗审查（红方），三镜头 |
| golden-path-controller | GP 提案编排（proposer↔reviewer 多轮） |
| golden-path（门面） | 判定链入口 + doctrine.md 所在地 |
| golden-path-scoping | ⚠️ 疑与 mapper 重叠、待下架确认 |
| harness-contract-proposer / reviewer | sprint 级合同 GAN（与 GP 级合同是两层，别混） |

---

## 二、Kernel v2 orchestrator（provider 无关执行内核）

### 入口文档

子系统唯一 README：`packages/brain/src/orchestrator/README.md`（灰度开关/回滚/Commander）。

### 两套派发系统的分流规则（此前无任何文档记载，勿再考古）

判定代码：`packages/brain/src/executor-contracts.js`

```
task.payload.orchestrator='skill-relay' 且 payload.harness_runtime='kernel-v1'
    → orchestrator/run.js（Kernel v2：独立主机进程，claude/codex/grok 三家对等）
task.payload.orchestrator='skill-relay'（无 harness_runtime）
    → 老 harness-controller relay 容器（docker，cecelia/runner 镜像）
其余全部 task_type（dev/talk/review/decomp/codex_dev…）
    → executor.js 老通用分发器（不含 Grok）
```

分流靠 **payload 字段**，不靠 task_type——这是最容易被误解的一条。

### provider 无关的知识注入链（"三家 agent 都能拿到同一份上下文"的现成机制）

```
packages/workflows/skills/<name>/SKILL.md
  → orchestrator/skill-bundle.js loadSkillBundle()（冻结快照：version + sha256）
  → orchestrator/dispatcher.js ACTION_SPECS（role→skill 映射：planner/proposer/reviewer/generator/evaluator）
  → providers/shared.js buildProviderPrompt()
  → claude / codex / grok 统一下发
```

扩展点：TaskBundle 是唯一注入载体，当前只带单个 skill；要注入额外知识需扩
`buildBundle` / `execution-contract.js` schema——"Kernel 统一上下文注入" 项目立项时从这里下刀。

### 子系统文件分区（指针，详见各文件头注释）

- 内核循环：`run.js` / `loop.js` / `derive.js` / `ground-truth.js` / `counters.js` / `gates.js` / `decision-log.js` / `heartbeat.js` / `kernel-handlers.js`
- 派发与合同：`dispatcher.js` / `execution-contract.js` / `contract-store.js` / `attempt-store.js` / `run-event-store.js` / `convergence-signatures.js` / `callback-auth.js` / `credential-broker.js`
- Provider 层：`provider-registry.js` / `providers/{claude,codex,grok,shared}.js` / `skill-bundle.js`
- Commander：`commander-*.js` / `directive-validator.js` / `actor-inbox.js`
- Fleet/Preflight：`preflight/` / `fleet-node/` / `*-transport.js` / `machine-attestation.js`

---

## 三、常用查询手册

```bash
# 治理决策（封版判据、产权方案等 6 条）
psql -h localhost -p 5432 -U postgres -d cecelia \
  -c "SELECT topic, decision FROM decisions WHERE category='governance' AND status='active'"

# 活跃铁律
psql ... -c "SELECT topic FROM decisions WHERE category='invariant' AND status='active'"

# GP 账本现状
psql ... -c "SELECT title, status, updated_at FROM golden_paths ORDER BY updated_at DESC"

# WarRoom Line 树（含 Area 归类；注意归类靠正则扫名字，已知误分 bug）
curl -s localhost:5221/api/brain/warroom/lines
```

---

## 四、已知缺口（2026-08-04 审计，修一条划一条）

1. `golden_path_contract_versions` 空表——合同机制上线但没有任何 GP 真的签过合同
2. `journey_features` 名废实活——账面废弃仍在写入，与 golden_paths 双轨并行
3. "智能客服 · GP-A~F" 6 个 Journey 是历史错建（GP 被建成了独立 Journey），
   骨干/feature/任务引用散落其中，待迁移回"智能客服"正主 + golden_paths 正表
4. WarRoom Area 归类正则（`warroom-classify.js`）误分："智能客服"系/爆款视频翻拍/西安机群 被错归 Cecelia
5. doctrine.md 缺 07-29 合同层与封版——补课 PR 待发（zenithjoy-skills）
6. `journey_step_links` 格子最后写入早于封版拍板，未按 11 要素终版重灌
7. orchestrator/ 33 文件在 system_modules 知识库覆盖率约 9%；SYSTEM_MAP 对该子系统零记载
8. golden-path-scoping skill 疑废未下架
9. AGENTS.md / skills-index.md / CI_PIPELINE.md / DEV_PIPELINE.md 整体过期待重写
   （"自称自动更新"的文件全部停摆——重写时必须同时修自动化，否则重蹈覆辙）
