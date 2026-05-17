# Directory Structure - Cecelia Quality Platform

完整的目录结构参考，包含所有组件和文件。

---

## 完整目录树

```
cecelia-quality/
├── README.md                          # 项目介绍
├── CHANGELOG.md                       # 版本历史
├── CLAUDE.md                          # 项目级开发指南
├── VERSION                            # 版本号文件
├── package.json                       # Node.js 依赖
├── package-lock.json
│
├── .prd.md                            # 当前功能 PRD
├── .dod.md                            # 当前功能 DoD
├── .quality-gate-passed               # 质检通过标记
├── .layer2-evidence.md                # L2B 证据
│
├── db/                                # 数据库（VPS 大脑记忆）
│   ├── schema.sql                     # SQLite schema 定义
│   ├── cecelia.db                     # SQLite 数据库文件
│   └── backups/                       # 数据库备份
│       └── cecelia_20260127_*.db
│
├── gateway/                           # 统一输入网关
│   ├── gateway.sh                     # CLI 入口（已实现）
│   ├── gateway-http.js                # HTTP 服务器（NEW）
│   ├── task-schema.json               # 任务格式定义
│   └── README.md                      # Gateway 使用文档
│
├── queue/                             # 任务队列
│   └── queue.jsonl                    # JSONL 格式队列文件
│
├── worker/                            # 工作器（任务执行）
│   ├── worker.sh                      # 主执行器（已实现）
│   └── archive-evidence.sh            # 证据归档脚本（NEW）
│
├── state/                             # 系统状态
│   ├── state.json                     # 全局状态快照
│   ├── worker.lock                    # Worker 并发锁
│   └── notion-sync.json               # Notion 同步记录
│
├── heartbeat/                         # 自主神经（健康检查）
│   ├── heartbeat.sh                   # 定时检查脚本
│   └── heartbeat.n8n.json             # n8n workflow 版本
│
├── runs/                              # 执行记录（证据存储）
│   └── <runId>/                       # 单次执行目录
│       ├── task.json                  # 原始任务定义
│       ├── summary.json               # 执行摘要
│       ├── worker.log                 # Worker 日志
│       ├── qa-output.log              # QA Orchestrator 日志
│       └── evidence/                  # 证据文件
│           ├── QA-DECISION.md         # QA 决策
│           ├── AUDIT-REPORT.md        # 审计报告
│           ├── l1-tests.log           # L1 测试日志
│           ├── dod-check.log          # DoD 映射检查
│           ├── rci-coverage.log       # RCI 覆盖度
│           ├── test-results.json      # 测试结果
│           └── screenshots/           # 截图
│
├── orchestrator/                      # QA 编排器（免疫系统）
│   ├── qa-run.sh                      # QA 总控脚本（NEW）
│   ├── qa-run-all.sh                  # 全量质检
│   ├── qa-run-rci.sh                  # 回归契约检查
│   └── qa-run-gp.sh                   # Golden Path 验证
│
├── control-plane/                     # 控制平面（配置管理）
│   ├── repo-registry.yaml             # 仓库注册表
│   ├── qa-policy.yaml                 # QA 策略配置
│   ├── README.md
│   └── schemas/                       # 数据格式定义
│       ├── qa-evidence.schema.json
│       └── task.schema.json
│
├── contracts/                         # 质量契约
│   ├── gate-contract.template.yaml    # Gate 契约模板
│   ├── regression-contract.template.yaml  # Regression 契约模板
│   └── cecelia-workspace.regression-contract.yaml
│
├── scripts/                           # 执行脚本
│   ├── db-init.sh                     # 数据库管理（NEW）
│   ├── db-api.sh                      # 数据库 API（NEW）
│   ├── notion-sync.sh                 # Notion 同步（NEW）
│   ├── demo.sh                        # 完整 Demo（NEW）
│   ├── install.sh                     # 全局安装脚本
│   ├── install-local.sh               # 项目级安装脚本
│   └── devgate/                       # DevGate 框架
│       ├── check-dod-mapping.cjs      # DoD 映射检查
│       ├── require-rci-update-if-p0p1.sh  # RCI 强制更新
│       ├── scan-rci-coverage.cjs      # RCI 覆盖度扫描
│       ├── impact-check.sh            # 影响分析
│       ├── l2a-check.sh               # L2A 代码审计
│       ├── l2b-check.sh               # L2B 证据检查
│       ├── detect-priority.cjs        # 优先级检测
│       └── draft-gci.cjs              # GCI 草稿生成
│
├── hooks/                             # Claude Code Hooks
│   ├── branch-protect.sh              # 分支保护
│   ├── pr-gate-v2.sh                  # PR 质检门禁
│   ├── stop.sh                        # 会话结束检查
│   ├── session-start.sh               # 会话开始
│   └── session-end.sh                 # 会话结束
│
├── skills/                            # Claude Code Skills
│   ├── audit/                         # 代码审计 Skill
│   │   ├── SKILL.md
│   │   ├── audit.sh
│   │   └── templates/
│   ├── qa/                            # QA Skill
│   │   ├── SKILL.md
│   │   ├── qa.sh
│   │   └── decision-templates/
│   └── assurance/                     # RADNA Assurance Skill
│       ├── SKILL.md
│       └── radna-visualizer.sh
│
├── templates/                         # 文档模板
│   ├── PRD-TEMPLATE.md
│   ├── DOD-TEMPLATE.md
│   ├── QA-DECISION.md
│   ├── AUDIT-REPORT.md
│   └── .layer2-evidence.template.md
│
├── docs/                              # 文档
│   ├── ARCHITECTURE.md                # 架构文档
│   ├── INTEGRATION.md                 # 集成指南
│   ├── CUSTOMIZATION.md               # 定制化指南
│   ├── FILE_FORMATS.md                # 文件格式定义（NEW）
│   ├── STATE_MACHINE.md               # 状态机定义（NEW）
│   ├── QA_INTEGRATION.md              # QA 集成文档（NEW）
│   ├── DIRECTORY_STRUCTURE.md         # 目录结构（本文档）
│   ├── QA-DECISION.md                 # QA 决策示例
│   ├── AUDIT-REPORT.md                # 审计报告示例
│   ├── FEATURE-CLASSIFICATION-GUIDE.md
│   ├── QA-STABILITY-MATRIX.md
│   ├── QUALITY-LAYERS-VISUAL.md
│   ├── QUALITY-SYSTEM-WHITEPAPER.md
│   └── THREE-LAYER-SYSTEMS.md
│
├── tests/                             # 测试
│   ├── gateway/
│   │   ├── test-gateway-cli.sh
│   │   └── test-gateway-http.sh
│   ├── worker/
│   │   └── test-worker-execution.sh
│   ├── heartbeat/
│   │   └── test-heartbeat.sh
│   ├── db/
│   │   └── test-db-init.sh
│   └── integration/
│       └── test-end-to-end.sh
│
├── profiles/                          # 项目配置
│   ├── web.yml                        # Web 项目配置
│   ├── engine.yml                     # Engine 项目配置
│   └── api.yml                        # API 项目配置
│
├── adapters/                          # 集成适配器
│   ├── github-actions/
│   │   └── web-profile.yml
│   └── claude-hooks/
│
├── dashboard/                         # 可视化仪表板
│   ├── schema.json
│   ├── collectors/
│   └── exporters/
│       └── export-status.sh
│
├── .github/                           # GitHub 配置
│   └── workflows/
│       ├── ci.yml                     # CI 工作流
│       └── quality-check.yml          # 质量检查工作流
│
└── .gitignore                         # Git 忽略规则
```

