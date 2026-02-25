---
id: stop-hook-spec
version: 1.0.0
created: 2026-01-24
updated: 2026-01-24
status: DEPRECATED
changelog:
  - 1.0.0: Stop Hook 两阶段分离规格说明
---

# ⚠️ DEPRECATED - Stop Hook 规格说明

**本文档已过时。请使用 v10.0.0 权威文档：**
- **权威**: [`docs/contracts/WORKFLOW-CONTRACT.md`](./contracts/WORKFLOW-CONTRACT.md)
- **权威**: [`docs/contracts/QUALITY-CONTRACT.md`](./contracts/QUALITY-CONTRACT.md)

**不要使用本文档**。v10.0.0 Contract Rebase 后，所有流程规格以 contracts/ 下的文档为准。

---

# Stop Hook 规格说明（已废弃描述）

**核心原则**: Stop Hook 只做"本阶段的结束条件检查"，不跨阶段

---

## 规则 1: 阶段检测优先

Stop Hook 每次触发时，首先检测当前阶段：

```bash
PHASE=$(bash scripts/detect-phase.sh | grep "^PHASE:" | awk '{print $2}')
```

根据阶段执行不同的检查逻辑。

---

## 规则 2: p0 阶段 - 只检查到 PR 创建

### 检查范围

```
Step 7: 质检检查
  - Audit 报告存在
  - Audit Decision: PASS
  - 测试通过 (.quality-gate-passed)

Step 8: PR 创建检查
  - PR 是否已创建

❌ 不检查: CI 状态（p0 不等待 CI）
```

### 结束条件

```bash
if PHASE == p0:
    if 质检通过 AND PR 已创建:
        exit 0  # 立即结束，不检查 CI
    else:
        exit 2  # 继续（质检 或 创建 PR）
```

### 典型流程

```
迭代 1: 写代码 → 尝试结束
        → 质检未通过 → exit 2

迭代 2: 修复 → 运行 qa:gate → 尝试结束
        → 质检通过，PR 未创建 → exit 2

迭代 3: 创建 PR → 尝试结束
        → 质检通过，PR 已创建 → exit 0
        → 会话结束 ✅（不等待 CI）
```

---

## 规则 3: p1 阶段 - 检查 CI 状态（事件驱动）

### 检查范围

```
Step 7: 质检检查（同 p0）
Step 8: PR 存在检查
Step 9: CI 状态检查  ← p1 才检查 CI
  - CI fail → exit 2（继续修）
  - CI pending → exit 0（退出，等下次唤醒）
  - CI pass → exit 0（结束）
```

### 结束条件

```bash
if PHASE == p1:
    if 质检通过 AND PR 已创建:
        check CI:
            if CI == FAILURE:
                exit 2  # 继续修复
            if CI == PENDING:
                exit 0  # 退出，等下次唤醒（不挂着）
            if CI == SUCCESS:
                exit 0  # 结束
    else:
        exit 2  # 继续（质检 或 PR）
```

### 典型流程（事件驱动）

```
唤醒 1: CI fail
        → 分析失败 → 修复 → push → 尝试结束
        → CI pending（刚 push，新 CI 还在跑）
        → exit 0（退出，不挂着）

（等待 CI 运行...）

唤醒 2: CI fail（新 CI 结果出来了）
        → 继续修复 → push → 尝试结束
        → CI pending
        → exit 0（退出）

（等待 CI 运行...）

唤醒 3: CI pass
        → 尝试结束
        → CI pass → exit 0
        → 会话结束 ✅（GitHub 自动 merge）
```

### 关键语义修正

| 表述 | ❌ 不准确 | ✅ 准确 |
|------|----------|---------|
| p1 循环 | "无限循环直到 CI 绿" | "事件驱动循环：每次 CI fail 唤醒，修复后退出" |
| pending 处理 | "挂着等待 CI" | "立即退出，等下次唤醒" |
| 循环次数 | "一次对话修到绿" | "多次对话，每次修一轮，直到绿" |

---

## 规则 4: p2/pending 阶段 - 直接允许结束

```bash
if PHASE == p2 OR PHASE == pending:
    exit 0  # 直接允许结束，不做检查
```

---

## 完整决策表

