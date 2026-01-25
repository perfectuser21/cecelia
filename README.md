# Cecelia Quality Platform

> 企业级质量保障基础设施 - 为 AI 驱动的开发工作流提供质量控制

## 概述

Cecelia Quality Platform 是从 ZenithJoy Engine 提取的独立质量保障体系，包含：

- ✅ Claude Code Hooks（分支保护、PR 质检、会话管理）
- ✅ DevGate 框架（DoD/RCI/Evidence 自动检查）
- ✅ Audit Skill（L1-L4 分层代码审计）
- ✅ QA Skill（测试决策、回归契约、Golden Paths）
- ✅ Assurance Skill（RADNA 4层体系）
- ✅ Contract Templates（Gate/Regression）
- ✅ Document Templates（PRD/DoD/QA/Audit）

---

## 特性

### 🔒 Hooks 系统

| Hook | 作用 | 触发时机 |
|------|------|----------|
| `branch-protect.sh` | 分支保护 + 步骤状态机 | 编辑/写文件前 |
| `pr-gate-v2.sh` | PR 质检（双模式：pr/release） | Bash 命令前 |
| `stop.sh` | 会话结束检查 | 会话结束时 |
| `session-end.sh` | 会话结束钩子 | 会话结束时 |
| `session-start.sh` | 会话开始钩子 | 会话开始时 |

### 🛠️ DevGate 框架

| 脚本 | 功能 |
|------|------|
| `check-dod-mapping.cjs` | 检查 DoD 与测试映射 |
| `require-rci-update-if-p0p1.sh` | P0/P1 强制更新 RCI |
| `scan-rci-coverage.cjs` | 扫描回归契约覆盖度 |
| `impact-check.sh` | 影响分析 |
| `l2a-check.sh` | L2A 代码审计检查 |
| `l2b-check.sh` | L2B 证据检查 |
| `detect-priority.cjs` | 自动检测优先级 |
| `draft-gci.cjs` | 自动生成 GCI 草稿 |

### 📋 Skills

| Skill | 功能 |
|-------|------|
| `/audit` | L1-L4 分层代码审计（有边界） |
| `/qa` | QA 总控（测试决策、RCI 判定、Golden Path） |
| `/assurance` | RADNA 体系（Gate/Regression 协调） |

---

## 快速开始

### 方式 1: 使用 Profile 系统（推荐）

Cecelia Quality 支持不同项目类型的质量配置：

```bash
# 检查质量（指定 profile）
./run.sh check --profile=web

# 导出质量状态（用于 Dashboard）
./run.sh export --profile=engine --export-path=./quality-status.json

# 初始化新项目
./run.sh init --profile=web
```

**可用 Profiles**:
- `engine` - 重度工作流（需要 PRD/DoD/QA/Audit，完整 RADNA 4 层）
- `web` - 轻量级工作流（Build + Type Check，无需 PRD/DoD）
- `api` - 中度工作流（测试覆盖 + API 契约）
- `minimal` - 最小化（仅 Lint + Build）

### 方式 2: 全局安装到 ~/.claude

```bash
cd /path/to/cecelia-quality
bash scripts/install.sh
```

安装后，所有 Claude Code 项目自动启用质量检查。

### 方式 3: Git Submodule（项目级）

```bash
cd your-project
git submodule add git@github.com:zenjoymedia/cecelia-quality.git infra/quality
bash infra/quality/scripts/install-local.sh
```

### 方式 4: NPM Package（未来）

```bash
npm install -D @cecelia/quality-platform
npx cecelia-quality install
```

---

## 使用

### Profile 系统

不同项目类型使用不同的质量配置：

#### Web Profile（轻量级）

适用于前端项目（如 zenithjoy-autopilot）：

```bash
# 运行质量检查
./run.sh check --profile=web

# 集成到 GitHub Actions
# 使用 adapters/github-actions/web-profile.yml
```

**Web Profile 特点**:
- ✅ 无需 PRD/DoD（快速迭代）
- ✅ 必要门控：Build 成功 + 无 TS 错误
- ✅ 可选证据：截图、Lighthouse 报告、Bundle 分析

#### Engine Profile（重度）

适用于核心引擎项目（如 zenithjoy-engine）：

