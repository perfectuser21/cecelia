# Sprint Contract Draft (Round 1)

> **Initiative**: W21 Walking Skeleton — playground 加 `GET /divide` endpoint（strict-schema + 除零兜底 + oracle）
> **Task ID**: 70b4a3ee-ca8b-47ce-81e3-5e21c2bdb404
> **Source PRD**: `sprints/w21-playground-divide/sprint-prd.md`
> **journey_type**: autonomous
> **承前**：W19 `/sum`（PR #2875）、W20 `/multiply`（PR #2878）已合并；本轮**只新增 `/divide` 路由**，不动 `/health` / `/sum` / `/multiply` 的实现/测试。
> **W21 新增对抗维度**：在 W20 strict-schema 之上叠加两层 oracle 探针——(1) **正向 oracle**：`quotient === Number(a)/Number(b)` 严格相等（独立复算）；(2) **反向 oracle**：strict 通过后必须显式拒 `b=0`，不允许靠 JS 自然产 `Infinity` 滑过。

---

## §1 Golden Path

[HTTP 客户端发 `GET /divide?a=6&b=2`] → [playground server 用 strict-schema 校验 query 参数 a/b → 显式判 `Number(b) === 0` → 通过则计算 a÷b] → [客户端收到 HTTP 200 + body `{ "quotient": 3 }`，且 `quotient === Number(a)/Number(b)` 严格成立]

边界 / 副 path（同一 endpoint 上的非 happy 路径，必须同样验证）：

- **缺参**（`a` 或 `b` 任一缺失，含空字符串）→ 400 + 非空 `error` 字段，且 body 不含 `quotient`
- **strict-schema 拒绝**（不完整匹配 `^-?\d+(\.\d+)?$`，含科学计数法 / Infinity / NaN / 前导正号 / `.5` / `6.` / 十六进制 / 千分位 / 含空格 / 非数字字符串）→ 400 + 非空 `error`，且 body 不含 `quotient`
- **除零兜底**（strict 通过但 `Number(b) === 0`，含 `b=0` / `b=0.0` / `0/0`）→ **400** + 非空 `error`，body 不含 `quotient`（**W21 主探针**：不允许任何"返 200 + Infinity/NaN"路径）
- **合法边界**（被除数 0 / 负数 / 标准小数 / 不能整除）→ 200 + JS 原生算术结果（不四舍五入、不字符串化）
- **正向 oracle**：对至少 1 组合法非整除输入（如 `a=1&b=3`、`a=1.5&b=0.5`），`body.quotient === Number(<a>)/Number(<b>)` 严格相等
- **现有 `GET /health` / `GET /sum`（W19）/ `GET /multiply`（W20）行为不被破坏**（回归基线）

---

## §2 journey_type

**autonomous** — playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议（与 W19、W20 同分类）。

---

## §3 strict-schema + 除零规范化定义

### 3.1 strict-schema（与 W20 一致，不重新发明）

合法 query 参数字符串必须**完整匹配**正则：

```
^-?\d+(\.\d+)?$
```

实现要求（spec 层 — 非实现指令，但以下边界必须落到代码上）：

- **不能**用 `Number()` + `Number.isFinite()` 替代正则（`Number('1e3') = 1000` 会假绿）
- **不能**用 `parseFloat()` 替代正则（`parseFloat('1e3') = 1000`、`parseFloat('1.5x') = 1.5` 都会假绿）
- 必须用 `^-?\d+(\.\d+)?$` 的**完整匹配**正则（含 `^` 和 `$` 锚），任何缺锚实现都让 `1e3` 这类输入侧滑通过
- **可与 `/multiply` 共享同一字面量常量**（PRD 假设 §allowed），不强制重复定义；语义等价即可

### 3.2 除零兜底（W21 新增 — 核心）

**触发位置**：strict-schema 通过 **之后**、除法运算 **之前**

**触发条件**：`Number(b) === 0`（覆盖 `b='0'` / `b='0.0'` / `b='-0'` 等所有 strict 通过且数值为零的输入）

**响应**：HTTP 400 + `{ error: <非空字符串> }`，body **不含** `quotient` 字段

**禁止实现**：
- ❌ 依赖 JS 自然算术产 `Infinity` / `NaN` 后再判（`Number.isFinite(quotient)` 兜底）— 这种实现会让 200 路径短暂存在 `quotient: Infinity` 状态，不符合"严格不返这类值"的合同
- ❌ 用字符串等值比较（`b === '0'`）— 会漏掉 `'0.0'` / `'-0'`
- ✅ 显式 `Number(b) === 0` 在调用 `Number(a)/Number(b)` 之前

### 3.3 落地行为表（与 PRD §strict-schema 表 + 除零行对齐 — Reviewer 可对照逐项核对）

