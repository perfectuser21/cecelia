---
id: workflow-contract
version: 2.0.0
created: 2026-01-24
updated: 2026-01-24
changelog:
  - 2.0.0: 两阶段工作流契约（唯一流程定义来源）
---

# Workflow Contract - 两阶段工作流契约

**唯一流程定义来源** - 其他地方不再重复讲流程。

---

## 状态机

```
┌─────────────────────────────────────────────────────────┐
│                Two-Phase Workflow State Machine         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  p0 (Published)  → 本地质检 → 创建 PR → 结束           │
│                    不等待 CI                            │
│                                                         │
│  p1 (CI fail)    → 事件驱动修复循环                     │
│                    修复 → push → 退出 → 等唤醒         │
│                                                         │
│  p2 (CI pass)    → 自动合并 → Learning → Cleanup       │
│                                                         │
│  pending         → 中间态，直接退出（不挂着）           │
│                    等待 CI 结果                         │
│                                                         │
│  unknown         → 错误状态，安全退出                   │
│                    API 错误/网络问题                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 阶段定义

| 阶段 | 触发条件 | 允许动作 | 退出条件 | Stop Hook 行为 |
|------|----------|----------|----------|---------------|
| **p0** | 无 PR | PRD → DoD → Code → Quality → PR | PR 创建成功 | 检查质检+PR，不检查 CI |
| **p1** | PR + CI fail | 修复 → push | CI pending/pass | 检查 CI 状态 |
| **p2** | PR + CI pass | Learning → Cleanup | 完成 | 直接 exit 0 |
| **pending** | PR + CI pending | 无（等待） | 稍后再查 | 直接 exit 0 |
| **unknown** | gh API 错误 | 无（报错） | 立即退出 | 直接 exit 0 |

---

## 阶段检测

**脚本**: `scripts/detect-phase.sh`

**检测逻辑**（三个问题）：

```bash
# 1. 有没有 PR？
PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number -q '.[0].number')

if [[ -z "$PR_NUMBER" ]]; then
    echo "PHASE: p0"  # 没有 PR → p0
    exit 0
fi

# 2. CI 有结果吗？
CI_STATUS=$(gh pr checks "$PR_NUMBER" --json state -q '.[].state' | head -1)

if [[ -z "$CI_STATUS" ]] || [[ "$CI_STATUS" == "PENDING" ]]; then
    echo "PHASE: pending"  # CI 运行中 → pending
    exit 0
fi

# 3. 结果是啥？
if echo "$CI_STATUS" | grep -qi "FAILURE"; then
    echo "PHASE: p1"  # CI fail → p1
elif echo "$CI_STATUS" | grep -qi "SUCCESS"; then
    echo "PHASE: p2"  # CI pass → p2
else
    echo "PHASE: unknown"  # 未知状态
fi
```

**错误处理**：

- gh API 错误（rate limit / 网络错误）→ `PHASE: unknown` → exit 0
- 不允许因为 API 波动误判阶段

---

## PHASE_OVERRIDE 强制模式

**用途**: 强制进入 p1 阶段（CI fail 通知触发时）

```bash
# 强制进入 p1
PHASE_OVERRIDE=p1 bash scripts/detect-phase.sh
# 输出: PHASE: p1

# 用例: CI fail 通知 → 自动触发 p1 修复
PHASE_OVERRIDE=p1 cecelia-run "修复 PR #123 的 CI 失败..."
```

**详细文档**: `docs/PHASE-OVERRIDE.md`

---

## Stop Hook 角色

**职责**: 只检查**当前阶段的结束条件**，不跨阶段

### p0 阶段（本地质检）

```bash
# 检查质检产物
if [[ ! -f "docs/AUDIT-REPORT.md" ]]; then
    echo "❌ Audit 报告缺失"
    exit 2  # 阻止结束
fi

DECISION=$(grep "^Decision:" docs/AUDIT-REPORT.md | awk '{print $2}')
if [[ "$DECISION" != "PASS" ]]; then
    echo "❌ Audit 未通过"
    exit 2  # 阻止结束
fi

if [[ ! -f ".quality-gate-passed" ]]; then
    echo "❌ 测试未通过"
    exit 2  # 阻止结束
fi

# 检查 PR 创建
PR_NUMBER=$(gh pr list --head "$BRANCH" --state open --json number -q '.[0].number')
if [[ -z "$PR_NUMBER" ]]; then
    echo "❌ PR 未创建"
    exit 2  # 阻止结束
fi

# p0 完成：不检查 CI
echo "✅ p0 阶段完成（PR 已创建，不等 CI）"
exit 0  # 允许结束
```

### p1 阶段（CI 修复）

```bash
# 检查 CI 状态
CI_STATUS=$(gh pr checks "$PR_NUMBER" --json state -q '.[].state' | head -1)

if [[ -z "$CI_STATUS" ]] || [[ "$CI_STATUS" == "PENDING" ]]; then
    echo "✅ CI pending，退出等待下次唤醒"
    exit 0  # 允许结束（不挂着）

elif echo "$CI_STATUS" | grep -qi "FAILURE"; then
    echo "❌ CI 失败，需要修复"
    echo "运行: gh pr checks $PR_NUMBER"
    exit 2  # 阻止结束

