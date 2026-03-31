---
id: optimal-paths
version: 4.0.0
created: 2026-03-31
updated: 2026-03-31
source: features/feature-registry.yml
generation: auto-generated (scripts/generate-path-views.sh)
changelog:
  - 4.0.0: 从 feature-registry.yml 自动生成
---

# Optimal Paths - 推荐体验路径

**来源**: `features/feature-registry.yml` (单一事实源)
**用途**: 每个 feature 的"推荐体验路径"（优化后的流程）
**生成**: 自动生成，不要手动编辑

---

## Platform Core 5 - 平台基础设施

### H1: Branch Protection

```
检测当前分支 → main/develop → exit 2 (阻止) | cp-*/feature/* → worktree 检测 → 僵尸检测 → .dev-mode 检测 → PRD/DoD 检测 → exit 0 (放行)
```

---

### H7: Stop Hook Router (v14.0.0)

```
会话结束 → 检测 .dev-mode → 检查完成条件 → exit 2 (继续) | exit 0 (结束)
```

---

### H2: PR Gate (Dual Mode)

```
检测命令 (gh pr create) → 判断模式 (PR/Release) → 检查产物 → 通过/阻止
```

---

### W1: Unified Dev Workflow

```
完整的 Golden Path（11 步）：
1. PRD 确定
2. 环境检测
3. 分支创建 (cp-MMDDTTTT-xxx)
4. DoD 定稿 (含 QA Decision Node)
5. 写代码
6. 写测试
7. 质检循环 (Audit + L1, Stop Hook 强制)
8. 提交 PR (p0 结束)
9. CI 修复 (p1 事件驱动)
10. Learning
11. Cleanup
```

---

### Q1: Impact Check

```
PR 改动核心文件 → impact-check.sh 检测 → 验证 registry 同时更新 → 通过/失败
```

---

### Q2: Evidence Gate

```
npm run qa:gate → 生成 .quality-evidence.json → CI 验证 SHA/字段 → 通过/失败
```

---

### Q3: Anti-Bypass Contract

```
开发者理解质量契约 → 本地 Hook 提前反馈 → 远端 CI 最终强制 → Branch Protection 物理阻止
```

---

### Q4: CI Layering (L2B + L3-fast + Preflight + AI Review)

```
本地 → ci:preflight (快速预检) → L2B 证据创建 → PR Gate (L2B-min) →
CI → l2b-check job → ai-review job → 通过/失败
```

---

### Q5: RISK SCORE Trigger

```
/dev Step 3 → risk-score.cjs (计算分数) → ≥3 分 → 执行完整 QA Decision Node →
生成 docs/QA-DECISION.md
```

---

### Q6: Structured Audit

```
/dev Step 6 → compare-scope.cjs (验证范围) → check-forbidden.cjs (检查禁区) →
check-proof.cjs (验证证据) → generate-report.cjs (生成报告) →
AUDIT-REPORT.md (Decision: PASS/FAIL)
```

---

## Product Core 5 - 引擎核心能力

### P1: Regression Testing Framework

```
定义 RCI (regression-contract.yaml) → rc-filter.sh 过滤 →
run-regression.sh 执行 → 验证契约不被破坏
```

---

### P2: DevGate

```
CI test job → DevGate checks → 三个检查全部通过 → CI 继续
```

---

### P3: Quality Reporting

```
执行脚本 → 扫描 repo 结构 → 生成 JSON/TXT 报告 → 供 Dashboard 使用
```

---

### P4: CI Quality Gates

```
PR 创建 → CI 触发 → version-check + test + DevGate → 全部通过 → ci-passed
```

---

### P5: Worktree Parallel Development

```
/dev 启动 → Step 0 强制创建 worktree（.claude/worktrees/ 路径）→ 继续正常流程 → 退出时 Stop Hook 强制清理 worktree
```

---

### P6: Self-Evolution Automation

```
问题发现 → 记录到 docs/SELF-EVOLUTION.md → 创建检查项 → 自动化脚本 → 集成到流程
```

---

### H8: Credential Guard

```
写入代码 → credential-guard.sh 检测 → 真实凭据 → exit 2 (阻止) | 占位符/credentials目录 → exit 0 (放行)
```

---

### H9: Bash Guard (Credential Leak + File Exposure + HK Deploy Protection)