| 输入示例 | 判定阶段 | 期望响应 | 落地 ASSERT |
|---|---|---|---|
| `a=6&b=2` | happy | 200 + `{quotient:3}` | `[ASSERT-DIV-HAPPY]` |
| `a=1&b=3` | happy + **oracle** | 200 + `quotient === 1/3` | `[ASSERT-DIV-ORACLE-FRACT]` |
| `a=1.5&b=0.5` | happy + **oracle** | 200 + `quotient === 1.5/0.5` | `[ASSERT-DIV-ORACLE-FLOAT]` |
| `a=-6&b=2` | happy | 200 + `{quotient:-3}` | `[ASSERT-DIV-NEG-NUM]` |
| `a=6&b=-2` | happy | 200 + `{quotient:-3}` | `[ASSERT-DIV-NEG-DEN]` |
| `a=0&b=5` | happy（被除数为 0 合法） | 200 + `{quotient:0}` | `[ASSERT-DIV-ZERO-NUM]` |
| `a=5&b=0` | strict 通过 + **除零兜底** | 400 + 不含 quotient | `[ASSERT-DIV-DIVZERO-INT]` |
| `a=0&b=0` | strict 通过 + **除零兜底** | 400 + 不含 quotient | `[ASSERT-DIV-DIVZERO-BOTH]` |
| `a=6&b=0.0` | strict 通过 + **除零兜底**（小数 0） | 400 + 不含 quotient | `[ASSERT-DIV-DIVZERO-FLOAT]` |
| `a=6` / `b=2` / 全缺 | 缺参 | 400 + 不含 quotient | `[ASSERT-DIV-MISSING-B]` / `[ASSERT-DIV-MISSING-A]` / `[ASSERT-DIV-MISSING-BOTH]` |
| `a=1e3&b=2` | strict 拒（科学计数法） | 400 + 不含 quotient | `[ASSERT-DIV-SCI]` |
| `a=Infinity&b=2` | strict 拒 | 400 + 不含 quotient | `[ASSERT-DIV-INFINITY]` |
| `a=6&b=NaN` | strict 拒 | 400 | `[ASSERT-DIV-NAN]` |
| `a=%2B6&b=2`（前导 +） | strict 拒 | 400 | `[ASSERT-DIV-PLUS]` |
| `a=.5&b=2` | strict 拒（缺整数部分） | 400 | `[ASSERT-DIV-LEADING-DOT]` |
| `a=6.&b=2` | strict 拒（缺小数部分） | 400 | `[ASSERT-DIV-TRAILING-DOT]` |
| `a=0xff&b=2` | strict 拒（十六进制） | 400 | `[ASSERT-DIV-HEX]` |
| `a=1,000&b=2` | strict 拒（千分位） | 400 | `[ASSERT-DIV-COMMA]` |
| `a=&b=3` | strict 拒（空字符串） | 400 | `[ASSERT-DIV-EMPTY]` |
| `a=abc&b=3` | strict 拒（非数字） | 400 + 不含 quotient | `[ASSERT-DIV-WORD]` |

---

## §4 ASSERT 目录（Single Source of Truth）

> 每条 ASSERT 是一条独立可执行的 bash 断言，预设环境变量 `PORT` 已指向 spawn 起来的 playground server（§6 用 `shuf` 随机化），且 `jq` / `curl` / `node` 可用。
> Step 段（§5）只引用 `[ASSERT-ID]` + 期望；E2E 脚本（§6）按顺序串起这些 ASSERT 跑，每行注释回链 ID。
> 任一 ASSERT 命令以非 0 退出即视为该断言失败 → Evaluator FAIL。
> **造假防御 7 条**见 §7 风险矩阵 R3 行 mitigation（避免重复，原文不在此处复述）。

### Happy + 边界（合法输入）

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-DIV-HAPPY]` | happy 整除：`a=6&b=2` → `{quotient:6/2}` | `curl -fsS "http://127.0.0.1:$PORT/divide?a=6&b=2" \| jq -e '.quotient == 3' >/dev/null` | exit 0 |
| `[ASSERT-DIV-ORACLE-FRACT]` | **oracle 探针 1**：`a=1&b=3` 商必须等于 Node 独立复算 `Number('1')/Number('3')` | `EXP=$(node -e "process.stdout.write(String(Number('1')/Number('3')))"); curl -fsS "http://127.0.0.1:$PORT/divide?a=1&b=3" \| jq -e --argjson e "$EXP" '.quotient == $e' >/dev/null` | exit 0 |
| `[ASSERT-DIV-ORACLE-FLOAT]` | **oracle 探针 2**：`a=1.5&b=0.5` 商必须等于 Node 独立复算 | `EXP=$(node -e "process.stdout.write(String(Number('1.5')/Number('0.5')))"); curl -fsS "http://127.0.0.1:$PORT/divide?a=1.5&b=0.5" \| jq -e --argjson e "$EXP" '.quotient == $e' >/dev/null` | exit 0 |
| `[ASSERT-DIV-NEG-NUM]` | 负被除数：`a=-6&b=2` → `{quotient:-3}` | `curl -fsS "http://127.0.0.1:$PORT/divide?a=-6&b=2" \| jq -e '.quotient == -3' >/dev/null` | exit 0 |
| `[ASSERT-DIV-NEG-DEN]` | 负除数：`a=6&b=-2` → `{quotient:-3}` | `curl -fsS "http://127.0.0.1:$PORT/divide?a=6&b=-2" \| jq -e '.quotient == -3' >/dev/null` | exit 0 |
| `[ASSERT-DIV-ZERO-NUM]` | 被除数为 0（合法）：`a=0&b=5` → `{quotient:0}` | `curl -fsS "http://127.0.0.1:$PORT/divide?a=0&b=5" \| jq -e '.quotient == 0' >/dev/null` | exit 0 |

### 除零兜底（W21 主探针 — strict 通过但 b=0）

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-DIV-DIVZERO-INT]` | `a=5&b=0` → 400 + 非空 error + 不含 quotient（**核心新增**） | `H=$(curl -s -o /tmp/div-dz0.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=5&b=0"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-dz0.json >/dev/null && jq -e 'has("quotient") \| not' /tmp/div-dz0.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-DIVZERO-BOTH]` | `a=0&b=0` → 400 + 非空 error + 不含 quotient | `H=$(curl -s -o /tmp/div-dz00.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=0&b=0"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-dz00.json >/dev/null && jq -e 'has("quotient") \| not' /tmp/div-dz00.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-DIVZERO-FLOAT]` | `a=6&b=0.0` → 400 + 非空 error + 不含 quotient（防字符串等值比较漏） | `H=$(curl -s -o /tmp/div-dz0f.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=6&b=0.0"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-dz0f.json >/dev/null && jq -e 'has("quotient") \| not' /tmp/div-dz0f.json >/dev/null` | exit 0 |

