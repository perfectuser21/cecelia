---
id: features-registry
version: 1.16.0
created: 2026-01-20
updated: 2026-02-04
changelog:
  - 1.16.0: 审计清理 - session-end.sh 归档、pr-gate-v2.sh 标记废弃
  - 1.15.0: 新增 Q5 RISK SCORE + Q6 Structured Audit（三层架构）
  - 1.14.0: 新增 C6 Evidence CI (SSOT)
  - 1.13.0: 新增 W7 Ralph Loop 自动化
  - 1.12.0: 新增 W6 Worktree 并行开发
  - 1.11.0: 新增 N1 Cecilia (无头模式 + N8N 集成)
  - 1.10.0: 同步 regression-contract.yaml 版本，GP-005 补 E2-003
  - 1.9.0: QA 清理 - 修复 bugs、移除 W4 残留、更新文档
  - 1.8.0: 新增 C5 release-check，GP-005 Export 链路
  - 1.7.0: 新增 E2 Dev Session Reporting
  - 1.6.0: 新增 W5 模式自动检测
  - 1.5.0: 新增 Export 分类，E1 QA Reporting
  - 1.4.0: 更新 Trigger 规则说明，统计改用 rc-filter.sh 脚本
  - 1.3.0: 引入 Regression Contract 体系，清理步骤状态机描述
  - 1.2.0: 删除 project-detect hook（死代码）
  - 1.1.0: 删除冗余 hooks (session-init, stop-gate)
  - 1.0.0: 初始版本 - v8.0 升级时创建
---

# Feature Registry

> 系统里"有什么能力"的完整清单

**与 Regression Contract 的关系**：

```
FEATURES.md (本文件)
└─ Feature Registry（What - 能力存在性）
   └─ 只选 Committed 的 Feature
         ↓
regression-contract.yaml
└─ Regression Contract（How - 能力稳定性）
   └─ 可执行断言 + Priority + Trigger
         ↓
Full Regression（全量测试）
```

**核心原则**：
- Feature Registry 回答"系统有什么能力"
- Regression Contract 回答"哪些能力必须永远不坏"
- 全量 ≠ 所有 Feature，全量 = Regression Contract

---

## 状态说明

| 状态 | 含义 | 回归要求 |
|------|------|----------|
| **Committed** | 已承诺的能力，长期存在 | 必须有自动化测试 |
| **Experiment** | 实验中，可能删除 | 可选测试 |
| **Deprecated** | 已废弃，待删除 | 不需要测试 |

---

## Hooks (核心能力)

| ID | Feature | 状态 | 最小验收 | 说明 |
|----|---------|------|----------|------|
| H1 | Branch Protection | **Committed** | `tests/hooks/branch-protect.test.ts` | 分支保护（main/develop 禁写） |
| H7 | Stop Hook Quality Gate | **Committed** | `tests/hooks/stop-hook.test.ts` | 循环控制（不达目的不罢休） |
| ~~H2~~ | ~~PR Gate (Dual Mode)~~ | **Deprecated** | - | v12.5.4 删除，质检交给 CI |
| ~~H3~~ | ~~project-detect~~ | **Deprecated** | - | v8.0.2 删除 |
| ~~H4~~ | ~~session-init~~ | **Deprecated** | - | v8.0.1 删除 |
| ~~H5~~ | ~~stop-gate~~ | **Deprecated** | - | v8.0.1 删除 |
| ~~H6~~ | ~~pr-gate~~ | **Deprecated** | - | 被 pr-gate-v2 替代 |

---

## Gate (门禁能力)

| ID | Feature | 状态 | 最小验收 | 说明 |
|----|---------|------|----------|------|
| ~~G1~~ | ~~Gate Subagent Token~~ | **Deprecated** | - | v12.5.3 删除，不再使用 Subagent |

---

## Workflow (流程能力)

| ID | Feature | 状态 | 最小验收 | 说明 |
|----|---------|------|----------|------|
| W1 | Two-Phase Dev Workflow | **Committed** | 手动验证 | **v2.0.0 核心** - 两阶段工作流（p0: 发 PR / p1: 修 CI / p2: 自动 merge） |
| ~~W2~~ | ~~步骤状态机~~ | **Deprecated** | - | v8.0.11 简化，不再强制追踪 step |
| ~~W3~~ | ~~循环回退~~ | **Deprecated** | - | v2.0.0 废弃，被 p1 事件驱动循环替代 |
| ~~W5~~ | ~~Phase Detection~~ | **Deprecated** | - | v11.2.9 废弃 - 脚本从未实现，已被 Ralph Loop 替代 |
| ~~W4~~ | ~~测试任务模式~~ | **Deprecated** | - | v8.0.21 删除，功能不需要 |
| W6 | Worktree 并行开发 | **Committed** | `skills/dev/scripts/worktree-manage.sh` | 自动检测 .dev-mode 冲突，自动创建 worktree + cd，僵尸清理，flock 并发锁 |
| W7 | Ralph Loop 自动化 | **Experiment** | 手动验证 | Ralph Loop 自动启用 + SHA 一次性提交 + 版本号自动更新 |

---

## 业务代码

| ID | Feature | 状态 | 最小验收 | 说明 |
|----|---------|------|----------|------|
| ~~B1~~ | ~~calculator~~ | **Deprecated** | - | v8.0.21 删除，示例代码不需要 |

---

## Bug Fixes

