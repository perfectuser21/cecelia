# Sprint Contract Draft (Round 2)

> **Initiative**: W19 Walking Skeleton — playground 加 `GET /sum` endpoint
> **Task ID**: eaf2a56f-695e-46bb-ab2f-04387f8427f4
> **Source PRD**: `sprints/w19-playground-sum/sprint-prd.md`
> **journey_type**: autonomous

---

## 上轮 Reviewer 反馈处理（Round 1 → Round 2 diff）

| 反馈 | 处理方式 | 新位置 |
|---|---|---|
| (1) 测试代码骨架可视化（≥ 6 个 test 块 + 关键 expect 断言行）+ 显式声明 Red 必失败的根因 | 把 `tests/ws1/sum.test.js` 的 8 个 `test()` 标题 + 关键 `expect` 断言行**原样内嵌**到本合同 §6；并在 §7 显式声明"当前 `playground/server.js` 不含 `/sum`，express 默认 404 → 所有 `expect(200)` / `expect(400)` 必 FAIL" | §6 §7 |
| (2) Step 1-5 的 curl bash 块与 E2E 重复（internal_consistency=7 踩线） | **删除** Step 1-5 各自的 bash 块。统一抽到 §3 ASSERT 目录定义一次；Step 段只引用 ID + 期望；E2E 脚本（§5）作为 SSOT 实际执行形式，每行带 `# [ASSERT-*]` 注释回链 | §3 §4 §5 |

---

## §1 Golden Path

[HTTP 客户端发 `GET /sum?a=2&b=3`] → [playground server 解析 query 求和] → [客户端收到 HTTP 200 + body `{ "sum": 5 }`]

边界 / 副 path（同一 endpoint 上的非 happy 路径，必须同样验证）：
- 缺参 → 400 + 非空 `error` 字段
- 非数字 → 400 + 非空 `error` 字段，且 body 不含 `sum`
- 负数 / 零 / 小数 → 200 + 算术结果
- 现有 `GET /health` 行为不被破坏

---

## §2 journey_type

**autonomous** — playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议。

---

## §3 ASSERT 目录（Single Source of Truth）

> 每条 ASSERT 是一条独立可执行的 bash 断言，预设环境变量 `PORT`（默认 3000）已指向 spawn 起来的 playground server，且 `jq` / `curl` 可用。
> Step 段只引用 `[ASSERT-ID]` + 期望；E2E 脚本（§5）按顺序串起这些 ASSERT 跑，每行注释回链 ID。
> 任一 ASSERT 命令以非 0 退出即视为该断言失败 → Evaluator FAIL。

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-SUM-HAPPY]` | happy path：`a=2&b=3` → `{sum:5}` | `curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3" \| jq -e '.sum == 5' >/dev/null` | exit 0 |
| `[ASSERT-SUM-MISSING-B]` | 缺 b → 400 + 非空 error | `H=$(curl -s -o /tmp/sum-miss.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/sum-miss.json >/dev/null` | exit 0 |
| `[ASSERT-SUM-NAN]` | a 非数字 → 400 + 非空 error 且 body 不含 sum | `H=$(curl -s -o /tmp/sum-nan.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=abc&b=3"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/sum-nan.json >/dev/null && jq -e 'has("sum") \| not' /tmp/sum-nan.json >/dev/null` | exit 0 |
| `[ASSERT-SUM-NEG]` | 负数合法：`a=-1&b=1` → `{sum:0}` | `curl -fsS "http://127.0.0.1:$PORT/sum?a=-1&b=1" \| jq -e '.sum == 0' >/dev/null` | exit 0 |
| `[ASSERT-SUM-FLOAT]` | 小数合法：`a=1.5&b=2.5` → `{sum:4}` | `curl -fsS "http://127.0.0.1:$PORT/sum?a=1.5&b=2.5" \| jq -e '.sum == 4' >/dev/null` | exit 0 |
| `[ASSERT-SUM-ZERO]` | 双零合法：`a=0&b=0` → `{sum:0}` | `curl -fsS "http://127.0.0.1:$PORT/sum?a=0&b=0" \| jq -e '.sum == 0' >/dev/null` | exit 0 |
| `[ASSERT-HEALTH-INTACT]` | 回归：`/health` 仍 200 + `{ok:true}` | `curl -fsS "http://127.0.0.1:$PORT/health" \| jq -e '.ok == true' >/dev/null` | exit 0 |
| `[ASSERT-UNIT-PASSED]` | playground 单测套件全绿 | `cd playground && npm ci --silent && npm test -- --reporter=verbose 2>&1 \| tee /tmp/playground-unit.log; grep -E "Tests\s+[0-9]+ passed" /tmp/playground-unit.log && ! grep -E "Tests\s+[0-9]+ failed" /tmp/playground-unit.log` | exit 0 |
| `[ASSERT-UNIT-COVERS-SUM]` | 单测确实覆盖了 `/sum` happy + error | `grep -E "GET /sum.*200" /tmp/playground-unit.log && grep -Ei "GET /sum.*(400\|missing\|invalid\|error)" /tmp/playground-unit.log` | exit 0 |