### 缺参

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-DIV-MISSING-B]` | 缺 b → 400 + 非空 error + 不含 quotient | `H=$(curl -s -o /tmp/div-mb.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=6"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-mb.json >/dev/null && jq -e 'has("quotient") \| not' /tmp/div-mb.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-MISSING-A]` | 缺 a → 400 + 非空 error | `H=$(curl -s -o /tmp/div-ma.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-ma.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-MISSING-BOTH]` | 双参数都缺 → 400 + 非空 error | `H=$(curl -s -o /tmp/div-mab.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-mab.json >/dev/null` | exit 0 |

### strict-schema 拒绝（非法输入 — 与 W20 同探针集，确保 strict 不被打回）

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-DIV-SCI]` | 科学计数法 `1e3` → 400 + 非空 error + 不含 quotient（**防 Number() 假绿**） | `H=$(curl -s -o /tmp/div-sci.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=1e3&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-sci.json >/dev/null && jq -e 'has("quotient") \| not' /tmp/div-sci.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-INFINITY]` | `Infinity` → 400 + 非空 error + 不含 quotient | `H=$(curl -s -o /tmp/div-inf.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=Infinity&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-inf.json >/dev/null && jq -e 'has("quotient") \| not' /tmp/div-inf.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-NAN]` | `NaN` 字符串（在 b 上）→ 400 + 非空 error | `H=$(curl -s -o /tmp/div-nan.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=6&b=NaN"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-nan.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-PLUS]` | 前导正号 `+6`（URL `%2B6`） → 400 + 非空 error | `H=$(curl -s -o /tmp/div-plus.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=%2B6&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-plus.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-LEADING-DOT]` | `.5`（缺整数部分） → 400 + 非空 error | `H=$(curl -s -o /tmp/div-ld.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=.5&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-ld.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-TRAILING-DOT]` | `6.`（缺小数部分） → 400 + 非空 error | `H=$(curl -s -o /tmp/div-td.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=6.&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-td.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-HEX]` | `0xff` → 400 + 非空 error | `H=$(curl -s -o /tmp/div-hex.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=0xff&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-hex.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-COMMA]` | 千分位 `1,000` → 400 + 非空 error | `H=$(curl -s -o /tmp/div-comma.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=1,000&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-comma.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-EMPTY]` | 空字符串 `a=&b=3` → 400 + 非空 error | `H=$(curl -s -o /tmp/div-emp.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=&b=3"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-emp.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-WORD]` | 非数字字符串 `abc` → 400 + 非空 error + 不含 quotient | `H=$(curl -s -o /tmp/div-word.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=abc&b=3"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-word.json >/dev/null && jq -e 'has("quotient") \| not' /tmp/div-word.json >/dev/null` | exit 0 |

### 回归（不破坏现有 endpoint）

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-HEALTH-INTACT]` | `/health` 仍 200 + `{ok:true}` | `curl -fsS "http://127.0.0.1:$PORT/health" \| jq -e '.ok == true' >/dev/null` | exit 0 |
| `[ASSERT-SUM-INTACT]` | W19 `/sum` 仍 200 + `{sum:5}` | `curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3" \| jq -e '.sum == 5' >/dev/null` | exit 0 |
| `[ASSERT-MUL-INTACT]` | W20 `/multiply` 仍 200 + `{product:6}` | `curl -fsS "http://127.0.0.1:$PORT/multiply?a=2&b=3" \| jq -e '.product == 6' >/dev/null` | exit 0 |
| `[ASSERT-MUL-STRICT-INTACT]` | W20 `/multiply` strict 不被打回（`1e3` 仍 400） | `H=$(curl -s -o /tmp/mul-strict.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=1e3&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-strict.json >/dev/null` | exit 0 |

