---
id: current-system-map
version: 1.4.0
created: 2026-03-10
updated: 2026-08-04
authority: CURRENT_STATE
changelog:
  - 1.0.0: 初始版本，基于 main 分支代码实际审计
  - 1.1.0: Wave1 双层架构 — LLM fire-and-forget、circuit_breaker_states 持久化、brain_guidance 表
  - 1.2.0: Harness Pipeline 可视化 v2 — GET /initiative/:id/detail 端点 + Dashboard initiative 详情面板（data-testid: initiative-card/detail-panel/prd-content/step-timeline）+ reportNode step_timing/ws_issues/ws_costs 增强
  - 1.3.0: 七大机制总账(DevOps 完备性基准,2026-07-18/19 信息逻辑重建周收官)
  - 1.4.0: 刀0 六型制地基——约束正本(KERNEL_CONTEXT.md)+三方对账闸+docs目录登记闸(PR #4611)
---

# Cecelia 系统架构图（当前事实版）

> **Authority: CURRENT_STATE**
> 本文档只记录当前 main 分支真实存在并生效的内容。
> 任何"计划中"、"PR 中"、"MEMORY 里"的内容不写入此文档。
> 如发现过期内容，请更新版本号并在 changelog 记录。

---

## 1. 整体架构

```
Cecelia Monorepo
├── packages/
│   ├── brain/       Node.js 决策引擎（端口 5221）
│   ├── engine/      开发工作流引擎（Hooks + Skills + DevGate）
│   ├── workflows/   Agent 协议 + Workflow Skills（54 个）
│   ├── quality/     QA 基础设施
│   └── config/      共享配置
├── apps/
│   ├── api/         后端 API 层（Workspace Core）
│   └── dashboard/   React UI（端口 5211）
├── scripts/         工具脚本（facts-check、devgate、deploy 等）
├── docs/            文档库
└── .github/workflows/  CI/CD（7 个 workflow）
```

---

## 2. packages/brain — 决策引擎

**端口**：5221 | **版本 SSOT**：`packages/brain/package.json`（当前 1.216.0）

```
Brain (port 5221)
├── 心脏：Tick Loop（5s 循环 / 2min 执行一次 tick）
│     src/tick.js
├── 三层大脑
│   ├── L0 脑干（纯代码）：src/tick.js, src/decision-executor.js
│   ├── L1 丘脑（Haiku）：src/thalamus.js（ACTION_WHITELIST）
│   └── L2 皮层（Sonnet）：src/cortex.js
├── 任务系统
│   ├── src/planner.js              KR 轮转评分、任务生成
│   ├── src/task-router.js          LOCATION_MAP（VALID_TASK_TYPES）
│   ├── src/task-generators/        8 个任务生成器
│   └── src/quarantine.js           隔离保护
├── HTTP API
│   ├── src/routes/                 29 个路由模块
│   └── src/routes.js               生成的路由集合
├── PostgreSQL
│   ├── migrations/                 139 个 SQL 迁移文件
│   └── src/selfcheck.js            EXPECTED_SCHEMA_VERSION = '139'
├── Harness 自愈链（刀A1-A8，2026-07-16 上生产）
│   ├── src/harness-relay-watchdog.js   收尸+死因路由+对因处置（CI红/BEHIND重点火、OOM升档、
│   │                                   401换号、限流defer、绿灯死收尾棒、宿主团灭S0批量恢复）
│   ├── src/harness-death-classifier.js 死因分类器（退出码/stdout关键词/tmux屏幕 三源取证）
│   ├── src/harness-judge.js            机械预检+DeepSeek裁判（GP步骤逐条验覆盖）
│   ├── src/lib/harness-finalize.js     收账权收归（PR MERGED+evaluator gate 外部真相核验）
│   └── scripts/canary-death-drill.mjs  金丝雀故障注入演习（nightly 03:30 staging 真死真救）
│       PRD: docs/prd/2026-07-15-self-healing-golden-path.prd.md（决策 5b0690ca golden path 形态）
└── 辅助
    ├── src/watchdog.js             进程监护（Darwin 适配）
    ├── src/alertness/              警觉等级系统
    ├── brain-manifest.generated.json  自动生成清单
    └── src/guidance.js             brain_guidance 表 CRUD（Wave1 双层握手，migration 262）
```

**Janitor 维护模块（2026-05-14，PR #2952）**：

| 能力 | 实现 | 说明 |
|------|------|------|
| Janitor 调度器 | `src/janitor.js` + `src/janitor-jobs/docker-prune.js` | 统一维护任务注册/执行，首个 job：Docker 镜像清理 |
| Janitor API | `src/routes/janitor.js` | GET /jobs、POST /jobs/:id/run、PATCH /jobs/:id/config、GET /jobs/:id/history |
| DB 表 | migration 272（janitor_runs + janitor_config） | 执行历史记录 + 每 job 开关/schedule 配置 |
| Settings 4-tab | `apps/dashboard/src/pages/settings/` | SettingsPage → BrainSystemTab / MaintenanceTab / NotificationsTab / AccountsTab |
| brain-build.sh | 每次 build 后自动 docker image prune | 防磁盘被 dangling images 撑满 |

**Wave1 新增能力（2026-05-04，PR #2750/#2751/#2748）**：

| 能力 | 实现 | 说明 |
|------|------|------|
| LLM 去阻塞 | `src/tick-runner.js` | LLM 调用全部 fire-and-forget，thalamus 30s 超时，tick loop 不再阻塞 |
| Circuit Breaker 持久化 | `src/circuit-breaker.js` + migration 261 | 重启后自动从 DB 恢复熔断状态，消除每次重启的冷启动盲区 |
| brain_guidance 表 | `src/guidance.js` + migration 262 | 两层架构握手基础设施，getGuidance/setGuidance/clearExpired API |

**刀0 新增能力（2026-08-04，PR #4611）——六型制地基 · 文档约束正本落地**：

| 能力 | 实现 | 说明 |
|------|------|------|
| 约束正本（SSOT） | `packages/workflows/KERNEL_CONTEXT.md` | 硬规则唯一权威源，HARD_RULES:BEGIN/END marker 包裹 23 条铁律 |
| 三方对账闸（升级） | `scripts/check-agents-rules-sync.sh` | 正本 vs AGENTS.md vs .claude/CLAUDE.md 三方 diff，任一不一致 exit 1 |
| docs 目录登记闸 | `scripts/smoke/check-docs-dir-registry-smoke.sh` | 检测 docs/ 未登记子目录，exit 1 阻断 |
| docs 目录基线 | `docs/current/docs-dir-baseline.txt` | 39 条祖父条款，登记闸的对账基准 |

**Brain 版本同步（4 处必须同时更新）**：

| 文件 | 值 |
|------|-----|
| `packages/brain/package.json`（SSOT） | 1.216.0 |
| `packages/brain/package-lock.json` | 1.216.0 |
| `DEFINITION.md` 第 9 行 | 1.216.0 |
| `.brain-versions` | 1.216.0 |

**关键常数（由 facts-check.mjs 验证）**：

| 常数 | 值 |
|------|-----|
| PORT | 5221 |
| TICK_LOOP_INTERVAL_MS | 5000 |
| TICK_INTERVAL_MINUTES | 2 |
| EXPECTED_SCHEMA_VERSION | 262 |

---

## 3. packages/engine — 开发工作流引擎

**版本 SSOT**：`packages/engine/package.json`（当前 12.46.0）

```
packages/engine/
├── hooks/                    Git Hook 脚本
│   ├── branch-protect.sh     分支保护（核心 gate）
│   ├── stop-dev.sh           /dev 停止点续跑逻辑
│   ├── bash-guard.sh         Bash 语法检查
│   └── credential-guard.sh   凭据泄露防护
├── skills/dev/               /dev 工作流定义（v3.4.1）
│   ├── SKILL.md
│   └── steps/                00~11 共 12 个步骤
├── scripts/devgate/          DevGate 检查脚本（6 个）
└── features/feature-registry.yml  Feature 注册表 SSOT
```

**Engine 版本同步（5 个文件必须同时更新）**：
`package.json` / `package-lock.json` / `VERSION` / `.hook-core-version` / `regression-contract.yaml`

---

## 4. apps/ — 前端应用层

| 目录 | 职责 | 端口 |
|------|------|------|
| `apps/api/` | Workspace Core 后端 API，28 个功能模块 | — |
| `apps/dashboard/` | React UI，Cecelia 唯一前端入口 | 5211 |

---

## 5. packages/workflows — Agent 协议与 Skills

- `skills/`：54 个技能实现（发布工具类为主）
- `agents/`：Agent 定义
- `n8n/`：N8N Workflow 配置
- `agents-registry.json`、`workflow-registry.json`

---

## 6. scripts/ — 工具脚本（根目录）

| 脚本 | 职责 |
|------|------|
| `facts-check.mjs` | Brain 代码事实一致性检查 |
| `check-version-sync.sh` | Brain 版本 4 文件同步验证 |
| `devgate/` | 6 个 DevGate 检查脚本 |
| `brain-deploy.sh` | Brain 部署 |
| `brain-reload.sh` | Brain 热重载 |
| `brain-rollback.sh` | Brain 版本回滚 |

**⚠️ 注**：`scripts/local-precheck.sh` 在 MEMORY.md 中有记录（PR #754），但当前 main 分支中**不存在**此文件。

---

## 7. CI/CD Workflow 列表（当前实际存在）

| 文件 | 触发条件 | Runner |
|------|---------|--------|
| `ci-l1-process.yml` | PR → main（所有 PR 必跑） | ubuntu |
| `ci-l2-consistency.yml` | push + PR → main | ubuntu |
| `ci-l3-code.yml` | push + PR → main（brain 变更时） | ubuntu |
| `ci-l4-runtime.yml` | push + PR → main（brain 变更时） | macOS |
| `deploy.yml` | 部署（详情待审计） | — |
| `auto-version.yml` | push → main，自动 bump 版本 | ubuntu |

详细结构见 `docs/current/CI_PIPELINE.md`。

---

## 8. 数据流

```
Brain Tick（每 2min）
    ↓
planner.js 选取任务
    ↓
cecelia-bridge → cecelia-run → claude -p "/dev --task-id <id>"
    ↓
/dev 工作流（12 步，见 DEV_PIPELINE.md）
    ↓
POST /api/brain/execution-callback
    ↓
更新任务状态 → 下个 tick 继续
```

---

## 9. 快捷链接（Symlinks）

| 快捷 | 指向 |
|------|------|
| `hooks/` | `packages/engine/hooks/` |
| `skills/` | `packages/engine/skills/` |

---

## 10. 交付轴 Golden Path（合并即上线）

| 件 | 名称 | 实现路径 | 状态 |
|----|------|---------|------|
| G1 | SHA 对账判变（假跳过根治） | brain-ci-deploy.yml SHA 对账 + brain-deploy.sh SHA 回读断言 | ✅ 已上线 |
| G2 | 漂移哨兵 | packages/brain/src/cron/drift-sentinel.js（每 30min 自动补部署） | ✅ 已上线 |
| G3 | 每日演习 | scripts/smoke/e2e/deploy-daily-drill.sh（nightly 09:00 对账断言） | 🆕 本 PR |

---

## 七大机制总账(DevOps 完备性基准,主理人验收表)

> 2026-07-18/19 拍板:大机制清单**封闭为七条**。完备性判据(可验伪):
> 今后任何新问题若能落进七机制之一的现有家(issue/棘轮/learning/守卫)而无需发明新机制,
> 即机制层完备的持续证明;出现"无家可归"的问题才允许加第八行。

| # | 机制 | 回答什么 | 载体 | 状态 |
|---|---|---|---|---|
| 1 | 认知 | 系统有什么、谁连谁 | 照相层四表(api/db_schema/test/graph_edges)+事件扳机(rescan-if-changed)+五查询(/api/brain/graph)+账龄哨兵 | ✅ 2026-07-18 闭合(PR#4082/4085/4087/4092) |
| 2 | 意图 | 承诺了什么 | 承诺地图(journeys/steps.promise/journey_features/golden_path)+判定点/决策表+锚点(回填进行中) | ✅ 机制在;锚点加厚中(刀C) |
| 3 | 生产 | 意图→代码 | /dev 三路径 + harness skill-relay(planner→GAN→generator) | ✅ 成熟(2026-07-18 B② 全自动实证) |
| 4 | 质检 | 证明做对 | 合同层(GAN rubric/格式硬检)+代码层(TDD 闸/不可变校验/island-gate/重跑闸)+验收层(evaluator 真跑/judge 权威) | ✅ 密 |
| 5 | 生存 | 执行体死了有人收 | harness-orphan-guard(callback 一致性闸+定时兜底,只收 generator_done 前的裸孤儿)+harness-relay-watchdog(PR 态收口:MERGED→finalize/OPEN绿→静等/红→重点火)+zombie-reaper+主仓哨兵 | ✅ 2026-07-19 守卫补链刀闭合(收权分界:开 PR 前归闸,开 PR 后归 watchdog) |
| 6 | 交付 | 合并→安全上线 | Gate3 自动部署+staging 放行+版本 bump 闸+部署自检 | ✅ 2026-07-15 根治 |
| 7 | 学习 | 不掉同一个坑 | learnings 落库/issue 立案/decisions/判定点活性/棘轮族(smoke/无主比例/暗边计数) | ✅ 永续运转 |

> 剪裁说明:骨架=行业 DevOps 闭环;1(认知)与 5(生存)为 AI 工人特化——行业默认工人是"有记忆、不蒸发的人",我们的工人是失忆且会蒸发的 LLM,故显式机制化。适用于本组织全部仓(Cecelia/ZenithJoy)。
