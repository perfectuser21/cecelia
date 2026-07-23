# Contract DoD — playground GET /square 端点

## 定义

本文档定义 GET /square 端点的可验证行为条目（[BEHAVIOR]），以及 CI 可执行的验收命令。

---

## [BEHAVIOR] 条目

### [DOD-1] 正常数字请求返回 HTTP 200 + 正确 square 字段

[BEHAVIOR] GET /square?n=5 → HTTP 200 { "square": 25 }
  Test: vitest supertest（square.contract.test.js DOD-1）

[BEHAVIOR] GET /square?n=-3 → HTTP 200 { "square": 9 }（负数平方为正数）
  Test: vitest supertest（square.contract.test.js DOD-1）

[BEHAVIOR] GET /square?n=1.5 → HTTP 200 { "square": 2.25 }（小数合法）
  Test: vitest supertest（square.contract.test.js DOD-1）

**场景**: `GET /square?n=5`
**期望**:
- HTTP 状态码 = 200
- 响应 body = `{ "square": 25 }`
- `typeof res.body.square === 'number'`

**场景**: `GET /square?n=-3`
**期望**:
- HTTP 状态码 = 200
- 响应 body = `{ "square": 9 }`（负数平方为正数）

**场景**: `GET /square?n=1.5`
**期望**:
- HTTP 状态码 = 200
- 响应 body = `{ "square": 2.25 }`（小数合法）

---

### [DOD-2] 缺失参数 n 返回 HTTP 400

[BEHAVIOR] GET /square（无 query 参数）→ HTTP 400，响应 body 含 error 字段，不含 square 字段
  Test: vitest supertest（square.contract.test.js DOD-2）

**场景**: `GET /square`（无 query 参数）
**期望**:
- HTTP 状态码 = 400
- 响应 body 含 `error` 字段（string，长度 > 0）
- 响应 body 不含 `square` 字段

---

### [DOD-3] 非法格式参数返回 HTTP 400

[BEHAVIOR] GET /square?n=abc → HTTP 400，响应含 error 字段，不含 square 字段
  Test: vitest supertest（square.contract.test.js DOD-3）

[BEHAVIOR] GET /square?n=1e5 → HTTP 400（科学计数法不匹配 STRICT_NUMBER）
  Test: vitest supertest（square.contract.test.js DOD-3）

**场景**: 以下输入均应返回 HTTP 400:
- `n=abc`（非数字字符串）
- `n=1e5`（科学计数法，不匹配 STRICT_NUMBER）
- `n=+3`（前导 +，不匹配 STRICT_NUMBER）
- `n=0x1A`（十六进制，不匹配 STRICT_NUMBER）
- `n=Infinity`（不匹配 STRICT_NUMBER）
- `n=` 空串（不匹配 STRICT_NUMBER）

**期望**:
- HTTP 状态码 = 400
- 响应 body 含 `error` 字段（string，长度 > 0）
- 响应 body 不含 `square` 字段

---

### [DOD-4] 计算结果溢出返回 HTTP 400（有限数保护）

[BEHAVIOR] 极大整数输入导致平方结果非有限数时 → HTTP 400，响应含 error 字段
  Test: vitest supertest（square.contract.test.js DOD-4）

**背景**: STRICT_NUMBER 正则允许多位整数，极大数平方后可能超过 Number.MAX_VALUE 变为 Infinity。

**说明**: STRICT_NUMBER 本身会拦截科学计数法（如 `1e308`），但极大整数字符串（如足够多位数）仍可能通过正则匹配后计算溢出。

**期望**:
- 若 `Number(n) ** 2` 结果不是有限数（`!Number.isFinite(result)`），返回 HTTP 400
- 响应 body 含 `error` 字段

---

### [DOD-5] -0 规范化：结果不得返回 -0

[BEHAVIOR] GET /square?n=-0 → 若返回 HTTP 200，则 Object.is(res.body.square, -0) 必须为 false（square=0 非 -0）
  Test: vitest supertest（square.contract.test.js DOD-5）

**场景**: `GET /square?n=-0`（若 `-0` 匹配 STRICT_NUMBER，则 `(-0)²` 在 JS 中为 `0`）
**期望**:
- 若返回 HTTP 200，则 `Object.is(res.body.square, -0)` 必须为 `false`（即 square = 0，非 -0）
- JSON 序列化层面：`JSON.stringify(-0) === "0"`，自动满足；但实现层应显式规范化

**实现建议**: 使用 `result || 0` 或 `result === 0 ? 0 : result` 规范化 -0。

---

### [DOD-6] n=0 返回 HTTP 200 + square=0

[BEHAVIOR] GET /square?n=0 → HTTP 200 { "square": 0 }，typeof square === 'number'
  Test: vitest supertest（square.contract.test.js DOD-6）

**场景**: `GET /square?n=0`
**期望**:
- HTTP 状态码 = 200
- 响应 body = `{ "square": 0 }`
- `typeof res.body.square === 'number'`

---

## manual:bash 可执行验收命令

```bash
# 在 /workspace/playground 目录下运行 vitest 合同测试
cd /workspace/playground && npx vitest run tests/square.contract.test.js
```

```bash
# 运行全量 playground 测试（回归保护）
cd /workspace/playground && npx vitest run
```

```bash
# 单独运行合同测试文件，详细输出
cd /workspace/playground && npx vitest run tests/square.contract.test.js --reporter=verbose
```

---

## 覆盖矩阵

| DoD 条目 | 对应测试文件 | 测试用例描述 |
|----------|-------------|-------------|
| DOD-1 | tests/square.contract.test.js | 正常输入系列 |
| DOD-2 | tests/square.contract.test.js | 缺失参数 n |
| DOD-3 | tests/square.contract.test.js | 非法格式系列 |
| DOD-4 | tests/square.contract.test.js | 有限数保护 |
| DOD-5 | tests/square.contract.test.js | -0 规范化 |
| DOD-6 | tests/square.contract.test.js | n=0 边界 |