### 单测套件

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-UNIT-PASSED]` | playground 单测套件全绿 | `cd playground && npm ci --silent && npm test -- --reporter=verbose 2>&1 \| tee /tmp/playground-unit.log; grep -E "Tests\s+[0-9]+ passed" /tmp/playground-unit.log && ! grep -E "Tests\s+[0-9]+ failed" /tmp/playground-unit.log` | exit 0 |
| `[ASSERT-UNIT-COVERS-DIV]` | 单测确实覆盖 `/divide` happy + 拒绝路径 | `grep -E "GET /divide.*200" /tmp/playground-unit.log && grep -Ei "GET /divide.*(400\|invalid\|missing\|error\|拒绝\|除零)" /tmp/playground-unit.log` | exit 0 |
| `[ASSERT-UNIT-COVERS-DIVZERO]` | 单测**显式**覆盖除零兜底（`b=0` 拒绝） | `grep -E "b=0\|b: '0'\|b:'0'" /tmp/playground-unit.log` | exit 0 |
| `[ASSERT-UNIT-COVERS-ORACLE]` | 单测**显式**含 oracle 复算断言（`Number(...) / Number(...)`） | `grep -E "toBe\(Number\(.*\)\s*/\s*Number\(.*\)\)" /tmp/playground-unit.log \|\| grep -E "Number\(.*\)\s*/\s*Number\(.*\)" playground/tests/server.test.js` | exit 0 |
| `[ASSERT-UNIT-COVERS-STRICT]` | 单测显式覆盖 strict 核心拒绝（`1e3` + `Infinity` 各 ≥ 1） | `grep -Ei "1e3\|科学计数" /tmp/playground-unit.log && grep -Ei "Infinity" /tmp/playground-unit.log` | exit 0 |

---

## §5 Golden Path Steps（每步只引用 ASSERT ID）

> Step 段不再内嵌 bash。可执行形式见 §6 E2E 脚本。

### Step 1: 客户端发 `GET /divide?a=6&b=2`，收到 200 + `{ "quotient": 3 }`

- **可观测行为**：playground server 对合法整数 query 返回 HTTP 200，body 是含 `quotient` 字段的 JSON，值等于算术商。
- **断言**：`[ASSERT-DIV-HAPPY]`
- **硬阈值**：HTTP 200 + body `.quotient === 3`（数值类型严格，不允许字符串 `"3"`）

### Step 2: 正向 oracle — 商等于独立复算（核心新增）

- **可观测行为**：对至少 2 组合法非整除输入（`a=1&b=3`、`a=1.5&b=0.5`），server 返回 200，且 `body.quotient` **数值严格等于** Node 端独立用 `Number(<a>)/Number(<b>)` 算出的 JS Number 浮点值。
- **断言**：`[ASSERT-DIV-ORACLE-FRACT]` + `[ASSERT-DIV-ORACLE-FLOAT]` 全 exit 0
- **硬阈值**：jq `--argjson` 注入 Node 复算值后 `==` 严格相等；不允许字符串化 / 不允许四舍五入 / 不允许字段重命名。

### Step 3: 合法边界值（被除数 0 / 负数）正常计算

- **可观测行为**：`a=0&b=5` / `a=-6&b=2` / `a=6&b=-2` 都视作合法 strict 输入，server 返回 200 + 正确算术商；**不能误把 `a=0` 也拒掉**。
- **断言**：`[ASSERT-DIV-ZERO-NUM]` + `[ASSERT-DIV-NEG-NUM]` + `[ASSERT-DIV-NEG-DEN]` 三条全 exit 0
- **硬阈值**：三条断言全部 exit 0；quotient 数值精确相等（`{quotient:0}` 的 `0` 是 JS Number 零值，不是 `"0"`）

### Step 4: 除零兜底 — strict 通过但 b=0 必须 400（W21 主探针）

- **可观测行为**：`a=5&b=0` / `a=0&b=0` / `a=6&b=0.0` 三类输入**都**返回 400 + 非空 `error` + body **不含** `quotient`；**不允许** 200 + `{quotient: Infinity / -Infinity / NaN}` 任意一种。
- **断言**：`[ASSERT-DIV-DIVZERO-INT]` + `[ASSERT-DIV-DIVZERO-BOTH]` + `[ASSERT-DIV-DIVZERO-FLOAT]` 全 exit 0
- **硬阈值**：HTTP 严格 400；`.error` 非空字符串；`has("quotient") == false`；该判定必须发生在 strict-schema 通过 **之后**、调用 `Number(a)/Number(b)` **之前**（不允许靠 `Number.isFinite(quotient)` 兜底，因为那意味着 200 路径短暂存在过 `quotient: Infinity`）。

### Step 5: 缺参 → 400 + 非空 `error`，body 不含 `quotient`

- **可观测行为**：`a=6`（缺 b）/ `b=2`（缺 a）/ 双参数都缺 → 400 + JSON `error`；**不允许** 200 + `{quotient:NaN}` 或 500。
- **断言**：`[ASSERT-DIV-MISSING-B]` + `[ASSERT-DIV-MISSING-A]` + `[ASSERT-DIV-MISSING-BOTH]`
- **硬阈值**：HTTP 严格 400 + `.error` 非空 + （缺 b 用例）`has("quotient") == false`

### Step 6: strict-schema 拒绝核心案例（防 W20 strict 被打回）

- **可观测行为**：以下 10 类输入**全部**返回 400 + 非空 `error` + body 不含 `quotient`：
  - 科学计数法 `1e3`
  - `Infinity`
  - `NaN` 字符串
  - 前导正号 `+6`（URL `%2B6`）
  - `.5`（缺整数部分）
  - `6.`（缺小数部分）
  - `0xff`（十六进制）
  - `1,000`（千分位）
  - 空字符串 `a=&b=3`
  - 非数字字符串 `abc`
- **断言**：`[ASSERT-DIV-SCI]` + `[ASSERT-DIV-INFINITY]` + `[ASSERT-DIV-NAN]` + `[ASSERT-DIV-PLUS]` + `[ASSERT-DIV-LEADING-DOT]` + `[ASSERT-DIV-TRAILING-DOT]` + `[ASSERT-DIV-HEX]` + `[ASSERT-DIV-COMMA]` + `[ASSERT-DIV-EMPTY]` + `[ASSERT-DIV-WORD]` 全部 exit 0
- **硬阈值**：10 条断言全部 exit 0；其中 `DIV-SCI` / `DIV-INFINITY` / `DIV-WORD` 额外要求 body **不含** `quotient` 字段（防 `{quotient:NaN, error:"..."}` 模糊态）

### Step 7: 现有 `/health` + `/sum`（W19）+ `/multiply`（W20）不被破坏

- **可观测行为**：`/health` 仍 200 + `{ok:true}`；`/sum?a=2&b=3` 仍 200 + `{sum:5}`；`/multiply?a=2&b=3` 仍 200 + `{product:6}`；W20 strict 不被打回（`/multiply?a=1e3&b=2` 仍 400）。
- **断言**：`[ASSERT-HEALTH-INTACT]` + `[ASSERT-SUM-INTACT]` + `[ASSERT-MUL-INTACT]` + `[ASSERT-MUL-STRICT-INTACT]`
- **硬阈值**：四条断言全部 exit 0

### Step 8: 单测套件全绿（`npm test` 在 `playground/` 内）

- **可观测行为**：`playground/tests/server.test.js` 含 `/divide` describe 块（happy + 除零 + strict 拒绝 + oracle 复算断言）全部 pass；`/health` + `/sum` + `/multiply` 用例继续 pass。
- **断言**：`[ASSERT-UNIT-PASSED]` + `[ASSERT-UNIT-COVERS-DIV]` + `[ASSERT-UNIT-COVERS-DIVZERO]` + `[ASSERT-UNIT-COVERS-ORACLE]` + `[ASSERT-UNIT-COVERS-STRICT]`
- **硬阈值**：vitest 退出 0；日志 grep 到 `/divide.*200` 与 `/divide.*(400|error|missing|拒绝|除零)` 各 ≥ 1 行；除零拒绝标识（`b=0` 任一形式）≥ 1 行；oracle 复算断言（源文件层面 `Number(...) / Number(...)`）≥ 1 行；strict-schema 拒绝标识（`1e3` / `科学计数` 任一 + `Infinity`）各 ≥ 1 行；不含 `Tests N failed`。

---

## §6 E2E 验收脚本（最终 Evaluator 直接跑 — SSOT 可执行形式）

> 与 W19 round 3 / W20 同骨架（PORT 随机化 / health 起活探测 / npm ci 失败重试 / trap EXIT 兜底 / cascade ID 注释），按 W21 的 ASSERT 集合替换 + 加 oracle / 除零 / W20 回归段。

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
grep -E "GET /divide.*200" /tmp/playground-unit.log                               # [ASSERT-UNIT-COVERS-DIV] (a)
grep -Ei "GET /divide.*(400|missing|invalid|error|拒绝|除零)" /tmp/playground-unit.log  # [ASSERT-UNIT-COVERS-DIV] (b)
grep -E "b=0|b: '0'|b:'0'" /tmp/playground-unit.log                                # [ASSERT-UNIT-COVERS-DIVZERO]
grep -E "Number\(.*\)\s*/\s*Number\(.*\)" tests/server.test.js                     # [ASSERT-UNIT-COVERS-ORACLE]（源文件层）
grep -Ei "1e3|科学计数" /tmp/playground-unit.log                                   # [ASSERT-UNIT-COVERS-STRICT] (a)
grep -Ei "Infinity" /tmp/playground-unit.log                                       # [ASSERT-UNIT-COVERS-STRICT] (b)

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
curl -fsS "http://127.0.0.1:$PORT/divide?a=6&b=2"   | jq -e '.quotient == 3'  >/dev/null   # [ASSERT-DIV-HAPPY]
curl -fsS "http://127.0.0.1:$PORT/divide?a=0&b=5"   | jq -e '.quotient == 0'  >/dev/null   # [ASSERT-DIV-ZERO-NUM]
curl -fsS "http://127.0.0.1:$PORT/divide?a=-6&b=2"  | jq -e '.quotient == -3' >/dev/null   # [ASSERT-DIV-NEG-NUM]
curl -fsS "http://127.0.0.1:$PORT/divide?a=6&b=-2"  | jq -e '.quotient == -3' >/dev/null   # [ASSERT-DIV-NEG-DEN]

# --- oracle 探针（独立复算严格相等）---
EXP_FRACT=$(node -e "process.stdout.write(String(Number('1')/Number('3')))")
curl -fsS "http://127.0.0.1:$PORT/divide?a=1&b=3" | jq -e --argjson e "$EXP_FRACT" '.quotient == $e' >/dev/null   # [ASSERT-DIV-ORACLE-FRACT]

EXP_FLOAT=$(node -e "process.stdout.write(String(Number('1.5')/Number('0.5')))")
curl -fsS "http://127.0.0.1:$PORT/divide?a=1.5&b=0.5" | jq -e --argjson e "$EXP_FLOAT" '.quotient == $e' >/dev/null   # [ASSERT-DIV-ORACLE-FLOAT]

# --- 除零兜底（核心 W21 主探针）---
H=$(curl -s -o /tmp/div-dz0.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=5&b=0")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-DIVZERO-INT] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-dz0.json >/dev/null               # [ASSERT-DIV-DIVZERO-INT] (b)
jq -e 'has("quotient") | not' /tmp/div-dz0.json >/dev/null                                  # [ASSERT-DIV-DIVZERO-INT] (c)

H=$(curl -s -o /tmp/div-dz00.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=0&b=0")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-DIVZERO-BOTH] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-dz00.json >/dev/null              # [ASSERT-DIV-DIVZERO-BOTH] (b)
jq -e 'has("quotient") | not' /tmp/div-dz00.json >/dev/null                                 # [ASSERT-DIV-DIVZERO-BOTH] (c)

H=$(curl -s -o /tmp/div-dz0f.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=6&b=0.0")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-DIVZERO-FLOAT] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-dz0f.json >/dev/null              # [ASSERT-DIV-DIVZERO-FLOAT] (b)
jq -e 'has("quotient") | not' /tmp/div-dz0f.json >/dev/null                                 # [ASSERT-DIV-DIVZERO-FLOAT] (c)

# --- 缺参 ---
H=$(curl -s -o /tmp/div-mb.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=6")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-MISSING-B] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-mb.json >/dev/null                # [ASSERT-DIV-MISSING-B] (b)
jq -e 'has("quotient") | not' /tmp/div-mb.json >/dev/null                                   # [ASSERT-DIV-MISSING-B] (c)

H=$(curl -s -o /tmp/div-ma.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-MISSING-A] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-ma.json >/dev/null                # [ASSERT-DIV-MISSING-A] (b)

H=$(curl -s -o /tmp/div-mab.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-MISSING-BOTH] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-mab.json >/dev/null               # [ASSERT-DIV-MISSING-BOTH] (b)

# --- strict-schema 拒绝（防 W20 strict 被打回）---
H=$(curl -s -o /tmp/div-sci.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=1e3&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-SCI] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-sci.json >/dev/null               # [ASSERT-DIV-SCI] (b)
jq -e 'has("quotient") | not' /tmp/div-sci.json >/dev/null                                  # [ASSERT-DIV-SCI] (c)

H=$(curl -s -o /tmp/div-inf.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=Infinity&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-INFINITY] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-inf.json >/dev/null               # [ASSERT-DIV-INFINITY] (b)
jq -e 'has("quotient") | not' /tmp/div-inf.json >/dev/null                                  # [ASSERT-DIV-INFINITY] (c)

H=$(curl -s -o /tmp/div-nan.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=6&b=NaN")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-NAN] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-nan.json >/dev/null               # [ASSERT-DIV-NAN] (b)

H=$(curl -s -o /tmp/div-plus.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=%2B6&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-PLUS] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-plus.json >/dev/null              # [ASSERT-DIV-PLUS] (b)

H=$(curl -s -o /tmp/div-ld.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=.5&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-LEADING-DOT] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-ld.json >/dev/null                # [ASSERT-DIV-LEADING-DOT] (b)

H=$(curl -s -o /tmp/div-td.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=6.&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-TRAILING-DOT] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-td.json >/dev/null                # [ASSERT-DIV-TRAILING-DOT] (b)

H=$(curl -s -o /tmp/div-hex.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=0xff&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-HEX] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-hex.json >/dev/null               # [ASSERT-DIV-HEX] (b)

H=$(curl -s -o /tmp/div-comma.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=1,000&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-COMMA] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-comma.json >/dev/null             # [ASSERT-DIV-COMMA] (b)

H=$(curl -s -o /tmp/div-emp.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=&b=3")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-EMPTY] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-emp.json >/dev/null               # [ASSERT-DIV-EMPTY] (b)

H=$(curl -s -o /tmp/div-word.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=abc&b=3")
[ "$H" = "400" ]                                                                            # [ASSERT-DIV-WORD] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-word.json >/dev/null              # [ASSERT-DIV-WORD] (b)
jq -e 'has("quotient") | not' /tmp/div-word.json >/dev/null                                 # [ASSERT-DIV-WORD] (c)

# --- 回归（W19 + W20 + bootstrap 不被破坏）---
curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.ok == true' >/dev/null                  # [ASSERT-HEALTH-INTACT]
curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3" | jq -e '.sum == 5' >/dev/null               # [ASSERT-SUM-INTACT]
curl -fsS "http://127.0.0.1:$PORT/multiply?a=2&b=3" | jq -e '.product == 6' >/dev/null      # [ASSERT-MUL-INTACT]
H=$(curl -s -o /tmp/mul-strict.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=1e3&b=2")
[ "$H" = "400" ]                                                                            # [ASSERT-MUL-STRICT-INTACT] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-strict.json >/dev/null            # [ASSERT-MUL-STRICT-INTACT] (b)

echo "OK Golden Path 验证通过"
```

