# cecelia-playground

W19 Walking Skeleton 测试床。本子项目刻意保持极薄，给 Cecelia harness pipeline 提供一个"外部代码改动对象"——后续 W19+ task 由 generator container push PR 给这里加 endpoint，evaluator container 自起 server 真验证。

## 跟 cecelia core 的关系

完全独立子项目。Brain / Engine / Workspace **不依赖** playground。playground 也不感知 brain。这是刻意的解耦：harness 测协议层时不能让"亲爹打亲爹"环路（详见 `docs/handoffs/2026-05-10-w19-walking-skeleton-playground-handoff-prd.md` §10）。

## 启动

```bash
cd playground
npm install
npm test            # 单测
npm start           # 起 server（默认 :3000）
```

## 端点

- `GET /health` → `{ "ok": true }`
- `GET /sum?a=N&b=M` → 返回 a+b 的算术和
- `GET /multiply?a=N&b=M` → 返回 a×b 的乘积（**strict-schema**：拒绝科学计数法 / `Infinity` / 前导 `+` / 十六进制 等）
- `GET /divide?a=N&b=M` → 返回 a÷b 的商（**strict-schema** + **除零兜底**：`b=0`/`b=0.0` → 400）
- `GET /power?a=N&b=M` → 返回 a^b（**strict-schema** + **0^0 不定式拒** + **结果有限性兜底**：`Number.isFinite(result)===false` 时 400，覆盖 0^负 / 负^分数 / 溢出）
- `GET /modulo?a=N&b=M` → 返回 a%b 的余数（**strict-schema** + **除零兜底**：`b=0`/`b=0.0` → 400；**JS 原生 truncated 取模**：余数符号跟随被除数 a，与数学 floored mod 区分）
- `GET /factorial?n=N` → 返回 n! 阶乘（**整数白名单 strict-schema** `^\d+$` + **上界 18 拒**：`n > 18` → 400（精度上界，避免超过 `Number.MAX_SAFE_INTEGER`）+ **迭代精确累积**：`for(i=2; i<=n; i++) acc *= i`，不引入 BigInt / Stirling / gamma 近似）
- `GET /increment?value=N` → 返回 `{result: N+1, operation: "increment"}`（**整数白名单 strict-schema** `^-?\d+$` + **精度上下界拒**：`|Number(value)| > 9007199254740990` → 400（+1 后避免超过 `Number.MAX_SAFE_INTEGER`）+ **query 名锁死**：只接受 `value`，别名 `n/a/b/x/val/input/...` 全 400）
- `GET /decrement?value=N` → 返回 `{result: N-1, operation: "decrement"}`（**整数白名单 strict-schema** `^-?\d+$` + **精度上下界拒**：`|Number(value)| > 9007199254740990` → 400（-1 后避免超过 `Number.MIN_SAFE_INTEGER`）+ **query 名锁死**：只接受 `value`，PRD 禁用 9 个变体 `n/x/a/b/num/number/input/v/val` 全 400）

### `GET /sum` 示例

happy path：

```bash
curl -s 'http://127.0.0.1:3000/sum?a=2&b=3'
# {"sum":5}
```

参数缺失或非数字 → 400：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/sum?a=2'
# {"error":"a 和 b 都是必填 query 参数"}
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/sum?a=abc&b=3'
# {"error":"a 和 b 必须是合法数字"}
# HTTP 400
```

负数 / 零 / 小数视为合法数字。零依赖：仅 `express`（运行时）+ `vitest` / `supertest`（开发时）。

### `GET /multiply` 示例

happy path：

```bash
curl -s 'http://127.0.0.1:3000/multiply?a=2&b=3'
# {"product":6}

curl -s 'http://127.0.0.1:3000/multiply?a=-2&b=3'
# {"product":-6}

curl -s 'http://127.0.0.1:3000/multiply?a=1.5&b=2'
# {"product":3}
```

strict-schema 拒绝（核心：用原生正则 `^-?\d+(\.\d+)?$` 校验，**不依赖** `Number()` / `Number.isFinite()`，避免 `1e3` / `Infinity` / `0xff` 等被 JS 隐式解析为数字而假绿）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/multiply?a=1e3&b=2'
# {"error":"a 和 b 必须匹配 ^-?\\d+(\\.\\d+)?$（禁止科学计数法、Infinity、前导 +、十六进制等）"}
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/multiply?a=Infinity&b=2'
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/multiply?a=2'
# {"error":"a 和 b 都是必填 query 参数"}
# HTTP 400
```

### `GET /divide` 示例

happy path（含小数 oracle 严格相等：JS 原生除法结果，不做精度截断）：

