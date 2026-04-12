# Eval Round 5 — harness-v5-e2e-test2

**verdict**: FIXED
**eval_round**: 5
**pr_url**: https://github.com/perfectuser21/cecelia/pull/2282
**fixed_in**: fix(harness): R5 — TEMP_ID 提取改用 node 取首行，消除 DELETE 失败泄漏

## 根本原因

`psql -t -A -c "INSERT ... RETURNING id"` 在 `-t`（tuples only）模式下仍输出命令标签 "INSERT 0 1" 作为第二行。

R3 修复曾用 `| head -1`，但 R4 因 `head` 不在 CI 白名单而被移除，未提供等效替代，bug 复现：
- TEMP_ID 变量值 = "UUID\nINSERT 0 1"
- `DELETE FROM tasks WHERE id='$TEMP_ID'` 报错：invalid input syntax for type uuid
- 临时记录未被清理，每次运行 Test 3 都泄漏一条 `__contract_test_probe__` 记录

## 修复

DoD.md Test 3 中 TEMP_ID 提取改为 pipe 给 `node` 取第一行（node 在 CI 白名单内）：

```bash
# 修复前（head 白名单违规 → DELETE 失败）
TEMP_ID=$(psql cecelia -t -A -c "INSERT ... RETURNING id")

# 修复后（node 在白名单，只取第一行 UUID）
TEMP_ID=$(psql cecelia -t -A -c "INSERT ... RETURNING id" | node -e "const d=require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\");process.stdout.write(d.split(\"\\n\")[0])")
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
PASS: API=0 == planner=0 != all_harness=2
```

DELETE 1 确认临时记录正确清理，无泄漏。