| 阶段 | 检查 Step 7 | 检查 Step 8 | 检查 Step 9 | 结束条件 |
|------|-----------|-----------|-----------|---------|
| p0 | ✅ 质检 | ✅ PR 创建 | ❌ 不检查 CI | 质检通过 + PR 创建 |
| p1 | ✅ 质检 | ✅ PR 存在 | ✅ CI 状态 | CI pass（fail 继续，pending 退出）|
| p2 | ❌ | ❌ | ❌ | 直接允许 |
| pending | ❌ | ❌ | ❌ | 直接允许 |

---

## 代码实现（核心逻辑）

```bash
#!/usr/bin/env bash
# hooks/stop.sh

# 1. 检测阶段
PHASE=$(bash scripts/detect-phase.sh | grep "^PHASE:" | awk '{print $2}')

# 2. Step 7: 质检检查（所有阶段共享）
check_quality() {
    # Audit 报告
    # Audit Decision: PASS
    # 测试通过
}

# 3. 阶段分支
if [[ "$PHASE" == "p0" ]]; then
    # p0: 只检查到 PR 创建
    check_quality || exit 2

    PR_NUMBER=$(gh pr list ...)
    if [[ -z "$PR_NUMBER" ]]; then
        echo "请创建 PR"
        exit 2  # 继续
    fi

    echo "p0 完成，不检查 CI"
    exit 0  # 结束

elif [[ "$PHASE" == "p1" ]] || [[ "$PHASE" == "unknown" ]]; then
    # p1: 检查 CI 状态
    check_quality || exit 2

    PR_NUMBER=$(gh pr list ...)
    if [[ -z "$PR_NUMBER" ]]; then
        exit 2  # 不应该发生（p1 必有 PR）
    fi

    CI_STATUS=$(gh pr checks ...)
    case "$CI_STATUS" in
        FAILURE|ERROR)
            echo "CI fail，继续修复"
            exit 2  # 继续修
            ;;
        PENDING|QUEUED|"")
            echo "CI pending，退出等下次唤醒"
            exit 0  # 退出（不挂着）
            ;;
        SUCCESS|PASS)
            echo "CI pass，p1 完成"
            exit 0  # 结束
            ;;
    esac

elif [[ "$PHASE" == "p2" ]] || [[ "$PHASE" == "pending" ]]; then
    # p2/pending: 直接允许
    exit 0
fi
```

---

## 防护措施

### 防止跨阶段污染

```
❌ 错误: p0 检查 CI
   → 可能在 p0 里被拖进 p1 修复循环
   → 破坏"创建 PR 后立即结束"的原则

✅ 正确: p0 只检查到 PR 创建
   → 创建 PR 后立即 exit 0
   → CI 检查留给 p1
```

### 防止挂着等待

```
❌ 错误: while CI == PENDING; do sleep 10; done
   → 挂着等待，浪费资源

✅ 正确: if CI == PENDING; exit 0
   → 立即退出，等下次唤醒（事件驱动）
```

---

## 测试验证

### p0 阶段测试

```bash
# 场景 1: 质检未通过
# 预期: exit 2（继续）

# 场景 2: 质检通过，PR 未创建
# 预期: exit 2（继续）

# 场景 3: 质检通过，PR 已创建
# 预期: exit 0（结束，不检查 CI）

# 场景 4: 质检通过，PR 已创建，CI fail（刚创建）
# 预期: exit 0（不检查 CI，立即结束）← 关键测试
```

### p1 阶段测试

```bash
# 场景 1: CI fail
# 预期: exit 2（继续修）

# 场景 2: CI pending（刚 push）
# 预期: exit 0（退出，等下次）← 关键测试

# 场景 3: CI pass
# 预期: exit 0（结束）
```

---

## 总结

| 规则 | 说明 |
|------|------|
| **阶段检测优先** | 每次触发先检测 PHASE |
| **p0 只检查到 PR** | 创建 PR 后立即结束，不检查 CI |
| **p1 才检查 CI** | CI fail 继续修，pending 退出，pass 结束 |
| **事件驱动** | 不挂着等待，每次唤醒处理一轮 |
| **两阶段分离** | p0 和 p1 互不干扰 |

---

*生成时间: 2026-01-24*