```bash
curl -s 'http://127.0.0.1:3000/divide?a=6&b=2'
# {"quotient":3}

curl -s 'http://127.0.0.1:3000/divide?a=-6&b=2'
# {"quotient":-3}

curl -s 'http://127.0.0.1:3000/divide?a=1.5&b=0.5'
# {"quotient":3}

curl -s 'http://127.0.0.1:3000/divide?a=1&b=3'
# {"quotient":0.3333333333333333}
```

除零拒绝（核心兜底：strict-schema 通过后显式 `Number(b) === 0` 判定，0/0 与 b=0.0 都拒）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/divide?a=5&b=0'
# {"error":"除数 b 不能为 0"}
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/divide?a=0&b=0'
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/divide?a=6&b=0.0'
# HTTP 400
```

strict-schema 拒绝（与 `/multiply` 同款正则 `^-?\d+(\.\d+)?$`，禁 `Number()` 假绿）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/divide?a=1e3&b=2'
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/divide?a=Infinity&b=2'
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/divide?a=6'
# {"error":"a 和 b 都是必填 query 参数"}
# HTTP 400
```

### `GET /power` 示例

happy path（含小数指数 oracle 严格相等：JS 原生 `**` 结果，不做精度截断）：

```bash
curl -s 'http://127.0.0.1:3000/power?a=2&b=10'
# {"power":1024}

curl -s 'http://127.0.0.1:3000/power?a=4&b=0.5'
# {"power":2}

curl -s 'http://127.0.0.1:3000/power?a=-2&b=3'
# {"power":-8}

curl -s 'http://127.0.0.1:3000/power?a=2&b=-2'
# {"power":0.25}

curl -s 'http://127.0.0.1:3000/power?a=5&b=0'
# {"power":1}
```

0^0 不定式拒绝（核心兜底：strict-schema 通过后显式 `Number(a)===0 && Number(b)===0` 判定，**不允许靠 JS `0**0===1` 滑过**）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/power?a=0&b=0'
# {"error":"0^0 是数学不定式，拒绝计算"}
# HTTP 400
```

结果非有限拒绝（核心兜底：算式后显式 `Number.isFinite(result)===false` 判定，覆盖 0^负=Infinity / 负^分数=NaN / 溢出=Infinity）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/power?a=0&b=-1'
# HTTP 400 (0^-1 = Infinity)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/power?a=-2&b=0.5'
# HTTP 400 (负^分数 = NaN)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/power?a=10&b=1000'
# HTTP 400 (10^1000 = Infinity)
```

strict-schema 拒绝（与 `/multiply`、`/divide` 同款正则 `^-?\d+(\.\d+)?$`，禁 `Number()` 假绿）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/power?a=1e3&b=2'
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/power?a=Infinity&b=2'
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/power?a=2'
# {"error":"a 和 b 都是必填 query 参数"}
# HTTP 400
```

### `GET /modulo` 示例

happy path（含整数 / 整除 / 浮点 / 0%N，全部走 JS 原生 `%`，不做精度截断）：

```bash
curl -s 'http://127.0.0.1:3000/modulo?a=5&b=3'
# {"remainder":2}

curl -s 'http://127.0.0.1:3000/modulo?a=10&b=3'
# {"remainder":1}

curl -s 'http://127.0.0.1:3000/modulo?a=6&b=2'
# {"remainder":0}

curl -s 'http://127.0.0.1:3000/modulo?a=5.5&b=2'
# {"remainder":1.5}

curl -s 'http://127.0.0.1:3000/modulo?a=0&b=5'
# {"remainder":0}
```

符号不变量（核心：JS truncated 取模，余数符号跟随 **被除数 a**，与数学 floored mod 区分；floored 实现 `((a%b)+b)%b` 在以下用例必挂）：

```bash
curl -s 'http://127.0.0.1:3000/modulo?a=-5&b=3'
# {"remainder":-2}        # 符号跟随被除数 -5；floored mod 会返 1

curl -s 'http://127.0.0.1:3000/modulo?a=5&b=-3'
# {"remainder":2}         # 符号跟随被除数 5；floored mod 会返 -1

curl -s 'http://127.0.0.1:3000/modulo?a=-5&b=-3'
# {"remainder":-2}        # 双负，符号仍跟随 a
```

除零拒绝（核心兜底：strict-schema 通过后显式 `Number(b) === 0` 判定，0%0 与 b=0.0 都拒）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/modulo?a=5&b=0'
# {"error":"除数 b 不能为 0"}
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/modulo?a=0&b=0'
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/modulo?a=5&b=0.0'
# HTTP 400
```