```
Bash 命令 → token 扫描 (~1ms) → .credentials/ 暴露检测 (~1ms) →
rsync/scp + HK 检测 (~1ms) → 未命中 → 放行 | 命中 HK → git 三连检 → 通过/阻止
```

---

### S2: PRD/DoD Validation Loop

```
生成 PRD/DoD → validate-*.py 打分 → total < 90 →
AI 读取 validation report → 改进文档 → 重新验证 →
Loop until >= 90 → anti-cheat-*.sh 验证 → 通过
```

---

### S3: Decomp Skill

```
秋米被调用 → 读取 /decomp → 三维矩阵识别层级 →
按五层模板拆解 → 战略对齐检查 → 写入数据库 →
OKR层: status=reviewing（等人工确认）
KR以下: 触发 Decomp-Check 审查
```

---

### S4: Decomp-Check Skill

```
Vivian 被调用 → 读取 /decomp-check → 按层级选审查标准 →
检查因果链/覆盖度/命名/战略对齐 →
approved: Brain 继续流程
needs_revision: 秋米修正
rejected: Brain 打回重拆
```

---

### S5: Pipeline Hardening V1

```
代码变更 → Step 7.1 npm test → Step 7.1b local-precheck →
facts-check/version-sync/manifest-sync 全绿 → Step 7.2 DoD 验证 →
Step 7.4 代码审查 → push → CI 直通
```

---

### S6: Delivery Type + PR Behavior Declaration

```
createTask({ delivery_type: 'behavior-change' }) →
PR body 包含 SYSTEM BEHAVIOR CHANGE →
check-delivery-type.sh 验证测试文件存在 →
CI 通过
```

---

### S7: PRD Semantic Coverage Audit

```
PRD 写承诺 → DoD 分类 [ARTIFACT]/[BEHAVIOR]/[GATE] →
BEHAVIOR 条目 Test 必须用 tests/*.test.ts 或 manual:curl →
check-dod-mapping.cjs 拒绝 BEHAVIOR 用 grep/ls 弱测试 →
Step 7.5 独立审计员验证 PRD vs 代码实现
```

---

### S8: Changed-Line Coverage Gate

```
feat: PR → CI L3 Unit Tests → Coverage Gate →
check-changed-coverage.cjs 检查三个门禁 →
变更行覆盖率 ≥ 60% → 通过
```

---

### S9: fire-learnings-event.sh 来源追踪

```
/dev PR 合并 → Step 10 → fire-learnings-event.sh →
POST /api/brain/learnings-received →
learnings 表写入 source_branch/source_pr/repo →
Haiku 异步分类 learning_type
```

---

### S10: Hook Gates 5个真锁

```
git push → bash-guard 拦截 → local-precheck.sh 通过 → push 成功
git commit -m "random" → bash-guard 拦截 → 报错 → 修改消息 → 通过
Write .prd-*.md (无成功标准) → branch-protect 拦截 → 添加成功标准 → 通过
Write .dod-*.md (无 checkbox) → branch-protect 拦截 → 添加 - [ ] → 通过
STEP_10 flag=done → stop-dev 运行 check-learning.sh → 内容验证 → 允许合并
```

---

### S11: Provider-Agnostic Engine — devloop-check.sh 单一入口

```
Brain codex_dev 任务 → executor.triggerCodexBridge() →
codex-bridge POST /run (runner=runner.sh) →
runner.sh source devloop-check.sh →
while ! devloop_check done → codex-bin exec action →
完成 → cleanup
```

---

### stop-hook-retry-fix: Stop Hook 重试上限统一 + 双 exit 0 终止条件合并

```
Stop Hook → devloop_check() → blocked →
超时检查（MAX_RETRIES=30）→ 未超时则 exit 2 继续 →
Step 11 完成 → _mark_cleanup_done() 写入 cleanup_done: true →
下次 Stop Hook → cleanup_done: true → exit 0 完成
```

---

### bash-guard-pr-title-check: bash-guard.sh gh pr create title 格式验证

```
gh pr create --title "feat: 描述" → 放行 →
gh pr create --title "random text" → 拦截，exit 2 →
Engine 改动 + 无 [CONFIG] → 拦截，exit 2 →
Engine 改动 + [CONFIG] feat: → 放行
```

---

### branch-date-warn-cleanup-fix: branch-protect 分支日期警告 + cleanup.sh step_* 非阻塞

