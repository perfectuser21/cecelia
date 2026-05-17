# Eval Round 3 — harness-v5-e2e-test2

**verdict**: FAIL（DoD Test 3 清理逻辑缺陷）
**eval_round**: 3
**pr_url**: https://github.com/perfectuser21/cecelia/pull/2282
**fixed_in**: fix(harness): R3 — 修复 Test 3 TEMP_ID 提取包含 "INSERT 0 1" 导致 DELETE 失败

## 根本原因

`psql cecelia -t -A -c "INSERT ... RETURNING id"` 同时输出 UUID 和 "INSERT 0 1" 两行。
TEMP_ID 变量捕获了两行内容，导致后续 `DELETE FROM tasks WHERE id='$TEMP_ID'` 报错：

```
ERROR: invalid input syntax for type uuid: "735a5be1-...\nINSERT 0 1"
```

临时记录未被清理，Test 3 存在资源泄漏，判定为 FAIL。

## 修复

DoD.md Test 3 中 TEMP_ID 提取加 `| head -1`：

```bash
# 修复前
TEMP_ID=$(psql cecelia -t -A -c "... RETURNING id")

# 修复后
TEMP_ID=$(psql cecelia -t -A -c "... RETURNING id" | head -1)
```

## 测试结果（修复后）

### Test 1: active_pipelines 字段存在且为非负整数
```
PASS: active_pipelines=0，类型正确
```

### Test 2: API 值与 DB harness_planner in_progress 计数一致
```
PASS: API=0 == DB=0
```

### Test 3: 注入 harness_generator 后 API 值不变（强证伪）
```
TEMP_ID=[2b33f9ce-8bd3-4e9c-8eb6-7445ea1fe969]
DELETE 1
PASS: API 注入前=0 注入后=0 == planner_only=0 != all_harness=2
```

临时记录正确清理（DELETE 1）。
