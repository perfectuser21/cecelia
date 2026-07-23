# Contract Draft — GET /negate endpoint

## Sprint: 07231722-relay-17d5b58d
## Task ID: 17d5b58d-29b8-4dbd-977a-82d44427cebf
## Round: 1（首轮）

---

## 1. Response Schema（铁律）

### 成功路径（HTTP 200）

```json
{
  "result": <number>,
  "operation": "negate"
}
```

**字段铁律**：
- 键名 `result`：禁用 `negated`、`value`、`output`、`answer`、`data`
- 键名 `operation`：字面值必须是 `"negate"`，禁用 `"negation"`、`"neg"`、`"negative"`
- 成功体 keys 严格等于 `["operation", "result"]`（排序后）

### 错误路径（HTTP 400）

```json
{
  "error": "<非空字符串>"
}
```

**字段铁律**：
- 键名 `error`：禁用 `message`、`msg`、`reason`、`detail`
- 错误体不含 `result`、`operation`

---

## 2. 参数规范

| 属性 | 规范 |
|------|------|
| 参数名 | `value`（query string） |
| 参数数量 | 仅接受 1 个 query 参数，键名必须是 `value` |
| 格式约束 | strict `^-?\d+$`（仅整数；禁小数、前导 `+`、双重负号、科学计数法、十六进制、千分位、空格、`Infinity`、`NaN`、空串） |
| 上界约束 | `|Number(value)| ≤ 9007199254740990` |

---

## 3. 行为断言

### 成功路径

| 输入 | 期望输出 |
|------|----------|
| `value=5` | HTTP 200 `{"result": -5, "operation": "negate"}` |
| `value=-5` | HTTP 200 `{"result": 5, "operation": "negate"}` |
| `value=0` | HTTP 200 `{"result": 0, "operation": "negate"}`（`-0` 规范化为 `0`） |
| `value=9007199254740990` | HTTP 200 `{"result": -9007199254740990, "operation": "negate"}` |
| `value=-9007199254740990` | HTTP 200 `{"result": 9007199254740990, "operation": "negate"}` |
| `value=01` | HTTP 200 `{"result": -1, "operation": "negate"}`（不许按八进制解析）|

### 错误路径

| 输入 | 期望输出 |
|------|----------|
| value 缺失 | HTTP 400 `{error: "<非空字符串>"}` |
| `value=` (空串) | HTTP 400 |
| `value=3.14` | HTTP 400 |
| `value=abc` | HTTP 400 |
| `value=1e2` | HTTP 400 |
| `value=+5` | HTTP 400 |
| `value=0x10` | HTTP 400 |
| `value=Infinity` | HTTP 400 |
| `value=NaN` | HTTP 400 |
| `value=9007199254740991`（超上界）| HTTP 400 |
| `value=-9007199254740991`（超下界）| HTTP 400 |
| 错误 query 名 `n=5` | HTTP 400 |
| 错误 query 名 `x=5` | HTTP 400 |
| 错误 query 名 `a=5` | HTTP 400 |
| 错误 query 名 `b=5` | HTTP 400 |
| 错误 query 名 `num=5` | HTTP 400 |
| 错误 query 名 `number=5` | HTTP 400 |
| 错误 query 名 `input=5` | HTTP 400 |
| 错误 query 名 `v=5` | HTTP 400 |
| 错误 query 名 `val=5` | HTTP 400 |

---

## 4. 接缝清单

| # | 接缝点 | 类型 | 真目标验证方式 |
|---|--------|------|----------------|
| 1 | HTTP 响应 schema（键名 + 值类型）| 逻辑断言 | vitest supertest 验证 `res.body.result`、`res.body.operation` |
| 2 | 参数校验（format + 上界）| 逻辑断言 | vitest supertest 验证非法输入返回 HTTP 400 |
| 3 | 运算正确性（取反）| 逻辑断言 | vitest 验证 `-Number(value)` 结果 |
| 4 | `-0` 规范化 | 逻辑断言 | vitest 验证 `value=0` → `result === 0`，非 `-0` |
| 5 | 端到端 E2E（真实 HTTP） | 接缝断言（环境相关）| bash + curl 对 `PLAYGROUND_PORT=3001` 跑验收脚本 |

---

## Test Contract

| WS | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| ws1 | `tests/negate.contract.test.js` | [DOD-1] 成功体 keys / [DOD-2] operation 字面值 / [DOD-3] result 键名 / [DOD-4] value=5 → result=-5 / [DOD-5] value=-5 → result=5 / [DOD-6] value=0 → result=0，且不是 -0 / [DOD-7] value=9007199254740990 / [DOD-9] value=9007199254740991 / [DOD-11] value 缺失 / [DOD-12] 非法格式全部 400 / [DOD-13] 错误 query 名全部 400 / [DOD-14] 400 响应 keys / [DOD-15] /health 不受影响 | Red：20 fail（/negate 返回 404，实现前） |

---

## E2E 验收

端到端验收使用 `bash + curl` 对真实运行中的服务执行检查，脚本位于 `sprints/07231722-relay-17d5b58d/tests/e2e.sh`。

**执行命令**：
```bash
PLAYGROUND_PORT=3001 bash sprints/07231722-relay-17d5b58d/tests/e2e.sh
```

**验收检查点**（脚本内逐一 curl 验证）：
- `GET /negate?value=5` → HTTP 200，`result === -5`，`operation === "negate"`
- `GET /negate?value=-5` → HTTP 200，`result === 5`
- `GET /negate?value=0` → HTTP 200，`result === 0`（非 `-0`）
- `GET /negate?value=9007199254740990` → HTTP 200，`result === -9007199254740990`
- `GET /negate` → HTTP 400
- `GET /negate?value=abc` → HTTP 400
- `GET /negate?value=9007199254740991` → HTTP 400
- 现有路由 `/health`、`/increment?value=1`、`/decrement?value=1` 仍正常返回

脚本全部检查点通过则返回 exit 0，任意失败则 exit 1。

---

## 5. 实现文件范围

- **允许改动**：`playground/server.js`（新增 GET /negate 路由）
- **允许改动**：`playground/tests/server.test.js`（新增 `describe('GET /negate')` 测试块）
- **禁止改动**：其他路由（/sum /multiply /divide /power /modulo /subtract /increment /decrement /factorial /abs /echo）
- **禁止改动**：Brain API 路由、dashboard、任何 /negate 以外功能

---

## 6. 风险

| # | 风险 | 严重度 | Mitigation |
|---|------|--------|------------|
| 1 | Generator 用 `negation`/`neg` 替代 `"negate"` 作为 operation 字面值 | High | BEHAVIOR 测试明确断言 `operation === "negate"` 并反向检查禁用值 |
| 2 | Generator 用 `negated`/`value`/`output` 替代 `result` 作为键名 | High | BEHAVIOR 测试严格断言 `keys.sort() == ["operation","result"]` |
| 3 | `-0` 未规范化，返回 JSON 中出现 `-0` | Medium | 测试断言 `result === 0` 且 `Object.is(result, -0) === false` |
| 4 | 接受多余 query 参数（如 `value=5&extra=1`） | Medium | 测试验证额外参数时行为（参照 /increment 单参严格设计） |
| 5 | 上界检查遗漏（9007199254740991 未拒绝）| High | 测试明确验证边界值 9007199254740991 → 400 |
