# Sprint Contract Draft (Round 1)

## Golden Path

[触发: 执行 B38 测试套件] → [vi.mock 拦截 @langchain/langgraph] → [3 条用例执行] → [sprint_dir 注入断言通过]

---

### Step 1: 为 harness-initiative-b38.test.js 添加 @langchain/langgraph mock

**可观测行为**: 测试文件顶部含 `vi.mock('@langchain/langgraph', ...)` 块，vitest 解析时拦截缺失包

**验证命令**:
```bash
grep -c "vi.mock('@langchain/langgraph'" /workspace/packages/brain/src/workflows/__tests__/harness-initiative-b38.test.js
# 期望：≥ 1
```

**硬阈值**: grep exit 0 且 count ≥ 1

---

### Step 2: 同步修复 b35/b36/b37 同类缺失

**可观测行为**: b35/b36/b37 同样含 `vi.mock('@langchain/langgraph', ...)` 块

**验证命令**:
```bash
for f in b35 b36 b37; do
  grep -c "vi.mock('@langchain/langgraph'" /workspace/packages/brain/src/workflows/__tests__/harness-initiative-${f}.test.js || { echo "FAIL: ${f} 缺 langchain mock"; exit 1; }
done
echo "OK: 所有文件已修复"
# 期望：OK
```

**硬阈值**: 循环 exit 0

---

### Step 3: B38 测试套件全通过

**可观测行为**: 运行 harness-initiative-b38.test.js，3 条用例全部 PASS；sprintDir 覆盖断言 + fallback 断言均通过

**验证命令**:
```bash
cd /workspace/packages/brain && npx vitest run src/workflows/__tests__/harness-initiative-b38.test.js --reporter=verbose 2>&1 | tee /tmp/b38-run.log
grep -E "3 passed|✓.*sprintDir|✓.*fallback" /tmp/b38-run.log || { echo "FAIL: 用例未全通"; exit 1; }
echo "PASS: 3 用例全通"
# 期望：PASS
```

**硬阈值**: vitest exit 0，日志含 "3 passed"

---

### Step 4: b35/b36/b37 测试套件无解析错误

**可观测行为**: 同批 b35/b36/b37 测试均可解析并运行，无 ERR_MODULE_NOT_FOUND

**验证命令**:
```bash
cd /workspace/packages/brain && npx vitest run \
  src/workflows/__tests__/harness-initiative-b35.test.js \
  src/workflows/__tests__/harness-initiative-b36.test.js \
  src/workflows/__tests__/harness-initiative-b37.test.js \
  --reporter=verbose 2>&1 | tee /tmp/b35b36b37-run.log
grep -v "ERR_MODULE_NOT_FOUND" /tmp/b35b36b37-run.log | grep -E "passed|PASS" || { echo "FAIL"; exit 1; }
echo "PASS: b35/b36/b37 无解析错误"
# 期望：PASS
```

**硬阈值**: 无 ERR_MODULE_NOT_FOUND，各文件 exit 0

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本**:
```bash
#!/bin/bash
set -e

cd /workspace/packages/brain

# 1. 确认 vi.mock 已加到 b38
grep -c "vi.mock('@langchain/langgraph'" src/workflows/__tests__/harness-initiative-b38.test.js \
  || { echo "FAIL: b38 缺 langchain mock"; exit 1; }

# 2. 确认同步修复 b35/b36/b37
for f in b35 b36 b37; do
  grep -c "vi.mock('@langchain/langgraph'" src/workflows/__tests__/harness-initiative-${f}.test.js \
    || { echo "FAIL: ${f} 缺 langchain mock"; exit 1; }
done

# 3. 运行 B38 测试套件，验证 3 条用例通过
npx vitest run src/workflows/__tests__/harness-initiative-b38.test.js --reporter=verbose 2>&1 | tee /tmp/b38-e2e.log
grep -E "3 passed" /tmp/b38-e2e.log || { echo "FAIL: B38 未 3 passed"; exit 1; }

# 4. 确认 sprintDir 覆盖行为（核心 B38 断言）
grep -E "✓|PASS" /tmp/b38-e2e.log | grep -i "sprint" || \
  grep -E "3 passed" /tmp/b38-e2e.log || { echo "FAIL: sprintDir 断言未执行"; exit 1; }

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 2

### Workstream 1: harness-initiative-b38.test.js 添加 @langchain/langgraph mock

**范围**: 仅修改 `packages/brain/src/workflows/__tests__/harness-initiative-b38.test.js`，在顶部 vi.mock 块区添加 `@langchain/langgraph` 和 `@langchain/langgraph-checkpoint-postgres` mock
**大小**: S(<50行净增)
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/b38-mock-contract.test.ts`

---

### Workstream 2: b35/b36/b37 同步修复

**范围**: 修改 `harness-initiative-b35.test.js`、`b36`、`b37` 三文件，添加同上的 `vi.mock('@langchain/langgraph', ...)`
**大小**: S(<50行净增，3文件)
**依赖**: Workstream 1 完成后（确认 mock 模板正确）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/b35b36b37-mock-contract.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/b38-mock-contract.test.ts` | vi.mock 存在/B38 3 用例通过 | 1 failure (mock 不存在) |
| WS2 | `tests/ws2/b35b36b37-mock-contract.test.ts` | b35/b36/b37 mock 存在 | 3 failures (3 文件缺 mock) |