strict-schema 拒绝（与 `/multiply`、`/divide`、`/power` 同款正则 `^-?\d+(\.\d+)?$`，禁 `Number()` 假绿）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/modulo?a=1e3&b=2'
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/modulo?a=Infinity&b=2'
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/modulo?a=5'
# {"error":"a 和 b 都是必填 query 参数"}
# HTTP 400
```

### `GET /factorial` 示例

happy path（含数学边界 0!=1、1!=1、精度上界 18! < `Number.MAX_SAFE_INTEGER`）：

```bash
curl -s 'http://127.0.0.1:3000/factorial?n=5'
# {"factorial":120}

curl -s 'http://127.0.0.1:3000/factorial?n=10'
# {"factorial":3628800}

curl -s 'http://127.0.0.1:3000/factorial?n=12'
# {"factorial":479001600}

curl -s 'http://127.0.0.1:3000/factorial?n=0'
# {"factorial":1}        # 数学定义 0!=1（空积）

curl -s 'http://127.0.0.1:3000/factorial?n=1'
# {"factorial":1}

curl -s 'http://127.0.0.1:3000/factorial?n=18'
# {"factorial":6402373705728000}  # 精度上界，等于 18! 的精确整数值，< 2^53-1
```

跨调用递推不变量演示（核心 oracle：`factorial(n) === n * factorial(n-1)`，Stirling/Lanczos/浮点近似实现必断）：

```bash
# 演示 f(5) === 5 * f(4) === 120
curl -s 'http://127.0.0.1:3000/factorial?n=4'   # {"factorial":24}
curl -s 'http://127.0.0.1:3000/factorial?n=5'   # {"factorial":120}
# 校验：120 === 5 * 24 ✓

# 演示 f(18) === 18 * f(17)（精度边界递推，必须严等）
curl -s 'http://127.0.0.1:3000/factorial?n=17'  # {"factorial":355687428096000}
curl -s 'http://127.0.0.1:3000/factorial?n=18'  # {"factorial":6402373705728000}
# 校验：6402373705728000 === 18 * 355687428096000 ✓
```

上界拒（核心兜底：strict 通过后显式 `Number(n) > 18` 判定，避免超过 `Number.MAX_SAFE_INTEGER` 造成精度漂移；不引入 BigInt 重写）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/factorial?n=19'
# {"error":"n 必须 ≤ 18（精度上界，避免超过 Number.MAX_SAFE_INTEGER）"}
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/factorial?n=20'
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/factorial?n=100'
# HTTP 400
```

strict-schema 拒（**新的**整数白名单 `^\d+$`，**不复用** `/multiply` 系列的浮点 `^-?\d+(\.\d+)?$`；负号 / 小数 / 前导 + / 科学计数法 / 十六进制 / 千分位 / `Infinity` / `NaN` / 字母串 / 空串全 400）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/factorial?n=-1'
# HTTP 400  (负号)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/factorial?n=5.5'
# HTTP 400  (小数点)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/factorial?n=1e2'
# HTTP 400  (科学计数法)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/factorial?n=0xff'
# HTTP 400  (十六进制)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/factorial?n=Infinity'
# HTTP 400

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/factorial'
# {"error":"n 是必填 query 参数（仅 n，整数 0 ≤ n ≤ 18）"}
# HTTP 400  (缺参)
```

query 别名锁死（只接受 `n=`，别名 `value/num/x/input/a/b/...` 全拒 400）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/factorial?value=5'
# HTTP 400  (别名 value)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/factorial?num=5'
# HTTP 400  (别名 num)
```

### `GET /increment` 示例

happy path（含数学边界 0+1=1、-1+1=0、精度上下界 |9007199254740990| 严等 ±MAX_SAFE_INTEGER∓1）：

```bash
curl -s 'http://127.0.0.1:3000/increment?value=5'
# {"result":6,"operation":"increment"}

curl -s 'http://127.0.0.1:3000/increment?value=0'
# {"result":1,"operation":"increment"}        # off-by-one 正侧

curl -s 'http://127.0.0.1:3000/increment?value=-1'
# {"result":0,"operation":"increment"}        # off-by-one 负侧

curl -s 'http://127.0.0.1:3000/increment?value=9007199254740990'
# {"result":9007199254740991,"operation":"increment"}  # 精度上界，===Number.MAX_SAFE_INTEGER

curl -s 'http://127.0.0.1:3000/increment?value=-9007199254740990'
# {"result":-9007199254740989,"operation":"increment"} # 精度下界

curl -s 'http://127.0.0.1:3000/increment?value=01'
# {"result":2,"operation":"increment"}        # 前导 0 happy（不许错用八进制）
```