**造假防御原则**（每条 ASSERT 都遵守）：
- 所有 curl 带 `-f`：HTTP 非 2xx 自动退 22（防 "404 也算通过"）
- 所有 JSON 断言用 `jq -e`：解析失败或表达式 false 即非 0 退出（防 "返回 HTML 也算通过"）
- 严格相等用 `==`：防 `{"sum":"5"}` 字符串作弊
- error 路径显式 `has("sum") | not`：防 `{"sum":NaN,"error":"..."}` 模糊态
- 单测断言 `Tests N passed` 且 `not Tests N failed`：防 0-test 假绿

---

## §4 Golden Path Steps（每步只引用 ASSERT ID）

> Step 段不再内嵌 bash。可执行形式见 §5 E2E 脚本。

### Step 1: 客户端发 `GET /sum?a=2&b=3`，收到 200 + `{ "sum": 5 }`
- **可观测行为**：playground server 对合法整数 query 返回 HTTP 200，body 是含 `sum` 字段的 JSON，值等于算术和。
- **断言**：`[ASSERT-SUM-HAPPY]`
- **硬阈值**：HTTP 200 + body `.sum === 5`（数值类型严格）

### Step 2: `GET /sum?a=2`（缺 b）→ 400 + 非空 `error`
- **可观测行为**：缺任一参数 → 400 + JSON `error`，**不允许** 200 + `{sum:NaN}` 或 500。
- **断言**：`[ASSERT-SUM-MISSING-B]`
- **硬阈值**：HTTP 严格 400 + `.error` 是非空字符串

### Step 3: `GET /sum?a=abc&b=3`（非数字）→ 400 + 非空 `error` 且 body 不含 `sum`
- **可观测行为**：参数无法解析为数字 → 400 + JSON `error`，**不允许** 200 / `{"sum":NaN}` / `{"sum":NaN,"error":...}`。
- **断言**：`[ASSERT-SUM-NAN]`
- **硬阈值**：HTTP 400 + `.error` 非空 + `has("sum") == false`

### Step 4: 边界数值（负数 / 零 / 小数）正常求和
- **可观测行为**：负数、零、小数都视作合法数字，server 返回 200 + 正确算术和。
- **断言**：`[ASSERT-SUM-NEG]` + `[ASSERT-SUM-FLOAT]` + `[ASSERT-SUM-ZERO]` 三条全 exit 0。
- **硬阈值**：三条断言全部 exit 0。

### Step 5: 现有 `GET /health` 不被破坏
- **可观测行为**：`/health` 仍返回 200 + `{ok:true}`。
- **断言**：`[ASSERT-HEALTH-INTACT]`
- **硬阈值**：HTTP 200 + `.ok === true`

### Step 6: 单测套件全绿（`npm test` 在 `playground/` 内）
- **可观测行为**：`playground/tests/server.test.js` 含 `/sum` happy + 至少一个 error case 全部 pass；`/health` 用例继续 pass。
- **断言**：`[ASSERT-UNIT-PASSED]` + `[ASSERT-UNIT-COVERS-SUM]`
- **硬阈值**：vitest 退出 0，日志 grep 到 `/sum.*200` 与 `/sum.*(400|error|invalid|missing)` 各 ≥ 1 行，且不含 `Tests N failed`。

---

## §5 E2E 验收脚本（最终 Evaluator 直接跑 — SSOT 可执行形式）

