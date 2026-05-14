# Sprint Contract Draft (Round 2)

## Golden Path
[Planner commit sprint-prd.md] → [parsePrdNode git diff 提取 sprintDir] → [Proposer 写 sprint-contract.md 到正确目录] → [Generator 创建 verify-b37.sh] → [Evaluator 跑验证脚本，全程无 ENOENT]

---

## 预条件检查（Planner 已完成，非 Generator 任务）

以下两项在 Generator 运行前已为真，作为前提验证：

**预条件 1**: git diff --name-only origin/main HEAD -- sprints/ 输出含 sprints/w49-b37-validation/
```bash
DIFF_OUT=$(git diff --name-only origin/main HEAD -- sprints/ 2>/dev/null)
echo "$DIFF_OUT" | grep -q "sprints/w49-b37-validation/" && echo "PASS: git diff 含目标路径" || { echo "FAIL: git diff 输出为空或不含目标路径"; exit 1; }
```
**硬阈值**: exit 0（B37 fix 生效的必要条件）

**预条件 2**: sprints/w49-b37-validation/sprint-prd.md 存在（planner 产出）
```bash
test -f sprints/w49-b37-validation/sprint-prd.md && echo "PASS: sprint-prd.md 存在" || { echo "FAIL: sprint-prd.md 缺失"; exit 1; }
```
**硬阈值**: exit 0

---

## Generator 任务

### Step 1: Proposer 将合同写入正确目录（sprintDir 正确传递的证明）

**可观测行为**: `sprints/w49-b37-validation/sprint-contract.md` 存在，说明 Proposer 收到了正确的 sprintDir（B37 fix 有效）

**验证命令**:
```bash
test -f sprints/w49-b37-validation/sprint-contract.md && echo "PASS" || { echo "FAIL: sprint-contract.md 缺失，sprintDir 可能漂移"; exit 1; }
```

**硬阈值**: 文件存在（exit 0）

---

### Step 2: Generator 创建 verify-b37.sh 验证脚本

**可观测行为**: `sprints/w49-b37-validation/verify-b37.sh` 存在，含 4 个 `✅ PASS` 标记，bash 运行 exit 0

**验证命令**:
```bash
# 文件存在
test -f sprints/w49-b37-validation/verify-b37.sh || { echo "FAIL: verify-b37.sh 缺失"; exit 1; }

# 含 4+ PASS 标记
PASS_COUNT=$(grep -c "✅ PASS" sprints/w49-b37-validation/verify-b37.sh || echo 0)
[ "${PASS_COUNT}" -ge 4 ] || { echo "FAIL: PASS 标记不足 4 条，实际 $PASS_COUNT"; exit 1; }

# 可执行
bash sprints/w49-b37-validation/verify-b37.sh || { echo "FAIL: verify-b37.sh 运行失败"; exit 1; }
echo "PASS"
```

**硬阈值**: 文件存在 + PASS 标记 ≥ 4 + 脚本 exit 0

---

### Step 3: 全程无 ENOENT 报错

**可观测行为**: Brain Docker 日志无 `ENOENT` 与 `w49-b37-validation` 关联的记录

**验证命令**:
```bash
ENOENT_COUNT=$(docker logs cecelia-brain 2>&1 | grep -c "ENOENT.*w49-b37-validation\|w49-b37-validation.*ENOENT" || echo 0)
[ "${ENOENT_COUNT:-0}" -eq 0 ] && echo "PASS: 无 ENOENT" || { echo "FAIL: 发现 $ENOENT_COUNT 条 ENOENT"; exit 1; }
```

**硬阈值**: ENOENT 计数 = 0

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: dev_pipeline

