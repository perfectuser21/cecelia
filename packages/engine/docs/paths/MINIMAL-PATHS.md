---
id: minimal-paths
version: 3.75.0
created: 2026-03-21
updated: 2026-03-21
source: features/feature-registry.yml
generation: auto-generated (scripts/generate-path-views.sh)
changelog:
  - 3.75.0: 从 feature-registry.yml 自动生成
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
3. ✅ **在已合并 cp-* 分支（僵尸 worktree）写代码 → 被阻止**
4. ✅ **在活跃 cp-* worktree、无 .dev-mode、新 Claude 会话 → 被阻止**

**RCI 覆盖**: H1-001,H1-002,H1-003,H1-010,H1-011,H1-012,H1-013

---

### H7: Stop Hook Router (v14.0.0)

1. ✅ **无 .dev-mode → exit 0 (普通会话)**
2. ✅ **有 .dev-mode + PR 未创建 → exit 2 (继续)**
3. ✅ **有 .dev-mode + PR 已合并 → 删除 .dev-mode + exit 0 (完成)**

**RCI 覆盖**: H7-001,H7-002,H7-004,H7-006,H7-007,H7-008,W6-006

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
