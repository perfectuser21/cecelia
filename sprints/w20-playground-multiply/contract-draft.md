# Sprint Contract Draft (Round 1)

> **Initiative**: W20 Walking Skeleton — playground 加 `GET /multiply` endpoint（strict-schema）
> **Task ID**: b56c4e82-fb02-425e-aa40-89983205d671
> **Source PRD**: `sprints/w20-playground-multiply/sprint-prd.md`
> **journey_type**: autonomous
> **承前**：W19 `/sum`（PR #2875）已合并；本轮**只新增 `/multiply` 路由**，不动 `/health` 与 `/sum` 的实现/测试。

---

## §1 Golden Path

[HTTP 客户端发 `GET /multiply?a=2&b=3`] → [playground server 用 strict-schema 校验 query 参数 a/b 并相乘] → [客户端收到 HTTP 200 + body `{ "product": 6 }`]

边界 / 副 path（同一 endpoint 上的非 happy 路径，必须同样验证）：

- 缺参（`a` 或 `b` 任一缺失，含空字符串） → 400 + 非空 `error` 字段，且 body 不含 `product`
- strict-schema 拒绝（不完整匹配 `^-?\d+(\.\d+)?$`，含科学计数法 / Infinity / NaN / 前导正号 / `.5` / `5.` / 十六进制 / 千分位 / 含空格 / 非数字字符串） → 400 + 非空 `error`，且 body 不含 `product`
- 合法边界（零 / 负数 / 标准小数）→ 200 + 算术结果
- 现有 `GET /health` 与 `GET /sum`（W19）行为**不被破坏**（回归基线）

---

## §2 journey_type

**autonomous** — playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议（与 W19 同分类）。

---

## §3 strict-schema 规范化定义

合法 query 参数字符串必须**完整匹配**正则：

```
^-?\d+(\.\d+)?$
```

落地行为表（与 PRD 一致 — Reviewer 可对照 PRD §strict-schema 表逐项核对）：

| 输入示例 | strict-schema 判定 | 期望响应 | 落地 ASSERT |
|---|---|---|---|
| `2` / `-3` / `0` / `1.5` / `-0.5` / `100.000` | 合法 | 200 + product | `[ASSERT-MUL-HAPPY]` / `[ASSERT-MUL-ZERO]` / `[ASSERT-MUL-NEG]` / `[ASSERT-MUL-FLOAT]` |
| `1e3`（科学计数法） | 非法 | 400 | `[ASSERT-MUL-SCI]` |
| `0xff`（十六进制） | 非法 | 400 | `[ASSERT-MUL-HEX]` |
| `Infinity` / `-Infinity` / `NaN` | 非法 | 400 | `[ASSERT-MUL-INFINITY]` / `[ASSERT-MUL-NAN]` |
| `+2`（前导正号） | 非法 | 400 | `[ASSERT-MUL-PLUS]` |
| `.5` / `5.` | 非法 | 400 | `[ASSERT-MUL-LEADING-DOT]` / `[ASSERT-MUL-TRAILING-DOT]` |
| `1,000`（千分位） | 非法 | 400 | `[ASSERT-MUL-COMMA]` |
| `""`（空字符串） | 非法 | 400 | `[ASSERT-MUL-EMPTY]` |
| `abc` / 其它非数字字符串 | 非法 | 400 | `[ASSERT-MUL-WORD]` |

实现要求（spec 层 — 非实现指令，但是 strict 边界必须落到代码上）：

- **不能**用 `Number()` + `Number.isFinite()` 替代正则（`Number('1e3') = 1000` 会假绿）
- **不能**用 `parseFloat()` 替代正则（`parseFloat('1e3') = 1000`、`parseFloat('1.5x') = 1.5` 都会假绿）
- 必须用 `^-?\d+(\.\d+)?$` 的**完整匹配**正则（含 `^` 和 `$` 锚），任何缺锚实现都让 `1e3` 这类输入侧滑通过

---

## §4 ASSERT 目录（Single Source of Truth）