```bash
#!/bin/bash
# Golden Path 端到端验收。每行末尾注释回链 §3 ASSERT ID。
# 失败定位：set -e 下退非 0 行号 → 注释 ID → 直接对照 Step。
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/playground"

# === 阶段 A: 单测套件 ===
npm ci --silent
npm test -- --reporter=verbose 2>&1 | tee /tmp/playground-unit.log
grep -E "Tests\s+[0-9]+ passed" /tmp/playground-unit.log                          # [ASSERT-UNIT-PASSED] (a)
! grep -E "Tests\s+[0-9]+ failed" /tmp/playground-unit.log                        # [ASSERT-UNIT-PASSED] (b)
grep -E "GET /sum.*200" /tmp/playground-unit.log                                  # [ASSERT-UNIT-COVERS-SUM] (a)
grep -Ei "GET /sum.*(400|missing|invalid|error)" /tmp/playground-unit.log         # [ASSERT-UNIT-COVERS-SUM] (b)

# === 阶段 B: 真 server spawn + HTTP 端到端 ===
export PLAYGROUND_PORT=${PLAYGROUND_PORT:-3789}
PORT=$PLAYGROUND_PORT
NODE_ENV=production node server.js &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

# 起活探测（最多 10s）
for i in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.5
done

curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.ok == true' >/dev/null         # [ASSERT-HEALTH-INTACT] (起活探测复用)

curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3" | jq -e '.sum == 5' >/dev/null      # [ASSERT-SUM-HAPPY]

H=$(curl -s -o /tmp/sum-miss.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=2")
[ "$H" = "400" ]                                                                   # [ASSERT-SUM-MISSING-B] (a)
jq -e '.error | type == "string" and length > 0' /tmp/sum-miss.json >/dev/null     # [ASSERT-SUM-MISSING-B] (b)

H=$(curl -s -o /tmp/sum-nan.json -w '%{http_code}' "http://127.0.0.1:$PORT/sum?a=abc&b=3")
[ "$H" = "400" ]                                                                   # [ASSERT-SUM-NAN] (a)
jq -e '.error | type == "string" and length > 0' /tmp/sum-nan.json >/dev/null      # [ASSERT-SUM-NAN] (b)
jq -e 'has("sum") | not' /tmp/sum-nan.json >/dev/null                              # [ASSERT-SUM-NAN] (c)

curl -fsS "http://127.0.0.1:$PORT/sum?a=-1&b=1"   | jq -e '.sum == 0' >/dev/null   # [ASSERT-SUM-NEG]
curl -fsS "http://127.0.0.1:$PORT/sum?a=1.5&b=2.5" | jq -e '.sum == 4' >/dev/null  # [ASSERT-SUM-FLOAT]
curl -fsS "http://127.0.0.1:$PORT/sum?a=0&b=0"     | jq -e '.sum == 0' >/dev/null  # [ASSERT-SUM-ZERO]

curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.ok == true' >/dev/null         # [ASSERT-HEALTH-INTACT] (显式回归)

echo "OK Golden Path 验证通过"
```

**通过标准**：脚本 `set -e` 下 exit 0。

---

## §6 测试代码骨架（内嵌可视化 — 直接来自 `tests/ws1/sum.test.js`）

> 完整文件位于 `sprints/w19-playground-sum/tests/ws1/sum.test.js`（共 8 个 `test()` 块，58 行）。
> 下面**原样**列出每个 `test()` 标题 + 关键 `expect` 断言行（注：vitest 中 `test` 与 `it` 等价，本合同沿用 `test`）。
> Reviewer 可直接据此判断"未实现时这些 expect 必 FAIL"。

