# Contract DoD — GET /negate endpoint

## Sprint: 07231722-relay-17d5b58d
## Task ID: 17d5b58d-29b8-4dbd-977a-82d44427cebf

---

## DoD 条目（全部通过 = 合同完成）

### [DOD-1] 成功 schema 键名铁律
- [BEHAVIOR] GET /negate?value=5 → HTTP 200 {result:-5, operation:"negate"}，`Object.keys(res.body).sort()` 严格等于 `["operation", "result"]`
  Test: vitest supertest（negate.contract.test.js DOD-1）

### [DOD-2] operation 字面值铁律
- [BEHAVIOR] GET /negate?value=5 → HTTP 200，res.body.operation === "negate"（禁用 negation/neg/negative）
  Test: vitest 单测（negate.contract.test.js DOD-2）

### [DOD-3] result 键名铁律
- [BEHAVIOR] GET /negate?value=5 → HTTP 200，res.body.result 存在，res.body 不含 negated/value/output/answer/data
  Test: vitest 单测（negate.contract.test.js DOD-3）

### [DOD-4] 正数取反
- [BEHAVIOR] GET /negate?value=5 → HTTP 200 {result:-5, operation:"negate"}
  Test: vitest 单测（negate.contract.test.js DOD-4）

### [DOD-5] 负数取反
- [BEHAVIOR] GET /negate?value=-5 → HTTP 200 {result:5, operation:"negate"}
  Test: vitest 单测（negate.contract.test.js DOD-5）

### [DOD-6] 零取反（-0 规范化）
**断言**：`GET /negate?value=0` → `result === 0` 且 `Object.is(result, -0) === false`
**验证方式**：vitest 单测

### [DOD-7] 精度上界合法
**断言**：`GET /negate?value=9007199254740990` → HTTP 200 + `result === -9007199254740990`
**验证方式**：vitest 单测

### [DOD-8] 精度下界合法
**断言**：`GET /negate?value=-9007199254740990` → HTTP 200 + `result === 9007199254740990`
**验证方式**：vitest 单测

### [DOD-9] 精度上界+1 拒绝
**断言**：`GET /negate?value=9007199254740991` → HTTP 400 + `error` 非空字符串
**验证方式**：vitest 单测

### [DOD-10] 精度下界-1 拒绝
**断言**：`GET /negate?value=-9007199254740991` → HTTP 400
**验证方式**：vitest 单测

### [DOD-11] value 缺失拒绝
**断言**：`GET /negate`（无 query 参数）→ HTTP 400 + `error` 非空字符串
**验证方式**：vitest 单测

### [DOD-12] 非法格式全拒（batch）
**断言**：`1.5`/`1e2`/`abc`/`+5`/``（空串）/`0x10`/`Infinity`/`NaN` → 全部 HTTP 400
**验证方式**：vitest 单测（参数化循环）

### [DOD-13] 错误 query 名全拒（batch）
**断言**：`n=5`/`x=5`/`a=5`/`b=5`/`num=5`/`number=5`/`input=5`/`v=5`/`val=5` → 全部 HTTP 400
**验证方式**：vitest 单测（参数化循环）

### [DOD-14] 错误体 schema 铁律
**断言**：任意 400 响应中，`Object.keys(res.body)` 严格等于 `["error"]`；不含 `message`/`msg`/`reason`/`detail`/`result`/`operation`
**验证方式**：vitest 单测

### [DOD-15] 现有路由无回退
**断言**：`/health`/`/increment?value=1`/`/decrement?value=1` 在新增路由后仍正常返回
**验证方式**：vitest 回归测试

### [DOD-16] Final E2E bash 脚本通过
**断言**：使用 `bash + curl` 对 `PLAYGROUND_PORT=3001` 运行端到端脚本，全部检查点通过
**验证方式**：`tests/regression/relay-17d5b58d/e2e.sh` 执行返回 exit 0
manual:bash PLAYGROUND_PORT=3001 bash tests/regression/relay-17d5b58d/e2e.sh

---

## 铁律覆盖总结

| PRD 铁律 | DoD 覆盖 |
|----------|----------|
| `result` 键名（禁 negated/value/output） | DOD-3, DOD-1 |
| `operation: "negate"`（禁 negation/neg/negative） | DOD-2 |
| strict `^-?\d+$` | DOD-12 |
| `|value| ≤ 9007199254740990` | DOD-7, DOD-8, DOD-9, DOD-10 |
| value=0 → result=0（-0 规范化）| DOD-6 |
| 缺参 → 400 | DOD-11 |
| 实现文件仅 playground/server.js | 代码审查 |
| E2E bash+curl PLAYGROUND_PORT=3001 | DOD-16 |