> 每条 ASSERT 是一条独立可执行的 bash 断言，预设环境变量 `PORT` 已指向 spawn 起来的 playground server（§6 用 `shuf` 随机化），且 `jq` / `curl` 可用。
> Step 段（§5）只引用 `[ASSERT-ID]` + 期望；E2E 脚本（§6）按顺序串起这些 ASSERT 跑，每行注释回链 ID。
> 任一 ASSERT 命令以非 0 退出即视为该断言失败 → Evaluator FAIL。
> **造假防御 5 条**见 §7 风险矩阵 R3 行 mitigation（避免重复，原文不在此处复述）。

### Happy + 边界（合法输入）

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-MUL-HAPPY]` | happy path：`a=2&b=3` → `{product:6}` | `curl -fsS "http://127.0.0.1:$PORT/multiply?a=2&b=3" \| jq -e '.product == 6' >/dev/null` | exit 0 |
| `[ASSERT-MUL-ZERO]` | 零参与：`a=0&b=5` → `{product:0}` | `curl -fsS "http://127.0.0.1:$PORT/multiply?a=0&b=5" \| jq -e '.product == 0' >/dev/null` | exit 0 |
| `[ASSERT-MUL-NEG]` | 负数：`a=-2&b=3` → `{product:-6}` | `curl -fsS "http://127.0.0.1:$PORT/multiply?a=-2&b=3" \| jq -e '.product == -6' >/dev/null` | exit 0 |
| `[ASSERT-MUL-FLOAT]` | 标准小数：`a=1.5&b=2` → `{product:3}` | `curl -fsS "http://127.0.0.1:$PORT/multiply?a=1.5&b=2" \| jq -e '.product == 3' >/dev/null` | exit 0 |

### strict-schema 拒绝（非法输入）

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-MUL-MISSING-B]` | 缺 b → 400 + 非空 error + 不含 product | `H=$(curl -s -o /tmp/mul-miss.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-miss.json >/dev/null && jq -e 'has("product") \| not' /tmp/mul-miss.json >/dev/null` | exit 0 |
| `[ASSERT-MUL-MISSING-BOTH]` | 双参数都缺 → 400 + 非空 error | `H=$(curl -s -o /tmp/mul-mb.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-mb.json >/dev/null` | exit 0 |
| `[ASSERT-MUL-SCI]` | 科学计数法 `1e3` → 400 + 非空 error + 不含 product（**核心防 Number() 假绿**） | `H=$(curl -s -o /tmp/mul-sci.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=1e3&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-sci.json >/dev/null && jq -e 'has("product") \| not' /tmp/mul-sci.json >/dev/null` | exit 0 |
| `[ASSERT-MUL-INFINITY]` | `Infinity` → 400 + 非空 error + 不含 product | `H=$(curl -s -o /tmp/mul-inf.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=Infinity&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-inf.json >/dev/null && jq -e 'has("product") \| not' /tmp/mul-inf.json >/dev/null` | exit 0 |
| `[ASSERT-MUL-NAN]` | `NaN` → 400 + 非空 error | `H=$(curl -s -o /tmp/mul-nanstr.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=NaN&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-nanstr.json >/dev/null` | exit 0 |
| `[ASSERT-MUL-PLUS]` | 前导正号 `+2`（URL `%2B2`） → 400 + 非空 error | `H=$(curl -s -o /tmp/mul-plus.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=%2B2&b=3"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-plus.json >/dev/null` | exit 0 |
| `[ASSERT-MUL-LEADING-DOT]` | `.5`（缺整数部分） → 400 + 非空 error | `H=$(curl -s -o /tmp/mul-ld.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=.5&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-ld.json >/dev/null` | exit 0 |
| `[ASSERT-MUL-TRAILING-DOT]` | `5.`（缺小数部分） → 400 + 非空 error | `H=$(curl -s -o /tmp/mul-td.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=5.&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-td.json >/dev/null` | exit 0 |
| `[ASSERT-MUL-HEX]` | `0xff` → 400 + 非空 error | `H=$(curl -s -o /tmp/mul-hex.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=0xff&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-hex.json >/dev/null` | exit 0 |
| `[ASSERT-MUL-COMMA]` | 千分位 `1,000` → 400 + 非空 error | `H=$(curl -s -o /tmp/mul-comma.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=1,000&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-comma.json >/dev/null` | exit 0 |
| `[ASSERT-MUL-EMPTY]` | 空字符串 `a=&b=3` → 400 + 非空 error | `H=$(curl -s -o /tmp/mul-emp.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=&b=3"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-emp.json >/dev/null` | exit 0 |
| `[ASSERT-MUL-WORD]` | 非数字字符串 `abc` → 400 + 非空 error + 不含 product | `H=$(curl -s -o /tmp/mul-word.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=abc&b=3"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-word.json >/dev/null && jq -e 'has("product") \| not' /tmp/mul-word.json >/dev/null` | exit 0 |

