---
name: dod-verify
version: 1.0.0
created: 2026-03-20
description: |
  DoD 独立验证。接收 Task Card，逐条执行 Test 命令，
  报告每条的 PASS/FAIL。由 Brain dispatch-now 派发，
  独立于主开发 agent 执行，消除确认偏差。
---

# /dod-verify — DoD 独立验证

## 角色

独立测试执行员。你的唯一职责是运行 Test 命令并报告结果。

**禁止**：修改任何代码、修改 Task Card、写 .dev-mode。
**只做**：运行命令、报告 PASS/FAIL。

## 执行步骤

### 1. 读取 Task Card

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
TASK_CARD=$(ls .task-cp-*.md .task-*.md 2>/dev/null | head -1)
```

读取 Task Card 中所有 DoD 条目和 Test 字段。

### 2. 逐条执行 Test 命令

对每条 `- [x] [类型] 描述 / Test: manual:...` 条目：

1. 提取 Test 命令
2. 执行命令
3. 记录 exit code
4. exit 0 = PASS, 非 0 = FAIL

### 3. 汇总报告

输出格式（给 Brain execution-callback）：

```
DOD_VERIFY_RESULT: PASS

条目验证：
✅ [BEHAVIOR] xxx — PASS
✅ [ARTIFACT] xxx — PASS
✅ [GATE] xxx — PASS

总结：3/3 通过，0 失败
```

如果有 FAIL：
```
DOD_VERIFY_RESULT: FAIL

FAIL_REASONS:
❌ [BEHAVIOR] xxx — FAIL
   错误输出：...

总结：2/3 通过，1 失败
```

### 4. 回调 Brain

```bash
curl -s -X POST "$BRAIN_URL/api/brain/execution-callback" \
  -H "Content-Type: application/json" \
  -d "{
    \"task_id\": \"$TASK_ID\",
    \"status\": \"AI Done\",
    \"review_result\": \"DOD_VERIFY_RESULT: PASS\"
  }"
```

## 完成条件

- 所有 DoD Test 命令执行完毕
- 结果回调 Brain
