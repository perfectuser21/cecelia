---
id: golden-paths
version: 2.71.0
created: 2026-02-06
updated: 2026-02-06
source: features/feature-registry.yml
generation: auto-generated (scripts/generate-path-views.sh)
changelog:
  - 2.71.0: 从 feature-registry.yml 自动生成
---

# Golden Paths - 端到端成功路径

**来源**: `features/feature-registry.yml` (单一事实源)
**用途**: 每个 feature 的"端到端成功路径"（最关键的完整流程）
**生成**: 自动生成，不要手动编辑

---

## GP-001: Branch Protection (H1)

**Feature**: H1 - Branch Protection
**Priority**: P0

### Golden Path

```
检测当前分支 → main/develop → exit 2 (阻止) | cp-*/feature/* → exit 0 (放行)
```

**RCI 覆盖**: H1-001,H1-002,H1-003,H1-010,H1-011

---

## GP-002: Stop Hook Loop Controller (JSON API) (H7)

**Feature**: H7 - Stop Hook Loop Controller (JSON API)
**Priority**: P0

### Golden Path

```
会话结束 → 检测 .dev-mode → 检查完成条件 → exit 2 (继续) | exit 0 (结束)
```

**RCI 覆盖**: H7-001,H7-002,H7-003,H7-006,H7-007,H7-008

---

## GP-003: PR Gate (Dual Mode) (H2)

**Feature**: H2 - PR Gate (Dual Mode)
**Priority**: P0

### Golden Path

```
检测命令 (gh pr create) → 判断模式 (PR/Release) → 检查产物 → 通过/阻止
```

**RCI 覆盖**: H2-001,H2-002,H2-003,H2-004

---

## GP-004: Unified Dev Workflow (W1)

**Feature**: W1 - Unified Dev Workflow
**Priority**: P0

### Golden Path

```
/dev → PRD → Branch → DoD (QA Node) → Code → Quality (Audit Node) →
PR (p0 结束) → CI fail (p1 唤醒) → Fix → Push → CI pass (p2 自动 merge)
```

**RCI 覆盖**: W1-001,W1-002,W1-003,W1-004,W1-005,W1-006,W1-008

---

## GP-005: Impact Check (Q1)

**Feature**: Q1 - Impact Check
**Priority**: P0

### Golden Path

```
PR 改动核心文件 → impact-check.sh 检测 → 验证 registry 同时更新 → 通过/失败
```

**RCI 覆盖**: Q1-001,Q1-002,Q1-003

---

## GP-006: Evidence Gate (Q2)

**Feature**: Q2 - Evidence Gate
**Priority**: P0

### Golden Path

```
npm run qa:gate → 生成 .quality-evidence.json → CI 验证 SHA/字段 → 通过/失败
```

**RCI 覆盖**: Q2-001,Q2-002,Q2-003

---

## GP-007: Anti-Bypass Contract (Q3)

**Feature**: Q3 - Anti-Bypass Contract
**Priority**: P0

### Golden Path

```
开发者理解质量契约 → 本地 Hook 提前反馈 → 远端 CI 最终强制 → Branch Protection 物理阻止
```

**RCI 覆盖**: Q3-001,Q3-002

---

## GP-008: CI Layering (L2B + L3-fast + Preflight + AI Review) (Q4)

**Feature**: Q4 - CI Layering (L2B + L3-fast + Preflight + AI Review)
**Priority**: P1

### Golden Path

```
本地 → ci:preflight (快速预检) → L2B 证据创建 → PR Gate (L2B-min) →
CI → l2b-check job → ai-review job → 通过/失败
```

**RCI 覆盖**: Q4-001,Q4-002,Q4-003,Q4-004,Q4-005,Q4-006

---

## GP-009: RISK SCORE Trigger (Q5)

**Feature**: Q5 - RISK SCORE Trigger
**Priority**: P1

### Golden Path