| ID | Feature | 状态 | 最小验收 | 说明 |
|----|---------|------|----------|------|
| B2 | Critical Bug Fix | **Committed** | CI 运行 + 手动验证 | 修复 16 个 CRITICAL 级别 bug（Stop Hook、Skills、CI/CD、部署脚本等） |

---

## CI/Release

| ID | Feature | 状态 | 最小验收 | 说明 |
|----|---------|------|----------|------|
| C1 | version-check | **Committed** | CI 运行 | PR 版本号检查 |
| C2 | test job | **Committed** | CI 运行 | L1 全量测试 |
| C3 | shell syntax check | **Committed** | CI 运行 | Shell 脚本语法 |
| ~~C4~~ | ~~notify-failure~~ | **Deprecated** | - | v8.0.21 删除，改用 n8n/飞书通知 |
| C5 | release-check | **Committed** | `scripts/release-check.sh` | Release 前 DoD 完成度检查 |
| C6 | Evidence CI (SSOT) | **Experiment** | CI 运行 | Evidence 只在 CI 生成/校验，本地 Fast Fail，Ralph Loop 自愈 |

---

## QA/Audit (质量保证)

| ID | Feature | 状态 | 最小验收 | 说明 |
|----|---------|------|----------|------|
| Q5 | RISK SCORE Trigger | **Committed** | `scripts/qa/risk-score.cjs` | R1-R8 规则（≥3 分触发 QA Node），自动化判断是否需要 QA Decision |
| Q6 | Structured Audit | **Committed** | `scripts/audit/generate-report.cjs` | 结构化验证（Scope+Forbidden+Proof），生成 AUDIT-REPORT.md |

**三层架构**：
- Layer 1: Skills (SKILL.md) - AI 操作手册
- Layer 2: Scripts (*.js) - 可执行工具
- Layer 3: Templates (*.md) - 结构化输出格式

**QA Scripts**:
- `scripts/qa/risk-score.js` - RISK SCORE 计算
- `scripts/qa/detect-scope.js` - 自动建议 Scope
- `scripts/qa/detect-forbidden.js` - 列出禁区

**Audit Scripts**:
- `scripts/audit/compare-scope.js` - Scope 对比
- `scripts/audit/check-forbidden.js` - Forbidden 检查
- `scripts/audit/check-proof.js` - Proof 验证
- `scripts/audit/generate-report.js` - 报告生成

---

## Export (数据导出)

| ID | Feature | 状态 | 最小验收 | 说明 |
|----|---------|------|----------|------|
| E1 | QA Reporting | **Committed** | `scripts/qa-report.sh` | 生成 QA 审计 JSON，供 Dashboard 使用 |
| E2 | Dev Session Reporting | **Committed** | `skills/dev/scripts/generate-report.sh` | 开发任务报告（JSON+TXT），供 Dashboard/Cecilia 使用 |

---

## N8N Integration (自动化集成)

| ID | Feature | 状态 | 最小验收 | 说明 |
|----|---------|------|----------|------|
| N1 | Cecilia (无头模式) | **Committed** | `cecilia --health` | 无头 Claude Code，供 N8N 调度执行开发任务 |

**架构**：
```
N8N Workflow → SSH → cecilia CLI → claude -p → /dev skill → 结果 JSON
```

**组件**：
- `cecilia` CLI: `/home/xx/bin/cecilia`
- N8N Workflow: `n8n/workflows/prd-executor-simple.json`
- PRD Schema: `templates/prd-schema.json`
- 接口规范: `docs/INTERFACE-SPEC.md`

---

## 全量回归定义

> **全量的唯一合法定义来源是 `regression-contract.yaml`**

```
全量 = Regression Contract 里的所有条目
     ≠ 所有 Committed features

Trigger 规则:
  PR Gate:      跑 trigger 包含 PR 的条目
  Release Gate: 跑 trigger 包含 Release 的条目
  Nightly:      跑全部条目（忽略 trigger 过滤）

本地命令:
  npm run qa              # 跑 L1 自动化
  bash scripts/rc-filter.sh stats  # 查看 RCI 统计
```

详见：
- [regression-contract.yaml](./regression-contract.yaml) - RCI 定义
- [scripts/rc-filter.sh](./scripts/rc-filter.sh) - 过滤器脚本

---

## 统计

> 使用 `bash scripts/rc-filter.sh stats` 获取实时统计

- **Committed Features**: 13（H1-H2, W1/W3/W5/W6, C1-C3/C5, E1-E2, N1）
- **Experiment Features**: 1（W7）

---

## 更新规则

1. 新增 Feature → 先 Experiment，有测试后 → Committed
2. 修改 Committed Feature → 必须保证测试通过
3. 删除 Feature → 先标记 Deprecated → 下个大版本删除

---

## v2.0.0 重要变更（Contract Rebase）

**单一事实源**：
- **机器可读真源**: `features/feature-registry.yml`
- **本文件（FEATURES.md）**: 人类可读视图，从 registry 派生

**重要**：修改 feature 定义时，应先更新 `features/feature-registry.yml`，再同步本文件。

**新增 Contract 文档**：
- `docs/contracts/WORKFLOW-CONTRACT.md` - 两阶段工作流契约
- `docs/contracts/QUALITY-CONTRACT.md` - 质量契约（三套分层）
- `docs/paths/MINIMAL-PATHS.md` - 最小验收路径
- `docs/paths/GOLDEN-PATHS.md` - 端到端成功路径

详见：`docs/CONTRACT-REBASE-ACCEPTANCE.md`

---

*Feature Registry = 能力地图*
*Regression Contract = 全量的宪法*
*v2.0.0: Contract Rebase - 单一事实源*