精度上下界拒（核心兜底：strict 通过后显式 `Math.abs(Number(value)) > 9007199254740990` 判定，避免 `+1` 后超过 `Number.MAX_SAFE_INTEGER` 造成精度漂移；不引入 BigInt 重写）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment?value=9007199254740991'
# {"error":"value 必须是唯一 query 名 + 匹配 ^-?\\d+$ ... + |value| ≤ 9007199254740990"}
# HTTP 400  (上界 +1 拒)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment?value=-9007199254740991'
# HTTP 400  (下界 -1 拒)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment?value=99999999999999999999'
# HTTP 400  (远超上界拒)
```

strict-schema 拒（**整数白名单** `^-?\d+$`，与 `/factorial` 同款思路；负号 / 小数 / 前导 + / 双重负号 / 科学计数法 / 十六进制 / 千分位 / 空格 / `Infinity` / `NaN` / 字母串 / 空串全 400）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment?value=1.5'
# HTTP 400  (小数)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment?value=1.0'
# HTTP 400  (带小数点的"整数")

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment?value=1e2'
# HTTP 400  (科学计数法)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment?value=0xff'
# HTTP 400  (十六进制)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment?value=%2B5'
# HTTP 400  (前导 +5 URL 编码)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment?value=--5'
# HTTP 400  (双重负号)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment?value=Infinity'
# HTTP 400  (Infinity 字面)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment?value='
# HTTP 400  (空串)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment'
# HTTP 400  (缺 value)
```

query 别名锁死（只接受 `value=`，别名 `n/x/val/input/a/b/...` 全拒 400）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment?n=5'
# HTTP 400  (别名 n)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/increment?input=5'
# HTTP 400  (别名 input)
```

响应 schema 完整性（成功响应顶层 keys 严格等于 `["operation","result"]`；不漂到禁用同义字段 `incremented`/`next`/`successor`/`n_plus_one`/`plus_one`/`succ`/`inc`/`incr`/`incrementation`，也不漂到 generic 字段 `value`/`input`/`output`/`data`/`payload`/`answer`/`meta`，错误体顶层 keys 严格等于 `["error"]`）。

### `GET /decrement` 示例

happy path（**字面严等** `{result: N-1, operation: "decrement"}`，覆盖正/零/负/精度上界/精度下界 5 类）：

```bash
curl -s 'http://127.0.0.1:3000/decrement?value=5'
# {"result":4,"operation":"decrement"}

curl -s 'http://127.0.0.1:3000/decrement?value=0'
# {"result":-1,"operation":"decrement"}

curl -s 'http://127.0.0.1:3000/decrement?value=-1'
# {"result":-2,"operation":"decrement"}

curl -s 'http://127.0.0.1:3000/decrement?value=9007199254740990'
# {"result":9007199254740989,"operation":"decrement"}  (精度上界)

curl -s 'http://127.0.0.1:3000/decrement?value=-9007199254740990'
# {"result":-9007199254740991,"operation":"decrement"}  (精度下界)
```

精度上下界拒（`|Number(value)| > 9007199254740990` → 400，-1 后避免超过 `Number.MIN_SAFE_INTEGER`）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/decrement?value=9007199254740991'
# HTTP 400  (上界 +1 拒)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/decrement?value=-9007199254740991'
# HTTP 400  (下界 -1 拒)
```

strict-schema 拒（**整数白名单** `^-?\d+$`，与 `/increment` 同款思路；小数 / 前导 + / 科学计数法 / 十六进制 / `Infinity` / 字母串 / 空串 / 缺 value 全 400）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/decrement?value=1.5'
# HTTP 400  (小数)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/decrement?value=1e2'
# HTTP 400  (科学计数法)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/decrement?value=%2B5'
# HTTP 400  (前导 +)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/decrement?value=abc'
# HTTP 400  (非数字)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/decrement?value='
# HTTP 400  (空串)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/decrement'
# HTTP 400  (缺 value)
```

PRD 完整 9 个禁用 query 名一律拒（**query 名锁死**，只接受 `value=`；别名 `n/x/a/b/num/number/input/v/val` 全 400）：

```bash
curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/decrement?n=5'
# HTTP 400  (禁用 n)

curl -s -o /dev/stderr -w 'HTTP %{http_code}\n' 'http://127.0.0.1:3000/decrement?input=5'
# HTTP 400  (禁用 input)
```

响应 schema 完整性（成功响应顶层 keys 严格等于 `["operation","result"]`；`operation` 字面字符串 `"decrement"`，不漂到 PRD 禁用 8 变体 `dec`/`decr`/`decremented`/`prev`/`previous`/`predecessor`/`minus_one`/`sub_one`；不漂到 PRD 禁用 19 个响应字段名 `decremented`/`prev`/`predecessor`/`minus_one`/`sub_one`/`incremented`/`sum`/`product`/`quotient`/`power`/`remainder`/`factorial`/`negation`/`value`/`input`/`output`/`data`/`payload`/`answer`/`meta`；错误体顶层 keys 严格等于 `["error"]`，不漂到禁用替代名 `message`/`msg`/`reason`/`detail`）。