elif echo "$CI_STATUS" | grep -qi "SUCCESS"; then
    echo "✅ CI 通过，进入 p2"
    exit 0  # 允许结束
fi
```

### p2/pending/unknown 阶段

```bash
# 直接允许结束
exit 0
```

---

## 核心原则

### 1. 两阶段真正分离 ✅

```
p0: 创建 PR 后立即结束，不等 CI
p1: 修复 CI 后立即结束，不等 merge
p2: 直接退出（GitHub 自动 merge）
```

### 2. 无头语义正确 ✅

```
p0: PR 创建就结束（不挂）
p1: push 后 pending 就结束（不挂），等待下次唤醒
```

### 3. Stop Hook 职责正确 ✅

```
Stop Hook 只检查"本阶段结束条件"，不跨阶段
- p0: 质检 + PR 创建 → 结束（不检查 CI）
- p1: CI 状态 → fail 继续，pending/pass 结束
```

### 4. 事件驱动循环 ✅

```
❌ 不挂着等待: while CI pending; do sleep; done
✅ push 后退出: push → exit 0 → 等下次唤醒
```

---

## 完整流程（11 步）

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  p0 阶段：Published（本地质检 → 创建 PR）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1: PRD 确定 (.prd.md)
Step 2: 环境检测 (项目类型)
Step 3: 分支创建 (cp-MMDDTTTT-xxx)
    ├─ 并行开发检测 (worktree 可选)
Step 4: DoD 定稿 (.dod.md)
    ├─ QA Decision Node (调用 /qa Skill)
    └─ 产物: docs/QA-DECISION.md
Step 5: 写代码
Step 6: 写测试
Step 7: 质检循环（Stop Hook 强制）
    ├─ L2A: Audit Node (调用 /audit Skill)
    │   └─ 产物: docs/AUDIT-REPORT.md (Decision: PASS)
    ├─ L1: npm run qa (typecheck + test + build)
    │   └─ 产物: .quality-gate-passed
    └─ Stop Hook 检查:
        ❌ Audit 未 PASS → exit 2
        ❌ 测试未通过 → exit 2
        ✅ 全部通过 → 继续 Step 8
Step 8: 提交 PR
    ├─ 版本号更新 (semver)
    ├─ git commit + push
    └─ gh pr create

    Stop Hook 检查:
      ✅ PR 创建成功 → exit 0（p0 结束）
      ❌ 不检查 CI（p0 不等 CI）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CI 运行（GitHub Actions）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

version-check: 检查版本号更新
test:          L1 (typecheck + test + build) + DevGate
release-check: L3 回归 + L4 Evidence (仅 PR to main)
ci-passed:     全部通过时提示
notify-failure: CI fail 时通知 Notion

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  p1 阶段：CI Fail 修复（事件驱动）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

触发方式:
  方案 A: Notion (Status=Failed) → n8n 轮询 → cecelia-run
  方案 B: GitHub Actions notify-failure → curl VPS → cecelia-run
  方案 C: VPS cron 轮询 → cecelia-run

Step 9: CI 修复循环
    ├─ 阶段检测: PHASE=p1
    ├─ 拉取 CI 失败详情: gh pr checks <PR>
    ├─ 分析失败原因 (typecheck/test/build/DevGate)
    ├─ 修复代码
    ├─ git commit + push
    └─ 尝试结束对话

    Stop Hook 检查:
      ❌ CI FAILURE → exit 2（继续修）
      ⏳ CI PENDING → exit 0（退出，等唤醒）
      ✅ CI SUCCESS → exit 0（进入 p2）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  p2 阶段：CI Pass（完成）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

auto-merge: PR approved + CI 通过 → 自动合并

Step 10: Learning (记录经验)
Step 11: Cleanup (清理分支/worktree)
```

---

## 验收清单

| 检查项 | 要求 | 实现位置 |
|--------|------|---------|
| 两阶段分离 | p0 创建 PR 后不检查 CI | hooks/stop.sh:226-246 |
| 无头语义 | p1 pending 时 exit 0 | hooks/stop.sh:260-267 |
| Stop Hook 职责 | 只检查当前阶段 | hooks/stop.sh:1-16 |
| 阶段检测 | 输出 p0/p1/p2/pending/unknown | scripts/detect-phase.sh |
| PHASE_OVERRIDE | 强制 p1 支持 | scripts/detect-phase.sh:14-25 |
| API 错误处理 | unknown → exit 0 | scripts/detect-phase.sh:34-47 |

**完整验收**: `docs/FINAL-ACCEPTANCE.md`

---

## 相关文档

- `features/feature-registry.yml` - Feature 定义（W1: Two-Phase Dev Workflow）
- `regression-contract.yaml` - RCI 契约（W1-001 ~ W1-005）
- `docs/PHASE-DETECTION.md` - 阶段检测详细说明
- `docs/PHASE-OVERRIDE.md` - PHASE_OVERRIDE 使用指南
- `docs/STOP-HOOK-SPEC.md` - Stop Hook 完整规格
- `docs/FINAL-ACCEPTANCE.md` - 最终验收清单

---

**版本**: 2.0.0
**状态**: ✅ Production Ready
**最后更新**: 2026-01-24