**通过标准**：脚本 `set -e` 下 exit 0。

---

## §7 执行层风险矩阵

| ID | 风险场景 | 触发条件 | Mitigation | Owner |
|----|---------|---------|-----------|------|
| **R1** | port 3000 被占用 | 并行测试 / 上轮残留进程 / CI runner 复用 | §6 阶段 B 用 `PLAYGROUND_PORT="${PLAYGROUND_PORT:-$(shuf -i 30000-40000 -n 1)}"` 随机化端口；起 server 后 20×0.5s 循环探活 `curl /health`，失败即视为 spawn 失败 → `set -e` 退出 | Evaluator |
| **R2** | server spawn 后崩溃但 PID 仍存在（zombie） | `NODE_ENV=production` 下静默 throw / `app.listen` 异常未传播 / express middleware 同步异常 | §6 用 `trap "kill $SERVER_PID 2>/dev/null \|\| true; wait $SERVER_PID 2>/dev/null \|\| true" EXIT` 兜底 kill；起活探测 `curl -fsS /health` 必须在 10s 内返回 200，否则 `[ "$SPAWN_OK" = "1" ] \|\| exit 1` | Evaluator |
| **R3** | Evaluator 假绿（404 / HTML / NaN / Infinity / 0-test / 宽松校验滑过 strict 边界 / oracle 比对错位） | Generator 提交空 PR / stub `res.status(200).send('OK')` 实现 / 测试套件 0 用例假 PASS / 用 `Number()` 替代正则导致 `1e3` 假绿 / **靠 `Number.isFinite(quotient)` 兜底导致 `b=0` 时 200 + `quotient: Infinity` 假绿** / 字段名误写成 `result` 而非 `quotient` | **造假防御 7 条**：<br>① 所有 curl 带 `-fsS`：HTTP 非 2xx 自动退 22<br>② 所有 JSON 断言用 `jq -e`：解析失败或表达式 false 即非 0 退出<br>③ 严格相等用 `==`（数值）：防 `{"quotient":"3"}` 字符串作弊<br>④ error 路径显式 `has("quotient") \| not`（强制于 `DIV-DIVZERO-*` / `DIV-SCI` / `DIV-INFINITY` / `DIV-WORD` / `DIV-MISSING-B`）：防 `{"quotient":NaN, "error":"..."}` 模糊态<br>⑤ 单测断言 `Tests N passed` 且 `not Tests N failed`：防 0-test 假绿<br>⑥ **W20 strict 探针保留**：`[ASSERT-DIV-SCI]` 用 `1e3`、`[ASSERT-DIV-INFINITY]` 用 `Infinity`、`[ASSERT-DIV-NAN]` 用 `NaN` token 强制实现走完整正则匹配<br>⑦ **W21 oracle 探针新增**：`[ASSERT-DIV-ORACLE-*]` 用 Node 端独立 `Number(<a>)/Number(<b>)` 复算后通过 jq `--argjson` 数值严格相等比对——防硬编码期望值 / 防字符串化 / 防四舍五入；`[ASSERT-DIV-DIVZERO-*]` 三条同时要求 `has("quotient") \| not`，强制实现走"strict 通过后立即判 b=0"路径，靠 `Number.isFinite` 兜底无法过 | Evaluator |
| **R4** | `npm ci` 网络抖动 | 离线 / npm registry 不可达 / IPv6 路由抽风 | §6 阶段 A 用 `npm ci --silent \|\| (echo "[R4] 重试..."; sleep 2; npm ci --silent)`：失败重试 1 次；仍失败即 FAIL（**不引入 cache fallback / mirror fallback**） | Evaluator |
| **R5** | cascade 失败导致定位困难 | E2E 第 N 行红，看不出是 spawn 失败 / npm ci 失败 / 单测断言失败 / HTTP 断言失败 / oracle 复算环境 node 缺失 | §6 每条断言行末尾注释 `# [ASSERT-XXX]` 回链 §4 ID；`set -euo pipefail` 让 bash 直接报错具体行号；spawn / npm ci 失败有专用 `[R1]` / `[R2]` / `[R4]` echo 标记区分阶段；oracle 探针前置 `node -e` 复算输出存入 `EXP_*` 变量，失败时 bash 直接显示空值 | Reviewer |
| **R6** | Generator 误改 `/health` / `/sum`（W19）/ `/multiply`（W20）实现 | LLM 误判 PRD「不在范围内」/ 把除零兜底顺手套到 `/multiply` 上 / 重写 strict-schema 把 W20 行为打散 | §4 引入 `[ASSERT-HEALTH-INTACT]` + `[ASSERT-SUM-INTACT]` + `[ASSERT-MUL-INTACT]` + `[ASSERT-MUL-STRICT-INTACT]` 四条回归；§5 Step 7 显式列入 Golden Path；contract-dod-ws1 的 ARTIFACT 强制源文件**仍含**`app.get('/health'` + `app.get('/sum'` + `app.get('/multiply'` 三条字面量 | Reviewer + Generator |
| **R7** | 字段命名漂移（`result` / `value` / 数字直返而非对象） | LLM 风格化把 `quotient` 改成 `result` / `value` / `answer` | §4 所有 happy/oracle ASSERT 显式用 `.quotient` 字段名；error path ASSERT 用 `has("quotient") \| not`（隐含字段名约束）；contract-dod-ws1 的 ARTIFACT 强制源文件含 `quotient` 字面量 | Reviewer + Generator |

