---
> ⚠️ **DEPRECATED** — 此文档为初稿，已被 `docs/current/SYSTEM_MAP.md` 取代。
> 请阅读 [docs/current/SYSTEM_MAP.md](./current/SYSTEM_MAP.md)（authority: CURRENT_STATE）。
---

---
id: system-map
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
changelog:
  - 1.0.0: 初始版本，基于代码现状审计生成
---

# Cecelia 系统架构图（SYSTEM MAP）

> 本文档基于代码现状生成，不包含推测或设想中的架构。
> 事实来源：`packages/brain/src/`、`.github/workflows/`、`packages/engine/`

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                   Cecelia Monorepo                          │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   packages/  │  │    apps/     │  │    scripts/      │  │
│  │    brain     │  │  api+dash    │  │  devgate+deploy  │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  packages/   │  │  packages/   │  │  packages/       │  │
│  │   engine     │  │  workflows   │  │   quality        │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 子系统详解

### 2.1 packages/brain — 决策引擎

**端口**：5221
**技术栈**：Node.js + Express + PostgreSQL + pgvector
**版本 SSOT**：`packages/brain/package.json`

Brain 是 Cecelia 的核心，负责任务调度、决策、保护机制。

```
Brain (port 5221)
│
├── 心脏：Tick Loop（每 5s 循环，每 2min 执行一次 tick）
│     src/tick.js
│
├── 三层大脑
│   ├── L0 脑干（纯代码）：调度、执行、保护
│   │     src/tick.js, src/decision-executor.js
│   ├── L1 丘脑（Haiku LLM）：事件路由、快速判断
│   │     src/thalamus.js
│   └── L2 皮层（Sonnet LLM）：深度分析、反思
│         src/cortex.js
│
├── 任务系统
│   ├── src/planner.js          KR 轮转评分、任务生成
│   ├── src/task-router.js      LOCATION_MAP（任务类型路由）
│   ├── src/task-generators/    8 个任务生成器
│   └── src/quarantine.js       隔离保护
│
├── 数据存储
│   ├── PostgreSQL (cecelia DB)
│   ├── migrations/             139 个 SQL 迁移文件
│   └── src/selfcheck.js        EXPECTED_SCHEMA_VERSION = '139'
│
├── HTTP API 层
│   ├── src/routes/             29 个路由模块
│   └── src/routes.js           生成的路由集合
│
└── 辅助系统
    ├── src/watchdog.js         进程监护（Darwin 适配）
    ├── src/alertness/          警觉等级系统
    └── brain-manifest.generated.json  自动生成的系统清单
```

**关键常数**（由 `scripts/facts-check.mjs` 验证）：

| 常数 | 值 | 定义位置 |
|------|-----|---------|
| PORT | 5221 | `src/server.js` |
| TICK_LOOP_INTERVAL_MS | 5000 | `src/tick.js` |
| TICK_INTERVAL_MINUTES | 2 | `src/tick.js` |
| EXPECTED_SCHEMA_VERSION | 139 | `src/selfcheck.js` |

---

### 2.2 packages/engine — 开发工作流引擎

**版本 SSOT**：`packages/engine/package.json`（当前 12.46.0）
**职责**：Hook 系统、Skills 加载、DevGate 质量门禁、CI 工具链

```
packages/engine/
│
├── hooks/                  Git Hook 脚本（8 个）
│   ├── branch-protect.sh   主分支保护（禁止在 main 直接写代码）
│   ├── stop-dev.sh         /dev 工作流停止点（自动续跑逻辑）
│   ├── stop.sh             通用停止钩子
│   ├── bash-guard.sh       Bash 代码语法检查
│   ├── credential-guard.sh 凭据泄露防护
│   └── ...
│
├── skills/dev/             /dev 工作流定义（v3.4.1）
│   ├── SKILL.md            主技能定义
│   └── steps/              12 个步骤（00-11）
│
├── scripts/devgate/        6 个 DevGate 检查脚本
│   ├── check-dod-mapping.cjs       DoD→Test 映射
│   ├── check-contract-drift.mjs    模块边界保护
│   ├── check-executor-agents.mjs   Executor agent 完整性
│   ├── check-llm-agents.mjs        LLM agent 完整性
│   ├── check-skills-registry.mjs   Skills 注册表完整性
│   └── check-okr-structure.mjs     OKR 结构验证
│
├── features/
│   └── feature-registry.yml        Feature 注册表 SSOT
│
└── regression-contract.yaml        回归测试契约
```