---

## 核心组件说明

### 1. 数据层（VPS 大脑记忆）

| 路径 | 作用 | 格式 |
|------|------|------|
| `db/cecelia.db` | 主数据库（SQLite） | SQLite3 |
| `queue/queue.jsonl` | 任务队列 | JSON Lines |
| `state/state.json` | 系统状态快照 | JSON |
| `runs/<runId>/` | 执行记录 + 证据 | 目录结构 |

### 2. 输入层（Gateway）

| 路径 | 作用 | 协议 |
|------|------|------|
| `gateway/gateway.sh` | CLI 入口 | Bash CLI |
| `gateway/gateway-http.js` | HTTP API | HTTP REST |

### 3. 执行层（Worker + Orchestrator）

| 路径 | 作用 |
|------|------|
| `worker/worker.sh` | 任务调度器 |
| `orchestrator/qa-run.sh` | QA 编排器 |
| `orchestrator/qa-run-*.sh` | 专项质检脚本 |

### 4. 监控层（Heartbeat）

| 路径 | 作用 |
|------|------|
| `heartbeat/heartbeat.sh` | 健康检查 + 自动修复 |

### 5. 同步层（Notion）

| 路径 | 作用 |
|------|------|
| `scripts/notion-sync.sh` | VPS → Notion 单向同步 |

### 6. 配置层（Control Plane）

| 路径 | 作用 |
|------|------|
| `control-plane/repo-registry.yaml` | 仓库注册表 |
| `control-plane/qa-policy.yaml` | QA 策略 |
| `contracts/*.yaml` | 质量契约 |