**Owner 含义**：
- **Evaluator**：跑验证脚本时必须遵守该 mitigation（已写入 §6 脚本）
- **Reviewer**：审合同时必须确认该 mitigation 已落实（不漏审）
- **Generator**：实现代码时必须遵守该 mitigation（R6 / R7 落到 Generator）

---

## §8 测试代码骨架（内嵌可视化 — 直接来自 `tests/ws1/divide.test.js`）

> 完整文件位于 `sprints/w21-playground-divide/tests/ws1/divide.test.js`（共 26 个 `test()` 块）。
> 下面**原样**列出每个 `test()` 标题 + 关键 `expect` 断言行（注：vitest 中 `test` 与 `it` 等价，本合同沿用 `test` 与 W19 / W20 一致）。
> Reviewer 可直接据此判断"未实现时这些 expect 必 FAIL"。

```javascript
import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /divide (strict-schema + 除零兜底 + oracle) [BEHAVIOR]', () => {
  // T1 happy 整除
  test('GET /divide?a=6&b=2 → 200 + {quotient:3}', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: 3 });
    expect(typeof res.body.quotient).toBe('number');
  });

  // T2 oracle：1/3（核心 oracle 探针）
  test('GET /divide?a=1&b=3 → oracle 严格相等', async () => {
    const res = await request(app).get('/divide').query({ a: '1', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body.quotient).toBe(Number('1') / Number('3'));
  });

  // T3 负被除数
  test('GET /divide?a=-6&b=2 → 200 + {quotient:-3}', async () => {
    const res = await request(app).get('/divide').query({ a: '-6', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: -3 });
  });

  // T4 负除数
  test('GET /divide?a=6&b=-2 → 200 + {quotient:-3}', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '-2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: -3 });
  });

  // T5 a=0 合法
  test('GET /divide?a=0&b=5 → 200 + {quotient:0}', async () => {
    const res = await request(app).get('/divide').query({ a: '0', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quotient: 0 });
  });

  // T6 标准小数 oracle
  test('GET /divide?a=1.5&b=0.5 → oracle 严格相等', async () => {
    const res = await request(app).get('/divide').query({ a: '1.5', b: '0.5' });
    expect(res.status).toBe(200);
    expect(res.body.quotient).toBe(Number('1.5') / Number('0.5'));
  });

  // T7 除零兜底（W21 主探针）
  test('GET /divide?a=5&b=0 → 400 + 不含 quotient', async () => {
    const res = await request(app).get('/divide').query({ a: '5', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  // T8 0/0 也拒
  test('GET /divide?a=0&b=0 → 400 + 不含 quotient', async () => {
    const res = await request(app).get('/divide').query({ a: '0', b: '0' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  // T9 b=0.0 也算零
  test('GET /divide?a=6&b=0.0 → 400 + 不含 quotient', async () => {
    const res = await request(app).get('/divide').query({ a: '6', b: '0.0' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  // T10–T12 缺参（缺 b / 缺 a / 全缺）
  test('GET /divide?a=6 (缺 b) → 400 + 不含 quotient', async () => { /* 略 */ });
  test('GET /divide?b=2 (缺 a) → 400', async () => { /* 略 */ });
  test('GET /divide (双参数都缺) → 400', async () => { /* 略 */ });

  // T13 strict 拒绝：科学计数法（核心 strict 探针）
  test('GET /divide?a=1e3&b=2 → 400 + 不含 quotient', async () => {
    const res = await request(app).get('/divide').query({ a: '1e3', b: '2' });
    expect(res.status).toBe(400);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'quotient')).toBe(false);
  });

  // T14 Infinity
  test('GET /divide?a=Infinity&b=2 → 400 + 不含 quotient', async () => { /* 略 */ });

  // T15 NaN
  test('GET /divide?a=6&b=NaN → 400', async () => { /* 略 */ });

  // T16–T22 strict 其余拒绝（前导+ / .5 / 6. / 0xff / 1,000 / 空字符串 / abc）
  // 略：每条都期望 status 400 + error 非空

  // T23 回归 /health
  test('GET /health 仍 200 + {ok:true}', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toEqual({ ok: true });
  });

  // T24 回归 /sum (W19)
  test('GET /sum?a=2&b=3 仍 200 + {sum:5}', async () => {
    const res = await request(app).get('/sum').query({ a: '2', b: '3' });
    expect(res.body).toEqual({ sum: 5 });
  });

  // T25 回归 /multiply happy (W20)
  test('GET /multiply?a=2&b=3 仍 200 + {product:6}', async () => {
    const res = await request(app).get('/multiply').query({ a: '2', b: '3' });
    expect(res.body).toEqual({ product: 6 });
  });

  // T26 回归 /multiply strict (W20)
  test('GET /multiply?a=1e3&b=2 仍 400', async () => { /* 略 */ });
});
```

