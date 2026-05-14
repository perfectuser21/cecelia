# Sprint Contract Draft (Round 4)

## Golden Path
[Planner commit sprint-prd.md] → [parsePrdNode git diff 提取 sprintDir] → [Proposer 写 sprint-contract.md 到正确目录] → [Generator 创建 verify-b37.sh] → [Evaluator 跑验证脚本，全程无 ENOENT]

---

## 预条件（Planner + Proposer 已完成，非 Generator 任务）

以下条件在 Generator 运行前已为真，Generator 不负责创建这些文件：

**预条件 P1**: `sprints/w49-b37-validation/sprint-prd.md` 存在（planner 产出）
```bash
test -f sprints/w49-b37-validation/sprint-prd.md && echo "PASS: sprint-prd.md 存在" || { echo "FAIL"; exit 1; }
```

**预条件 P2**: `sprints/w49-b37-validation/sprint-contract.md` 存在（proposer 产出，parsePrdNode B37 fix 生效的证明）
```bash
test -f sprints/w49-b37-validation/sprint-contract.md && echo "PASS: sprint-contract.md 存在" || { echo "FAIL: sprintDir 漂移，Proposer 未写入正确目录"; exit 1; }
```

**预条件 P3**: `git diff --name-only origin/main HEAD -- sprints/` 输出含目标路径
```bash
DIFF_OUT=$(git diff --name-only origin/main HEAD -- sprints/ 2>/dev/null)
echo "$DIFF_OUT" | grep -q "sprints/w49-b37-validation/" && echo "PASS: git diff 找到正确 sprint 目录" || { echo "FAIL"; exit 1; }
```

---

## Generator 任务（唯一任务）

### Step 1: 创建 verify-b37.sh 验证脚本

**可观测行为**: `sprints/w49-b37-validation/verify-b37.sh` 存在，内含 ≥4 条 `✅ PASS` 断言，`bash verify-b37.sh` exit 0 且输出 "B37 验证全部通过"

**验证命令**:
```bash
# 1. 文件存在
test -f sprints/w49-b37-validation/verify-b37.sh || { echo "FAIL: verify-b37.sh 缺失"; exit 1; }

# 2. 脚本运行 exit 0 且输出预期字符串（运行时验证，取代静态 grep 计数）
OUTPUT=$(bash sprints/w49-b37-validation/verify-b37.sh 2>&1)
echo "$OUTPUT" | grep -q "B37 验证全部通过" && echo "PASS" || { echo "FAIL: 未输出预期摘要"; exit 1; }
```

**硬阈值**: 文件存在 + 脚本 exit 0 + 输出含 "B37 验证全部通过"（PASS 断言计数由 [BEHAVIOR] 3 运行时校验）

---

### Step 2: 全程无 ENOENT 报错

**可观测行为**: Brain Docker 日志（动态查找容器名）无 `ENOENT` 与 `w49-b37-validation` 关联的记录

**验证命令**:
```bash
BRAIN_CTR=$(docker ps --filter name=brain --format "{{.Names}}" | head -1)
if [ -z "$BRAIN_CTR" ]; then
  echo "SKIP: brain 容器未运行，跳过 ENOENT 检查"
  exit 0
fi
ENOENT_COUNT=$(docker logs "$BRAIN_CTR" 2>&1 | grep -c "ENOENT.*w49-b37-validation\|w49-b37-validation.*ENOENT" || echo 0)
[ "${ENOENT_COUNT:-0}" -eq 0 ] && echo "PASS: 无 ENOENT" || { echo "FAIL: 发现 $ENOENT_COUNT 条 ENOENT"; exit 1; }
```

**硬阈值**: ENOENT 计数 = 0（若 brain 容器未运行则 SKIP）

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: dev_pipeline