```bash
./run.sh check --profile=engine
```

**Engine Profile 特点**:
- ✅ 需要 PRD/DoD/QA/Audit
- ✅ 完整 RADNA 4 层检查
- ✅ RCI 回归契约
- ✅ 分层代码审计（L1-L4）

#### 自定义 Profile

创建 `profiles/custom.yml`:

```yaml
profile:
  name: custom
  type: backend
  strictness: medium

gates:
  - id: G1
    name: "Tests pass"
    check: auto
    blocking: true

workflow:
  require_prd: true
  require_dod: true
  require_qa: false

ci:
  required_checks:
    - test
    - lint
```

### Hooks 自动运行

安装后，hooks 会在以下时机自动触发：

```bash
# 编辑文件前 → branch-protect.sh 检查分支和 PRD/DoD
# Bash 命令前 → pr-gate-v2.sh 检查质量门禁
# 会话结束时 → stop.sh 检查完成度
```

### 手动调用 Skills

在 Claude Code 中：

```bash
/audit           # 代码审计（默认 L2）
/qa              # QA 决策
/assurance       # Gate/Regression 协调
```

### 手动运行 DevGate

```bash
# 检查 DoD 映射
bash scripts/devgate/check-dod-mapping.cjs

# 检查 RCI 更新（P0/P1）
bash scripts/devgate/require-rci-update-if-p0p1.sh

# 扫描 RCI 覆盖度
bash scripts/devgate/scan-rci-coverage.cjs

# L2A 代码审计
bash scripts/devgate/l2a-check.sh

# L2B 证据检查
bash scripts/devgate/l2b-check.sh
```

---

## 集成到项目

### 1. 配置 Claude Code

创建或更新 `.claude/settings.json`：

```json
{
  "skills": {
    "paths": ["./infra/quality/skills", "./skills"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "./infra/quality/hooks/branch-protect.sh"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./infra/quality/hooks/pr-gate-v2.sh"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "./infra/quality/hooks/stop.sh"
          }
        ]
      }
    ]
  }
}
```

### 2. 复制 Contract 模板

```bash
mkdir -p contracts
cp infra/quality/contracts/gate-contract.template.yaml contracts/gate-contract.yaml
cp infra/quality/contracts/regression-contract.template.yaml contracts/regression-contract.yaml
```

### 3. 配置 GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI with Quality Gates

on:
  pull_request:
    branches: [main, develop]

jobs:
  quality-gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Check DoD Mapping
        run: bash infra/quality/scripts/devgate/check-dod-mapping.cjs

      - name: Check RCI Update (P0/P1)
        run: bash infra/quality/scripts/devgate/require-rci-update-if-p0p1.sh

      - name: Scan RCI Coverage
        run: bash infra/quality/scripts/devgate/scan-rci-coverage.cjs

      - name: L2A Check
        run: bash infra/quality/scripts/devgate/l2a-check.sh

      - name: Run Gate Tests
        run: bash infra/quality/scripts/run-gate-tests.sh

  tests:
    needs: quality-gates
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
```

---

## 架构

### RADNA 4层体系

```
L0 - Rules（规则层）
  ├── Policy 定义
  └── P0/P1 标准

L1 - Contracts（契约层）
  ├── Gate Contract（6大红线）
  └── Regression Contract（业务回归）

