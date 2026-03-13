---
id: golden-paths
version: 3.40.0
created: 2026-03-13
updated: 2026-03-13
source: features/feature-registry.yml
generation: auto-generated (scripts/generate-path-views.sh)
changelog:
  - 3.40.0: 从 feature-registry.yml 自动生成
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
检测当前分支 → main/develop → exit 2 (阻止) | cp-*/feature/* → worktree 检测 → 僵尸检测 → .dev-mode 检测 → PRD/DoD 检测 → exit 0 (放行)
```

**RCI 覆盖**: H1-001,H1-002,H1-003,H1-010,H1-011,H1-012,H1-013

---

## GP-002: Stop Hook Router (v14.0.0) (H7)

**Feature**: H7 - Stop Hook Router (v14.0.0)
**Priority**: P0

### Golden Path

```
会话结束 → 检测 .dev-mode → 检查完成条件 → exit 2 (继续) | exit 0 (结束)
```

**RCI 覆盖**: H7-001,H7-002,H7-004,H7-006,H7-007,H7-008,W6-006

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
/dev 启动 → Step 0 强制创建 worktree（.claude/worktrees/ 路径）→ 继续正常流程 → 退出时 Stop Hook 强制清理 worktree
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

## GP-018: Bash Guard (Credential Leak + File Exposure + HK Deploy Protection) (H9)

**Feature**: H9 - Bash Guard (Credential Leak + File Exposure + HK Deploy Protection)
**Priority**: P1

### Golden Path

```
Bash 命令 → token 扫描 (~1ms) → .credentials/ 暴露检测 (~1ms) →
rsync/scp + HK 检测 (~1ms) → 未命中 → 放行 | 命中 HK → git 三连检 → 通过/阻止
```

**RCI 覆盖**: H9-001,H9-002,H9-003,H9-004

---

## GP-019: PRD/DoD Validation Loop (S2)

**Feature**: S2 - PRD/DoD Validation Loop
**Priority**: P1

### Golden Path

```
生成 PRD/DoD → validate-*.py 打分 → total < 90 →
AI 读取 validation report → 改进文档 → 重新验证 →
Loop until >= 90 → anti-cheat-*.sh 验证 → 通过
```

**RCI 覆盖**: S2-001,S2-002,S2-003

---

## GP-020: Decomp Skill (S3)

**Feature**: S3 - Decomp Skill
**Priority**: P1

### Golden Path

```
秋米被调用 → 读取 /decomp → 三维矩阵识别层级 →
按五层模板拆解 → 战略对齐检查 → 写入数据库 →
OKR层: status=reviewing（等人工确认）
KR以下: 触发 Decomp-Check 审查
```

---

## GP-021: Decomp-Check Skill (S4)

**Feature**: S4 - Decomp-Check Skill
**Priority**: P1

### Golden Path

```
Vivian 被调用 → 读取 /decomp-check → 按层级选审查标准 →
检查因果链/覆盖度/命名/战略对齐 →
approved: Brain 继续流程
needs_revision: 秋米修正
rejected: Brain 打回重拆
```

---

## GP-022: Pipeline Hardening V1 (S5)

**Feature**: S5 - Pipeline Hardening V1
**Priority**: P1

### Golden Path

```
代码变更 → Step 7.1 npm test → Step 7.1b local-precheck →
facts-check/version-sync/manifest-sync 全绿 → Step 7.2 DoD 验证 →
Step 7.4 代码审查 → push → CI 直通
```

---

## GP-023: Delivery Type + PR Behavior Declaration (S6)

**Feature**: S6 - Delivery Type + PR Behavior Declaration
**Priority**: P1

### Golden Path

```
createTask({ delivery_type: 'behavior-change' }) →
PR body 包含 SYSTEM BEHAVIOR CHANGE →
check-delivery-type.sh 验证测试文件存在 →
CI 通过
```

---

## GP-024: PRD Semantic Coverage Audit (S7)

**Feature**: S7 - PRD Semantic Coverage Audit
**Priority**: P0

### Golden Path

```
PRD 写承诺 → DoD 分类 [ARTIFACT]/[BEHAVIOR]/[GATE] →
BEHAVIOR 条目 Test 必须用 tests/*.test.ts 或 manual:curl →
check-dod-mapping.cjs 拒绝 BEHAVIOR 用 grep/ls 弱测试 →
Step 7.5 独立审计员验证 PRD vs 代码实现
```

---

## GP-025: Changed-Line Coverage Gate (S8)

**Feature**: S8 - Changed-Line Coverage Gate
**Priority**: P0

### Golden Path

```
feat: PR → CI L3 Unit Tests → Coverage Gate →
check-changed-coverage.cjs 检查三个门禁 →
变更行覆盖率 ≥ 60% → 通过
```

---

## GP-026: fire-learnings-event.sh 来源追踪 (S9)

**Feature**: S9 - fire-learnings-event.sh 来源追踪
**Priority**: P1

### Golden Path

```
/dev PR 合并 → Step 10 → fire-learnings-event.sh →
POST /api/brain/learnings-received →
learnings 表写入 source_branch/source_pr/repo →
Haiku 异步分类 learning_type
```

---

## GP-027: Hook Gates 5个真锁 (S10)

**Feature**: S10 - Hook Gates 5个真锁
**Priority**: P0

### Golden Path

```
git push → bash-guard 拦截 → local-precheck.sh 通过 → push 成功
git commit -m "random" → bash-guard 拦截 → 报错 → 修改消息 → 通过
Write .prd-*.md (无成功标准) → branch-protect 拦截 → 添加成功标准 → 通过
Write .dod-*.md (无 checkbox) → branch-protect 拦截 → 添加 - [ ] → 通过
STEP_10 flag=done → stop-dev 运行 check-learning.sh → 内容验证 → 允许合并
```

---

## GP-028: Provider-Agnostic Engine — devloop-check.sh 单一入口 (S11)

**Feature**: S11 - Provider-Agnostic Engine — devloop-check.sh 单一入口
**Priority**: P1

### Golden Path

```
Brain codex_dev 任务 → executor.triggerCodexBridge() →
codex-bridge POST /run (runner=runner.sh) →
runner.sh source devloop-check.sh →
while ! devloop_check done → codex-bin exec action →
完成 → cleanup
```

---

## 更新规则

**本文件自动生成，不要手动编辑**。

所有变更必须：
1. 先更新 `features/feature-registry.yml`
2. 运行: `bash scripts/generate-path-views.sh`
3. 提交生成的视图文件

---

**来源**: features/feature-registry.yml
**版本**: 3.40.0
**生成时间**: 2026-03-13