**完整验证脚本**:
```bash
#!/bin/bash
set -e

echo "=== B37 验证：git diff 确定性找 sprint 目录 ==="

# 预条件 P1：sprint-prd.md 存在（planner 写入正确路径）
echo "[P1] 验证 sprint-prd.md 存在..."
test -f sprints/w49-b37-validation/sprint-prd.md \
  || { echo "❌ FAIL: sprint-prd.md 缺失"; exit 1; }
echo "✅ PASS: sprint-prd.md 存在"

# 预条件 P2：sprint-contract.md 存在（Proposer 写入正确目录，parsePrdNode B37 fix 生效）
echo "[P2] 验证 sprint-contract.md 存在..."
test -f sprints/w49-b37-validation/sprint-contract.md \
  || { echo "❌ FAIL: sprint-contract.md 缺失（sprintDir 漂移）"; exit 1; }
echo "✅ PASS: sprint-contract.md 存在于正确目录"

# 预条件 P3：git diff 找到正确路径（B37 fix 的直接验证）
echo "[P3] 验证 git diff 输出..."
DIFF_OUT=$(git diff --name-only origin/main HEAD -- sprints/ 2>/dev/null)
echo "git diff 输出: $DIFF_OUT"
echo "$DIFF_OUT" | grep -q "sprints/w49-b37-validation/" \
  || { echo "❌ FAIL: git diff 未找到 sprints/w49-b37-validation/"; exit 1; }
echo "✅ PASS: git diff 找到正确 sprint 目录"

# Generator 任务 G1：verify-b37.sh 存在
echo "[G1] 验证 verify-b37.sh 存在..."
test -f sprints/w49-b37-validation/verify-b37.sh \
  || { echo "❌ FAIL: verify-b37.sh 缺失"; exit 1; }
echo "✅ PASS: verify-b37.sh 存在"

# Generator 任务 G2：verify-b37.sh 运行通过且输出预期字符串（与 Step 1 验证命令一致）
echo "[G2] 运行 verify-b37.sh..."
G2_OUTPUT=$(bash sprints/w49-b37-validation/verify-b37.sh 2>&1) \
  || { echo "❌ FAIL: verify-b37.sh 运行失败"; echo "$G2_OUTPUT"; exit 1; }
echo "$G2_OUTPUT" | grep -q "B37 验证全部通过" \
  || { echo "❌ FAIL: verify-b37.sh 未输出 'B37 验证全部通过'"; echo "$G2_OUTPUT"; exit 1; }
echo "✅ PASS: verify-b37.sh 运行通过且含预期字符串"

# Generator 任务 G3：Brain 日志无 ENOENT（动态查找容器名）
echo "[G3] 验证 Brain 日志无 ENOENT..."
BRAIN_CTR=$(docker ps --filter name=brain --format "{{.Names}}" | head -1)
if [ -z "$BRAIN_CTR" ]; then
  echo "⚠️  SKIP: brain 容器未运行，跳过 ENOENT 检查"
else
  ENOENT_COUNT=$(docker logs "$BRAIN_CTR" 2>&1 | grep -c "ENOENT.*w49-b37-validation\|w49-b37-validation.*ENOENT" || echo 0)
  [ "${ENOENT_COUNT:-0}" -eq 0 ] \
    || { echo "❌ FAIL: 发现 $ENOENT_COUNT 条 ENOENT 报错"; exit 1; }
  echo "✅ PASS: 无 ENOENT 报错"
fi

echo ""
echo "✅ B37 验证全部通过 — parsePrdNode git diff 逻辑生效"
```

**通过标准**: 脚本 exit 0

---

## 已注册风险

| 风险 | 可能性 | 缓解 |
|---|---|---|
| docker 命令在 evaluator 环境不可用 | 中 | BRAIN_CTR 为空时 SKIP ENOENT 检查，不因此 fail |
| Brain 容器名不含 "brain" | 低 | 用 `--filter name=brain` 模糊匹配，返回第一条 |
| git diff 返回空（worktreePath 为空） | 低 | PRD ASSUMPTION 声明 worktreePath 非空；空时 B37 兜底逻辑不崩溃 |

---

## Workstreams

workstream_count: 1

### Workstream 1: 创建 verify-b37.sh 验证脚本

**范围**: 在 `sprints/w49-b37-validation/` 创建 `verify-b37.sh`，含 4+ 断言（git diff 输出、sprint-contract.md 存在、脚本自身运行、无 ENOENT）；脚本运行 exit 0 输出 "B37 验证全部通过"
**大小**: S(<100行)
**依赖**: 无（预条件 P1/P2 由 Planner/Proposer 提前满足）
**净增 LoC 估算**: verify-b37.sh ~60 行 + tests ~50 行 = 110 行 < 200 行阈值

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（均在 contract-dod-ws1.md 内嵌 manual:bash） | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/b37-validation.test.ts` | verify-b37.sh 存在、脚本运行 exit 0、输出含预期字符串、PASS 标记 ≥4 | WS1 → 3 failures（文件不存在时） |
