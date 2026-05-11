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
