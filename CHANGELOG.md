# Changelog

All notable changes to ZenithJoy Engine will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [9.1.1] - 2026-01-23

### Added

- **scripts/devgate/scan-rci-coverage.cjs**: RCI 覆盖率扫描器
  - 枚举业务入口（Skills, Hooks, Scripts）
  - 解析 RCI 并计算覆盖率
  - 生成 baseline-coverage.json 和 BASELINE-SNAPSHOT.md

- **tests/gate/scan-rci-coverage.test.ts**: 17 个单元测试

- **npm run coverage:rci**: 检查 RCI 覆盖率命令

### Baseline Snapshot

当前 RCI 覆盖率: 25% (2/8 业务入口)

未覆盖入口（需后续添加 RCI）：
- /qa, /audit, /assurance Skills
- run-regression.sh, qa-report.sh, release-check.sh

---

## [9.1.0] - 2026-01-23

### Added

- **scripts/devgate/draft-gci.cjs**: GCI 草稿自动生成
  - 分析 git diff，检测 Gate 相关文件改动
  - 自动生成契约草稿（YAML 格式）
  - 用法: `node scripts/devgate/draft-gci.cjs [--base <branch>] [--output <file>]`

- **tests/gate/draft-gci.test.ts**: 19 个单元测试
  - isGateFile: Gate 文件模式匹配
  - getCategory: GCI 分类映射
  - generateDraft: 草稿生成逻辑

### Changed

- **/assurance Skill**: 集成 draft-gci 自动化工具
- 体系从"手写契约"升级为"审核契约草稿"

---

## [9.0.0] - 2026-01-23

### 里程碑版本：RADNA 体系 + 全量审计 + Gate Test Suite

**核心成果**：建立"可封顶、可收口"的质量保证体系，终结 Gate/Regression/QA/Audit 的混乱。

---

### Added (RADNA 体系)

#### 4 层架构
| 层级 | 名称 | 文件 |
|------|------|------|
| L0 | Rules（宪法） | `docs/policy/ASSURANCE-POLICY.md` |
| L1 | Contracts（契约） | `contracts/gate-contract.yaml`, `contracts/regression-contract.yaml` |
| L2 | Executors（执行器） | `scripts/run-gate-tests.sh`, `scripts/run-regression.sh` |
| L3 | Evidence（证据） | `artifacts/QA-DECISION.md`, `artifacts/AUDIT-REPORT.md` |

#### /assurance Skill
- **skills/assurance/SKILL.md**: 统一的质量保证协调者
- 自动判断 PR 改动属于 Gate 还是 Business
- 强制更新对应契约（GCI / RCI）
- 自动生成 QA/Audit 产物

#### Gate Contract (GCI)
- **contracts/gate-contract.yaml**: 保护检查系统不会放错行
- 6 大红线：空 DoD、空 QA、优先级误判、CI 跳过、白名单穿透、误删分支

#### Regression Contract (RCI)
- **contracts/regression-contract.yaml**: 保护业务功能不回归
- 重新组织为 C1-C6 系列

---

### Added (Gate Test Suite)

- **tests/gate/gate.test.ts**: 16 个检查系统自测
  - A1: 空 DoD 必须 fail
  - A2: QA 决策空内容必须 fail
  - A3: P0wer 不应触发 P0 流程
  - A5: release 模式不跳过 L1 RCI
  - A6: 非白名单命令必须 fail
  - A7: checkout 失败后不删除分支

- **docs/KNOWN-ISSUES.md**: 6 个 B 层问题的触发条件和 workaround

---

### Fixed (全量审计 - 152 个问题)

#### hooks/ (24 个问题)
- **branch-protect.sh v16**: 非 git 仓库/空分支名改为 exit 2、realpath 兼容性
- **pr-gate-v2.sh v3.0**: 空 DoD 检查、QA 内容校验、jq 检查

#### scripts/devgate/ (25 个问题)
- **detect-priority.cjs**: 词边界修复（防止 P0wer 误匹配）、CRITICAL/HIGH/security 映射
- **metrics.cjs/append-learnings.cjs**: 修复参数解析双重递增 bug

#### scripts/ (30 个问题)
- **run-regression.sh**: npm 命令限制（只允许 test/qa/build/ci/install）
- **install-hooks.sh**: cp 失败时显示警告而非 OK
- **cleanup.sh**: checkout 失败时跳过远程分支删除

#### CI/YAML (22 个问题)
- **ci.yml**: ci-passed 依赖 release-check（PR to main 时）、fetch-depth: 0

#### TypeScript (22 个问题)
- 测试污染修复、输出格式更新

---

### Changed

- 测试数量从 134 增加到 150+
- 目录结构重组（contracts/, artifacts/, docs/policy/）

---

## [8.25.0] - 2026-01-23

### Fixed (P0 优先级检测 Bug 修复)

- **detect-priority.cjs**: 添加 CRITICAL→P0, HIGH→P1, security→P0 映射
- 21 个单元测试覆盖优先级检测

## [8.24.0] - 2026-01-23

### Security (CRITICAL 级安全修复)

- branch-protect.sh: JSON 预验证防止注入
- pr-gate-v2.sh: 命令执行安全加固
- run-regression.sh: 白名单限制

## [8.23.0] - 2026-01-22

### Added

- DoD ↔ Test 映射检查
- P0/P1 → RCI 更新检查
- 回归契约 v1.0（67 个条目）