```
cp-20260101-xxx 日期超 2 天 → WARN 输出 → 不 exit → 继续保护检查 →
cleanup.sh step 7.6 步骤不全 → WARN 输出 → VALIDATION_PASSED=true → cleanup 继续执行
```

---

### worktree-max-limit: worktree-manage.sh MAX_WORKTREES 数量上限检查

```
worktree 数量 < 8 → 正常创建 →
worktree 数量 >= 8 → exit 1 + 错误提示 →
运行 worktree-gc.sh 清理 → 重试创建
```

---

### codex-runner-account-rotation: Codex Runner 多账号轮换（CODEX_HOMES）

```
CODEX_HOMES 解析为账号数组 →
codex-bin exec 执行 →
输出含 Quota exceeded → 切换账号 → 重试 →
所有账号耗尽 → 失败
```

---

### codex-runner-model-selection: Codex Runner 模型选择（CODEX_MODEL）

```
CODEX_MODEL 读取（默认 gpt-5.4） →
codex-bin exec --model gpt-5.4 执行 →
成功返回（无 Quota exceeded）
```

---

### S-ci-task-card-support: null

```
PR with .task-{branch}.md → CI 找到 Task Card → DoD/PRD 验证通过
```

---

### task-card-branch-protect: branch-protect.sh Task Card 格式支持

```
写入 .task-cp-xxx.md（含成功标准+checkbox）→
hook 验证通过 →
代码文件保护阶段用 task card 作为 PRD+DoD →
允许写代码
```

---

### task-card-format-support: DevGate 脚本支持 Task Card 格式（.task-{branch}.md）

```
分支有 .task-{branch}.md →
check-prd.sh 优先读取 .task-*.md →
check-dod-mapping.cjs 优先读取 .task-*.md →
检查通过
```

---

### S12: /dev Skill 文档重组为6步 Task Card 格式

```
用户运行 /dev →
读 SKILL.md 流程图（6步） →
Step 1 创建 .task 文件（合并 PRD + DoD） →
后续步骤引用 .task 完成开发
```

---

### S13: 基于路径映射的选择性 CI 受影响包计算脚本

```
git diff 输出文件列表 →
node affected-packages.js <files> →
输出 JSON 数组（如 ["brain","engine"]） →
CI 按需执行对应包的测试
```

---

### S14: coverage-delta 换用 vitest-coverage-report-action

```
PR 包含 Brain 变更 →
brain-unit 通过 →
coverage-delta 运行 vitest coverage →
davelosert action 读取 coverage-summary.json →
在 PR 中展示覆盖率变化报告
```

---

### S15: codex-playwright task type + 03-branch.md regression stub

```
Brain 派发 codex_playwright 任务 →
playwright-runner.sh 获取 Task 详情 →
Codex 探索阶段：生成 .cjs 脚本（CDP 连接 100.97.242.124:19225）→
脚本保存到 ~/playwright-scripts/<task_id>.cjs →
执行阶段：直接运行 .cjs 无需 LLM
```

---

### bash-guard-main-write-block: bash-guard 补漏：拦截 main 分支 Bash 重定向写入源码目录

```
main 分支 Bash 命令包含 > packages/ →
bash-guard.sh 规则 3b 检测 →
exit 2 + [SKILL_REQUIRED: dev]
```

---

### code-review-pre-push: code_review_gate 前移到 Stage 2（push 前审查）

```
Stage 2 完成 →
02-code.md 派发 code_review_gate →
devloop-check 条件 2.5 检查 →
Codex 审查 PASS →
Stage 3 push + CI
```

---

### devloop-check-ci-timeout-blocked: devloop-check CI 超时返回 blocked + P0 诊断任务

```
CI 超时 90 分钟 →
devloop-check 检测 elapsed > 5400 →
curl POST Brain /api/brain/tasks P0 →
返回 blocked + return 2
```

---

### branch-protect-prd-content-fallback: branch-protect hook 修复 prd_id→prd_content 双重检测

```
Write 操作 →
branch-protect 检查 .dev-mode task_id →
Brain API 获取 prd_id // prd_content →
prd_content 存在则放行
```

---

### learning-content-validation: Learning 内容实质性检查 + devloop-check PR 合并目标验证

```
PR CI →
check-learning.sh 检查 Learning 内容行数 →
根本原因 ≥3 行、下次预防 ≥1 行 →
devloop-check.sh PR 合并验证 baseRefName == main →
完成
```

