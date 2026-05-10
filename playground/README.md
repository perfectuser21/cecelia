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
