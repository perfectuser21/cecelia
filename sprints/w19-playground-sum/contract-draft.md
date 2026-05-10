# Sprint Contract Draft (Round 3)

> **Initiative**: W19 Walking Skeleton — playground 加 `GET /sum` endpoint
> **Task ID**: eaf2a56f-695e-46bb-ab2f-04387f8427f4
> **Source PRD**: `sprints/w19-playground-sum/sprint-prd.md`
> **journey_type**: autonomous

---

## 上轮 Reviewer 反馈处理（Round 2 → Round 3 diff）

| 反馈 | 处理方式 | 新位置 |
|---|---|---|
| 新增「执行层风险矩阵」段，要求带表头表格 + R1-R5 五条风险 + 每条标注「触发场景 + mitigation 命令/段落 + owner」 | 新增 §6「执行层风险矩阵」，列出 R1（port 占用）/ R2（zombie spawn）/ R3（Evaluator 假绿）/ R4（npm ci 网络抖动）/ R5（cascade 失败定位） | §6（新增） |
| 把现有「造假防御原则」5 条**搬到** R3 的 mitigation 处明列（不重写，仅搬位置） | §3 末尾原"造假防御原则 5 条"删除；同 5 条原文不动地以列表形式塞进 §6 R3 行 mitigation | §3（删） + §6 R3（增） |
| E2E 脚本要按 R1（PORT 随机化）/ R2（health 起活探测 + trap EXIT）/ R4（npm ci 失败重试 1 次）补强 | §5 脚本 ① PORT 改用 `shuf -i 30000-40000 -n 1` 随机；② 起活探测沿用并补 timeout；③ `npm ci` 用 retry helper 1 次重试；④ trap EXIT 已存在，强化注释 | §5 |

后续段编号顺延：原 §6 测试代码骨架 → §7；原 §7 Red 证据 → §8；原 §8 Workstreams → §9；原 §9 Test Contract → §10。

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

> 每条 ASSERT 是一条独立可执行的 bash 断言，预设环境变量 `PORT` 已指向 spawn 起来的 playground server（§5 用 `shuf` 随机化），且 `jq` / `curl` 可用。
> Step 段只引用 `[ASSERT-ID]` + 期望；E2E 脚本（§5）按顺序串起这些 ASSERT 跑，每行注释回链 ID。
> 任一 ASSERT 命令以非 0 退出即视为该断言失败 → Evaluator FAIL。
> **造假防御 5 条已搬至 §6 风险矩阵 R3 行 mitigation**（避免重复，原文未改）。

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

> Round 3 增量：① PORT 用 `shuf` 随机化（R1）；② `npm ci` 失败时重试 1 次（R4）；③ trap EXIT 兜底 kill + health 起活探测（R2）；④ 每行末尾注释回链 §3 ASSERT ID（R5）。