### 回归（不破坏现有 endpoint）

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-HEALTH-INTACT]` | `/health` 仍 200 + `{ok:true}` | `curl -fsS "http://127.0.0.1:$PORT/health" \| jq -e '.ok == true' >/dev/null` | exit 0 |
| `[ASSERT-SUM-INTACT]` | W19 `/sum` 仍 200 + `{sum:5}`（防本轮误改 `/sum`） | `curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3" \| jq -e '.sum == 5' >/dev/null` | exit 0 |

### 单测套件

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-UNIT-PASSED]` | playground 单测套件全绿 | `cd playground && npm ci --silent && npm test -- --reporter=verbose 2>&1 \| tee /tmp/playground-unit.log; grep -E "Tests\s+[0-9]+ passed" /tmp/playground-unit.log && ! grep -E "Tests\s+[0-9]+ failed" /tmp/playground-unit.log` | exit 0 |
| `[ASSERT-UNIT-COVERS-MUL]` | 单测确实覆盖 `/multiply` happy + 拒绝路径 | `grep -E "GET /multiply.*200" /tmp/playground-unit.log && grep -Ei "GET /multiply.*(400\|invalid\|missing\|error)" /tmp/playground-unit.log` | exit 0 |
| `[ASSERT-UNIT-COVERS-STRICT]` | 单测**显式**覆盖 strict-schema 核心拒绝（科学计数法 + Infinity 各 ≥ 1） | `grep -Ei "1e3\|科学计数" /tmp/playground-unit.log && grep -Ei "Infinity" /tmp/playground-unit.log` | exit 0 |

---

## §5 Golden Path Steps（每步只引用 ASSERT ID）

> Step 段不再内嵌 bash。可执行形式见 §6 E2E 脚本。

### Step 1: 客户端发 `GET /multiply?a=2&b=3`，收到 200 + `{ "product": 6 }`

- **可观测行为**：playground server 对合法整数 query 返回 HTTP 200，body 是含 `product` 字段的 JSON，值等于算术积。
- **断言**：`[ASSERT-MUL-HAPPY]`
- **硬阈值**：HTTP 200 + body `.product === 6`（数值类型严格）

### Step 2: 合法边界值（零 / 负数 / 标准小数）正常相乘

- **可观测行为**：`a=0&b=5` / `a=-2&b=3` / `a=1.5&b=2` 都视作合法 strict-schema 输入，server 返回 200 + 正确算术积。
- **断言**：`[ASSERT-MUL-ZERO]` + `[ASSERT-MUL-NEG]` + `[ASSERT-MUL-FLOAT]` 三条全 exit 0
- **硬阈值**：三条断言全部 exit 0；product 数值精确相等（不允许字符串 `"0"` / `"-6"` / `"3"`）

### Step 3: 缺参 → 400 + 非空 `error`，body 不含 `product`

- **可观测行为**：`a=2`（缺 b）/ 双参数都缺 → 400 + JSON `error`；**不允许** 200 + `{product:NaN}` 或 500。
- **断言**：`[ASSERT-MUL-MISSING-B]` + `[ASSERT-MUL-MISSING-BOTH]`
- **硬阈值**：HTTP 严格 400 + `.error` 非空 + （缺 b 用例）`has("product") == false`

### Step 4: strict-schema 拒绝核心案例（防 W19 宽松校验复现）

- **可观测行为**：以下 9 类输入**全部**返回 400 + 非空 `error` + body 不含 `product`：
  - 科学计数法 `1e3`
  - `Infinity`
  - `NaN` 字符串
  - 前导正号 `+2`（URL `%2B2`）
  - `.5`（缺整数部分）
  - `5.`（缺小数部分）
  - `0xff`（十六进制）
  - `1,000`（千分位）
  - 空字符串 `a=&b=3`
  - 非数字字符串 `abc`
- **断言**：`[ASSERT-MUL-SCI]` + `[ASSERT-MUL-INFINITY]` + `[ASSERT-MUL-NAN]` + `[ASSERT-MUL-PLUS]` + `[ASSERT-MUL-LEADING-DOT]` + `[ASSERT-MUL-TRAILING-DOT]` + `[ASSERT-MUL-HEX]` + `[ASSERT-MUL-COMMA]` + `[ASSERT-MUL-EMPTY]` + `[ASSERT-MUL-WORD]` 全部 exit 0
- **硬阈值**：10 条断言全部 exit 0；其中 `MUL-SCI` / `MUL-INFINITY` / `MUL-WORD` / `MUL-MISSING-B` 额外要求 body **不含** `product` 字段（防 `{product:NaN, error:"..."}` 模糊态）

### Step 5: 现有 `GET /health` + `GET /sum`（W19）不被破坏

- **可观测行为**：`/health` 仍 200 + `{ok:true}`；`/sum?a=2&b=3` 仍 200 + `{sum:5}`。
- **断言**：`[ASSERT-HEALTH-INTACT]` + `[ASSERT-SUM-INTACT]`
- **硬阈值**：两条断言全部 exit 0

### Step 6: 单测套件全绿（`npm test` 在 `playground/` 内）

- **可观测行为**：`playground/tests/server.test.js` 含 `/multiply` happy + ≥ 5 个 strict-schema 拒绝用例（含科学计数法 + Infinity）全部 pass；`/health` + `/sum` 用例继续 pass。
- **断言**：`[ASSERT-UNIT-PASSED]` + `[ASSERT-UNIT-COVERS-MUL]` + `[ASSERT-UNIT-COVERS-STRICT]`
- **硬阈值**：vitest 退出 0；日志 grep 到 `/multiply.*200` 与 `/multiply.*(400|error|invalid|missing)` 各 ≥ 1 行；strict-schema 拒绝标识（`1e3` / `科学计数` 任一 + `Infinity`）各 ≥ 1 行；不含 `Tests N failed`。

---

## §6 E2E 验收脚本（最终 Evaluator 直接跑 — SSOT 可执行形式）

> 与 W19 round 3 同骨架（PORT 随机化 / health 起活探测 / npm ci 失败重试 / trap EXIT 兜底 / cascade ID 注释），按 W20 的 ASSERT 集合替换。

```bash
#!/bin/bash
# Golden Path 端到端验收。每行末尾注释回链 §4 ASSERT ID（R5 cascade 定位用）。
# 失败定位：set -e 下退非 0 行号 + 注释 ID → 直接对照 Step。
set -euo pipefail

