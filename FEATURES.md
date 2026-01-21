---
id: features-registry
version: 1.5.0
created: 2026-01-20
updated: 2026-01-21
changelog:
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
| H1 | branch-protect | **Committed** | `tests/hooks/branch-protect.test.ts` | 分支保护（main/develop 禁写） |
| H2 | pr-gate-v2 | **Committed** | `tests/hooks/pr-gate.test.ts` | PR 前质检（L1 + 双模式） |
| ~~H3~~ | ~~project-detect~~ | **Deprecated** | - | v8.0.2 删除，死代码（检测结果无人使用） |
| ~~H4~~ | ~~session-init~~ | **Deprecated** | - | v8.0.1 删除，只显示一次无实际用途 |
| ~~H5~~ | ~~stop-gate~~ | **Deprecated** | - | v8.0.1 删除，功能已合并到 pr-gate-v2 |
| ~~H6~~ | ~~pr-gate~~ | **Deprecated** | - | 被 pr-gate-v2 替代 |
| ~~H7~~ | ~~subagent-quality-gate~~ | **Deprecated** | - | v8.0 删除 |

---

## Workflow (流程能力)

| ID | Feature | 状态 | 最小验收 | 说明 |
|----|---------|------|----------|------|
| W1 | /dev 11 步流程 | **Committed** | 手动验证 | 统一开发入口 |
| ~~W2~~ | ~~步骤状态机~~ | **Deprecated** | - | v8.0.11 简化，不再强制追踪 step |
| W3 | 循环回退 | **Committed** | 手动验证 | 质检/CI 失败 → 继续修复 |
| W4 | 测试任务模式 | **Committed** | 手动验证 | [TEST] 前缀检测 |

---

## 业务代码

| ID | Feature | 状态 | 最小验收 | 说明 |
|----|---------|------|----------|------|
| B1 | calculator | **Committed** | `npm test` (80 用例) | 计算器模块示例 |

---

## CI/Release

| ID | Feature | 状态 | 最小验收 | 说明 |
|----|---------|------|----------|------|
| C1 | version-check | **Committed** | CI 运行 | PR 版本号检查 |
| C2 | test job | **Committed** | CI 运行 | L1 全量测试 |
| C3 | shell syntax check | **Committed** | CI 运行 | Shell 脚本语法 |
| C4 | notify-failure | **Committed** | CI 运行 | Notion 失败通知 |

---

## Export (数据导出)

| ID | Feature | 状态 | 最小验收 | 说明 |
|----|---------|------|----------|------|
| E1 | QA Reporting | **Committed** | `scripts/qa-report.sh` | 生成 QA 审计 JSON，供 Dashboard 使用 |

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

- **Committed Features**: 9（新增 E1，W2 已废弃）

---

## 更新规则

1. 新增 Feature → 先 Experiment，有测试后 → Committed
2. 修改 Committed Feature → 必须保证测试通过
3. 删除 Feature → 先标记 Deprecated → 下个大版本删除

---

*Feature Registry = 能力地图*
*Regression Contract = 全量的宪法*
