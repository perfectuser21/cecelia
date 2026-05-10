# Sprint Contract Draft (Round 1)

> **Initiative**: W22 Walking Skeleton — playground 加 `GET /power` endpoint（strict-schema + 0^0 拒 + 结果有限性兜底 + oracle）
> **Task ID**: 761dfe5f-3840-4e0c-9a8f-6edf0e6587d0
> **Source PRD**: `sprints/w22-playground-power/sprint-prd.md`
> **journey_type**: autonomous
> **承前**：W19 `/sum`（PR #2875）、W20 `/multiply`（PR #2878）、W21 `/divide`（PR #2881）已合并；本轮**只新增 `/power` 路由**，不动 `/health` / `/sum` / `/multiply` / `/divide` 的实现/测试一字。
> **W22 新增对抗维度**：在 W20 strict-schema + W21 输入规则拒绝的基础上，叠加**输出值级 oracle 探针**——(1) **0^0 不定式拒绝**：strict 通过后必须**显式判定** `Number(a)===0 && Number(b)===0`，不允许靠 JS 自然返 1 滑过；(2) **结果非有限拒绝**：算式后必须**显式判定** `Number.isFinite(result) === false`，覆盖 0^负 → Infinity、负^分数 → NaN、溢出 → Infinity；(3) **schema 完整性**：成功响应顶层 keys 严格等于 `["power"]`，不允许多余字段；(4) **正向 oracle**：`power === Number(a) ** Number(b)` 严格相等（独立复算，含小数指数）。

---

## §1 Golden Path

[HTTP 客户端发 `GET /power?a=2&b=10`] → [playground server 用 strict-schema 校验 query 参数 a/b → 显式判 `Number(a)===0 && Number(b)===0` → 计算 `Number(a) ** Number(b)` → 显式判 `Number.isFinite(result) === false` → 通过则返结果] → [客户端收到 HTTP 200 + body `{ "power": 1024 }`，且 `power === Number(a) ** Number(b)` 严格成立]

边界 / 副 path（同一 endpoint 上的非 happy 路径，必须同样验证）：

- **缺参**（`a` 或 `b` 任一缺失，含空字符串）→ 400 + 非空 `error` 字段，body 不含 `power`
- **strict-schema 拒绝**（不完整匹配 `^-?\d+(\.\d+)?$`，含科学计数法 / Infinity / NaN / 前导正号 / `.5` / `2.` / 十六进制 / 千分位 / 含空格 / 非数字字符串）→ 400 + 非空 `error`，body 不含 `power`
- **0^0 不定式拒绝**（strict 通过 + `Number(a)===0 && Number(b)===0`，含 `a=0&b=0`、`a=0.0&b=0`、`a=0&b=0.0` 等所有数值零形式）→ **400** + 非空 `error`，body 不含 `power`（**W22 主探针 #1**：不允许返 200 + `{power:1}`，即不允许靠 JS `0**0===1` 滑过）
- **结果非有限拒绝**（strict 通过 + 计算后 `Number.isFinite(result) === false`）→ **400** + 非空 `error`，body 不含 `power`（**W22 主探针 #2**：覆盖 0^负 → Infinity、负^分数 → NaN、大底大指 → Infinity）
- **合法边界**（5^0=1、0^5=0、1^N=1、负底整指 -2^3=-8、负底偶整指 -2^2=4、负指数 2^-2=0.25、小数指数开方 4^0.5=2）→ 200 + JS 原生算术结果（不四舍五入、不字符串化）
- **正向 oracle**（≥ 2 组合法输入，含至少 1 组小数指数 / 开方）：`body.power === Number(<a>) ** Number(<b>)` 严格相等
- **schema 完整性**：成功响应顶层 keys 严格等于 `["power"]`（不允许 `operation` / `result` / `a` / `b` / `input` 任何附加字段）
- **现有 `GET /health` / `GET /sum`（W19）/ `GET /multiply`（W20）/ `GET /divide`（W21）行为不被破坏**（回归基线）

---

## §2 journey_type

**autonomous** — playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议（与 W19、W20、W21 同分类）。

---

## §3 strict-schema + 0^0 + 结果有限性规范化定义

### 3.1 strict-schema（与 W20 / W21 一致，不重新发明）

合法 query 参数字符串必须**完整匹配**正则：

```
^-?\d+(\.\d+)?$
```

实现要求（spec 层 — 非实现指令，但以下边界必须落到代码上）：

- **不能**用 `Number()` + `Number.isFinite()` 替代正则（`Number('1e3') = 1000` 会假绿）
- **不能**用 `parseFloat()` 替代正则（`parseFloat('1e3') = 1000`、`parseFloat('1.5x') = 1.5` 都会假绿）
- 必须用 `^-?\d+(\.\d+)?$` 的**完整匹配**正则（含 `^` 和 `$` 锚），任何缺锚实现都让 `1e3` 这类输入侧滑通过
- **可与 `/multiply` / `/divide` 共享同一字面量常量**（PRD 假设 §allowed），不强制重复定义；语义等价即可

### 3.2 0^0 不定式拒绝（W22 主探针 #1 — 输入规则级，配合 strict 后置触发）

**触发位置**：strict-schema 通过 **之后**、计算 `Number(a) ** Number(b)` **之前**

**触发条件**：`Number(a) === 0 && Number(b) === 0`（覆盖 `a='0'` / `a='0.0'` / `a='-0'` 等所有 strict 通过且数值为零的输入）

**响应**：HTTP 400 + `{ error: <非空字符串> }`，body **不含** `power` 字段

**禁止实现**：
- ❌ 依赖 JS 自然算术返 `0 ** 0 === 1`（在数学上 0^0 是不定式，按 PRD 必须保守拒绝）
- ❌ 用字符串等值比较（`a === '0' && b === '0'`）— 会漏掉 `'0.0'` / `'-0'`
- ✅ 显式 `Number(a) === 0 && Number(b) === 0` 在 `Number(a) ** Number(b)` **之前**触发

### 3.3 结果有限性兜底（W22 主探针 #2 — 输出值级，事后判定）

**触发位置**：算式 `Number(a) ** Number(b)` **之后**、200 响应 **之前**

**触发条件**：`Number.isFinite(result) === false`（同时覆盖 `Infinity`、`-Infinity`、`NaN` 三类非有限值）

**响应**：HTTP 400 + `{ error: <非空字符串> }`，body **不含** `power` 字段

**覆盖场景**：
- `0^负`（如 `a=0&b=-1`、`a=0&b=-3`）→ JS 返 `Infinity` → 拒
- `负^分数`（如 `a=-2&b=0.5`、`a=-8&b=0.5`）→ JS 返 `NaN` → 拒
- 大底大指溢出（如 `a=10&b=1000`、`a=2&b=10000`）→ JS 返 `Infinity` → 拒

**禁止实现**：
- ❌ 仅判 `result === Infinity`（漏掉 `-Infinity` 与 `NaN`）
- ❌ 改用 `result === result` 比较（`NaN !== NaN` 仅能抓 NaN，漏掉 Infinity）
- ✅ 显式 `Number.isFinite(result)` 一步覆盖 NaN/Infinity/-Infinity 三种值

### 3.4 schema 完整性（W22 主探针 #3 — 字段命名锁死）

**成功响应**：JSON body 顶层 keys 必须**完全等于** `["power"]`（无 `operation` / 无 `result` / 无 `a` / 无 `b` / 无 `input` 等任何附加字段）

**错误响应**：JSON body 顶层 keys 必须**完全等于** `["error"]`（不允许 `{error, power}` 混合污染；不允许多 `message` / `msg` / `reason` / `detail` 同义键）

**字段命名锁死**：成功体的字段名**必须**是 `power`，**禁用**：
- 通用名漂移：`result`、`value`、`answer`、`out`、`output`、`data`、`payload`、`response`
- 同义替代：`exp`、`exponent`、`exponentiation`、`pow`
- 跨 endpoint 复用：`sum`（W19）、`product`（W20）、`quotient`（W21）

### 3.5 落地行为表（与 PRD §strict-schema 表 + 0^0 + 非有限行对齐 — Reviewer 可对照逐项核对）

