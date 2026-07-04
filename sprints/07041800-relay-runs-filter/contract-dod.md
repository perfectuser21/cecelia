# Contract DoD: relay-runs 过滤与详情

**Sprint**: 07041800-relay-runs-filter
**Task ID**: c66bbedc-5804-4d53-9eb9-4385d0b8d325
**版本**: v1（Proposer 首轮草稿）
**日期**: 2026-07-04

---

## DoD 检查清单（5 条铁律）

### 铁律1：phase 枚举白名单与 migration 312 完全一致

**可验证断言**：
- 路由实现中 `ALLOWED_PHASES` 数组包含且仅包含以下 10 个值（顺序不限）：
  `'A_planning', 'A_contract', 'B_task_loop', 'C_final_e2e', 'done', 'failed', 'planning', 'gan', 'generate', 'evaluate'`
- 单测必须明确断言 `ALLOWED_PHASES` 数组长度 == 10，且逐项检查每个枚举值存在
- migration 312 文件中 CHECK 约束的枚举值集合与上述数组完全相等（grep 可验证两者 diff 为空）

**验证命令**：
```bash
# 从路由文件提取 ALLOWED_PHASES
grep -A 20 "ALLOWED_PHASES" packages/brain/src/routes/initiatives.js | head -20

# 从 migration 文件提取 CHECK 枚举
grep -A 5 "CHECK" packages/brain/migrations/312_*.sql 2>/dev/null || \
grep -r "A_planning.*A_contract" packages/brain/migrations/ | head -5
```

**通过标准**：单测中 `ALLOWED_PHASES` 集合 === migration CHECK 集合，diff 为空。

---

### 铁律2：两个端点均为只读，不含任何写库操作

**可验证断言**：
- `packages/brain/src/routes/initiatives.js` 中处理 `/relay-runs` 路径的所有代码段，不含 `INSERT`、`UPDATE`、`DELETE`、`pool.query` 调用中含上述关键字的 SQL 字符串
- 单测中 mock 的 `mockPool.query` 不会被以 INSERT/UPDATE/DELETE 为前缀的 SQL 调用

**验证命令**：
```bash
grep -n -i "INSERT\|UPDATE\|DELETE" packages/brain/src/routes/initiatives.js
# 期望：0 行输出（若有输出则 FAIL）
```

**通过标准**：grep 输出为空，或输出行均在注释中。

---

### 铁律3：所有 HTTP 响应 Content-Type 均为 application/json

**可验证断言**：
- 200 响应含 `Content-Type: application/json`
- 400 响应（无效 phase、无效 limit）含 `Content-Type: application/json`
- 404 响应（initiative_id 不存在）含 `Content-Type: application/json`
- 500 响应（DB 失败）含 `Content-Type: application/json`
- 所有响应 body 为合法 JSON（`JSON.parse` 不抛异常）

**验证命令**：
```bash
# 200
curl -I -s "http://localhost:5221/api/brain/orchestrator/relay-runs" | grep -i content-type

# 400
curl -I -s "http://localhost:5221/api/brain/orchestrator/relay-runs?phase=bad" | grep -i content-type

# 404
curl -I -s "http://localhost:5221/api/brain/orchestrator/relay-runs/00000000-0000-0000-0000-000000000000" | grep -i content-type
```

**通过标准**：所有 curl 输出均含 `application/json`。

---

### 铁律4：404 不泄露内部信息

**可验证断言**：
- `GET /relay-runs/:initiative_id`（不存在 id）响应 body 严格等于 `{ "error": "not found" }` 或仅含 `error` 字段
- 响应 body 字符串不含：`sql`、`query`、`table`、`column`、`pg`、`postgres`、`syntax`、`ERROR`（大写）、完整 UUID 以外的 id 信息
- 响应 body 中 `error` 字段值不含原始 Error message（即 `err.message` 不直接暴露）

**验证命令**：
```bash
RESP=$(curl -s "http://localhost:5221/api/brain/orchestrator/relay-runs/00000000-0000-0000-0000-000000000000")
echo $RESP | python3 -c "
import sys, json
r = json.load(sys.stdin)
assert list(r.keys()) == ['error'], f'extra keys: {list(r.keys())}'
assert r['error'] == 'not found', f'unexpected error msg: {r[\"error\"]}'
print('INV-4 OK')
"
```

**通过标准**：断言全部通过，输出 `INV-4 OK`。

---

### 铁律5：列表端点向后兼容（不带 ?phase 行为不变）

**可验证断言**：
- `GET /relay-runs`（不带 phase 参数）执行的 SQL 不含 `phase` 过滤条件
- `GET /relay-runs?limit=10`（不带 phase）返回 ≤ 10 条 v2 runs，SQL 参数含 10，不含 phase 条件
- 默认 limit=20：不带任何参数时 SQL 参数含 20
- 单测中验证：带 phase 时 SQL 含 `WHERE ... phase=$N`；不带 phase 时 SQL 不含 `phase` 关键字（或含但无 WHERE phase 绑定参数）

**验证命令**：
```bash
# 不带 phase，正常返回
curl -s "http://localhost:5221/api/brain/orchestrator/relay-runs" | python3 -c "
import sys, json
runs = json.load(sys.stdin)
assert isinstance(runs, list), 'not array'
print(f'backward-compat OK: {len(runs)} runs')
"

# 带 limit 不带 phase
curl -s "http://localhost:5221/api/brain/orchestrator/relay-runs?limit=5" | python3 -c "
import sys, json
runs = json.load(sys.stdin)
assert isinstance(runs, list)
assert len(runs) <= 5
print('limit-only OK')
"
```

**通过标准**：两个命令均成功输出，无 AssertionError。

---

## 总体通过门槛

全部 5 条铁律均通过（5/5）方可合并 PR。任意一条失败，对应功能视为未完成。

| 铁律 | 描述 | 验证方式 | 状态 |
|------|------|---------|------|
| INV-1 | phase 枚举与 migration 一致 | 单测 + grep | 待验 |
| INV-2 | 只读，无写库操作 | grep + 单测 | 待验 |
| INV-3 | Content-Type: application/json | curl -I + 单测 | 待验 |
| INV-4 | 404 不泄露内部信息 | curl + python3 断言 | 待验 |
| INV-5 | 向后兼容，不带 phase 行为不变 | 单测 SQL 断言 | 待验 |
