# Sprint Contract Draft (Round 1)

## Golden Path

[构造真实 tmp 目录树] → [parsePrdNode 读取子目录 sprint-prd.md] → [defaultReadContractFile 读取子目录合同] → [合同缺失时 throw] → [验证全链路 exit 0]

---

### Step 1: 构造真实临时目录树

**可观测行为**: `os.tmpdir()` 下创建 `sprints/w45-b34-e2e/sprint-prd.md` 和 `sprints/w45-b34-e2e/sprint-contract.md`，均含伪内容。

**验证命令**:
```bash
# 验证集成测试文件存在
test -f packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js
echo $?
# 期望：0
```

**硬阈值**: 文件存在，exit 0

---

### Step 2: parsePrdNode 子目录扫描 — sprintDir 返回正确

**可观测行为**: 以 `worktreePath=<tmpdir>`, `sprint_dir='sprints'` 调用 `parsePrdNode`；函数扫描子目录，返回 `sprintDir === 'sprints/w45-b34-e2e'`，`prdContent` 与写入文件内容字面一致。

**验证命令**:
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js \
  --reporter=verbose 2>&1 | grep -E "✓|PASS|parsePrdNode.*happy path"
# 期望：匹配 ✓ 或 PASS
```

**硬阈值**: vitest 输出含 `✓`，exit 0

---

### Step 3: defaultReadContractFile 子目录扫描 — 内容字面一致

**可观测行为**: 以 `worktreePath=<tmpdir>`, `sprintDir='sprints'` 调用 `defaultReadContractFile`；函数扫描子目录找到 `sprint-contract.md`，返回内容与写入内容字面相等。

**验证命令**:
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js \
  --reporter=verbose 2>&1 | grep -E "✓|PASS|defaultReadContractFile.*subdir"
# 期望：匹配 ✓ 或 PASS
```

**硬阈值**: vitest 输出含 `✓`，exit 0

---

### Step 4: 边界 — contract 缺失时 throw

**可观测行为**: subdir 存在但无 contract 文件 → `defaultReadContractFile` throw 含 `contract file not found` 的 Error。

**验证命令**:
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js \
  --reporter=verbose 2>&1 | grep -E "✓|PASS|contract file not found"
# 期望：匹配 ✓ 或 PASS
```

**硬阈值**: vitest 输出含 `✓`，exit 0

---

### Step 5: E2E 验收 — 全套集成测试 pass

**可观测行为**: 4 个 it() 场景全部绿灯。

**验证命令**:
```bash
cd /workspace && npx vitest run packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js \
  --reporter=verbose 2>&1 | tail -5
# 期望：0 failed
```

**硬阈值**: `0 failed`，exit 0

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: dev_pipeline

**完整验证脚本**:
```bash
#!/bin/bash
set -e

# 1. 断言集成测试文件存在
test -f packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js \
  || { echo "FAIL: 集成测试文件缺失"; exit 1; }

# 2. 运行集成测试，断言全部通过
RESULT=$(cd /workspace && npx vitest run \
  packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js \
  --reporter=verbose 2>&1)
echo "$RESULT"

echo "$RESULT" | grep -qE "0 failed|Tests.*passed" \
  || { echo "FAIL: 集成测试有失败项"; exit 1; }

# 3. 断言覆盖 4 个关键场景
echo "$RESULT" | grep -q "parsePrdNode" \
  || { echo "FAIL: 缺少 parsePrdNode 场景"; exit 1; }
echo "$RESULT" | grep -q "defaultReadContractFile" \
  || { echo "FAIL: 缺少 defaultReadContractFile 场景"; exit 1; }
echo "$RESULT" | grep -q "contract file not found" \
  || { echo "FAIL: 缺少 throw 边界场景"; exit 1; }

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 1

### Workstream 1: 集成测试文件

**范围**: 新增 `packages/brain/src/__tests__/harness-sprint-subdir-detection.integration.test.js`，不 mock `node:fs/promises`，用真实 tmp 目录验证子目录检测全链路。
**大小**: S（约 120 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/integration-test-structure.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/integration-test-structure.test.ts` | 文件存在 + describe 块存在 + 4 场景覆盖 | 文件不存在时 → 2 failures |