cd "$(git rev-parse --show-toplevel)/playground"

# === 阶段 A: 单测套件 ===
# R4 mitigation: npm ci 失败重试 1 次（不引入 fallback / cache）
npm ci --silent || (echo "[R4] npm ci 第一次失败，重试 1 次..." >&2; sleep 2; npm ci --silent)

npm test -- --reporter=verbose 2>&1 | tee /tmp/playground-unit.log
grep -E "Tests\s+[0-9]+ passed" /tmp/playground-unit.log                          # [ASSERT-UNIT-PASSED] (a)
! grep -E "Tests\s+[0-9]+ failed" /tmp/playground-unit.log                        # [ASSERT-UNIT-PASSED] (b)
grep -E "GET /multiply.*200" /tmp/playground-unit.log                             # [ASSERT-UNIT-COVERS-MUL] (a)
grep -Ei "GET /multiply.*(400|missing|invalid|error)" /tmp/playground-unit.log    # [ASSERT-UNIT-COVERS-MUL] (b)
grep -Ei "1e3|科学计数" /tmp/playground-unit.log                                   # [ASSERT-UNIT-COVERS-STRICT] (a)
grep -Ei "Infinity" /tmp/playground-unit.log                                      # [ASSERT-UNIT-COVERS-STRICT] (b)

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