```bash
#!/bin/bash
# Golden Path 端到端验收。每行末尾注释回链 §3 ASSERT ID（R5 cascade 定位用）。
# 失败定位：set -e 下退非 0 行号 + 注释 ID → 直接对照 Step。
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/playground"

# === 阶段 A: 单测套件 ===
# R4 mitigation: npm ci 失败重试 1 次（不引入 fallback / cache）
npm ci --silent || (echo "[R4] npm ci 第一次失败，重试 1 次..." >&2; sleep 2; npm ci --silent)

npm test -- --reporter=verbose 2>&1 | tee /tmp/playground-unit.log
grep -E "Tests\s+[0-9]+ passed" /tmp/playground-unit.log                          # [ASSERT-UNIT-PASSED] (a)
! grep -E "Tests\s+[0-9]+ failed" /tmp/playground-unit.log                        # [ASSERT-UNIT-PASSED] (b)
grep -E "GET /sum.*200" /tmp/playground-unit.log                                  # [ASSERT-UNIT-COVERS-SUM] (a)
grep -Ei "GET /sum.*(400|missing|invalid|error)" /tmp/playground-unit.log         # [ASSERT-UNIT-COVERS-SUM] (b)

# === 阶段 B: 真 server spawn + HTTP 端到端 ===
# R1 mitigation: PORT 随机化避开 3000 占用（并行测试 / 残留进程）
export PLAYGROUND_PORT="${PLAYGROUND_PORT:-$(shuf -i 30000-40000 -n 1)}"
PORT=$PLAYGROUND_PORT
echo "[R1] 随机分配 PORT=$PORT"

NODE_ENV=production node server.js &
SERVER_PID=$!
# R2 mitigation: trap EXIT 兜底 kill（含 zombie / 异常退出）
trap "kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true" EXIT

# R2 mitigation: 起活探测（最多 10s）— health 失败即视为 spawn 失败 → set -e 让脚本退出
SPAWN_OK=0
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    SPAWN_OK=1
    break
  fi
  sleep 0.5
done
[ "$SPAWN_OK" = "1" ] || { echo "[R2] server spawn 失败：10s 内 /health 不可达 (PID=$SERVER_PID 可能已 zombie)"; exit 1; }

curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.ok == true' >/dev/null         # [ASSERT-HEALTH-INTACT] (起活探测确认)

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

## §6 执行层风险矩阵

> Reviewer round 2 反馈要求：除 spec 层外，把执行层（server spawn / 网络 / 假绿 / cascade 定位）的风险显式列出，每条标注「触发场景 + mitigation 命令/段落 + owner」。

| ID | 风险场景 | 触发条件 | Mitigation | Owner |
|----|---------|---------|-----------|------|
| **R1** | port 3000 被占用 | 并行测试 / 上轮残留进程 / CI runner 复用 | §5 阶段 B 用 `PLAYGROUND_PORT="${PLAYGROUND_PORT:-$(shuf -i 30000-40000 -n 1)}"` 随机化端口；起 server 后 20×0.5s 循环探活 `curl /health`，失败即视为 spawn 失败 → `set -e` 退出 | Evaluator |
| **R2** | server spawn 后崩溃但 PID 仍存在（zombie） | `NODE_ENV=production` 下静默 throw / `app.listen` 异常未传播 / express middleware 同步异常 | §5 用 `trap "kill $SERVER_PID 2>/dev/null \|\| true; wait $SERVER_PID 2>/dev/null \|\| true" EXIT` 兜底 kill；起活探测 `curl -fsS /health` 必须在 10s 内返回 200，否则 `[ "$SPAWN_OK" = "1" ] \|\| exit 1` | Evaluator |
| **R3** | Evaluator 假绿（404 / HTML / NaN / 0-test） | Generator 提交空 PR / stub `res.status(200).send('OK')` 实现 / 测试套件 0 用例假 PASS | **造假防御 5 条**（原 §3 末尾搬至此处，原文未改）：<br>① 所有 curl 带 `-f`：HTTP 非 2xx 自动退 22（防 "404 也算通过"）<br>② 所有 JSON 断言用 `jq -e`：解析失败或表达式 false 即非 0 退出（防 "返回 HTML 也算通过"）<br>③ 严格相等用 `==`：防 `{"sum":"5"}` 字符串作弊<br>④ error 路径显式 `has("sum") \| not`：防 `{"sum":NaN,"error":"..."}` 模糊态<br>⑤ 单测断言 `Tests N passed` 且 `not Tests N failed`：防 0-test 假绿 | Evaluator |
| **R4** | `npm ci` 网络抖动 | 离线 / npm registry 不可达 / IPv6 路由抽风 | §5 阶段 A 用 `npm ci --silent \|\| (echo "[R4] 重试..."; sleep 2; npm ci --silent)`：失败重试 1 次；仍失败即 FAIL（**不引入 cache fallback / mirror fallback**，避免假绿） | Evaluator |
| **R5** | cascade 失败导致定位困难 | E2E 第 N 行红，看不出是 spawn 失败 / npm ci 失败 / 单测断言失败 / HTTP 断言失败 | §5 每条断言行末尾注释 `# [ASSERT-XXX]` 回链 §3 ID；`set -euo pipefail` 让 bash 直接报错具体行号；spawn / npm ci 失败有专用 `[R1]` / `[R2]` / `[R4]` echo 标记区分阶段 | Reviewer |

**Owner 含义**：
- **Evaluator**：跑验证脚本时必须遵守该 mitigation（已写入 §5 脚本）
- **Reviewer**：审合同时必须确认该 mitigation 已落实（不漏审）
- **Generator**：实现代码时必须遵守该 mitigation（本 sprint 无此项 — 全部 mitigation 落在 Evaluator/Reviewer 侧）

---

## §7 测试代码骨架（内嵌可视化 — 直接来自 `tests/ws1/sum.test.js`）

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

## §8 Red 证据来源声明（为什么这些 expect 必 FAIL）

**当前主分支事实**（截至 round 2/3 起草时刻 — round 3 未改 server.js / 测试文件）：

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

**Red 失败矩阵**（在主分支 / proposer 分支当下跑 §7 测试时）：

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

**Round 2 实跑结果**（沿用 — round 3 未动测试 / server.js）：

```
Test Files  1 failed | 1 passed (2)
      Tests  7 failed | 2 passed (9)
```

7 FAIL（T1–T7 全 `expected 404 to be 200/400`）+ 2 PASS（T8 `/health` 回归 + 主测试文件原有 `/health`）→ 满足 Red ≥ 5 阈值。

---

## §9 Workstreams

workstream_count: 1

### Workstream 1: 加 `GET /sum` 路由 + 单测 + README

- **范围**：
  - `playground/server.js`：在 `/health` 路由之后、`app.listen` 之前新增 `GET /sum` handler，处理 happy / 缺参 / 非数字 / 负数 / 小数 / 零，返回 JSON。
  - `playground/tests/server.test.js`：保留现有 `/health` 用例不动，新增 `/sum` happy + 至少 2 个 error case（Generator 阶段把 §7 的 8 个 `test()` 块原样合并进来）。
  - `playground/README.md`：把"端点"段把 `/sum` 从"不在 bootstrap 范围"改为已实现，给一个示例 curl + 响应。
- **大小**：S（< 100 行净增）
- **依赖**：无
- **BEHAVIOR 覆盖测试文件**：`sprints/w19-playground-sum/tests/ws1/sum.test.js`

---

## §10 Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（按 §7 T-ID） | 预期 Red 证据 |
|---|---|---|---|
| WS1 | `sprints/w19-playground-sum/tests/ws1/sum.test.js` | T1 happy / T2 缺 b / T3 双缺 / T4 非数字+无 sum / T5 负数 / T6 小数 / T7 双零 / T8 /health 回归 | **7 failures**（T1–T7 全 FAIL，T8 PASS）→ 满足 Reviewer ≥ 5 阈值 |

**Red 证据采集命令**：见 §8 末尾「Proposer 自验命令」。