| 输入示例 | 判定阶段 | 期望响应 | 落地 ASSERT |
|---|---|---|---|
| `a=2&b=10` | happy（整数指数） | 200 + `{power:1024}` | `[ASSERT-POW-HAPPY-INT]` |
| `a=2&b=0.5` | happy + **oracle**（开方） | 200 + `power === 2**0.5` | `[ASSERT-POW-ORACLE-SQRT]` |
| `a=4&b=0.5` | happy（整数开方） | 200 + `{power:2}` | `[ASSERT-POW-SQRT-INT]` |
| `a=-2&b=3` | happy（负底奇整指） | 200 + `{power:-8}` | `[ASSERT-POW-NEG-INT]` |
| `a=-2&b=2` | happy（负底偶整指） | 200 + `{power:4}` | `[ASSERT-POW-NEG-EVEN]` |
| `a=2&b=-2` | happy（负指数） | 200 + `{power:0.25}` | `[ASSERT-POW-NEG-EXP]` |
| `a=5&b=0` | happy（任意非零^0=1） | 200 + `{power:1}` | `[ASSERT-POW-ZERO-EXP]` |
| `a=0&b=5` | happy（0^正=0） | 200 + `{power:0}` | `[ASSERT-POW-ZERO-BASE]` |
| `a=1&b=99999` | happy（1^N=1 不溢出） | 200 + `{power:1}` | `[ASSERT-POW-ONE-BASE]` |
| `a=0&b=0` | strict 通过 + **0^0 拒**（W22 主探针 #1） | 400 + 不含 power | `[ASSERT-POW-ZERO-ZERO]` |
| `a=0&b=-1` | strict 通过 + **结果非有限拒**（0^负=Infinity） | 400 + 不含 power | `[ASSERT-POW-ZERO-NEG-EXP]` |
| `a=0&b=-3` | strict 通过 + **结果非有限拒** | 400 + 不含 power | `[ASSERT-POW-ZERO-NEG-INT]` |
| `a=-2&b=0.5` | strict 通过 + **结果非有限拒**（负^分=NaN，主探针 #2） | 400 + 不含 power | `[ASSERT-POW-NEG-FRACT]` |
| `a=-8&b=0.5` | strict 通过 + **结果非有限拒** | 400 + 不含 power | `[ASSERT-POW-NEG-FRACT-2]` |
| `a=10&b=1000` | strict 通过 + **结果非有限拒**（溢出=Infinity） | 400 + 不含 power | `[ASSERT-POW-OVERFLOW]` |
| `a=2&b=10000` | strict 通过 + **结果非有限拒** | 400 + 不含 power | `[ASSERT-POW-OVERFLOW-2]` |
| `a=2` / `b=3` / 全缺 | 缺参 | 400 + 不含 power | `[ASSERT-POW-MISSING-B]` / `[ASSERT-POW-MISSING-A]` / `[ASSERT-POW-MISSING-BOTH]` |
| `a=1e3&b=2` | strict 拒（科学计数法） | 400 + 不含 power | `[ASSERT-POW-SCI]` |
| `a=Infinity&b=2` | strict 拒 | 400 + 不含 power | `[ASSERT-POW-INFINITY]` |
| `a=2&b=NaN` | strict 拒 | 400 | `[ASSERT-POW-NAN]` |
| `a=%2B2&b=3`（前导 +） | strict 拒 | 400 | `[ASSERT-POW-PLUS]` |
| `a=.5&b=2` | strict 拒（缺整数部分） | 400 | `[ASSERT-POW-LEADING-DOT]` |
| `a=2.&b=3` | strict 拒（缺小数部分） | 400 | `[ASSERT-POW-TRAILING-DOT]` |
| `a=0xff&b=2` | strict 拒（十六进制） | 400 | `[ASSERT-POW-HEX]` |
| `a=1,000&b=2` | strict 拒（千分位） | 400 | `[ASSERT-POW-COMMA]` |
| `a=&b=3` | strict 拒（空字符串） | 400 | `[ASSERT-POW-EMPTY]` |
| `a=abc&b=3` | strict 拒（非数字） | 400 + 不含 power | `[ASSERT-POW-WORD]` |
| `a=2&b=10` 响应 schema | happy → keys === `["power"]` | 200 + 顶层无多余字段 | `[ASSERT-POW-SCHEMA-SUCCESS]` |
| `a=0&b=0` 响应 schema | 0^0 拒 → body 不含 power | 400 + body has("power")==false | `[ASSERT-POW-SCHEMA-ERROR]` |

---

## §4 ASSERT 目录（Single Source of Truth）

> 每条 ASSERT 是一条独立可执行的 bash 断言，预设环境变量 `PORT` 已指向 spawn 起来的 playground server（§6 用 `shuf` 随机化），且 `jq` / `curl` / `node` 可用。
> Step 段（§5）只引用 `[ASSERT-ID]` + 期望；E2E 脚本（§6）按顺序串起这些 ASSERT 跑，每行注释回链 ID。
> 任一 ASSERT 命令以非 0 退出即视为该断言失败 → Evaluator FAIL。
> **造假防御 7 条**见 §7 风险矩阵 R3 行 mitigation（避免重复，原文不在此处复述）。

### Happy + 边界（合法输入）

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-POW-HAPPY-INT]` | happy 整数指数：`a=2&b=10` → `{power:1024}` | `curl -fsS "http://127.0.0.1:$PORT/power?a=2&b=10" \| jq -e '.power == 1024' >/dev/null` | exit 0 |
| `[ASSERT-POW-ORACLE-SQRT]` | **oracle 探针 1**：`a=2&b=0.5` 必须等于 Node 独立复算 `Number('2') ** Number('0.5')`（开方语义） | `EXP=$(node -e "process.stdout.write(String(Number('2') ** Number('0.5')))"); curl -fsS "http://127.0.0.1:$PORT/power?a=2&b=0.5" \| jq -e --argjson e "$EXP" '.power == $e' >/dev/null` | exit 0 |
| `[ASSERT-POW-SQRT-INT]` | 整数开方：`a=4&b=0.5` → `{power:2}` | `curl -fsS "http://127.0.0.1:$PORT/power?a=4&b=0.5" \| jq -e '.power == 2' >/dev/null` | exit 0 |
| `[ASSERT-POW-NEG-INT]` | 负底奇整指：`a=-2&b=3` → `{power:-8}` | `curl -fsS "http://127.0.0.1:$PORT/power?a=-2&b=3" \| jq -e '.power == -8' >/dev/null` | exit 0 |
| `[ASSERT-POW-NEG-EVEN]` | 负底偶整指：`a=-2&b=2` → `{power:4}` | `curl -fsS "http://127.0.0.1:$PORT/power?a=-2&b=2" \| jq -e '.power == 4' >/dev/null` | exit 0 |
| `[ASSERT-POW-NEG-EXP]` | 负指数：`a=2&b=-2` → `{power:0.25}` | `curl -fsS "http://127.0.0.1:$PORT/power?a=2&b=-2" \| jq -e '.power == 0.25' >/dev/null` | exit 0 |
| `[ASSERT-POW-ZERO-EXP]` | 任意非零^0=1：`a=5&b=0` → `{power:1}`（防把含 0 全拒） | `curl -fsS "http://127.0.0.1:$PORT/power?a=5&b=0" \| jq -e '.power == 1' >/dev/null` | exit 0 |
| `[ASSERT-POW-ZERO-BASE]` | 0^正=0：`a=0&b=5` → `{power:0}`（防把含 0 全拒） | `curl -fsS "http://127.0.0.1:$PORT/power?a=0&b=5" \| jq -e '.power == 0' >/dev/null` | exit 0 |
| `[ASSERT-POW-ONE-BASE]` | 1^N=1 不溢出：`a=1&b=99999` → `{power:1}` | `curl -fsS "http://127.0.0.1:$PORT/power?a=1&b=99999" \| jq -e '.power == 1' >/dev/null` | exit 0 |

### 0^0 不定式拒（W22 主探针 #1 — strict 通过 + 数学不定式）

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-POW-ZERO-ZERO]` | `a=0&b=0` → 400 + 非空 error + 不含 power（**核心新增 #1**：JS 原生 `0**0===1` 但保守拒） | `H=$(curl -s -o /tmp/pow-zz.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=0&b=0"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-zz.json >/dev/null && jq -e 'has("power") \| not' /tmp/pow-zz.json >/dev/null` | exit 0 |