**Engine 版本同步文件**（5 个必须同时更新）：
1. `packages/engine/package.json`
2. `packages/engine/package-lock.json`
3. `packages/engine/VERSION`
4. `packages/engine/.hook-core-version`
5. `packages/engine/regression-contract.yaml`

---

### 2.3 apps/ — 前端应用层

```
apps/
├── api/        后端 API 层（Workspace Core）
│   ├── src/    28 个功能模块子目录
│   └── features/ 24 个功能模块
│
└── dashboard/  React UI（Workspace Dashboard）
                端口：5211（生产唯一入口）
```

---

### 2.4 packages/workflows — Agent 协议与技能库

```
packages/workflows/
├── skills/     54 个技能实现（发布工具等）
│   ├── zhihu-publisher/
│   ├── weibo-publisher/
│   └── ...
├── agents/     Agent 定义文件
├── n8n/        N8N Workflow 配置
├── agents-registry.json
└── workflow-registry.json
```

---

### 2.5 packages/quality — QA 基础设施

```
packages/quality/
├── contracts/    测试契约定义
├── adapters/     测试适配器
└── heartbeat/    健康检查系统
```

---

### 2.6 scripts/ — 工具脚本

```
scripts/
├── facts-check.mjs         Brain 代码事实一致性检查
├── check-version-sync.sh   Brain 版本 4 文件同步检查
├── devgate/                6 个 DevGate 检查脚本（同 engine/scripts/devgate）
├── brain-deploy.sh         Brain 部署
├── brain-build.sh          Brain 构建
├── brain-reload.sh         热重载
└── brain-rollback.sh       版本回滚
```

---

## 3. 数据流

```
用户/Brain 触发任务
    │
    ▼
Brain Tick Loop（每 5s/2min）
    │
    ├── 1. L0 脑干检查资源/熔断/警觉
    ├── 2. L1 丘脑路由事件（Haiku）
    ├── 3. L2 皮层深度分析（Sonnet，按需）
    ├── 4. planner.js 选取下一个任务
    └── 5. cecelia-bridge → cecelia-run → claude -p "/dev --task-id <id>"
                                                │
                                                ▼
                                        执行 /dev 工作流（12 步）
                                                │
                                                ▼
                                        POST /api/brain/execution-callback
                                                │
                                                ▼
                                        更新任务状态 → 下个 tick 继续
```

---

## 4. CI/CD 流程

每个子系统有独立的 GitHub Actions workflow：

| Workflow | 文件 | 触发路径 | Runner |
|---------|------|---------|--------|
| Brain CI | `brain-ci.yml` | `packages/brain/**`, `DEFINITION.md` | macOS |
| Engine CI | `engine-ci.yml` | `packages/engine/**` | ubuntu |
| Quality CI | `quality-ci.yml` | - | ubuntu |
| Workflows CI | `workflows-ci.yml` | - | ubuntu |
| Workspace CI | `workspace-ci.yml` | - | ubuntu |
| DevGate | `devgate.yml` | - | ubuntu |
| Auto Version | `auto-version.yml` | - | ubuntu |

---

## 5. 版本管理

**Brain 版本**（4 处必须同步）：

| 文件 | 当前值 |
|------|--------|
| `packages/brain/package.json` | 1.216.0（SSOT） |
| `packages/brain/package-lock.json` | 1.216.0 |
| `DEFINITION.md` 第 9 行 | 1.216.0 |
| `.brain-versions` | 1.216.0 |

**整体 Monorepo 版本**：`VERSION` 文件（1.213.1）

---

## 6. 快捷链接（Symlinks）

| 快捷路径 | 指向 |
|---------|------|
| `hooks/` | `packages/engine/hooks/` |
| `skills/` | `packages/engine/skills/` |

---

## 7. 关键配置文件 SSOT

| 文件 | 职责 |
|------|------|
| `DEFINITION.md` | Cecelia 系统完整定义（唯一事实来源） |
| `regression-contract.yaml` | 回归测试契约 |
| `packages/brain/src/task-router.js` | 任务类型路由（LOCATION_MAP, VALID_TASK_TYPES） |
| `packages/brain/src/thalamus.js` | ACTION_WHITELIST |
| `packages/brain/src/selfcheck.js` | EXPECTED_SCHEMA_VERSION |
| `packages/engine/features/feature-registry.yml` | Feature 注册表 |