**完整验证脚本**:
```bash
#!/bin/bash
set -e

echo "=== B37 验证：git diff 确定性找 sprint 目录 ==="

# 预条件 1：git diff 找到正确 sprint 目录（planner B37 fix 验证）
echo "[PRE-1] 验证 git diff 输出..."
DIFF_OUT=$(git diff --name-only origin/main HEAD -- sprints/ 2>/dev/null)
echo "git diff 输出: $DIFF_OUT"
echo "$DIFF_OUT" | grep -q "sprints/w49-b37-validation/" \
  || { echo "❌ FAIL: git diff 未找到 sprints/w49-b37-validation/"; exit 1; }
echo "✅ PASS: git diff 找到正确 sprint 目录"

# 预条件 2：sprint-prd.md 存在（planner 写入正确路径）
echo "[PRE-2] 验证 sprint-prd.md 存在..."
test -f sprints/w49-b37-validation/sprint-prd.md \
  || { echo "❌ FAIL: sprint-prd.md 缺失"; exit 1; }
echo "✅ PASS: sprint-prd.md 存在"

# 验证 1：sprint-contract.md 存在（sprintDir 正确传递）
echo "[1/2] 验证 sprint-contract.md 存在..."
test -f sprints/w49-b37-validation/sprint-contract.md \
  || { echo "❌ FAIL: sprint-contract.md 缺失（sprintDir 可能漂移）"; exit 1; }
echo "✅ PASS: sprint-contract.md 存在于正确目录"

# 验证 2：verify-b37.sh 存在且运行通过
echo "[2/2] 验证 verify-b37.sh 存在并运行..."
test -f sprints/w49-b37-validation/verify-b37.sh \
  || { echo "❌ FAIL: verify-b37.sh 缺失"; exit 1; }
bash sprints/w49-b37-validation/verify-b37.sh \
  || { echo "❌ FAIL: verify-b37.sh 运行失败"; exit 1; }
echo "✅ PASS: verify-b37.sh 运行成功"

# 验证 3：Brain 日志无 ENOENT 关联此 sprint
echo "[ENOENT] 验证无 ENOENT 报错..."
ENOENT_COUNT=$(docker logs cecelia-brain 2>&1 | grep -c "ENOENT.*w49-b37-validation\|w49-b37-validation.*ENOENT" || echo 0)
[ "${ENOENT_COUNT:-0}" -eq 0 ] \
  || { echo "❌ FAIL: 发现 $ENOENT_COUNT 条 ENOENT 报错"; exit 1; }
echo "✅ PASS: 无 ENOENT 报错"

echo ""
echo "✅ B37 验证全部通过 — parsePrdNode git diff 逻辑生效"
```

**通过标准**: 脚本 exit 0

---

## 已注册风险

| 风险 | 可能性 | 缓解 |
|---|---|---|
| docker logs 命令在 evaluator 环境不可用 | 中 | ENOENT 检查降级为 "无 docker = skip"，不因此 fail E2E |
| Brain Docker 容器名不是 cecelia-brain | 低 | 在 verify-b37.sh 中用 `docker ps --filter name=brain` 动态查找 |
| worktreePath 为空导致 git diff 返回空 | 低 | 已有 ASSUMPTION 声明，git diff 空则保持原 sprintDir（B37 兜底逻辑已存在） |

---

## Workstreams

workstream_count: 1

### Workstream 1: 创建 verify-b37.sh 验证脚本

**范围**: 在 `sprints/w49-b37-validation/` 创建 `verify-b37.sh` 脚本，含 4 项断言（git diff 正确、sprint-prd.md 存在、sprint-contract.md 存在、无 ENOENT）；运行后所有断言通过
**大小**: S(<100行)
**依赖**: 无
**净增 LoC 估算**: verify-b37.sh ~55 行，tests/ws1/verify-b37.test.ts ~40 行，共 ~95 行 < 200 行阈值

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（均在 contract-dod-ws1.md 内嵌 manual:bash） | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/verify-b37.test.ts` | sprint-contract.md 存在、verify-b37.sh 存在并含 ≥4 PASS | WS1 → 2 failures（测试时两文件均不存在） |