> 注：上面是骨架视图（部分 test() 体折叠为 `/* 略 */` 节省篇幅）。**完整 26 个 test() 全文以 `tests/ws1/divide.test.js` 为准** — Reviewer 应直接读源文件；任何与源文件冲突的描述以源文件为权威。

---

## §9 Red 证据来源声明（为什么这些 expect 必 FAIL）

**当前主分支事实**（截至 round 1 起草时刻）：

`playground/server.js` 实际内容（共 41 行 — W19 `/sum` + W20 `/multiply` 已合并）：

```javascript
import express from 'express';
const app = express();
const PORT = process.env.PLAYGROUND_PORT || 3000;
app.get('/health', (req, res) => { res.json({ ok: true }); });
app.get('/sum', (req, res) => { /* W19 实现 */ });
const STRICT_NUMBER = /^-?\d+(\.\d+)?$/;
app.get('/multiply', (req, res) => { /* W20 strict 实现 */ });
// 没有 app.get('/divide', ...)
if (process.env.NODE_ENV !== 'test') app.listen(PORT, ...);
export default app;
```

**关键事实**：**没有任何 `app.get('/divide', ...)` 注册**。Express 对未注册路由默认行为是返回 HTTP **404** + `Cannot GET /divide`（text/html）。

**Red 失败矩阵**（在 proposer 分支当下跑 §8 测试时 — proposer 已实跑确认 22 fail / 4 pass）：