```
/dev Step 3 → risk-score.cjs (计算分数) → ≥3 分 → 执行完整 QA Decision Node →
生成 docs/QA-DECISION.md
```

**RCI 覆盖**: Q5-001,Q5-002

---

## GP-010: Structured Audit (Q6)

**Feature**: Q6 - Structured Audit
**Priority**: P1

### Golden Path

```
/dev Step 6 → compare-scope.cjs (验证范围) → check-forbidden.cjs (检查禁区) →
check-proof.cjs (验证证据) → generate-report.cjs (生成报告) →
AUDIT-REPORT.md (Decision: PASS/FAIL)
```

**RCI 覆盖**: Q6-001,Q6-002

---

## GP-011: Regression Testing Framework (P1)

**Feature**: P1 - Regression Testing Framework
**Priority**: P0

### Golden Path

```
定义 RCI (regression-contract.yaml) → rc-filter.sh 过滤 →
run-regression.sh 执行 → 验证契约不被破坏
```

**RCI 覆盖**: P1-001,P1-002,P1-003

---

## GP-012: DevGate (P2)

**Feature**: P2 - DevGate
**Priority**: P0

### Golden Path

```
CI test job → DevGate checks → 三个检查全部通过 → CI 继续
```

**RCI 覆盖**: C6-001,C7-001,C7-002,C7-003

---

## GP-013: Quality Reporting (P3)

**Feature**: P3 - Quality Reporting
**Priority**: P1

### Golden Path

```
执行脚本 → 扫描 repo 结构 → 生成 JSON/TXT 报告 → 供 Dashboard 使用
```

**RCI 覆盖**: E1-001,E1-002,E1-003,E2-001,E2-002,E2-003

---

## GP-014: CI Quality Gates (P4)

**Feature**: P4 - CI Quality Gates
**Priority**: P0

### Golden Path

```
PR 创建 → CI 触发 → version-check + test + DevGate → 全部通过 → ci-passed
```

**RCI 覆盖**: C1-001,C1-002,C1-003,C2-001,C3-001,C5-001

---

## GP-015: Worktree Parallel Development (P5)

**Feature**: P5 - Worktree Parallel Development
**Priority**: P1

### Golden Path

```
/dev 启动 → Step 0 检测 .dev-mode → 僵尸则清理 → 活跃则自动创建 worktree + cd → 继续正常流程
```

**RCI 覆盖**: W6-001

---

## GP-016: Self-Evolution Automation (P6)

**Feature**: P6 - Self-Evolution Automation
**Priority**: P2

### Golden Path

```
问题发现 → 记录到 docs/SELF-EVOLUTION.md → 创建检查项 → 自动化脚本 → 集成到流程
```

**RCI 覆盖**: S1-001,S2-001,S2-002,S3-001,S3-002,S3-003,S3-004

---

## GP-017: Credential Guard (H8)

**Feature**: H8 - Credential Guard
**Priority**: P0

### Golden Path

```
写入代码 → credential-guard.sh 检测 → 真实凭据 → exit 2 (阻止) | 占位符/credentials目录 → exit 0 (放行)
```

**RCI 覆盖**: H8-001,H8-002,H8-003

---

## GP-018: Bash Guard (Credential Leak + HK Deploy Protection) (H9)

**Feature**: H9 - Bash Guard (Credential Leak + HK Deploy Protection)
**Priority**: P1

### Golden Path

```
Bash 命令 → token 扫描 (~1ms) → rsync/scp + HK 检测 (~1ms) →
未命中 → 放行 | 命中 HK → git 三连检 → 通过/阻止
```

**RCI 覆盖**: H9-001,H9-002,H9-003

---

## 更新规则

**本文件自动生成，不要手动编辑**。

所有变更必须：
1. 先更新 `features/feature-registry.yml`
2. 运行: `bash scripts/generate-path-views.sh`
3. 提交生成的视图文件

---

**来源**: features/feature-registry.yml
**版本**: 2.71.0
**生成时间**: 2026-02-06
