---
id: current-system-map
version: 2.0.0
created: 2026-03-10
updated: 2026-03-29
authority: CURRENT_STATE
changelog:
  - 2.0.0: 2026-03-29 活地图更新 — 版本号/schema/模块数/CI结构/系统健康/已知缺口全部更新到真实状态
  - 1.0.0: 初始版本，基于 main 分支代码实际审计
---

# Cecelia 系统架构图（活地图）

> **Authority: CURRENT_STATE**
> 本文档只记录当前 main 分支真实存在并生效的内容。
> 任何"计划中"、"PR 中"、"MEMORY 里"的内容不写入此文档。
> 如发现过期内容，请更新版本号并在 changelog 记录。
>
> **Claude 读图规则**：对话开始先读此文件，看 §10「已知缺口」再定 scope，不要盲操作。

---

## 系统健康快照（2026-03-29）

| 模块 | 状态 | 说明 |
|------|------|------|
| Brain API | ✅ healthy | 端口 5221，调度器运行中 |
| 调度器 | ✅ running | enabled=true，max_concurrent=16 |
| 断路器 | ✅ all_closed | cecelia-run: CLOSED |
| 探针 | ✅ 10/10 | 全部通过（见 CURRENT_STATE.md） |
| 内容流水线 | ❌ 断连 | content-research 全部失败，10条话题卡死 |
| /context API | ❌ SQL bug | column "title" does not exist |
| DB 备份 | ❌ 缺失 | 无 pg_dump 定时任务 |
| CI 有效性 | ⚠️ 虚假绿 | 3个反模式（见 §8） |

---

## 1. 整体架构

```
Cecelia Monorepo
├── packages/
│   ├── brain/       Node.js 决策引擎（端口 5221）
│   ├── engine/      开发工作流引擎（Hooks + Skills + DevGate）
│   ├── workflows/   Agent 协议 + Workflow Skills（56 个）
│   ├── quality/     QA 基础设施
│   └── config/      共享配置
├── apps/
│   ├── api/         后端 API 层（22 个功能模块）
│   └── dashboard/   React UI（端口 5211）
├── scripts/         工具脚本（facts-check、devgate、deploy 等）
├── docs/            文档库
│   ├── current/     活文档（SYSTEM_MAP、CURRENT_STATE、CI_PIPELINE）
│   ├── instruction-book/  功能说明书（2026-03-10，待更新）
│   └── learnings/   PR 经验记录
└── .github/workflows/  CI/CD（7 个 workflow）
```

---

## 2. packages/brain — 决策引擎

**端口**：5221 | **版本 SSOT**：`packages/brain/package.json`（当前 **1.218.0**）

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
│   ├── src/task-generators/        6 个任务生成器
│   └── src/quarantine.js           隔离保护
├── HTTP API
│   ├── src/routes/                 56 个路由模块
│   └── src/routes.js               生成的路由集合
├── PostgreSQL
│   ├── migrations/                 202 个 SQL 迁移文件
│   └── src/selfcheck.js            EXPECTED_SCHEMA_VERSION = '203'
└── 辅助
    ├── src/watchdog.js             进程监护（Darwin 适配）
    ├── src/alertness/              警觉等级系统
    └── brain-manifest.generated.json  自动生成清单
