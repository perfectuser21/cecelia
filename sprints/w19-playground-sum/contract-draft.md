# Sprint Contract Draft (Round 1)

> **Initiative**: W19 Walking Skeleton — playground 加 `GET /sum` endpoint
> **Task ID**: eaf2a56f-695e-46bb-ab2f-04387f8427f4
> **Source PRD**: `sprints/w19-playground-sum/sprint-prd.md`
> **journey_type**: autonomous

---

## §1 Golden Path

[HTTP 客户端发 `GET /sum?a=2&b=3`]
→ [playground server 解析 query 参数 a/b，校验为合法数字，计算 a+b]
→ [客户端收到 HTTP 200，body 为 `{"sum":5}`]

边界 / 副 path（同一 endpoint 上的非 happy 路径）：
- 缺参（a 或 b 任一缺失）→ 400 + 非空 `error` 字段
- 非数字（`a=abc`）→ 400 + 非空 `error` 字段，body 不含 `sum`
- 负数 / 零 / 小数 → 200 + 算术结果
- 现有 `GET /health` 行为不被破坏

---

## §2 journey_type

**autonomous** — playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议。

---

## §3 Golden Path Steps（含验证命令）

### Step 1：客户端发起请求

**可观测行为**：playground server 在 $PLAYGROUND_PORT 监听，HTTP GET /sum?a=2&b=3 可到达并返回 JSON。

**验证命令**：
```bash
cd playground && PLAYGROUND_PORT=30011 node server.js &
SPID=$!; sleep 2
curl -f "localhost:30011/sum?a=2&b=3" | jq -e '.sum == 5'
kill $SPID
```
**硬阈值**：curl exit 0，`.sum == 5` 返回 `true`

---

### Step 2：server 解析 query 参数并求和，返回严格 schema

**可观测行为**：server 返回 `{ "sum": <number> }`，keys 恰好为 `["sum"]`，禁用字段（total/result/answer）不出现。

**验证命令**：
```bash
cd playground && PLAYGROUND_PORT=30012 node server.js &
SPID=$!; sleep 2
RESP=$(curl -fs "localhost:30012/sum?a=2&b=3")
echo "$RESP" | jq -e '.sum == 5'
echo "$RESP" | jq -e '.sum | type == "number"'
echo "$RESP" | jq -e 'keys == ["sum"]'
echo "$RESP" | jq -e 'has("total") | not'
echo "$RESP" | jq -e 'has("result") | not'
kill $SPID
```
**硬阈值**：所有 jq -e 命令 exit 0

---

### Step 3：非法输入返 400 + error 字段，body 不含 sum

**可观测行为**：a 缺失 / 非数字时 server 返回 HTTP 400，body 含非空字符串 `error` 字段，且 body 不含 `sum` 字段。

**验证命令**：
```bash
cd playground && PLAYGROUND_PORT=30013 node server.js &
SPID=$!; sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:30013/sum?a=2")
[ "$CODE" = "400" ] || { echo "FAIL 缺参未返 400"; kill $SPID; exit 1; }
CODE2=$(curl -s -o /dev/null -w "%{http_code}" "localhost:30013/sum?a=abc&b=3")
[ "$CODE2" = "400" ] || { echo "FAIL 非数字未返 400"; kill $SPID; exit 1; }
EBODY=$(curl -s "localhost:30013/sum?a=abc&b=3")
echo "$EBODY" | jq -e '.error | type == "string" and length > 0'
echo "$EBODY" | jq -e 'has("sum") | not'
kill $SPID
```
**硬阈值**：所有断言通过，exit 0

---

### Step 4：回归验证 /health 不受影响

**可观测行为**：`GET /health` 仍返回 HTTP 200 + `{"ok":true}`。

**验证命令**：
```bash
cd playground && PLAYGROUND_PORT=30014 node server.js &
SPID=$!; sleep 2
curl -f "localhost:30014/health" | jq -e '.ok == true'
kill $SPID
```
**硬阈值**：exit 0

---

## §4 E2E 验收脚本（Evaluator 直接执行）

**journey_type**: autonomous