---

### devloop-check-drift-detection: Stage3 Drift Check

```
Stage 2 完成 →
devloop-check.sh 条件 2.7 drift check →
实际改动文件与 Task Card Scope 对比 →
有 drift 则 warning（继续）→
条件 3 PR 创建 →
完成
```

---

### hook-ci-r12-gate0d-version-sync: Gate 0d Engine 版本同步检查

```
verify-step.sh step2 →
Gate 0d 检测 packages/engine/ 版本文件 →
调用 check-version-sync.sh →
5 文件版本一致 → PASS
```

---

### devgate-coverage-high-risk-whitelist: Devgate 覆盖率检查高风险白名单机制

```
check-coverage-completeness.mjs Check 3 →
高风险脚本缺测试 → exit 1（CI 阻断）→
低风险脚本缺测试 → warning（不阻断）→
所有高风险脚本有测试 → PASS
```

---

### brain-src-coverage-check: Brain src 覆盖率检查（Check 4）

```
check-coverage-completeness.mjs Check 4 →
扫描 packages/brain/src/*.js →
高风险模块缺测试 → exit 1（CI 阻断）→
普通模块缺测试 → warning（不阻断）→
所有高风险模块有测试 → PASS
```

---

### dod-ci-incompatible-command-detection: DoD CI 不兼容命令检测 (detectCiIncompatibleCommand)

```
DoD manual:curl localhost → detectCiIncompatibleCommand → exit 1 + 建议
DoD manual:psql → exit 1 + 建议用 tests/
DoD manual:node -e → 通过检查
```

---

### planner-subagent-stage1: Planner subagent — Stage 1 Task Card 生成独立化

```
/dev 启动 →
Stage 1: 主 agent spawn Planner subagent →
Planner 接收任务描述 + SYSTEM_MAP →
Planner 输出 Task Card + DoD（只含 WHAT，无 HOW）→
主 agent 继续 Sprint Contract Gate
```

---

### verify-step-symlink-path-fix: verify-step.sh symlink 物理路径解析修复

```
hooks/verify-step.sh（symlink）→
pwd -P 获取物理路径 →
拼接 ../scripts/devgate/check-manual-cmd-whitelist.cjs →
Node.js 词法解析成功 →
DoD whitelist 检查正常执行
```

---

### sprint-contract-fix-adversarial: Sprint Contract Gate 对抗审查修复

```
CRG subagent 输出 reviewer_model 字段 →
stats 非全零 →
seal 文件包含 reviewer_model →
spec_review plans.length > 0 →
Sprint Contract 验证有效
```

---

### sprint-contract-gate-fix: Sprint Contract Gate 防橡皮图章修复

```
spec_review subagent 调用 → plans.length > 0（有独立测试计划）→
CRG subagent 调用 → stats 非全零（有实质审查）→
reviewer_model 字段正确写入 seal 文件
```

---

### adversarial-redesign: Sprint Contract Gate 双独立提案对抗架构

```
Orchestrator 剥离 Task Card Test 字段 →
Generator subagent 独立提案 → .dev-gate-generator-sprint.{branch} →
Evaluator subagent 独立提案 → .dev-gate-spec.{branch} →
Orchestrator 比对 → 有分歧 → 双方互看 → 无限收敛（死循环检测）→
Evaluator 提案写入 Task Card Test 字段
```

---

### evaluator-reconnect: Stage 2 独立 Evaluator 接回 + Sprint Contract 无限收敛

```
Generator 写代码 → 自验证（2.3.3）→
独立 Evaluator（playwright-evaluator.sh）执行 [BEHAVIOR] Test →
PASS → CRG 审查 → push
FAIL → 打回 Generator 修代码 → 重新自验证 → 重新 Evaluator → 直到 PASS
```

---

### sprint-contract-loop: Sprint Contract 收敛循环 shell 脚本驱动

```
Generator subagent 提案 → Evaluator subagent 提案 →
bash sprint-contract-loop.sh → exit 0（blocker_count==0）→ 收敛，进入 Stage 2
exit 1 → 展示差异给双方 → 删除 seal 文件 → 重新 spawn → 再调脚本 → 无限循环直到 PASS
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
**版本**: 4.0.0
**生成时间**: 2026-03-31