L2 - Executors（执行层）
  ├── run-gate-tests.sh
  ├── run-regression.sh
  └── devgate/*

L3 - Evidence（证据层）
  ├── QA-DECISION.md
  ├── AUDIT-REPORT.md
  └── .layer2-evidence.md
```

### 分层标准

#### Audit 问题严重性（L1-L4）

| Layer | 名称 | 描述 | 完成标准 |
|-------|------|------|----------|
| L1 | 阻塞性 | 功能不工作、崩溃、数据丢失 | 必须修 |
| L2 | 功能性 | 边界条件、错误处理、edge case | 建议修 |
| L3 | 最佳实践 | 代码风格、一致性、可读性 | 可选 |
| L4 | 过度优化 | 理论边界、极端情况、性能微调 | 不修 |

#### 质检流程分层（L1-L3）

| Layer | 名称 | 内容 |
|-------|------|------|
| L1 | 自动化测试 | npm run qa |
| L2A | 代码审计 | /audit Skill |
| L2B | 证据收集 | 截图/curl 验证 |
| L3 | 验收 | DoD 全勾 |

---

## 版本管理

采用 Semver：

```
v1.0.0 - 初始版本（从 zenithjoy-engine 迁移）
v1.1.0 - 新增功能
v1.2.0 - 改进现有功能
v2.0.0 - Breaking change
```

项目可锁定版本：

```bash
cd infra/quality
git checkout v1.2.0
```

---

## 目录结构

```
cecelia-quality/
├── VERSION                    # 版本号
├── README.md
├── CHANGELOG.md
├── run.sh                     # 统一入口（NEW）
│
├── profiles/                  # 项目配置（NEW）
│   ├── web.yml               # 轻量级（前端）
│   ├── engine.yml            # 重度（核心引擎）
│   └── api.yml               # 中度（API 服务）
│
├── adapters/                  # 集成方式（NEW）
│   ├── github-actions/
│   │   └── web-profile.yml   # GitHub Actions 示例
│   └── claude-hooks/
│
├── dashboard/                 # 可视化（NEW）
│   ├── schema.json           # quality-status.json 格式定义
│   ├── collectors/
│   └── exporters/
│       └── export-status.sh  # 导出质量状态
│
├── hooks/                     # Claude Code Hooks
│   ├── branch-protect.sh
│   ├── pr-gate-v2.sh
│   ├── stop.sh
│   ├── session-end.sh
│   └── session-start.sh
│
├── scripts/                   # 执行脚本
│   ├── devgate/              # DevGate 框架
│   │   ├── check-dod-mapping.cjs
│   │   ├── require-rci-update-if-p0p1.sh
│   │   ├── scan-rci-coverage.cjs
│   │   ├── impact-check.sh
│   │   ├── l2a-check.sh
│   │   ├── l2b-check.sh
│   │   ├── detect-priority.cjs
│   │   └── draft-gci.cjs
│   ├── run-gate-tests.sh
│   ├── run-regression.sh
│   ├── install.sh
│   └── install-local.sh
│
├── skills/                    # Claude Code Skills
│   ├── audit/                # L1-L4 代码审计
│   ├── qa/                   # QA 总控
│   └── assurance/            # RADNA 体系
│
├── contracts/                 # Contract 模板
│   ├── gate-contract.template.yaml
│   └── regression-contract.template.yaml
│
├── templates/                 # 文档模板
│   ├── AUDIT-REPORT.md
│   ├── QA-DECISION.md
│   ├── DOD-TEMPLATE.md
│   ├── PRD-TEMPLATE.md
│   └── .layer2-evidence.template.md
│
├── tests/                     # 质量体系测试
│   ├── hooks/
│   ├── gate/
│   └── devgate/
│
└── docs/                      # 文档
    ├── INTEGRATION.md
    ├── ARCHITECTURE.md
    └── CUSTOMIZATION.md
```

---

## 适用场景

### Engine 仓库

- zenithjoy-engine
- zenithjoy-media-engine
- zenithjoy-commerce-engine

### 业务仓库

- zenithjoy-autopilot
- zenithjoy-core
- 任何需要质量保障的项目

---

## 开发

### 修改 Quality Platform

```bash
cd /path/to/cecelia-quality
# 修改代码
git add .
git commit -m "feat: xxx"
git tag v1.1.0
git push origin main --tags
```

### 项目升级版本

```bash
cd your-project/infra/quality
git fetch
git checkout v1.1.0
```

---

## 贡献

本项目是 ZenithJoy 质量体系的核心基础设施，欢迎：

- 报告 Bug
- 建议新功能
- 提交 PR

---

## 许可证

MIT

---

## 相关项目

- [zenithjoy-engine](https://github.com/zenjoymedia/zenithjoy-engine) - AI 开发工作流引擎
- [zenithjoy-autopilot](https://github.com/zenjoymedia/zenithjoy-autopilot) - 自动化运营平台
- [zenithjoy-core](https://github.com/zenjoymedia/zenithjoy-core) - 核心服务

---

**Version**: 1.0.0
**Last Updated**: 2026-01-25