```javascript
import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /sum [BEHAVIOR]', () => {
  // T1
  test('GET /sum?a=2&b=3 → 200 + {sum:5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 5 });
    expect(typeof res.body.sum).toBe('number');
  });

  // T2
  test('GET /sum?a=2 (b 缺失) → 400 + 非空 error 字段', async () => {
    const res = await request(app).get('/sum').query({ a: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T3
  test('GET /sum (双参数都缺) → 400 + 非空 error', async () => {
    const res = await request(app).get('/sum');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T4
  test('GET /sum?a=abc&b=3 (a 非数字) → 400 + error，且 body 不含 sum 字段', async () => {
    const res = await request(app).get('/sum').query({ a: 'abc', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'sum')).toBe(false);
  });

  // T5
  test('GET /sum?a=-1&b=1 → 200 + {sum:0} (负数合法)', async () => {
    const res = await request(app).get('/sum').query({ a: '-1', b: '1' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 0 });
  });

  // T6
  test('GET /sum?a=1.5&b=2.5 → 200 + {sum:4} (小数合法)', async () => {
    const res = await request(app).get('/sum').query({ a: '1.5', b: '2.5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 4 });
  });

  // T7
  test('GET /sum?a=0&b=0 → 200 + {sum:0} (零合法)', async () => {
    const res = await request(app).get('/sum').query({ a: '0', b: '0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 0 });
  });

  // T8
  test('GET /health 仍 200 + {ok:true} (回归)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

---

## §7 Red 证据来源声明（为什么这些 expect 必 FAIL）

**当前主分支事实**（截至 round 2 起草时刻）：

`playground/server.js` 实际内容（共 14 行）：
```javascript
import express from 'express';
const app = express();
const PORT = process.env.PLAYGROUND_PORT || 3000;
app.get('/health', (req, res) => { res.json({ ok: true }); });   // 仅有 /health
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`playground listening on ${PORT}`));
}
export default app;
```

**关键事实**：**没有任何 `app.get('/sum', ...)` 注册**。Express 对未注册路由默认行为是返回 HTTP **404** + `Cannot GET /sum`（text/html）。

**Red 失败矩阵**（在主分支 / proposer 分支当下跑 §6 测试时）：

| Test ID | 期望状态 | 实际状态（无 /sum 路由） | 失败行 | 结论 |
|---|---|---|---|---|
| T1 | `expect(res.status).toBe(200)` | 404 | status 断言 | **FAIL** |
| T2 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T3 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T4 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T5 | `expect(res.status).toBe(200)` | 404 | status 断言 | **FAIL** |
| T6 | `expect(res.status).toBe(200)` | 404 | status 断言 | **FAIL** |
| T7 | `expect(res.status).toBe(200)` | 404 | status 断言 | **FAIL** |
| T8 | `expect(res.status).toBe(200)` | 200（`/health` 仍存在） | — | **PASS**（回归基线） |

**预期 Red 总数**：**7 FAIL + 1 PASS**（≥ Reviewer 设定的 5 failures 阈值）。

**Proposer 自验命令**（commit 前 Proposer 实跑确认 — 已实跑）：
```bash
cd playground
# 复制时把"从 sprint dir 看 server.js"的 4 层相对路径改写成"从 playground/tests 看"的 1 层
cp ../sprints/w19-playground-sum/tests/ws1/sum.test.js tests/_sum_red_probe.test.js
sed -i 's|../../../../playground/server.js|../server.js|' tests/_sum_red_probe.test.js
npx vitest run --reporter=verbose 2>&1 | tee /tmp/ws1-red.log || true
rm -f tests/_sum_red_probe.test.js
# 期望：Tests {N>=5} failed
grep -E "Tests\s+[0-9]+ failed" /tmp/ws1-red.log
```

**Round 2 实跑结果**（本轮 Proposer 已执行）：

```
Test Files  1 failed | 1 passed (2)
      Tests  7 failed | 2 passed (9)
```

7 FAIL（T1–T7 全 `expected 404 to be 200/400`）+ 2 PASS（T8 `/health` 回归 + 主测试文件原有 `/health`）→ 满足 Red ≥ 5 阈值。

---

## §8 Workstreams

workstream_count: 1

### Workstream 1: 加 `GET /sum` 路由 + 单测 + README

- **范围**：
  - `playground/server.js`：在 `/health` 路由之后、`app.listen` 之前新增 `GET /sum` handler，处理 happy / 缺参 / 非数字 / 负数 / 小数 / 零，返回 JSON。
  - `playground/tests/server.test.js`：保留现有 `/health` 用例不动，新增 `/sum` happy + 至少 2 个 error case（Generator 阶段把 §6 的 8 个 `test()` 块原样合并进来）。
  - `playground/README.md`：把"端点"段把 `/sum` 从"不在 bootstrap 范围"改为已实现，给一个示例 curl + 响应。
- **大小**：S（< 100 行净增）
- **依赖**：无
- **BEHAVIOR 覆盖测试文件**：`sprints/w19-playground-sum/tests/ws1/sum.test.js`

---

## §9 Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（按 §6 T-ID） | 预期 Red 证据 |
|---|---|---|---|
| WS1 | `sprints/w19-playground-sum/tests/ws1/sum.test.js` | T1 happy / T2 缺 b / T3 双缺 / T4 非数字+无 sum / T5 负数 / T6 小数 / T7 双零 / T8 /health 回归 | **7 failures**（T1–T7 全 FAIL，T8 PASS）→ 满足 Reviewer ≥ 5 阈值 |

**Red 证据采集命令**：见 §7 末尾「Proposer 自验命令」。
