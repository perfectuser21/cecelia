---
id: minimal-paths
version: 3.72.0
created: 2026-03-19
updated: 2026-03-19
source: features/feature-registry.yml
generation: auto-generated (scripts/generate-path-views.sh)
changelog:
  - 3.72.0: 从 feature-registry.yml 自动生成
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

1. ✅ **已在 worktree → 跳过创建**
2. ✅ **主仓库 → 强制创建 worktree + cd（.claude/worktrees/ 路径）**
3. ✅ **worktree-manage.sh 创建前自动更新 develop 分支**
4. ✅ **Stop Hook 退出时强制清理 worktree（兜底）**

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

### H9: Bash Guard (Credential Leak + File Exposure + HK Deploy Protection)

1. ✅ **命令含真实 token → 被阻止**
2. ✅ **cp/mv ~/.credentials/ → 被阻止**
3. ✅ **cat ~/.credentials/ > file → 被阻止**
4. ✅ **source ~/.credentials/ → 放行（安全加载）**
5. ✅ **rsync 到 HK + git dirty → 被阻止**
6. ✅ **rsync 到 HK + git clean + main → 放行**
7. ✅ **日常命令 (git/npm/echo) → 放行**
8. ✅ **ssh hk → 放行（不拦）**

**RCI 覆盖**: H9-001,H9-002,H9-003,H9-004

---

### S2: PRD/DoD Validation Loop

1. ✅ **PRD 验证: 生成 PRD → 验证 → 90+ 通过**
2. ✅ **DoD 验证: 生成 DoD → 验证 → 90+ 通过**
3. ✅ **质量循环: 85 分 → 改进 → 92 分通过**
4. ✅ **防作弊: 手动改分 → SHA256 不匹配 → exit 2**

**RCI 覆盖**: S2-001,S2-002,S2-003

---

### S3: Decomp Skill

1. ✅ **基本拆解: 秋米 → /decomp → 生成层级结构 → 写入 DB**

---

### S4: Decomp-Check Skill

1. ✅ **质检通过: Vivian → /decomp-check → approved**
2. ✅ **质检驳回: Vivian → /decomp-check → rejected → 秋米重拆**

---

### S5: Pipeline Hardening V1

1. ✅ **Brain 改动: 本地预检 → facts/version/manifest 全绿 → push**
2. ✅ **非 Brain 改动: 预检跳过 → DoD 验证 → push**

---

### S6: Delivery Type + PR Behavior Declaration

1. ✅ **code-only 任务: delivery_type 默认值，无额外验证**
2. ✅ **behavior-change 任务: 必须有测试文件 + PR body 声明**

---

### S7: PRD Semantic Coverage Audit

1. ✅ **无 [BEHAVIOR] 标签: 向后兼容，不触发弱测试检测**
2. ✅ **有 [BEHAVIOR] 标签: 强制要求强测试（tests/ 或 curl）**

---

### S8: Changed-Line Coverage Gate

1. ✅ **fix:/docs:/chore: PR: 门禁 1 跳过（不要求新测试），门禁 3 仍检查覆盖率**
2. ✅ **无源码变更: 全部门禁跳过**

---

### S9: fire-learnings-event.sh 来源追踪

1. ✅ **BRANCH_NAME 为空: source_branch = null**
2. ✅ **PR_NUMBER 为空: source_pr = null**

---

### S10: Hook Gates 5个真锁

1. ✅ **local-precheck.sh 不存在: 放行（降级）**
2. ✅ **git commit 无 -m 参数: 放行（interactive 模式）**
3. ✅ **check-learning.sh 不存在: 降级为只检查 flag**

---

### S11: Provider-Agnostic Engine — devloop-check.sh 单一入口

1. ✅ **devloop-check.sh 未加载: stop-dev.sh fallback 到旧内联逻辑**
2. ✅ **dry-run 模式: runner.sh 打印命令不执行**

---

### stop-hook-retry-fix: Stop Hook 重试上限统一 + 双 exit 0 终止条件合并

