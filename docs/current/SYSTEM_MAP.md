---
id: current-system-map
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
authority: CURRENT_STATE
changelog:
  - 1.0.0: 初始版本，基于 main 分支代码实际审计
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
└── 辅助
    ├── src/watchdog.js             进程监护（Darwin 适配）
    ├── src/alertness/              警觉等级系统
    └── brain-manifest.generated.json  自动生成清单
```

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
| EXPECTED_SCHEMA_VERSION | 139 |

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