```bash
#!/bin/bash
set -e
trap 'kill $SPID 2>/dev/null; true' EXIT

# ① 启动 server（随机端口，防 port 冲突）
PORT=$(shuf -i 31000-39000 -n 1)
cd playground
PLAYGROUND_PORT=$PORT node server.js &
SPID=$!

# ② 起活探测（最多等 5 秒）
for i in $(seq 1 10); do
  curl -sf "localhost:$PORT/health" > /dev/null 2>&1 && break
  sleep 0.5
  [ "$i" = "10" ] && { echo "FAIL server 未能在 5s 内就绪"; exit 1; }
done

# ③ Happy path — 字段值 + 类型 + schema 完整性
RESP=$(curl -sf "localhost:$PORT/sum?a=2&b=3")
echo "$RESP" | jq -e '.sum == 5'                    || { echo "FAIL .sum != 5"; exit 1; }
echo "$RESP" | jq -e '.sum | type == "number"'      || { echo "FAIL .sum 非 number"; exit 1; }
echo "$RESP" | jq -e 'keys == ["sum"]'              || { echo "FAIL schema 完整性失败"; exit 1; }
echo "$RESP" | jq -e 'has("total") | not'           || { echo "FAIL 禁用字段 total 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not'          || { echo "FAIL 禁用字段 result 漏网"; exit 1; }
echo "$RESP" | jq -e 'has("answer") | not'          || { echo "FAIL 禁用字段 answer 漏网"; exit 1; }

# ④ 负数 / 小数合法
echo "$(curl -sf "localhost:$PORT/sum?a=-1&b=1")" | jq -e '.sum == 0'    || { echo "FAIL 负数求和"; exit 1; }
echo "$(curl -sf "localhost:$PORT/sum?a=1.5&b=2.5")" | jq -e '.sum == 4' || { echo "FAIL 小数求和"; exit 1; }

# ⑤ Error path — 缺参 400
ECODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:$PORT/sum?a=2")
[ "$ECODE" = "400" ] || { echo "FAIL 缺参未返 400，实际: $ECODE"; exit 1; }

# ⑥ Error path — 非数字 400 + error 字段 + 不含 sum
EBODY=$(curl -s "localhost:$PORT/sum?a=abc&b=3")
echo "$EBODY" | jq -e '.error | type == "string" and length > 0' || { echo "FAIL error 字段缺失"; exit 1; }
echo "$EBODY" | jq -e 'has("sum") | not'                          || { echo "FAIL error 响应含 sum"; exit 1; }

# ⑦ 回归 /health
curl -sf "localhost:$PORT/health" | jq -e '.ok == true' || { echo "FAIL /health 回归失败"; exit 1; }

echo "✅ Golden Path 全部验证通过"
```

**通过标准**：脚本 exit 0

---

## §5 Workstreams

**workstream_count**: 1

（总净增 < 100 行，符合 v7.7 单 ws 允许条件：整 contract 净增 < 200 行）

### Workstream 1：playground 加 GET /sum 路由 + 单测 + README 更新

**范围**：
- `playground/server.js`：新增 `GET /sum` 路由（解析 a/b → 校验 → 200+{sum} 或 400+{error}）
- `playground/tests/server.test.js`：新增 /sum happy path + ≥2 error case（保留 /health 用例）
- `playground/README.md`：端点段把 /sum 从"不在 bootstrap 范围"改为已实现并给示例

**大小**：S（< 100 行）
**依赖**：无
**零新依赖**：除 express/supertest/vitest 不引入任何新包

**BEHAVIOR 覆盖测试文件**：`sprints/w19-playground-sum/tests/ws1/sum.test.js`

---

## §6 Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `sprints/w19-playground-sum/tests/ws1/sum.test.js` | happy path + 缺参 + 非数字 + 负数 + 小数 + 零 + /health 回归 | 实现前 8 failures |

---

## §7 验证命令写作规范自查

- [x] curl 全部带 `-f` flag 或 `-s -o /dev/null -w "%{http_code}"` 专取状态码
- [x] 所有 jq -e 均有具体断言，无 `echo ok` / `true` 假验证
- [x] E2E 脚本含起活探测（`/health` 轮询），防 race condition
- [x] 时间窗口：本 sprint 无数据库写入，不需要时间窗口约束
- [x] trap EXIT 确保 server 进程清理
- [x] E2E 脚本使用 shuf 随机端口，防 port 占用造假