### 结果非有限拒（W22 主探针 #2 — strict 通过 + Number.isFinite===false）

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-POW-ZERO-NEG-EXP]` | `a=0&b=-1` → 400 + 不含 power（0^负=Infinity） | `H=$(curl -s -o /tmp/pow-0n.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=0&b=-1"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-0n.json >/dev/null && jq -e 'has("power") \| not' /tmp/pow-0n.json >/dev/null` | exit 0 |
| `[ASSERT-POW-ZERO-NEG-INT]` | `a=0&b=-3` → 400 + 不含 power | `H=$(curl -s -o /tmp/pow-0n3.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=0&b=-3"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-0n3.json >/dev/null && jq -e 'has("power") \| not' /tmp/pow-0n3.json >/dev/null` | exit 0 |
| `[ASSERT-POW-NEG-FRACT]` | `a=-2&b=0.5` → 400 + 不含 power（**核心新增 #2**：负^分=NaN） | `H=$(curl -s -o /tmp/pow-nf.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=-2&b=0.5"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-nf.json >/dev/null && jq -e 'has("power") \| not' /tmp/pow-nf.json >/dev/null` | exit 0 |
| `[ASSERT-POW-NEG-FRACT-2]` | `a=-8&b=0.5` → 400 + 不含 power | `H=$(curl -s -o /tmp/pow-nf2.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=-8&b=0.5"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-nf2.json >/dev/null && jq -e 'has("power") \| not' /tmp/pow-nf2.json >/dev/null` | exit 0 |
| `[ASSERT-POW-OVERFLOW]` | `a=10&b=1000` → 400 + 不含 power（**核心新增 #3**：溢出=Infinity） | `H=$(curl -s -o /tmp/pow-of.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=10&b=1000"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-of.json >/dev/null && jq -e 'has("power") \| not' /tmp/pow-of.json >/dev/null` | exit 0 |
| `[ASSERT-POW-OVERFLOW-2]` | `a=2&b=10000` → 400 + 不含 power | `H=$(curl -s -o /tmp/pow-of2.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=2&b=10000"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-of2.json >/dev/null && jq -e 'has("power") \| not' /tmp/pow-of2.json >/dev/null` | exit 0 |

### Schema 完整性（W22 主探针 #3 — 顶层 keys 严格匹配）

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-POW-SCHEMA-SUCCESS]` | 成功响应顶层 keys 严格等于 `["power"]`（**禁多余字段 — 防 generator 加 operation/result/a/b/input**） | `curl -fsS "http://127.0.0.1:$PORT/power?a=2&b=10" \| jq -e '(keys \| sort) == ["power"]' >/dev/null` | exit 0 |
| `[ASSERT-POW-SCHEMA-ERROR]` | 错误响应 body 不含 power（与 has-not 重复但显式 codify 字段命名约束） | `curl -s "http://127.0.0.1:$PORT/power?a=0&b=0" \| jq -e 'has("power") \| not' >/dev/null` | exit 0 |
| `[ASSERT-POW-FIELD-NAME]` | 字段名锁死：成功体不允许同义替代（`result`/`value`/`answer`/`exp`/`exponent`/`pow`/`output`/`product`/`sum`/`quotient`） | `curl -fsS "http://127.0.0.1:$PORT/power?a=2&b=10" \| jq -e '(has("result") or has("value") or has("answer") or has("exp") or has("exponent") or has("pow") or has("output") or has("product") or has("sum") or has("quotient")) \| not' >/dev/null` | exit 0 |

### 缺参

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-POW-MISSING-B]` | 缺 b → 400 + 非空 error + 不含 power | `H=$(curl -s -o /tmp/pow-mb.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-mb.json >/dev/null && jq -e 'has("power") \| not' /tmp/pow-mb.json >/dev/null` | exit 0 |
| `[ASSERT-POW-MISSING-A]` | 缺 a → 400 + 非空 error | `H=$(curl -s -o /tmp/pow-ma.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?b=3"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-ma.json >/dev/null` | exit 0 |
| `[ASSERT-POW-MISSING-BOTH]` | 双参数都缺 → 400 + 非空 error | `H=$(curl -s -o /tmp/pow-mab.json -w '%{http_code}' "http://127.0.0.1:$PORT/power"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-mab.json >/dev/null` | exit 0 |

