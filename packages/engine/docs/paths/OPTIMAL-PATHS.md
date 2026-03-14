---
id: optimal-paths
version: 3.48.0
created: 2026-03-14
updated: 2026-03-14
source: features/feature-registry.yml
generation: auto-generated (scripts/generate-path-views.sh)
changelog:
  - 3.48.0: 从 feature-registry.yml 自动生成
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

## 更新规则

**本文件自动生成，不要手动编辑**。

所有变更必须：
1. 先更新 `features/feature-registry.yml`
2. 运行: `bash scripts/generate-path-views.sh`
3. 提交生成的视图文件

---

**来源**: features/feature-registry.yml
**版本**: 3.48.0
**生成时间**: 2026-03-14