### 7. Hooks 层（工作流拦截）

| 路径 | 触发时机 |
|------|----------|
| `hooks/branch-protect.sh` | 编辑文件前 |
| `hooks/pr-gate-v2.sh` | Bash 命令前 |
| `hooks/stop.sh` | 会话结束时 |

---

## 数据流向

```
┌───────────────────────────────────────────────────────────────┐
│                         数据流向图                              │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  User/N8N/Notion                                              │
│       │                                                       │
│       ▼                                                       │
│  ┌─────────────┐                                              │
│  │   Gateway   │ ──write──▶ queue.jsonl                       │
│  │             │ ──insert─▶ db/cecelia.db (inbox → todo)      │
│  └─────────────┘                                              │
│                                                               │
│       │                                                       │
│       ▼                                                       │
│  ┌─────────────┐                                              │
│  │   Worker    │ ◀─dequeue── queue.jsonl                      │
│  │             │ ──update──▶ db/cecelia.db (todo → doing)     │
│  └──────┬──────┘                                              │
│         │                                                     │
│         ├──────────────────┬────────────────┐                 │
│         ▼                  ▼                ▼                 │
│  ┌─────────────┐    ┌─────────────┐  ┌─────────────┐         │
│  │ QA Executor │    │  CloudCode  │  │   Other     │         │
│  │(orchestrator)│    │  (headless) │  │  Executors  │         │
│  └──────┬──────┘    └──────┬──────┘  └──────┬──────┘         │
│         │                  │                │                 │
│         └──────────────────┴────────────────┘                 │
│                            │                                  │
│                            ▼                                  │
│                    ┌──────────────┐                           │
│                    │   Evidence   │                           │
│                    │runs/<runId>/ │                           │
│                    └──────┬───────┘                           │
│                           │                                   │
│                           ├──▶ summary.json                   │
│                           ├──▶ worker.log                     │
│                           └──▶ evidence/*.md                  │
│                                                               │
│       ┌────────────────────┴────────────────────┐             │
│       ▼                                         ▼             │
│  ┌─────────────┐                          ┌─────────────┐    │
│  │ DB Update   │                          │   Notion    │    │
│  │ (做→完成)    │                          │    Sync     │    │
│  └─────────────┘                          └─────────────┘    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## 文件大小参考

| 文件/目录 | 典型大小 | 清理策略 |
|----------|----------|----------|
| `db/cecelia.db` | 1-10 MB | 定期备份，保留最近 10 个 |
| `queue/queue.jsonl` | < 100 KB | 完成后自动移除 |
| `state/state.json` | < 1 KB | 实时更新 |
| `runs/<runId>/` | 1-50 MB | 30 天后删除 |
| `evidence/*.md` | 10-100 KB | 跟随 run 清理 |
| `evidence/*.log` | 100 KB - 10 MB | 跟随 run 清理 |

---

## 关键路径

### 任务提交路径

```
User → Gateway → queue.jsonl → Worker → Executor → Evidence → DB/Notion
```

### 质检路径

```
Worker → orchestrator/qa-run.sh → [L1, L2A, DoD, RCI] → Evidence → DB
```

### 监控路径

```
Heartbeat → DB (system_health) → [异常检测] → Gateway (auto-enqueue)
```

---

## 环境变量

| 变量 | 用途 | 示例 |
|------|------|------|
| `GATEWAY_PORT` | Gateway HTTP 端口 | 5680 |
| `GATEWAY_HOST` | Gateway HTTP 主机 | 0.0.0.0 |
| `NOTION_TOKEN` | Notion API Token | secret_xxx |
| `NOTION_STATE_DB_ID` | Notion 状态数据库 ID | database-id-1 |
| `NOTION_RUNS_DB_ID` | Notion 运行数据库 ID | database-id-2 |

---

## 常用命令速查

```bash
# 数据库
bash scripts/db-init.sh init           # 初始化
bash scripts/db-init.sh stats          # 查看统计
bash scripts/db-init.sh backup         # 备份

# Gateway
bash gateway/gateway.sh add cloudcode runQA P0 '{"project":"cecelia-quality"}'
node gateway/gateway-http.js           # 启动 HTTP 服务器

# Worker
bash worker/worker.sh                  # 执行一个任务

# Heartbeat
bash heartbeat/heartbeat.sh            # 健康检查

# Notion
bash scripts/notion-sync.sh            # 同步到 Notion

# Demo
bash scripts/demo.sh                   # 完整演示
```

---

**版本**: 1.0.0
**最后更新**: 2026-01-27
