---
id: minimal-paths
version: 2.66.0
created: 2026-02-04
updated: 2026-02-04
source: features/feature-registry.yml
generation: auto-generated (scripts/generate-path-views.sh)
changelog:
  - 2.66.0: 从 feature-registry.yml 自动生成
---

# Minimal Paths - 最小验收路径

**来源**: `features/feature-registry.yml` (单一事实源)
**用途**: 每个 feature 的"必须覆盖的 1-3 条"最小路径
**生成**: 自动生成，不要手动编辑

---

## Platform Core 5 - 平台基础设施

### H1: Branch Protection

1. ✅ **在 main 分支尝试写代码 → 被阻止**
2. ✅ **在 cp-* 分支写代码 → 放行**

**RCI 覆盖**: H1-001,H1-002,H1-003,H1-010,H1-011

---

### H7: Stop Hook Loop Controller (JSON API)

1. ✅ **无 .dev-mode → exit 0 (普通会话)**
2. ✅ **有 .dev-mode + PR 未创建 → exit 2 (继续)**
3. ✅ **有 .dev-mode + PR 已合并 → 删除 .dev-mode + exit 0 (完成)**

**RCI 覆盖**: H7-001,H7-002,H7-003,H7-006,H7-007,H7-008

---

### H2: PR Gate (Dual Mode)

1. ✅ **PR 模式: 检查 PRD + DoD + QA-DECISION + AUDIT-REPORT (PASS) + L1**
2. ✅ **Release 模式: 额外检查 .layer2-evidence.md + DoD 全勾**

**RCI 覆盖**: H2-001,H2-002,H2-003,H2-004

---

### W1: Unified Dev Workflow

1. ✅ **p0: PRD → DoD → Code → Audit (PASS) → Test (L1) → PR → 结束**
2. ✅ **p1: CI fail → 修复 → push → 退出（不等 CI）**
3. ✅ **p2: CI pass → 自动 merge → Learning → Cleanup**

**RCI 覆盖**: W1-001,W1-002,W1-003,W1-004,W1-005,W1-006,W1-008

---

### Q1: Impact Check

1. ✅ **改 hooks/ 不改 registry → CI FAIL**
2. ✅ **改 hooks/ 同时改 registry → CI PASS**
3. ✅ **只改 registry → CI PASS（允许文档更新）**

**RCI 覆盖**: Q1-001,Q1-002,Q1-003

---

### Q2: Evidence Gate

1. ✅ **无证据文件 → CI FAIL**
2. ✅ **SHA 不匹配 HEAD → CI FAIL**
3. ✅ **证据完整 → CI PASS**

**RCI 覆盖**: Q2-001,Q2-002,Q2-003

---

### Q3: Anti-Bypass Contract

1. ✅ **文档说明本地 vs 远端职责**
2. ✅ **文档说明为何不用脚本验证 Branch Protection**

**RCI 覆盖**: Q3-001,Q3-002

---

### Q4: CI Layering (L2B + L3-fast + Preflight + AI Review)

1. ✅ **L2B-min: .layer2-evidence.md 存在 + 格式有效 + 至少 1 条可复核证据**
2. ✅ **L3-fast: npm run lint/format:check（--if-present 占位符）**
3. ✅ **Preflight: typecheck + test + L3-fast + L2A-min（120s 内）**
4. ✅ **AI Review: 调用 VPS Review API，L2C 专用提示词**

**RCI 覆盖**: Q4-001,Q4-002,Q4-003,Q4-004,Q4-005,Q4-006

---

### Q5: RISK SCORE Trigger

1. ✅ **risk-score.cjs: 计算 R1-R8 规则，输出 JSON**
2. ✅ **detect-scope.cjs: 自动建议允许的 Scope**
3. ✅ **detect-forbidden.cjs: 列出常见禁区**

**RCI 覆盖**: Q5-001,Q5-002

---

### Q6: Structured Audit

1. ✅ **compare-scope.cjs: 对比实际改动与允许范围**
2. ✅ **check-forbidden.cjs: 检查是否触碰禁区**
3. ✅ **check-proof.cjs: 验证 Tests 字段完成度**
4. ✅ **generate-report.cjs: 生成结构化报告**

**RCI 覆盖**: Q6-001,Q6-002

---

## Product Core 5 - 引擎核心能力

### P1: Regression Testing Framework

1. ✅ **PR: rc-filter.sh pr → 跑 trigger=[PR] 的 RCI**
2. ✅ **Release: rc-filter.sh release → 跑 trigger=[Release] 的 RCI**
3. ✅ **Nightly: run-regression.sh nightly → 跑全部 RCI**

**RCI 覆盖**: P1-001,P1-002,P1-003

---

### P2: DevGate

1. ✅ **DoD 映射: .dod.md 每项 → 对应测试文件存在**
2. ✅ **P0/P1 检查: PR title 含 P0/P1 → regression-contract.yaml 必须更新**
3. ✅ **RCI 覆盖率: 新增入口 → 必须有对应 RCI**

**RCI 覆盖**: C6-001,C7-001,C7-002,C7-003

---

### P3: Quality Reporting

1. ✅ **QA Report: bash scripts/qa-report.sh → qa-report.json**
2. ✅ **Dev Session: bash skills/dev/scripts/generate-report.sh → dev-session-report.***

**RCI 覆盖**: E1-001,E1-002,E1-003,E2-001,E2-002,E2-003

---

### P4: CI Quality Gates

1. ✅ **version-check: PR 时检查版本号更新**
2. ✅ **test: 跑 L1 (typecheck + test + build) + DevGate**
3. ✅ **release-check: PR to main 时跑 L3 回归 + L4 Evidence**

**RCI 覆盖**: C1-001,C1-002,C1-003,C2-001,C3-001,C5-001

---

### P5: Worktree Parallel Development

1. ✅ **主仓库无冲突 → 跳过，正常流程**
2. ✅ **主仓库有活跃 .dev-mode → 自动创建 worktree + cd**
3. ✅ **僵尸 .dev-mode（>2h 或分支不存在）→ 自动清理**

**RCI 覆盖**: W6-001

---

### P6: Self-Evolution Automation

1. ✅ **Step 8: squash-evidence.sh 自动合并 evidence commit**
2. ✅ **Step 7: auto-generate-views.sh 自动生成派生视图**
3. ✅ **Step 11: post-pr-checklist.sh 自动运行 4 项检查**
4. ✅ **detect-priority.cjs 优先读取 QA-DECISION.md（不解析文本）**
5. ✅ **CI: 检测 .quality-evidence.json 中的 'known failures' 标记**

**RCI 覆盖**: S1-001,S2-001,S2-002,S3-001,S3-002,S3-003,S3-004

---

### H8: Credential Guard

1. ✅ **代码中写真实 token → 被阻止**
2. ✅ **代码中写占位符 YOUR_XXX → 放行**
3. ✅ **写入 ~/.credentials/ → 放行**

**RCI 覆盖**: H8-001,H8-002,H8-003

---

### G1: Gate Skill Family

1. ✅ **写完 DoD → gate:dod 审核 → FAIL → 修改 → 再审核 → PASS**
2. ✅ **写完测试 → gate:test 审核 → PASS → 继续质检**

**RCI 覆盖**: G1-001,G1-002,G1-003,G1-004,G1-005,G1-006

---

## 更新规则

**本文件自动生成，不要手动编辑**。

所有变更必须：
1. 先更新 `features/feature-registry.yml`
2. 运行: `bash scripts/generate-path-views.sh`
3. 提交生成的视图文件

---

**来源**: features/feature-registry.yml
**版本**: 2.66.0
**生成时间**: 2026-02-04