| Test ID | 期望状态 | 实际状态（无 /divide 路由） | 失败原因 | 结论 |
|---|---|---|---|---|
| T1–T6（happy + oracle + 边界） | 200 | 404 | status 断言 | **6 FAIL** |
| T7–T9（除零兜底） | 400 | 404 | status 断言 | **3 FAIL** |
| T10–T12（缺参） | 400 | 404 | status 断言 | **3 FAIL** |
| T13–T22（strict 拒绝 10 条） | 400 | 404 | status 断言 | **10 FAIL** |
| T23（回归 /health） | 200 + `{ok:true}` | 200（W19/W20 已合并 /health 仍存在） | — | **PASS**（bootstrap 回归） |
| T24（回归 /sum） | 200 + `{sum:5}` | 200（W19 已合并） | — | **PASS**（W19 回归） |
| T25（回归 /multiply happy） | 200 + `{product:6}` | 200（W20 已合并） | — | **PASS**（W20 回归） |
| T26（回归 /multiply strict） | 400 | 400（W20 strict 仍生效） | — | **PASS**（W20 strict 回归） |

**预期 Red 总数**：**22 FAIL + 4 PASS**（远超 Reviewer ≥ 5 failures 阈值）。

**Proposer 自验命令实际输出**（已跑过）：

```text
Test Files  1 failed (1)
     Tests  22 failed | 4 passed (26)
```

**Proposer 自验命令**（commit 前 Proposer 实跑，本轮已确认）：

```bash
cd playground
cp ../sprints/w21-playground-divide/tests/ws1/divide.test.js tests/_divide_red_probe.test.js
sed -i 's|../../../../playground/server.js|../server.js|' tests/_divide_red_probe.test.js
npx vitest run tests/_divide_red_probe.test.js --reporter=verbose 2>&1 | tee /tmp/ws1-red.log || true
rm -f tests/_divide_red_probe.test.js
# 期望：Tests {N>=22} failed
grep -E "Tests\s+[0-9]+ failed" /tmp/ws1-red.log
```

---

## §10 Workstreams

workstream_count: 1

### Workstream 1: 加 `GET /divide` 路由（strict-schema + 除零兜底 + oracle）+ 单测 + README

- **范围**：
  - `playground/server.js`：在 `/multiply` 路由之后、`app.listen` 之前新增 `GET /divide` handler；用原生 RegExp `/^-?\d+(\.\d+)?$/` 对 query a/b **完整匹配**校验（**可复用 W20 的 `STRICT_NUMBER` 常量**或单写一份语义等价的）；strict 通过后**显式判定** `Number(b) === 0` → 400 + `{error}`；否则 200 + `{quotient: Number(a) / Number(b)}`。任一拒绝路径 body 都**不含** `quotient` 字段。**不动 `/health` / `/sum` / `/multiply` 的代码**。
  - `playground/tests/server.test.js`：把 §8 的 26 个 `test()` 块（完整版见 `sprints/w21-playground-divide/tests/ws1/divide.test.js`）原样合并进去（vitest 兼容，与现有 `/sum`、`/multiply` describe 块共存）；保留现有 `/health`、`/sum`、`/multiply` 用例不动。
  - `playground/README.md`：「端点」段加 `/divide`，给出 happy + 除零拒绝 + ≥ 1 条 strict-schema 拒绝示例（含 `1e3` 或 `Infinity` 任一）；保留现有 `/health`、`/sum`、`/multiply` 段不动。
- **大小**：S（< 100 行净增 — 与 W19 / W20 量级相当；server.js 新增约 12 行，单测约 200 行，README 约 20 行）
- **依赖**：无（W19 `/sum` + W20 `/multiply` 已合并，作为回归基线即可）
- **BEHAVIOR 覆盖测试文件**：`sprints/w21-playground-divide/tests/ws1/divide.test.js`

---

## §11 Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（按 §8 T-ID） | 预期 Red 证据 |
|---|---|---|---|
| WS1 | `tests/ws1/divide.test.js` | quotient、Number、除零兜底、缺 b、Infinity、health、W19、W20 | **22 failures**（T1–T22 全 FAIL，T23/T24/T25/T26 PASS）→ 远超 Reviewer ≥ 5 阈值 |

**Red 证据采集命令**：见 §9 末尾「Proposer 自验命令」（本轮已实跑确认 `Tests 22 failed | 4 passed`）。