# --- happy + 边界 ---
curl -fsS "http://127.0.0.1:$PORT/multiply?a=2&b=3"   | jq -e '.product == 6'  >/dev/null   # [ASSERT-MUL-HAPPY]
curl -fsS "http://127.0.0.1:$PORT/multiply?a=0&b=5"   | jq -e '.product == 0'  >/dev/null   # [ASSERT-MUL-ZERO]
curl -fsS "http://127.0.0.1:$PORT/multiply?a=-2&b=3"  | jq -e '.product == -6' >/dev/null   # [ASSERT-MUL-NEG]
curl -fsS "http://127.0.0.1:$PORT/multiply?a=1.5&b=2" | jq -e '.product == 3'  >/dev/null   # [ASSERT-MUL-FLOAT]

# --- 缺参 ---
H=$(curl -s -o /tmp/mul-miss.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=2")
[ "$H" = "400" ]                                                                            # [ASSERT-MUL-MISSING-B] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-miss.json >/dev/null              # [ASSERT-MUL-MISSING-B] (b)
jq -e 'has("product") | not' /tmp/mul-miss.json >/dev/null                                  # [ASSERT-MUL-MISSING-B] (c)

H=$(curl -s -o /tmp/mul-mb.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply")
[ "$H" = "400" ]                                                                            # [ASSERT-MUL-MISSING-BOTH] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-mb.json >/dev/null                # [ASSERT-MUL-MISSING-BOTH] (b)

# --- strict-schema 拒绝（核心防 Number()/parseFloat() 假绿）---
H=$(curl -s -o /tmp/mul-sci.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=1e3&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-MUL-SCI] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-sci.json >/dev/null               # [ASSERT-MUL-SCI] (b)
jq -e 'has("product") | not' /tmp/mul-sci.json >/dev/null                                   # [ASSERT-MUL-SCI] (c)

H=$(curl -s -o /tmp/mul-inf.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=Infinity&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-MUL-INFINITY] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-inf.json >/dev/null               # [ASSERT-MUL-INFINITY] (b)
jq -e 'has("product") | not' /tmp/mul-inf.json >/dev/null                                   # [ASSERT-MUL-INFINITY] (c)

H=$(curl -s -o /tmp/mul-nanstr.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=NaN&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-MUL-NAN] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-nanstr.json >/dev/null            # [ASSERT-MUL-NAN] (b)

H=$(curl -s -o /tmp/mul-plus.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=%2B2&b=3")
[ "$H" = "400" ]                                                                            # [ASSERT-MUL-PLUS] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-plus.json >/dev/null              # [ASSERT-MUL-PLUS] (b)

H=$(curl -s -o /tmp/mul-ld.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=.5&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-MUL-LEADING-DOT] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-ld.json >/dev/null                # [ASSERT-MUL-LEADING-DOT] (b)

H=$(curl -s -o /tmp/mul-td.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=5.&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-MUL-TRAILING-DOT] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-td.json >/dev/null                # [ASSERT-MUL-TRAILING-DOT] (b)

H=$(curl -s -o /tmp/mul-hex.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=0xff&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-MUL-HEX] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-hex.json >/dev/null               # [ASSERT-MUL-HEX] (b)

H=$(curl -s -o /tmp/mul-comma.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=1,000&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-MUL-COMMA] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-comma.json >/dev/null             # [ASSERT-MUL-COMMA] (b)

H=$(curl -s -o /tmp/mul-emp.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=&b=3")
[ "$H" = "400" ]                                                                            # [ASSERT-MUL-EMPTY] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-emp.json >/dev/null               # [ASSERT-MUL-EMPTY] (b)

H=$(curl -s -o /tmp/mul-word.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=abc&b=3")
[ "$H" = "400" ]                                                                            # [ASSERT-MUL-WORD] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-word.json >/dev/null              # [ASSERT-MUL-WORD] (b)
jq -e 'has("product") | not' /tmp/mul-word.json >/dev/null                                  # [ASSERT-MUL-WORD] (c)

# --- 回归 ---
curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.ok == true' >/dev/null                  # [ASSERT-HEALTH-INTACT]
curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3" | jq -e '.sum == 5' >/dev/null               # [ASSERT-SUM-INTACT]

echo "OK Golden Path 验证通过"
```

**通过标准**：脚本 `set -e` 下 exit 0。

---

## §7 执行层风险矩阵

| ID | 风险场景 | 触发条件 | Mitigation | Owner |
|----|---------|---------|-----------|------|
| **R1** | port 3000 被占用 | 并行测试 / 上轮残留进程 / CI runner 复用 | §6 阶段 B 用 `PLAYGROUND_PORT="${PLAYGROUND_PORT:-$(shuf -i 30000-40000 -n 1)}"` 随机化端口；起 server 后 20×0.5s 循环探活 `curl /health`，失败即视为 spawn 失败 → `set -e` 退出 | Evaluator |
| **R2** | server spawn 后崩溃但 PID 仍存在（zombie） | `NODE_ENV=production` 下静默 throw / `app.listen` 异常未传播 / express middleware 同步异常 | §6 用 `trap "kill $SERVER_PID 2>/dev/null \|\| true; wait $SERVER_PID 2>/dev/null \|\| true" EXIT` 兜底 kill；起活探测 `curl -fsS /health` 必须在 10s 内返回 200，否则 `[ "$SPAWN_OK" = "1" ] \|\| exit 1` | Evaluator |
| **R3** | Evaluator 假绿（404 / HTML / NaN / 0-test / 宽松校验滑过 strict 边界） | Generator 提交空 PR / stub `res.status(200).send('OK')` 实现 / 测试套件 0 用例假 PASS / 用 `Number()` 替代正则导致 `1e3` 假绿 | **造假防御 6 条**：<br>① 所有 curl 带 `-fsS`：HTTP 非 2xx 自动退 22<br>② 所有 JSON 断言用 `jq -e`：解析失败或表达式 false 即非 0 退出<br>③ 严格相等用 `==`（数值）：防 `{"product":"6"}` 字符串作弊<br>④ error 路径显式 `has("product") \| not`（at least 在 `MUL-SCI` / `MUL-INFINITY` / `MUL-WORD` / `MUL-MISSING-B` 上强制）：防 `{"product":NaN,"error":"..."}` 模糊态<br>⑤ 单测断言 `Tests N passed` 且 `not Tests N failed`：防 0-test 假绿<br>⑥ **核心新增（W20 strict-schema 专属）**：`[ASSERT-MUL-SCI]` 用 `1e3` 这个 `Number()` 会乐意接受的 token 作"探针"，强制实现走完整正则匹配；`[ASSERT-MUL-INFINITY]` + `[ASSERT-MUL-NAN]` 用 `Number()` 会返回 `Infinity` / `NaN` 的 token 作第二探针；任一 ASSERT 红就证明实现没用 `^-?\d+(\.\d+)?$` 完整匹配 | Evaluator |
| **R4** | `npm ci` 网络抖动 | 离线 / npm registry 不可达 / IPv6 路由抽风 | §6 阶段 A 用 `npm ci --silent \|\| (echo "[R4] 重试..."; sleep 2; npm ci --silent)`：失败重试 1 次；仍失败即 FAIL（**不引入 cache fallback / mirror fallback**） | Evaluator |
| **R5** | cascade 失败导致定位困难 | E2E 第 N 行红，看不出是 spawn 失败 / npm ci 失败 / 单测断言失败 / HTTP 断言失败 | §6 每条断言行末尾注释 `# [ASSERT-XXX]` 回链 §4 ID；`set -euo pipefail` 让 bash 直接报错具体行号；spawn / npm ci 失败有专用 `[R1]` / `[R2]` / `[R4]` echo 标记区分阶段 | Reviewer |
| **R6** | Generator 误改 `/sum` 或 `/health` 实现 | LLM 误判 PRD「不在范围内」/ 把 strict-schema 顺手套到 `/sum` 上打 W19 旧账 | §4 引入 `[ASSERT-SUM-INTACT]` 做 W19 回归；§5 Step 5 显式列入 Golden Path；contract-dod-ws1 的 ARTIFACT 强制源文件**仍含**`app.get('/sum'` 与 `app.get('/health'` | Reviewer + Generator |

**Owner 含义**：
- **Evaluator**：跑验证脚本时必须遵守该 mitigation（已写入 §6 脚本）
- **Reviewer**：审合同时必须确认该 mitigation 已落实（不漏审）
- **Generator**：实现代码时必须遵守该 mitigation（R6 落到 Generator）

---

## §8 测试代码骨架（内嵌可视化 — 直接来自 `tests/ws1/multiply.test.js`）

> 完整文件位于 `sprints/w20-playground-multiply/tests/ws1/multiply.test.js`（共 18 个 `test()` 块）。
> 下面**原样**列出每个 `test()` 标题 + 关键 `expect` 断言行（注：vitest 中 `test` 与 `it` 等价，本合同沿用 `test` 与 W19 一致）。
> Reviewer 可直接据此判断"未实现时这些 expect 必 FAIL"。

```javascript
import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /multiply (strict-schema) [BEHAVIOR]', () => {
  // T1 happy
  test('GET /multiply?a=2&b=3 → 200 + {product:6}', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: 6 });
    expect(typeof res.body.product).toBe('number');
  });

  // T2 零参与
  test('GET /multiply?a=0&b=5 → 200 + {product:0} (零合法)', async () => {
    const res = await request(app).get('/multiply').query({ a: '0', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: 0 });
  });

  // T3 负数
  test('GET /multiply?a=-2&b=3 → 200 + {product:-6} (负数合法)', async () => {
    const res = await request(app).get('/multiply').query({ a: '-2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: -6 });
  });

  // T4 标准小数
  test('GET /multiply?a=1.5&b=2 → 200 + {product:3} (标准小数合法)', async () => {
    const res = await request(app).get('/multiply').query({ a: '1.5', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ product: 3 });
  });

  // T5 缺 b
  test('GET /multiply?a=2 (缺 b) → 400 + 非空 error，body 不含 product', async () => {
    const res = await request(app).get('/multiply').query({ a: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'product')).toBe(false);
  });

  // T6 双参数都缺
  test('GET /multiply (双参数都缺) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T7 科学计数法（核心 strict 探针 — 防 Number() 假绿）
  test('GET /multiply?a=1e3&b=2 (科学计数法) → 400 + 非空 error，body 不含 product', async () => {
    const res = await request(app).get('/multiply').query({ a: '1e3', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'product')).toBe(false);
  });

  // T8 Infinity（防 Number.isFinite 路径滑过）
  test('GET /multiply?a=Infinity&b=2 → 400 + 非空 error，body 不含 product', async () => {
    const res = await request(app).get('/multiply').query({ a: 'Infinity', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'product')).toBe(false);
  });

  // T9 NaN 字符串
  test('GET /multiply?a=NaN&b=2 → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: 'NaN', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T10 前导正号
  test('GET /multiply?a=+2&b=3 (前导正号) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: '+2', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T11 .5 缺整数部分
  test('GET /multiply?a=.5&b=2 (小数点缺整数部分) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: '.5', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T12 5. 缺小数部分
  test('GET /multiply?a=5.&b=2 (小数点缺小数部分) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: '5.', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T13 0xff 十六进制
  test('GET /multiply?a=0xff&b=2 (十六进制) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: '0xff', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T14 1,000 千分位
  test('GET /multiply?a=1,000&b=2 (千分位) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: '1,000', b: '2' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T15 空字符串
  test('GET /multiply?a=&b=3 (空字符串) → 400 + 非空 error', async () => {
    const res = await request(app).get('/multiply').query({ a: '', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  // T16 非数字字符串
  test('GET /multiply?a=abc&b=3 (非数字) → 400 + error，body 不含 product', async () => {
    const res = await request(app).get('/multiply').query({ a: 'abc', b: '3' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'product')).toBe(false);
  });

  // T17 回归 /health
  test('GET /health 仍 200 + {ok:true} (回归不破坏)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  // T18 回归 /sum (W19)
  test('GET /sum?a=2&b=3 仍 200 + {sum:5} (W19 回归不破坏)', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sum: 5 });
  });
});
```

---

## §9 Red 证据来源声明（为什么这些 expect 必 FAIL）

**当前主分支事实**（截至 round 1 起草时刻）：

`playground/server.js` 实际内容（共 27 行 — W19 已合并 `/sum`）：

```javascript
import express from 'express';
const app = express();
const PORT = process.env.PLAYGROUND_PORT || 3000;
app.get('/health', (req, res) => { res.json({ ok: true }); });
app.get('/sum', (req, res) => { /* W19 实现：Number() + isFinite */ });
// 没有 app.get('/multiply', ...)
if (process.env.NODE_ENV !== 'test') app.listen(PORT, ...);
export default app;
```

**关键事实**：**没有任何 `app.get('/multiply', ...)` 注册**。Express 对未注册路由默认行为是返回 HTTP **404** + `Cannot GET /multiply`（text/html）。

**Red 失败矩阵**（在 proposer 分支当下跑 §8 测试时）：

| Test ID | 期望状态 | 实际状态（无 /multiply 路由） | 失败行 | 结论 |
|---|---|---|---|---|
| T1 | `expect(res.status).toBe(200)` | 404 | status 断言 | **FAIL** |
| T2 | `expect(res.status).toBe(200)` | 404 | status 断言 | **FAIL** |
| T3 | `expect(res.status).toBe(200)` | 404 | status 断言 | **FAIL** |
| T4 | `expect(res.status).toBe(200)` | 404 | status 断言 | **FAIL** |
| T5 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T6 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T7 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T8 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T9 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T10 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T11 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T12 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T13 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T14 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T15 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T16 | `expect(res.status).toBe(400)` | 404 | status 断言 | **FAIL** |
| T17 | `expect(res.status).toBe(200)` | 200（`/health` 仍存在） | — | **PASS**（回归基线） |
| T18 | `expect(res.status).toBe(200)` | 200（`/sum` W19 已合并） | — | **PASS**（W19 回归基线） |

**预期 Red 总数**：**16 FAIL + 2 PASS**（远超 Reviewer ≥ 5 failures 阈值）。

**Proposer 自验命令**（commit 前 Proposer 实跑确认）：

```bash
cd playground
# 复制时把"从 sprint dir 看 server.js"的 4 层相对路径改写成"从 playground/tests 看"的 1 层
cp ../sprints/w20-playground-multiply/tests/ws1/multiply.test.js tests/_multiply_red_probe.test.js
sed -i 's|../../../../playground/server.js|../server.js|' tests/_multiply_red_probe.test.js
npx vitest run --reporter=verbose 2>&1 | tee /tmp/ws1-red.log || true
rm -f tests/_multiply_red_probe.test.js
# 期望：Tests {N>=16} failed
grep -E "Tests\s+[0-9]+ failed" /tmp/ws1-red.log
```

---

## §10 Workstreams

workstream_count: 1

### Workstream 1: 加 `GET /multiply` 路由（strict-schema）+ 单测 + README

- **范围**：
  - `playground/server.js`：在 `/sum` 路由之后、`app.listen` 之前新增 `GET /multiply` handler；用原生 RegExp `/^-?\d+(\.\d+)?$/` 对 query a/b **完整匹配**校验；通过则 `Number()` 转换并相乘 → 200 + `{product}`；任一不通过或缺参 → 400 + `{error}`，body 不含 `product` 字段。**不动 `/health` 与 `/sum` 的代码**。
  - `playground/tests/server.test.js`：把 §8 的 18 个 `test()` 块原样合并进去（vitest 兼容，与现有 `/sum` describe 块共存）；保留现有 `/health` + `/sum` 用例不动。
  - `playground/README.md`：「端点」段加 `/multiply`，给出 happy + ≥ 1 条 strict-schema 拒绝示例（含 `1e3` 或 `Infinity` 任一）；保留现有 `/health` + `/sum` 段不动。
- **大小**：S（< 100 行净增 — 与 W19 量级相当）
- **依赖**：无（W19 `/sum` 已合并，作为回归基线即可）
- **BEHAVIOR 覆盖测试文件**：`sprints/w20-playground-multiply/tests/ws1/multiply.test.js`

---

## §11 Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（按 §8 T-ID） | 预期 Red 证据 |
|---|---|---|---|
| WS1 | `tests/ws1/multiply.test.js` | T1–T16（happy + 边界 + 缺参 + strict-schema 10 类拒绝 + 非数字）+ T17–T18（/health + /sum 回归） | **16 failures**（T1–T16 全 FAIL，T17/T18 PASS）→ 远超 Reviewer ≥ 5 阈值 |

**Red 证据采集命令**：见 §9 末尾「Proposer 自验命令」。
