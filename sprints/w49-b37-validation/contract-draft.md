# Sprint Contract Draft (Round 1)

## Golden Path
[Planner 创建 sprint 目录] → [parsePrdNode 运行 git diff 提取 sprintDir] → [Proposer 写入正确目录] → [全程无 ENOENT，E2E 验证通过]

---

### Step 1: Planner 在正确路径创建 sprint-prd.md 并 commit

**可观测行为**: `sprints/w49-b37-validation/sprint-prd.md` 存在于 planner 分支，内容含 "Sprint PRD" 头部

**验证命令**:
```bash
git fetch origin cp-05141641-harness-prd 2>/dev/null || true
git show "origin/cp-05141641-harness-prd:sprints/w49-b37-validation/sprint-prd.md" | head -1 | grep -q "Sprint PRD" && echo "PASS" || echo "FAIL"
```

**硬阈值**: grep exit 0（文件存在且含 "Sprint PRD"）

---

### Step 2: parsePrdNode 通过 git diff 提取正确 sprintDir

**可观测行为**: `git diff --name-only origin/main HEAD -- sprints/` 输出包含 `sprints/w49-b37-validation/sprint-prd.md`，parsePrdNode 从中提取 `sprintDir = "sprints/w49-b37-validation"`

**验证命令**:
```bash
DIFF_OUT=$(git diff --name-only origin/main HEAD -- sprints/ 2>/dev/null)
echo "git diff 输出: $DIFF_OUT"
echo "$DIFF_OUT" | grep -q "sprints/w49-b37-validation/" && echo "PASS" || { echo "FAIL"; exit 1; }
```

**硬阈值**: grep exit 0（diff 输出含目标路径）

---

### Step 3: Proposer 将合同写入正确目录（sprintDir 正确传递）

**可观测行为**: `sprints/w49-b37-validation/sprint-contract.md` 存在，说明 Proposer 收到了正确的 sprintDir

**验证命令**:
```bash
test -f sprints/w49-b37-validation/sprint-contract.md && echo "PASS" || { echo "FAIL: sprint-contract.md 缺失，sprintDir 可能漂移"; exit 1; }
```

**硬阈值**: 文件存在（exit 0）

---

### Step 4: Generator/Evaluator 全程无 ENOENT 报错

**可观测行为**: Brain Docker 日志中无 `ENOENT` 错误与 `w49-b37-validation` 关联的记录

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

# 1. 验证 git diff 找到正确 sprint 目录
echo "[1/4] 验证 git diff 输出..."
DIFF_OUT=$(git diff --name-only origin/main HEAD -- sprints/ 2>/dev/null)
echo "git diff 输出: $DIFF_OUT"
echo "$DIFF_OUT" | grep -q "sprints/w49-b37-validation/" \
  || { echo "❌ FAIL: git diff 未找到 sprints/w49-b37-validation/"; exit 1; }
echo "✅ PASS: git diff 找到正确 sprint 目录"

# 2. 验证 sprint-prd.md 存在于正确路径
echo "[2/4] 验证 sprint-prd.md 存在..."
test -f sprints/w49-b37-validation/sprint-prd.md \
  || { echo "❌ FAIL: sprint-prd.md 缺失"; exit 1; }
echo "✅ PASS: sprint-prd.md 存在"

# 3. 验证 sprint-contract.md 存在（Proposer 写入正确目录 = sprintDir 正确传递）
echo "[3/4] 验证 sprint-contract.md 存在..."
test -f sprints/w49-b37-validation/sprint-contract.md \
  || { echo "❌ FAIL: sprint-contract.md 缺失（sprintDir 可能漂移）"; exit 1; }
echo "✅ PASS: sprint-contract.md 存在于正确目录"

# 4. 验证 Brain 日志无 ENOENT 关联此 sprint
echo "[4/4] 验证无 ENOENT 报错..."
ENOENT_COUNT=$(docker logs cecelia-brain 2>&1 | grep -c "ENOENT.*w49-b37-validation\|w49-b37-validation.*ENOENT" || echo 0)
[ "${ENOENT_COUNT:-0}" -eq 0 ] \
  || { echo "❌ FAIL: 发现 $ENOENT_COUNT 条 ENOENT 报错"; exit 1; }
echo "✅ PASS: 无 ENOENT 报错"

echo ""
echo "✅ B37 验证全部通过 — parsePrdNode git diff 逻辑生效"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: 编写并运行 B37 验证脚本

**范围**: 在 `sprints/w49-b37-validation/` 创建 `verify-b37.sh` 验证脚本，覆盖 git diff 输出、文件存在性、ENOENT 日志三项断言；运行后输出结构化结果
**大小**: S(<100行)
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/verify-b37.test.ts`

---

## Workstreams 切分说明

净增代码量：`verify-b37.sh` ~50 行，`tests/ws1/verify-b37.test.ts` ~80 行，共 ~130 行，< 200 行阈值，1 个 workstream 足够。

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/verify-b37.test.ts` | git diff 输出含路径、sprint-prd.md 存在、sprint-contract.md 存在（运行时验证）、ENOENT 计数为 0 | WS1 → 1-2 failures（sprint-contract.md 在测试时不存在） |