```

**Brain 版本同步（4 处必须同时更新）**：

| 文件 | 值 |
|------|-----|
| `packages/brain/package.json`（SSOT） | 1.218.0 |
| `packages/brain/package-lock.json` | 1.218.0 |
| `DEFINITION.md` 第 9 行 | 1.218.0 |
| `.brain-versions` | 1.218.0 |

**关键常数（由 facts-check.mjs 验证）**：

| 常数 | 值 |
|------|-----|
| PORT | 5221 |
| TICK_LOOP_INTERVAL_MS | 5000 |
| TICK_INTERVAL_MINUTES | 2 |
| EXPECTED_SCHEMA_VERSION | 203 |

---

## 3. packages/engine — 开发工作流引擎

**版本 SSOT**：`packages/engine/package.json`（当前 **13.52.0**）

```
packages/engine/
├── hooks/                    Git Hook 脚本
│   ├── branch-protect.sh     分支保护（核心 gate）
│   ├── stop-dev.sh / stop.sh /dev 停止点续跑逻辑
│   ├── bash-guard.sh         Bash 语法检查
│   └── credential-guard.sh   凭据泄露防护
├── skills/dev/               /dev 工作流定义（v4.0.0，4-Stage Pipeline）
│   ├── SKILL.md
│   └── steps/                00~04 共 5 个步骤（v4 重构后）
├── scripts/devgate/          DevGate 检查脚本（30 个）
└── features/feature-registry.yml  Feature 注册表 SSOT
```

**Engine 版本同步（5 个文件必须同时更新）**：
`package.json` / `package-lock.json` / `VERSION` / `.hook-core-version` / `regression-contract.yaml`

---

## 4. apps/ — 前端应用层

| 目录 | 职责 | 端口 |
|------|------|------|
| `apps/api/` | Workspace Core 后端 API，22 个功能模块 | — |
| `apps/dashboard/` | React UI，Cecelia 唯一前端入口 | 5211 |

---

## 5. packages/workflows — Agent 协议与 Skills

- `skills/`：**56 个**技能实现（发布工具类为主）
- `agents/`：Agent 定义
- `n8n/`：N8N Workflow 配置
- `agents-registry.json`、`workflow-registry.json`

---

## 6. scripts/ — 工具脚本（根目录）

| 脚本 | 职责 |
|------|------|
| `facts-check.mjs` | Brain 代码事实一致性检查 |
| `check-version-sync.sh` | Brain 版本 4 文件同步验证 |
| `devgate/` | DevGate 检查脚本（30 个） |
| `brain-deploy.sh` | Brain 部署 |
| `brain-reload.sh` | Brain 热重载 |
| `brain-rollback.sh` | Brain 版本回滚 |
| `write-current-state.sh` | 生成 .agent-knowledge/CURRENT_STATE.md 快照 |

---

## 7. CI/CD Workflow 列表（当前 7 个）

| 文件 | 触发条件 | Runner |
|------|---------|--------|
| `ci-l1-process.yml` | PR → main（所有 PR 必跑） | ubuntu |
| `ci-l2-consistency.yml` | push + PR → main | ubuntu |
| `ci-l3-code.yml` | push + PR → main（brain 变更时） | ubuntu |
| `ci-l4-runtime.yml` | push + PR → main（brain 变更时） | ubuntu |
| `deploy.yml` | push → main，自动部署 | ubuntu |
| `auto-version.yml` | push → main，自动 bump 版本 | ubuntu |
| `cleanup-merged-artifacts.yml` | PR 合并后，清理 .prd/.dod 文件 | ubuntu |

---

## 8. CI 已知缺陷（虚假绿）

> 来源：/repo-audit 2026-03-29，得分 72/120

| 缺陷 | 位置 | 影响 | 状态 |
|------|------|------|------|
| 🔴 **admin_bypass** | GitHub 分支保护 `enforce_admins: false` | 管理员（Alex）可绕过所有 CI 门禁 | 待手动改 GitHub Settings |
| ✅ **no_audit_in_ci** | L3 brain-l3 job 已加 `npm audit --audit-level=high --omit=dev` | 生产依赖漏洞对 CI 可见 | PR #1663 已修复 |
| ✅ **no_coverage_gate** | coverage-delta 已移除无条件 continue-on-error | vitest 75% 覆盖率阈值真实执行 | PR #1663 已修复 |
| ✅ **/context SQL bug** | context.js 已移除错误的 decisions 查询 | GET /api/brain/context 不再 500 | PR #1663 已修复 |

**当前状态**：3 个 CI 虚假绿已修复，剩余 admin_bypass 需手动修 GitHub Settings。

---

## 9. 数据流

```
Brain Tick（每 2min）
    ↓
planner.js 选取任务
    ↓
cecelia-bridge → cecelia-run → claude -p "/dev --task-id <id>"
    ↓
/dev 工作流（4-Stage Pipeline，见 packages/engine/skills/dev/SKILL.md）
    ↓
POST /api/brain/execution-callback
    ↓
更新任务状态 → 下个 tick 继续
```

---

## 10. 已知缺口（Claude 读图先看这里）

> 下次对话 scope 前先检查这张表，对缺口有针对性地修，不要重复已知问题。

| 缺口 | 优先级 | 修复路径 |
|------|--------|---------|
| CI 3 个虚假绿（admin_bypass/no_audit/no_coverage） | P0 | /dev session |
| content-research 执行器断连（内容流水线 Step1 全部失败） | P0 | /dev session |
| `/api/brain/context` SQL bug（column "title" does not exist） | P0 | /dev session |
| DB 备份策略缺失（无 pg_dump cron） | P0 | /dev session |
| instruction-book 内容过期（2026-03-10） | P1 | 直接更新文档 |
| Codex bridge 连接未验证（0 执行节点） | P1 | 验证 + /dev |
| arch_review 任务卡在 paused 状态 | P1 | SQL 清理 |

---

## 11. 快捷链接（Symlinks）

| 快捷 | 指向 |
|------|------|
| `hooks/` | `packages/engine/hooks/` |
| `skills/` | `packages/engine/skills/` |