### strict-schema 拒绝（非法输入 — 与 W20/W21 同探针集，确保 strict 不被打回）

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-POW-SCI]` | 科学计数法 `1e3` → 400 + 不含 power（**防 Number() 假绿**） | `H=$(curl -s -o /tmp/pow-sci.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=1e3&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-sci.json >/dev/null && jq -e 'has("power") \| not' /tmp/pow-sci.json >/dev/null` | exit 0 |
| `[ASSERT-POW-INFINITY]` | `Infinity` → 400 + 不含 power | `H=$(curl -s -o /tmp/pow-inf.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=Infinity&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-inf.json >/dev/null && jq -e 'has("power") \| not' /tmp/pow-inf.json >/dev/null` | exit 0 |
| `[ASSERT-POW-NAN]` | `NaN` 字符串（在 b 上） → 400 + 非空 error | `H=$(curl -s -o /tmp/pow-nan.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=2&b=NaN"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-nan.json >/dev/null` | exit 0 |
| `[ASSERT-POW-PLUS]` | 前导正号 `+2`（URL `%2B2`） → 400 + 非空 error | `H=$(curl -s -o /tmp/pow-plus.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=%2B2&b=3"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-plus.json >/dev/null` | exit 0 |
| `[ASSERT-POW-LEADING-DOT]` | `.5`（缺整数部分） → 400 + 非空 error | `H=$(curl -s -o /tmp/pow-ld.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=.5&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-ld.json >/dev/null` | exit 0 |
| `[ASSERT-POW-TRAILING-DOT]` | `2.`（缺小数部分） → 400 + 非空 error | `H=$(curl -s -o /tmp/pow-td.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=2.&b=3"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-td.json >/dev/null` | exit 0 |
| `[ASSERT-POW-HEX]` | `0xff` → 400 + 非空 error | `H=$(curl -s -o /tmp/pow-hex.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=0xff&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-hex.json >/dev/null` | exit 0 |
| `[ASSERT-POW-COMMA]` | 千分位 `1,000` → 400 + 非空 error | `H=$(curl -s -o /tmp/pow-comma.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=1,000&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-comma.json >/dev/null` | exit 0 |
| `[ASSERT-POW-EMPTY]` | 空字符串 `a=&b=3` → 400 + 非空 error | `H=$(curl -s -o /tmp/pow-emp.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=&b=3"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-emp.json >/dev/null` | exit 0 |
| `[ASSERT-POW-WORD]` | 非数字字符串 `abc` → 400 + 非空 error + 不含 power | `H=$(curl -s -o /tmp/pow-word.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=abc&b=3"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/pow-word.json >/dev/null && jq -e 'has("power") \| not' /tmp/pow-word.json >/dev/null` | exit 0 |

### 回归（不破坏现有 endpoint）

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-HEALTH-INTACT]` | `/health` 仍 200 + `{ok:true}` | `curl -fsS "http://127.0.0.1:$PORT/health" \| jq -e '.ok == true' >/dev/null` | exit 0 |
| `[ASSERT-SUM-INTACT]` | W19 `/sum` 仍 200 + `{sum:5}` | `curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3" \| jq -e '.sum == 5' >/dev/null` | exit 0 |
| `[ASSERT-MUL-INTACT]` | W20 `/multiply` 仍 200 + `{product:6}` | `curl -fsS "http://127.0.0.1:$PORT/multiply?a=2&b=3" \| jq -e '.product == 6' >/dev/null` | exit 0 |
| `[ASSERT-MUL-STRICT-INTACT]` | W20 `/multiply` strict 不被打回（`1e3` 仍 400） | `H=$(curl -s -o /tmp/mul-strict.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=1e3&b=2"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/mul-strict.json >/dev/null` | exit 0 |
| `[ASSERT-DIV-INTACT]` | W21 `/divide` 仍 200 + `{quotient:3}` | `curl -fsS "http://127.0.0.1:$PORT/divide?a=6&b=2" \| jq -e '.quotient == 3' >/dev/null` | exit 0 |
| `[ASSERT-DIV-DIVZERO-INTACT]` | W21 除零兜底仍生效（`b=0` 仍 400） | `H=$(curl -s -o /tmp/div-dz.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=5&b=0"); [ "$H" = "400" ] && jq -e '.error \| type == "string" and length > 0' /tmp/div-dz.json >/dev/null && jq -e 'has("quotient") \| not' /tmp/div-dz.json >/dev/null` | exit 0 |

### 单测套件

| ID | 用途 | 命令 | 期望 |
|---|---|---|---|
| `[ASSERT-UNIT-PASSED]` | playground 单测套件全绿 | `cd playground && npm ci --silent && npm test -- --reporter=verbose 2>&1 \| tee /tmp/playground-unit.log; grep -E "Tests\s+[0-9]+ passed" /tmp/playground-unit.log && ! grep -E "Tests\s+[0-9]+ failed" /tmp/playground-unit.log` | exit 0 |
| `[ASSERT-UNIT-COVERS-POW]` | 单测确实覆盖 `/power` happy + 拒绝路径 | `grep -E "GET /power.*200" /tmp/playground-unit.log && grep -Ei "GET /power.*(400\|invalid\|missing\|error\|拒绝\|不定式\|非有限\|溢出)" /tmp/playground-unit.log` | exit 0 |
| `[ASSERT-UNIT-COVERS-ZERO-ZERO]` | 单测**显式**覆盖 0^0 不定式拒（`a=0&b=0` 形式） | `grep -E "a:\s*'0'.*b:\s*'0'\|a=0.*b=0" /tmp/playground-unit.log` | exit 0 |
| `[ASSERT-UNIT-COVERS-FINITE]` | 单测**显式**覆盖结果非有限拒（0^负 + 负^分 + 溢出 任一文本特征） | `grep -Ei "0\^负\|负\^分\|溢出\|isFinite\|Infinity\|NaN.*power\|power.*Infinity" /tmp/playground-unit.log \|\| grep -Ei "(b=-1\|b=-3\|b=0\.5.*a=-\|b=10000\|b=1000)" /tmp/playground-unit.log` | exit 0 |
| `[ASSERT-UNIT-COVERS-ORACLE]` | 单测**显式**含 oracle 复算断言（`Number(...) ** Number(...)`） | `grep -E "toBe\(\s*Number\([^)]+\)\s*\*\*\s*Number\([^)]+\)\s*\)" playground/tests/server.test.js` | exit 0 |
| `[ASSERT-UNIT-COVERS-SCHEMA]` | 单测**显式**含 schema oracle 断言（`Object.keys(res.body).sort()` 形式） | `grep -E "Object\.keys\(res\.body\).*toEqual\(\s*\[\s*['\"]power['\"]\s*\]\s*\)" playground/tests/server.test.js \|\| grep -E "expect\(Object\.keys\(res\.body\)" playground/tests/server.test.js` | exit 0 |
| `[ASSERT-UNIT-COVERS-STRICT]` | 单测显式覆盖 strict 核心拒绝（`1e3` + `Infinity` 各 ≥ 1） | `grep -Ei "1e3\|科学计数" /tmp/playground-unit.log && grep -Ei "Infinity" /tmp/playground-unit.log` | exit 0 |

---

## §5 Golden Path Steps（每步只引用 ASSERT ID）

> Step 段不再内嵌 bash。可执行形式见 §6 E2E 脚本。

### Step 1: 客户端发 `GET /power?a=2&b=10`，收到 200 + `{ "power": 1024 }`

- **可观测行为**：playground server 对合法整数指数 query 返回 HTTP 200，body 是含 `power` 字段的 JSON，值等于算术指数结果。
- **断言**：`[ASSERT-POW-HAPPY-INT]`
- **硬阈值**：HTTP 200 + body `.power === 1024`（数值类型严格，不允许字符串 `"1024"`）

### Step 2: 正向 oracle — 幂结果等于独立复算（核心新增，含开方语义）

- **可观测行为**：对至少 2 组合法输入（其中至少 1 组小数指数 / 开方场景，如 `a=2&b=0.5`、`a=4&b=0.5`），server 返回 200，且 `body.power` **数值严格等于** Node 端独立用 `Number(<a>) ** Number(<b>)` 算出的 JS Number 浮点值。
- **断言**：`[ASSERT-POW-ORACLE-SQRT]` + `[ASSERT-POW-SQRT-INT]`
- **硬阈值**：jq `--argjson` 注入 Node 复算值后 `==` 严格相等；不允许字符串化 / 不允许四舍五入 / 不允许字段重命名。

### Step 3: 合法边界（含 0、负数、负指数、1^N、5^0、0^正）正常计算

- **可观测行为**：`a=-2&b=3`（负底奇整指）/ `a=-2&b=2`（负底偶整指）/ `a=2&b=-2`（负指数）/ `a=5&b=0`（任意非零^0）/ `a=0&b=5`（0^正）/ `a=1&b=99999`（1^N）都视作合法 strict 输入，server 返回 200 + 正确算术结果；**不能误把所有含 0 / 含 1 / 含负数的也拒掉**。
- **断言**：`[ASSERT-POW-NEG-INT]` + `[ASSERT-POW-NEG-EVEN]` + `[ASSERT-POW-NEG-EXP]` + `[ASSERT-POW-ZERO-EXP]` + `[ASSERT-POW-ZERO-BASE]` + `[ASSERT-POW-ONE-BASE]` 全 exit 0
- **硬阈值**：六条断言全部 exit 0；power 数值精确相等（`{power:1}` 的 `1` 是 JS Number `1`，不是 `"1"`）

### Step 4: 0^0 不定式拒绝 — strict 通过但 a=b=0 必须 400（W22 主探针 #1）

- **可观测行为**：`a=0&b=0` 输入返回 400 + 非空 `error` + body **不含** `power`；**不允许** 200 + `{power:1}`（即不允许靠 JS `0**0===1` 滑过）。
- **断言**：`[ASSERT-POW-ZERO-ZERO]`
- **硬阈值**：HTTP 严格 400；`.error` 非空字符串；`has("power") == false`；该判定**必须**发生在 strict-schema 通过 **之后**、调用 `Number(a) ** Number(b)` **之前**。

### Step 5: 结果非有限拒绝 — strict 通过但 Number.isFinite(result)===false 必须 400（W22 主探针 #2）

- **可观测行为**：以下 6 类输入**全部**返回 400 + 非空 `error` + body 不含 `power`：
  - 0^负：`a=0&b=-1`、`a=0&b=-3` → JS 返 `Infinity`
  - 负^分数：`a=-2&b=0.5`、`a=-8&b=0.5` → JS 返 `NaN`
  - 大底大指溢出：`a=10&b=1000`、`a=2&b=10000` → JS 返 `Infinity`
- **断言**：`[ASSERT-POW-ZERO-NEG-EXP]` + `[ASSERT-POW-ZERO-NEG-INT]` + `[ASSERT-POW-NEG-FRACT]` + `[ASSERT-POW-NEG-FRACT-2]` + `[ASSERT-POW-OVERFLOW]` + `[ASSERT-POW-OVERFLOW-2]` 全 exit 0
- **硬阈值**：六条断言全部 exit 0；该判定**必须**用 `Number.isFinite(result)`（同时覆盖 NaN/Infinity/-Infinity），**不允许仅判** `result === Infinity`（漏 `-Infinity` 与 `NaN`）。

### Step 6: Schema 完整性 — 顶层 keys 严格等于 ["power"]，禁多余字段（W22 主探针 #3）

- **可观测行为**：成功响应 `(keys | sort) == ["power"]`；错误响应 body 不含 `power` 字段；成功体不允许同义替代字段（`result`/`value`/`answer`/`exp`/`exponent`/`pow`/`output`/`product`/`sum`/`quotient`）出现。
- **断言**：`[ASSERT-POW-SCHEMA-SUCCESS]` + `[ASSERT-POW-SCHEMA-ERROR]` + `[ASSERT-POW-FIELD-NAME]`
- **硬阈值**：三条断言全部 exit 0；`jq -e '(keys | sort) == ["power"]'` 完整匹配。

### Step 7: 缺参 → 400 + 非空 `error`，body 不含 `power`

- **可观测行为**：`a=2`（缺 b）/ `b=3`（缺 a）/ 双参数都缺 → 400 + JSON `error`；**不允许** 200 + `{power:NaN}` 或 500。
- **断言**：`[ASSERT-POW-MISSING-B]` + `[ASSERT-POW-MISSING-A]` + `[ASSERT-POW-MISSING-BOTH]`
- **硬阈值**：HTTP 严格 400 + `.error` 非空 + （缺 b 用例）`has("power") == false`

### Step 8: strict-schema 拒绝核心案例（防 W20/W21 strict 被打回）

- **可观测行为**：以下 10 类输入**全部**返回 400 + 非空 `error` + body 不含 `power`：
  - 科学计数法 `1e3`
  - `Infinity`
  - `NaN` 字符串
  - 前导正号 `+2`（URL `%2B2`）
  - `.5`（缺整数部分）
  - `2.`（缺小数部分）
  - `0xff`（十六进制）
  - `1,000`（千分位）
  - 空字符串 `a=&b=3`
  - 非数字字符串 `abc`
- **断言**：`[ASSERT-POW-SCI]` + `[ASSERT-POW-INFINITY]` + `[ASSERT-POW-NAN]` + `[ASSERT-POW-PLUS]` + `[ASSERT-POW-LEADING-DOT]` + `[ASSERT-POW-TRAILING-DOT]` + `[ASSERT-POW-HEX]` + `[ASSERT-POW-COMMA]` + `[ASSERT-POW-EMPTY]` + `[ASSERT-POW-WORD]` 全部 exit 0
- **硬阈值**：10 条断言全部 exit 0；其中 `POW-SCI` / `POW-INFINITY` / `POW-WORD` 额外要求 body **不含** `power` 字段（防 `{power:NaN, error:"..."}` 模糊态）

### Step 9: 现有 `/health` + `/sum`（W19）+ `/multiply`（W20）+ `/divide`（W21）不被破坏

- **可观测行为**：`/health` 仍 200 + `{ok:true}`；`/sum?a=2&b=3` 仍 200 + `{sum:5}`；`/multiply?a=2&b=3` 仍 200 + `{product:6}`；W20 strict 不被打回（`/multiply?a=1e3&b=2` 仍 400）；`/divide?a=6&b=2` 仍 200 + `{quotient:3}`；W21 除零兜底仍生效（`/divide?a=5&b=0` 仍 400）。
- **断言**：`[ASSERT-HEALTH-INTACT]` + `[ASSERT-SUM-INTACT]` + `[ASSERT-MUL-INTACT]` + `[ASSERT-MUL-STRICT-INTACT]` + `[ASSERT-DIV-INTACT]` + `[ASSERT-DIV-DIVZERO-INTACT]`
- **硬阈值**：六条断言全部 exit 0

### Step 10: 单测套件全绿（`npm test` 在 `playground/` 内）

- **可观测行为**：`playground/tests/server.test.js` 含 `/power` describe 块（happy + 0^0 + 结果非有限 + strict 拒 + oracle 复算 + schema oracle）全部 pass；`/health` + `/sum` + `/multiply` + `/divide` 用例继续 pass。
- **断言**：`[ASSERT-UNIT-PASSED]` + `[ASSERT-UNIT-COVERS-POW]` + `[ASSERT-UNIT-COVERS-ZERO-ZERO]` + `[ASSERT-UNIT-COVERS-FINITE]` + `[ASSERT-UNIT-COVERS-ORACLE]` + `[ASSERT-UNIT-COVERS-SCHEMA]` + `[ASSERT-UNIT-COVERS-STRICT]`
- **硬阈值**：vitest 退出 0；日志 grep 到 `/power.*200` 与 `/power.*(400|error|missing|拒绝|不定式|非有限|溢出)` 各 ≥ 1 行；0^0 拒绝标识（`a=0.*b=0`）≥ 1 行；结果非有限标识（`b=-1` / `b=-3` / `a=-.*b=0.5` / `b=10000` / `b=1000` 任一）≥ 1 行；oracle 复算断言（源文件层面 `Number(...) ** Number(...)`）≥ 1 行；schema oracle 断言（源文件层面 `Object.keys(res.body)...['power']`）≥ 1 行；strict-schema 拒绝标识（`1e3` / `科学计数` 任一 + `Infinity`）各 ≥ 1 行；不含 `Tests N failed`。

---

## §6 E2E 验收脚本（最终 Evaluator 直接跑 — SSOT 可执行形式）

> 与 W19 round 3 / W20 / W21 同骨架（PORT 随机化 / health 起活探测 / npm ci 失败重试 / trap EXIT 兜底 / cascade ID 注释），按 W22 的 ASSERT 集合替换 + 加 0^0 / 结果非有限 / schema oracle / W21 回归段。

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
grep -E "Tests\s+[0-9]+ passed" /tmp/playground-unit.log                            # [ASSERT-UNIT-PASSED] (a)
! grep -E "Tests\s+[0-9]+ failed" /tmp/playground-unit.log                          # [ASSERT-UNIT-PASSED] (b)
grep -E "GET /power.*200" /tmp/playground-unit.log                                  # [ASSERT-UNIT-COVERS-POW] (a)
grep -Ei "GET /power.*(400|missing|invalid|error|拒绝|不定式|非有限|溢出)" /tmp/playground-unit.log   # [ASSERT-UNIT-COVERS-POW] (b)
grep -E "a:\s*'0'.*b:\s*'0'|a=0.*b=0" /tmp/playground-unit.log                       # [ASSERT-UNIT-COVERS-ZERO-ZERO]
grep -Ei "(b=-1|b=-3|b=0\.5.*a=-|b=10000|b=1000)" /tmp/playground-unit.log           # [ASSERT-UNIT-COVERS-FINITE]
grep -E "Number\([^)]+\)\s*\*\*\s*Number\([^)]+\)" tests/server.test.js              # [ASSERT-UNIT-COVERS-ORACLE]（源文件层）
grep -E "Object\.keys\(res\.body\)" tests/server.test.js                             # [ASSERT-UNIT-COVERS-SCHEMA]（源文件层）
grep -Ei "1e3|科学计数" /tmp/playground-unit.log                                     # [ASSERT-UNIT-COVERS-STRICT] (a)
grep -Ei "Infinity" /tmp/playground-unit.log                                         # [ASSERT-UNIT-COVERS-STRICT] (b)

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
curl -fsS "http://127.0.0.1:$PORT/power?a=2&b=10"     | jq -e '.power == 1024' >/dev/null   # [ASSERT-POW-HAPPY-INT]
curl -fsS "http://127.0.0.1:$PORT/power?a=4&b=0.5"    | jq -e '.power == 2'    >/dev/null   # [ASSERT-POW-SQRT-INT]
curl -fsS "http://127.0.0.1:$PORT/power?a=-2&b=3"     | jq -e '.power == -8'   >/dev/null   # [ASSERT-POW-NEG-INT]
curl -fsS "http://127.0.0.1:$PORT/power?a=-2&b=2"     | jq -e '.power == 4'    >/dev/null   # [ASSERT-POW-NEG-EVEN]
curl -fsS "http://127.0.0.1:$PORT/power?a=2&b=-2"     | jq -e '.power == 0.25' >/dev/null   # [ASSERT-POW-NEG-EXP]
curl -fsS "http://127.0.0.1:$PORT/power?a=5&b=0"      | jq -e '.power == 1'    >/dev/null   # [ASSERT-POW-ZERO-EXP]
curl -fsS "http://127.0.0.1:$PORT/power?a=0&b=5"      | jq -e '.power == 0'    >/dev/null   # [ASSERT-POW-ZERO-BASE]
curl -fsS "http://127.0.0.1:$PORT/power?a=1&b=99999"  | jq -e '.power == 1'    >/dev/null   # [ASSERT-POW-ONE-BASE]

# --- oracle 探针（独立复算严格相等，含小数指数 / 开方）---
EXP_SQRT=$(node -e "process.stdout.write(String(Number('2') ** Number('0.5')))")
curl -fsS "http://127.0.0.1:$PORT/power?a=2&b=0.5" | jq -e --argjson e "$EXP_SQRT" '.power == $e' >/dev/null   # [ASSERT-POW-ORACLE-SQRT]

# --- 0^0 不定式拒（W22 主探针 #1）---
H=$(curl -s -o /tmp/pow-zz.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=0&b=0")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-ZERO-ZERO] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-zz.json >/dev/null                  # [ASSERT-POW-ZERO-ZERO] (b)
jq -e 'has("power") | not' /tmp/pow-zz.json >/dev/null                                        # [ASSERT-POW-ZERO-ZERO] (c)

# --- 结果非有限拒（W22 主探针 #2 — 0^负 + 负^分 + 溢出）---
H=$(curl -s -o /tmp/pow-0n.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=0&b=-1")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-ZERO-NEG-EXP] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-0n.json >/dev/null                  # [ASSERT-POW-ZERO-NEG-EXP] (b)
jq -e 'has("power") | not' /tmp/pow-0n.json >/dev/null                                        # [ASSERT-POW-ZERO-NEG-EXP] (c)

H=$(curl -s -o /tmp/pow-0n3.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=0&b=-3")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-ZERO-NEG-INT] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-0n3.json >/dev/null                 # [ASSERT-POW-ZERO-NEG-INT] (b)
jq -e 'has("power") | not' /tmp/pow-0n3.json >/dev/null                                       # [ASSERT-POW-ZERO-NEG-INT] (c)

H=$(curl -s -o /tmp/pow-nf.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=-2&b=0.5")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-NEG-FRACT] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-nf.json >/dev/null                  # [ASSERT-POW-NEG-FRACT] (b)
jq -e 'has("power") | not' /tmp/pow-nf.json >/dev/null                                        # [ASSERT-POW-NEG-FRACT] (c)

H=$(curl -s -o /tmp/pow-nf2.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=-8&b=0.5")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-NEG-FRACT-2] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-nf2.json >/dev/null                 # [ASSERT-POW-NEG-FRACT-2] (b)
jq -e 'has("power") | not' /tmp/pow-nf2.json >/dev/null                                       # [ASSERT-POW-NEG-FRACT-2] (c)

H=$(curl -s -o /tmp/pow-of.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=10&b=1000")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-OVERFLOW] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-of.json >/dev/null                  # [ASSERT-POW-OVERFLOW] (b)
jq -e 'has("power") | not' /tmp/pow-of.json >/dev/null                                        # [ASSERT-POW-OVERFLOW] (c)

H=$(curl -s -o /tmp/pow-of2.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=2&b=10000")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-OVERFLOW-2] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-of2.json >/dev/null                 # [ASSERT-POW-OVERFLOW-2] (b)
jq -e 'has("power") | not' /tmp/pow-of2.json >/dev/null                                       # [ASSERT-POW-OVERFLOW-2] (c)

# --- Schema 完整性（W22 主探针 #3）---
curl -fsS "http://127.0.0.1:$PORT/power?a=2&b=10" | jq -e '(keys | sort) == ["power"]' >/dev/null    # [ASSERT-POW-SCHEMA-SUCCESS]
curl -s "http://127.0.0.1:$PORT/power?a=0&b=0"    | jq -e 'has("power") | not' >/dev/null            # [ASSERT-POW-SCHEMA-ERROR]
curl -fsS "http://127.0.0.1:$PORT/power?a=2&b=10" | jq -e '(has("result") or has("value") or has("answer") or has("exp") or has("exponent") or has("pow") or has("output") or has("product") or has("sum") or has("quotient")) | not' >/dev/null    # [ASSERT-POW-FIELD-NAME]

# --- 缺参 ---
H=$(curl -s -o /tmp/pow-mb.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=2")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-MISSING-B] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-mb.json >/dev/null                  # [ASSERT-POW-MISSING-B] (b)
jq -e 'has("power") | not' /tmp/pow-mb.json >/dev/null                                        # [ASSERT-POW-MISSING-B] (c)

H=$(curl -s -o /tmp/pow-ma.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?b=3")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-MISSING-A] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-ma.json >/dev/null                  # [ASSERT-POW-MISSING-A] (b)

H=$(curl -s -o /tmp/pow-mab.json -w '%{http_code}' "http://127.0.0.1:$PORT/power")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-MISSING-BOTH] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-mab.json >/dev/null                 # [ASSERT-POW-MISSING-BOTH] (b)

# --- strict-schema 拒绝（防 W20/W21 strict 被打回）---
H=$(curl -s -o /tmp/pow-sci.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=1e3&b=2")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-SCI] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-sci.json >/dev/null                 # [ASSERT-POW-SCI] (b)
jq -e 'has("power") | not' /tmp/pow-sci.json >/dev/null                                       # [ASSERT-POW-SCI] (c)

H=$(curl -s -o /tmp/pow-inf.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=Infinity&b=2")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-INFINITY] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-inf.json >/dev/null                 # [ASSERT-POW-INFINITY] (b)
jq -e 'has("power") | not' /tmp/pow-inf.json >/dev/null                                       # [ASSERT-POW-INFINITY] (c)

H=$(curl -s -o /tmp/pow-nan.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=2&b=NaN")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-NAN] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-nan.json >/dev/null                 # [ASSERT-POW-NAN] (b)

H=$(curl -s -o /tmp/pow-plus.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=%2B2&b=3")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-PLUS] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-plus.json >/dev/null                # [ASSERT-POW-PLUS] (b)

H=$(curl -s -o /tmp/pow-ld.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=.5&b=2")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-LEADING-DOT] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-ld.json >/dev/null                  # [ASSERT-POW-LEADING-DOT] (b)

H=$(curl -s -o /tmp/pow-td.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=2.&b=3")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-TRAILING-DOT] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-td.json >/dev/null                  # [ASSERT-POW-TRAILING-DOT] (b)

H=$(curl -s -o /tmp/pow-hex.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=0xff&b=2")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-HEX] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-hex.json >/dev/null                 # [ASSERT-POW-HEX] (b)

H=$(curl -s -o /tmp/pow-comma.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=1,000&b=2")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-COMMA] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-comma.json >/dev/null               # [ASSERT-POW-COMMA] (b)

H=$(curl -s -o /tmp/pow-emp.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=&b=3")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-EMPTY] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-emp.json >/dev/null                 # [ASSERT-POW-EMPTY] (b)

H=$(curl -s -o /tmp/pow-word.json -w '%{http_code}' "http://127.0.0.1:$PORT/power?a=abc&b=3")
[ "$H" = "400" ]                                                                              # [ASSERT-POW-WORD] (a)
jq -e '.error | type == "string" and length > 0' /tmp/pow-word.json >/dev/null                # [ASSERT-POW-WORD] (b)
jq -e 'has("power") | not' /tmp/pow-word.json >/dev/null                                      # [ASSERT-POW-WORD] (c)

# --- 回归（W19 + W20 + W21 + bootstrap 不被破坏）---
curl -fsS "http://127.0.0.1:$PORT/health" | jq -e '.ok == true' >/dev/null                    # [ASSERT-HEALTH-INTACT]
curl -fsS "http://127.0.0.1:$PORT/sum?a=2&b=3" | jq -e '.sum == 5' >/dev/null                 # [ASSERT-SUM-INTACT]
curl -fsS "http://127.0.0.1:$PORT/multiply?a=2&b=3" | jq -e '.product == 6' >/dev/null        # [ASSERT-MUL-INTACT]
H=$(curl -s -o /tmp/mul-strict.json -w '%{http_code}' "http://127.0.0.1:$PORT/multiply?a=1e3&b=2")
[ "$H" = "400" ]                                                                              # [ASSERT-MUL-STRICT-INTACT] (a)
jq -e '.error | type == "string" and length > 0' /tmp/mul-strict.json >/dev/null              # [ASSERT-MUL-STRICT-INTACT] (b)
curl -fsS "http://127.0.0.1:$PORT/divide?a=6&b=2" | jq -e '.quotient == 3' >/dev/null         # [ASSERT-DIV-INTACT]
H=$(curl -s -o /tmp/div-dz.json -w '%{http_code}' "http://127.0.0.1:$PORT/divide?a=5&b=0")
[ "$H" = "400" ]                                                                              # [ASSERT-DIV-DIVZERO-INTACT] (a)
jq -e '.error | type == "string" and length > 0' /tmp/div-dz.json >/dev/null                  # [ASSERT-DIV-DIVZERO-INTACT] (b)
jq -e 'has("quotient") | not' /tmp/div-dz.json >/dev/null                                     # [ASSERT-DIV-DIVZERO-INTACT] (c)

echo "OK Golden Path 验证通过"
```

**通过标准**：脚本 `set -e` 下 exit 0。

---

## §7 执行层风险矩阵

| ID | 风险场景 | 触发条件 | Mitigation | Owner |
|----|---------|---------|-----------|------|
| **R1** | port 3000 被占用 | 并行测试 / 上轮残留进程 / CI runner 复用 | §6 阶段 B 用 `PLAYGROUND_PORT="${PLAYGROUND_PORT:-$(shuf -i 30000-40000 -n 1)}"` 随机化端口；起 server 后 20×0.5s 循环探活 `curl /health`，失败即视为 spawn 失败 → `set -e` 退出 | Evaluator |
| **R2** | server spawn 后崩溃但 PID 仍存在（zombie） | `NODE_ENV=production` 下静默 throw / `app.listen` 异常未传播 / express middleware 同步异常 | §6 用 `trap "kill $SERVER_PID 2>/dev/null \|\| true; wait $SERVER_PID 2>/dev/null \|\| true" EXIT` 兜底 kill；起活探测 `curl -fsS /health` 必须在 10s 内返回 200，否则 `[ "$SPAWN_OK" = "1" ] \|\| exit 1` | Evaluator |
| **R3** | Evaluator 假绿（404 / HTML / NaN / Infinity / 0-test / 宽松校验滑过 strict 边界 / oracle 比对错位 / 0^0 靠 JS 自然返 1 滑过 / 结果非有限漏判） | Generator 提交空 PR / stub `res.status(200).send('OK')` 实现 / 测试套件 0 用例假 PASS / 用 `Number()` 替代正则导致 `1e3` 假绿 / **靠 JS `0**0===1` 直接 200 + `{power:1}` 滑过 0^0 拒绝** / **仅判 `result === Infinity` 漏掉 NaN / -Infinity** / 字段名误写成 `result` 而非 `power` / 多写 `operation` / `a` / `b` 字段污染 schema | **造假防御 8 条**：<br>① 所有 curl 带 `-fsS`：HTTP 非 2xx 自动退 22<br>② 所有 JSON 断言用 `jq -e`：解析失败或表达式 false 即非 0 退出<br>③ 严格相等用 `==`（数值）：防 `{"power":"3"}` 字符串作弊<br>④ error 路径显式 `has("power") \| not`（强制于 `POW-ZERO-ZERO` / `POW-ZERO-NEG-*` / `POW-NEG-FRACT*` / `POW-OVERFLOW*` / `POW-SCI` / `POW-INFINITY` / `POW-WORD` / `POW-MISSING-B`）：防 `{"power":NaN, "error":"..."}` 模糊态<br>⑤ 单测断言 `Tests N passed` 且 `not Tests N failed`：防 0-test 假绿<br>⑥ **W20 strict 探针保留**：`[ASSERT-POW-SCI]` 用 `1e3`、`[ASSERT-POW-INFINITY]` 用 `Infinity`、`[ASSERT-POW-NAN]` 用 `NaN` token 强制实现走完整正则匹配<br>⑦ **W22 oracle 探针新增**：`[ASSERT-POW-ORACLE-SQRT]` 用 Node 端独立 `Number(<a>) ** Number(<b>)` 复算后通过 jq `--argjson` 数值严格相等比对（覆盖小数指数 / 开方）；`[ASSERT-POW-ZERO-ZERO]` 显式拒 0^0（防 JS `0**0===1` 滑过）；`[ASSERT-POW-OVERFLOW]` / `POW-NEG-FRACT` 显式拒非有限（覆盖 Infinity + NaN，防仅判 Infinity 漏 NaN）<br>⑧ **W22 schema 探针新增**：`[ASSERT-POW-SCHEMA-SUCCESS]` 用 `(keys \| sort) == ["power"]` 完整匹配（防多余字段污染）；`[ASSERT-POW-FIELD-NAME]` 显式枚举禁用同义字段名（防漂移到 `result` / `value` / `pow` / `product` 等） | Evaluator |
| **R4** | `npm ci` 网络抖动 | 离线 / npm registry 不可达 / IPv6 路由抽风 | §6 阶段 A 用 `npm ci --silent \|\| (echo "[R4] 重试..."; sleep 2; npm ci --silent)`：失败重试 1 次；仍失败即 FAIL（**不引入 cache fallback / mirror fallback**） | Evaluator |
| **R5** | cascade 失败导致定位困难 | E2E 第 N 行红，看不出是 spawn 失败 / npm ci 失败 / 单测断言失败 / HTTP 断言失败 / oracle 复算环境 node 缺失 | §6 每条断言行末尾注释 `# [ASSERT-XXX]` 回链 §4 ID；`set -euo pipefail` 让 bash 直接报错具体行号；spawn / npm ci 失败有专用 `[R1]` / `[R2]` / `[R4]` echo 标记区分阶段；oracle 探针前置 `node -e` 复算输出存入 `EXP_*` 变量，失败时 bash 直接显示空值 | Reviewer |
| **R6** | Generator 误改 `/health` / `/sum`（W19）/ `/multiply`（W20）/ `/divide`（W21）实现 | LLM 误判 PRD「不在范围内」/ 把 0^0 / 结果有限性兜底顺手套到其他 endpoint 上 / 重写 strict-schema 把 W20/W21 行为打散 | §4 引入 `[ASSERT-HEALTH-INTACT]` + `[ASSERT-SUM-INTACT]` + `[ASSERT-MUL-INTACT]` + `[ASSERT-MUL-STRICT-INTACT]` + `[ASSERT-DIV-INTACT]` + `[ASSERT-DIV-DIVZERO-INTACT]` 六条回归；§5 Step 9 显式列入 Golden Path；contract-dod-ws1 的 ARTIFACT 强制源文件**仍含**`app.get('/health'` + `app.get('/sum'` + `app.get('/multiply'` + `app.get('/divide'` 四条字面量 | Reviewer + Generator |
| **R7** | 字段命名漂移（`result` / `value` / `pow` / `product` / 数字直返而非对象 / 加 `operation` / `a` / `b` 多余字段污染 schema） | LLM 风格化把 `power` 改成 `result` / `value` / `answer` / `pow` / `exp` / 误用 W19/W20/W21 字段名 / 多塞 `operation: "power"` 之类附加字段 | §4 所有 happy/oracle ASSERT 显式用 `.power` 字段名；error path ASSERT 用 `has("power") \| not`（隐含字段名约束）；`[ASSERT-POW-SCHEMA-SUCCESS]` 用 `(keys \| sort) == ["power"]` 完整匹配防多字段；`[ASSERT-POW-FIELD-NAME]` 用 `or` 串接禁用名清单（10 个）确保任一漂移即 FAIL；contract-dod-ws1 的 ARTIFACT 强制源文件含 `power` 字面量 | Reviewer + Generator |
| **R8** | 0^0 拒判被 JS 原生 `0**0===1` 滑过 | LLM 直接写 `return res.json({power: Number(a) ** Number(b)})` 没显式判 0^0 → 实测 `a=0&b=0` 返 200 + `{power:1}` 假通过 | §4 `[ASSERT-POW-ZERO-ZERO]` 显式断言 `H=400` + `has("power") \| not`；§5 Step 4 写明判定**必须**在算式 **之前**；contract-dod-ws1 的 ARTIFACT 强制源文件含 `Number(a) === 0 && Number(b) === 0` 字面量；§3.2 节展开禁止实现清单 | Reviewer + Generator |
| **R9** | 结果非有限拒判仅覆盖 Infinity 漏 NaN 或 -Infinity | LLM 写 `if (result === Infinity) return 400` 漏掉 NaN（负^分数）和 -Infinity；或写 `result === result` 仅抓 NaN 漏掉 Infinity | §4 `[ASSERT-POW-NEG-FRACT]` 用 `a=-2&b=0.5`（NaN 路径）+ `[ASSERT-POW-OVERFLOW]` 用 `a=10&b=1000`（Infinity 路径）双向覆盖；§5 Step 5 写明必须用 `Number.isFinite(result)`（一步覆盖 NaN/Infinity/-Infinity）；contract-dod-ws1 的 ARTIFACT 强制源文件含 `Number.isFinite` 字面量；§3.3 节展开禁止实现清单 | Reviewer + Generator |

**Owner 含义**：
- **Evaluator**：跑验证脚本时必须遵守该 mitigation（已写入 §6 脚本）
- **Reviewer**：审合同时必须确认该 mitigation 已落实（不漏审）
- **Generator**：实现代码时必须遵守该 mitigation（R6 / R7 / R8 / R9 落到 Generator）

---

## §8 测试代码骨架（内嵌可视化 — 直接来自 `tests/ws1/power.test.js`）

> 完整文件位于 `sprints/w22-playground-power/tests/ws1/power.test.js`（共 37 个 `test()` 块）。
> 下面**原样**列出关键 `test()` 标题 + 关键 `expect` 断言行（注：vitest 中 `test` 与 `it` 等价，本合同沿用 `test` 与 W19 / W20 / W21 一致）。
> Reviewer 可直接据此判断"未实现时这些 expect 必 FAIL"。

```javascript
import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../playground/server.js';

describe('Workstream 1 — GET /power (strict-schema + 0^0 拒 + 结果有限性兜底 + oracle) [BEHAVIOR]', () => {
  // T1 happy 整数指数
  test('GET /power?a=2&b=10 → 200 + {power:1024}', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 1024 });
    expect(typeof res.body.power).toBe('number');
  });

  // T2 oracle：开方（小数指数，核心 oracle 探针 #1）
  test('GET /power?a=2&b=0.5 → oracle 严格相等（开方语义）', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '0.5' });
    expect(res.status).toBe(200);
    expect(res.body.power).toBe(Number('2') ** Number('0.5'));
  });

  // T3 整数开方：4^0.5 = 2
  test('GET /power?a=4&b=0.5 → 200 + {power:2}', async () => {
    const res = await request(app).get('/power').query({ a: '4', b: '0.5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 2 });
  });

  // T4 oracle：负指数（小数结果，oracle 探针 #2）
  test('GET /power?a=2&b=-2 → oracle 严格相等（负指数）', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '-2' });
    expect(res.status).toBe(200);
    expect(res.body.power).toBe(Number('2') ** Number('-2'));
  });

  // T5 负底奇整指
  test('GET /power?a=-2&b=3 → 200 + {power:-8}', async () => {
    const res = await request(app).get('/power').query({ a: '-2', b: '3' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: -8 });
  });

  // T6 负底偶整指
  test('GET /power?a=-2&b=2 → 200 + {power:4}', async () => {
    const res = await request(app).get('/power').query({ a: '-2', b: '2' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 4 });
  });

  // T7 任意非零^0=1（合法边界，防把含 0 全拒）
  test('GET /power?a=5&b=0 → 200 + {power:1}', async () => {
    const res = await request(app).get('/power').query({ a: '5', b: '0' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 1 });
  });

  // T8 0^正=0（合法边界）
  test('GET /power?a=0&b=5 → 200 + {power:0}', async () => {
    const res = await request(app).get('/power').query({ a: '0', b: '5' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 0 });
  });

  // T9 1^N=1 不溢出
  test('GET /power?a=1&b=99999 → 200 + {power:1}', async () => {
    const res = await request(app).get('/power').query({ a: '1', b: '99999' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ power: 1 });
  });

  // T10 schema oracle：成功体顶层 keys 严格等于 ['power']
  test('GET /power?a=2&b=10 响应顶层 keys 严格等于 ["power"]（schema oracle）', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['power']);
  });

  // T11 0^0 不定式拒（W22 主探针 #1）
  test('GET /power?a=0&b=0 → 400 + 不含 power（0^0 不定式拒）', async () => {
    const res = await request(app).get('/power').query({ a: '0', b: '0' });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('power');
  });

  // T12 0^负=Infinity 拒（结果非有限）
  test('GET /power?a=0&b=-1 → 400 + 不含 power（0^负=Infinity 拒）', async () => {
    const res = await request(app).get('/power').query({ a: '0', b: '-1' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('power');
  });

  // T13 0^负整=Infinity 拒
  test('GET /power?a=0&b=-3 → 400 + 不含 power（0^负 整 拒）', async () => {
    const res = await request(app).get('/power').query({ a: '0', b: '-3' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('power');
  });

  // T14 负^分=NaN 拒（W22 主探针 #2）
  test('GET /power?a=-2&b=0.5 → 400 + 不含 power（负^分=NaN 拒）', async () => {
    const res = await request(app).get('/power').query({ a: '-2', b: '0.5' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('power');
  });

  // T15 负^分=NaN 拒
  test('GET /power?a=-8&b=0.5 → 400 + 不含 power', async () => {
    const res = await request(app).get('/power').query({ a: '-8', b: '0.5' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('power');
  });

  // T16 溢出=Infinity 拒（W22 主探针 #3）
  test('GET /power?a=10&b=1000 → 400 + 不含 power（溢出 拒）', async () => {
    const res = await request(app).get('/power').query({ a: '10', b: '1000' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('power');
  });

  // T17 溢出=Infinity 拒
  test('GET /power?a=2&b=10000 → 400 + 不含 power（溢出 拒）', async () => {
    const res = await request(app).get('/power').query({ a: '2', b: '10000' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('power');
  });

  // T18–T20 缺参（缺 b / 缺 a / 全缺）
  test('GET /power?a=2 (缺 b) → 400 + 不含 power', async () => {
    const res = await request(app).get('/power').query({ a: '2' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('power');
  });
  test('GET /power?b=3 (缺 a) → 400', async () => {
    const res = await request(app).get('/power').query({ b: '3' });
    expect(res.status).toBe(400);
  });
  test('GET /power (双参数都缺) → 400', async () => {
    const res = await request(app).get('/power');
    expect(res.status).toBe(400);
  });

  // T21 strict 拒：科学计数法
  test('GET /power?a=1e3&b=2 → 400 + 不含 power', async () => {
    const res = await request(app).get('/power').query({ a: '1e3', b: '2' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('power');
  });

  // T22 strict 拒：Infinity
  test('GET /power?a=Infinity&b=2 → 400 + 不含 power', async () => {
    const res = await request(app).get('/power').query({ a: 'Infinity', b: '2' });
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('power');
  });

  // T23 strict 拒：NaN
  test('GET /power?a=2&b=NaN → 400', async () => { /* 略 */ });

  // T24–T29 strict 其余拒绝（前导+ / .5 / 2. / 0xff / 1,000 / 空字符串 / abc）
  // 略：每条都期望 status 400 + error 非空

  // T30 回归 /health
  test('GET /health 仍 200 + {ok:true}', async () => { /* 略 */ });

  // T31 回归 /sum (W19) / /multiply (W20) / /divide (W21)
  test('GET /sum/multiply/divide 仍按各自合同行为', async () => { /* 略 */ });

  // T32 失败响应反向断言：成功体不允许同义替代字段
  test('GET /power?a=2&b=10 响应不含 result/value/answer/exp/exponent/pow/output/product/sum/quotient', async () => { /* 略 */ });
});
```

> 注：上面是骨架视图（部分 test() 体折叠为 `/* 略 */` 节省篇幅）。**完整 37 个 test() 全文以 `tests/ws1/power.test.js` 为准** — Reviewer 应直接读源文件；任何与源文件冲突的描述以源文件为权威。

---

## §9 Red 证据来源声明（为什么这些 expect 必 FAIL）

**当前主分支事实**（截至 round 1 起草时刻）：

`playground/server.js` 实际内容（共 54 行 — W19 `/sum` + W20 `/multiply` + W21 `/divide` 已合并）：

```javascript
import express from 'express';
const app = express();
const PORT = process.env.PLAYGROUND_PORT || 3000;
app.get('/health', (req, res) => { res.json({ ok: true }); });
app.get('/sum', (req, res) => { /* W19 实现 */ });
const STRICT_NUMBER = /^-?\d+(\.\d+)?$/;
app.get('/multiply', (req, res) => { /* W20 strict 实现 */ });
app.get('/divide', (req, res) => { /* W21 strict + 除零兜底 */ });
// 没有 app.get('/power', ...)
if (process.env.NODE_ENV !== 'test') app.listen(PORT, ...);
export default app;
```

**关键事实**：**没有任何 `app.get('/power', ...)` 注册**。Express 对未注册路由默认行为是返回 HTTP **404** + `Cannot GET /power`（text/html）。

**Red 失败矩阵**（在 proposer 分支当下跑 §8 测试时 — proposer 已实跑确认 31 fail / 6 pass / 共 37 用例）：

| Test 段 | 用例数 | 期望状态 | 实际状态（无 /power 路由） | 失败原因 | 结论 |
|---|---|---|---|---|---|
| Happy + 边界（整数指数 / 开方 oracle / 负指数 oracle / 负底整指 / 0^正 / 任意^0 / 1^N） | 9 | 200 | 404 | status 断言 | **9 FAIL** |
| Schema oracle（keys === ['power'] + 反向同义字段） | 2 | 200 + schema | 404 | status 断言 | **2 FAIL** |
| 0^0 不定式拒（W22 主探针 #1） | 1 | 400 + 不含 power | 404 | status 断言 | **1 FAIL** |
| 结果非有限拒（W22 主探针 #2 — 0^负 ×2 + 负^分 ×2 + 溢出 ×2） | 6 | 400 + 不含 power | 404 | status 断言 | **6 FAIL** |
| 缺参（缺 b / 缺 a / 全缺） | 3 | 400 | 404 | status 断言 | **3 FAIL** |
| strict-schema 拒（1e3 / Infinity / NaN / +2 / .5 / 2. / 0xff / 1,000 / 空 / abc） | 10 | 400 | 404 | status 断言 | **10 FAIL** |
| 回归 /health | 1 | 200 + `{ok:true}` | 200 | — | **PASS** |
| 回归 /sum（W19） | 1 | 200 + `{sum:5}` | 200 | — | **PASS** |
| 回归 /multiply（W20 happy + strict） | 2 | 200 / 400 | 200 / 400 | — | **2 PASS** |
| 回归 /divide（W21 happy + 除零兜底） | 2 | 200 / 400 | 200 / 400 | — | **2 PASS** |

**预期 Red 总数**：**31 FAIL + 6 PASS**（37 用例，远超 Reviewer ≥ 5 failures 阈值）。

**Proposer 自验命令实际输出**（已跑过）：

```text
Test Files  1 failed (1)
     Tests  31 failed | 6 passed (37)
```

**Proposer 自验命令**（commit 前 Proposer 实跑，本轮已确认）：

```bash
cd playground
cp ../sprints/w22-playground-power/tests/ws1/power.test.js tests/_power_red_probe.test.js
sed -i 's|../../../../playground/server.js|../server.js|' tests/_power_red_probe.test.js
npx vitest run tests/_power_red_probe.test.js --reporter=verbose 2>&1 | tee /tmp/ws1-red.log || true
rm -f tests/_power_red_probe.test.js
# 期望：Tests 31 failed | 6 passed (37)
grep -E "Tests\s+[0-9]+ failed" /tmp/ws1-red.log
```

---

## §10 Workstreams

workstream_count: 1

### Workstream 1: 加 `GET /power` 路由（strict-schema + 0^0 拒 + 结果有限性兜底 + oracle）+ 单测 + README

- **范围**：
  - `playground/server.js`：在 `/divide` 路由之后、`app.listen` 之前新增 `GET /power` handler；用原生 RegExp `/^-?\d+(\.\d+)?$/` 对 query a/b **完整匹配**校验（**可复用 W20/W21 的 `STRICT_NUMBER` 常量**或单写一份语义等价的）；strict 通过后**显式判定** `Number(a) === 0 && Number(b) === 0` → 400 + `{error}`（拒掉 0^0 不定式）；计算 `result = Number(a) ** Number(b)`；**显式判定** `Number.isFinite(result) === false` → 400 + `{error}`（覆盖 0^负、负^分数、溢出）；否则 200 + `{power: result}`。任一拒绝路径 body **不含** `power` 字段；成功响应顶层 keys **严格等于** `["power"]`。**不动 `/health` / `/sum` / `/multiply` / `/divide` 的代码**。
  - `playground/tests/server.test.js`：把 §8 的 32 个 `test()` 块（完整版见 `sprints/w22-playground-power/tests/ws1/power.test.js`）原样合并进去（vitest 兼容，与现有 `/sum`、`/multiply`、`/divide` describe 块共存）；保留现有 `/health`、`/sum`、`/multiply`、`/divide` 用例不动。
  - `playground/README.md`：「端点」段加 `/power`，给出 happy + 0^0 拒 + 结果非有限拒（0^负 / 负^分 / 溢出 任一）+ ≥ 1 条 strict-schema 拒绝示例（含 `1e3` 或 `Infinity` 任一）；保留现有 `/health`、`/sum`、`/multiply`、`/divide` 段不动。
- **大小**：S（< 100 行净增 — 与 W19 / W20 / W21 量级相当；server.js 新增约 18 行，单测约 250 行，README 约 25 行）
- **依赖**：无（W19 `/sum` + W20 `/multiply` + W21 `/divide` 已合并，作为回归基线即可）
- **BEHAVIOR 覆盖测试文件**：`sprints/w22-playground-power/tests/ws1/power.test.js`

---

## §11 Test Contract

| Workstream | Test File | BEHAVIOR 覆盖（按 §8 T-ID） | 预期 Red 证据 |
|---|---|---|---|
| WS1 | `tests/ws1/power.test.js` | power、Number(...) ** Number(...)、Object.keys schema、0^0 拒、0^负 拒、负^分 拒、溢出拒、缺 b、Infinity、health、W19、W20、W21 | **31 failures / 6 passed / 37 total**（happy + oracle + schema + 0^0 + 非有限 + 缺参 + strict 全 FAIL，回归 6 条 PASS）→ 远超 Reviewer ≥ 5 阈值 |

**Red 证据采集命令**：见 §9 末尾「Proposer 自验命令」（本轮已实跑确认 `Tests N failed | M passed`）。