1. ✅ **devloop_check done: 已有 cleanup_done: true，直接 exit 0**
2. ✅ **超时: RETRY_COUNT > MAX_RETRIES → 上报失败 → exit 0**

---

### bash-guard-pr-title-check: bash-guard.sh gh pr create title 格式验证

1. ✅ **无 --title 参数: 提取失败，降级放行**
2. ✅ **非 gh pr create 命令: 跳过检查**

---

### branch-date-warn-cleanup-fix: branch-protect 分支日期警告 + cleanup.sh step_* 非阻塞

1. ✅ **日期计算失败（date 命令不可用）: DATE_2_DAYS_AGO 为空，跳过检查**
2. ✅ **cleanup.sh 无 .dev-mode 文件: 跳过 step_* 验证**

---

### worktree-max-limit: worktree-manage.sh MAX_WORKTREES 数量上限检查

1. ✅ **数量 < 8: 正常流程**
2. ✅ **数量 >= 8: 拒绝创建，提示 GC**

---

### codex-runner-account-rotation: Codex Runner 多账号轮换（CODEX_HOMES）

1. ✅ **单账号（兼容）: CODEX_HOME 正常执行**
2. ✅ **多账号轮换: Quota exceeded → 切换 → 继续**
3. ✅ **全部耗尽: 报错退出**

---

### codex-runner-model-selection: Codex Runner 模型选择（CODEX_MODEL）

1. ✅ **默认: gpt-5.4 执行，无 quota 问题**
2. ✅ **自定义: CODEX_MODEL=gpt-5.3-codex 恢复旧行为**

---

### S-ci-task-card-support: null

1. ✅ **新格式: .task-{branch}.md 被正确识别**
2. ✅ **旧格式: .dod-{branch}.md / .prd-{branch}.md 向后兼容**

---

### task-card-branch-protect: branch-protect.sh Task Card 格式支持

1. ✅ **task card: .task-{branch}.md 含成功标准+checkbox → 通过**
2. ✅ **旧格式: .prd-{branch}.md + .dod-{branch}.md → 仍然有效**
3. ✅ **缺少成功标准: exit 2 拦截**
4. ✅ **缺少 checkbox: exit 2 拦截**

---

### task-card-format-support: DevGate 脚本支持 Task Card 格式（.task-{branch}.md）

1. ✅ **新格式: .task-{branch}.md 存在时优先使用**
2. ✅ **旧格式: .task-*.md 不存在时 fallback 到 .prd-*.md / .dod-*.md**

---

### S12: /dev Skill 文档重组为6步 Task Card 格式

1. ✅ **新模式: 使用 01-taskcard.md 创建合并格式 Task Card**
2. ✅ **兼容模式: 旧 01-prd.md + 05-dod.md 仍可用（弃用提示）**

---

### S13: 基于路径映射的选择性 CI 受影响包计算脚本

1. ✅ **改动 packages/brain/ → 输出 brain**
2. ✅ **改动 packages/engine/ → 输出 engine**
3. ✅ **改动根目录/CI 文件 → 输出所有包（兜底）**

---

### S14: coverage-delta 换用 vitest-coverage-report-action

1. ✅ **PR brain 变更 → coverage-delta 跑并报告**
2. ✅ **push main → coverage-baseline 跑，更新基线**

---

### S15: codex-playwright task type + 03-branch.md regression stub

1. ✅ **codex_playwright 任务 → playwright-runner.sh → Codex 探索 → .cjs 脚本**
2. ✅ **已有 .cjs 脚本 → 直接 node 执行**

---

### bash-guard-main-write-block: bash-guard 补漏：拦截 main 分支 Bash 重定向写入源码目录

1. ✅ **main 分支 > packages/ 重定向 → 被拦截 exit 2**
2. ✅ **cp-* 分支同样命令 → 放行**

---

## 更新规则

**本文件自动生成，不要手动编辑**。

所有变更必须：
1. 先更新 `features/feature-registry.yml`
2. 运行: `bash scripts/generate-path-views.sh`
3. 提交生成的视图文件

---

**来源**: features/feature-registry.yml
**版本**: 3.72.0
**生成时间**: 2026-03-19
