# Sprint PRD — playground 加 GET /ping endpoint（W33 Walking Skeleton P1 happy path 验）

## OKR 对齐

- **对应 KR**：W33 Walking Skeleton — Cecelia harness pipeline 端到端 P1 happy path 最小一刀验证。前置 W19~W26 演进出了"strict-schema + 输入规则拒 + 输出值兜底 + 单调用语义不变量 + 多调用递推不变量 + 字段名字面相等"六类 oracle 范式，验证 happy + error + 边界 全覆盖；W33 反向用"**最薄一刀 happy path**"独立验证：在所有 error / 边界 / 强校验全部砍掉、只剩"客户端发请求 → server 返固定 shape"这条最小 vertical slice 的前提下，harness pipeline（planner → proposer → reviewer → generator → evaluator → task=completed）依然能跑通且不漂移
- **当前进度**：W19~W26 八条 endpoint 演进出富 oracle 链路；2026-05-11 #2893（PR-G）proposer v7.5 死规则段落已落地（PRD 字段名字面法定）；W33 是 Walking Skeleton 范式首次进入 playground——区别于 W19~W26 的"加深 oracle"路线，本任务走"**减薄一切非必要项**"路线
- **本次推进预期**：在 playground 加第九条 endpoint `GET /ping`，作为 **Walking Skeleton P1 happy path 验**——零 query 参、零 strict-schema、零 error 分支、零边界、零值复算。响应固定 `{"pong": true}`（字面布尔 true，单一 key `pong`）。验证 harness pipeline 在"trivial spec"输入下能正确完成端到端：planner 产出 PRD、proposer GAN 起草合同、reviewer 通过、generator 实现 happy path 单路径、evaluator schema 完整性 oracle 真起服务真 curl 真 jq 通过、final_evaluate=PASS、task=completed。**没有任何 error 路径需要验**——这是定义层面的 trivial：不存在拒绝输入的语义，所有请求一律 200 + 固定 body

## 背景

W19~W26 八条 endpoint 持续加深 oracle 覆盖（strict-schema、规则拒、值兜底、语义不变量、字段名锁），目的是堵 generator/proposer 各类漂移路径。但 harness pipeline 是否也能跑通"最简单的事"，从未独立验过——所有既有 task 都至少含 strict-schema + 至少一类错误分支 + 至少一类边界 oracle。

**Walking Skeleton 方法论的核心**：用最薄的一刀（thinnest possible vertical slice）验证端到端管道的连通性。如果 pipeline 连"server 收请求返固定 shape"都做不对，那加再多 oracle 都是徒劳；反过来，如果 pipeline 在 trivial spec 下能稳定跑通，则 W19~W26 的复杂 oracle 才是有意义的加深。

**W33 的核心使命**：验证 harness pipeline 在没有 error 分支、没有 strict-schema、没有边界拒、没有值复算的最简 spec 下：

1. planner 能产出符合 v8.2 Golden Path 格式的 PRD（不写 How，但 Response Schema 段足以锁死 oracle）
2. proposer 能在"几乎没有可漂移的字段"的情况下，仍然字面照搬 PRD `pong: true` 进合同
3. reviewer 能识别这是 trivial spec 不强求 W19~W26 风格的多 oracle 覆盖，APPROVED 时不假绿
4. generator 能实现"单一 happy 路径"而不画蛇添足加 error 处理
5. evaluator schema 完整性 oracle（`keys == ["pong"]` 字面相等 + `.pong === true` 字面布尔）真起服务真 curl 真 jq 通过
6. final_evaluate=PASS、task=completed

**关键反差**：W26 PR-G 是用"故意 generic 字段名"诱导 proposer 漂移；W33 是用"几乎没东西可漂移"独立验证 pipeline 在 trivial spec 下不**画蛇添足**——proposer 不许擅自添加 strict-schema 校验、不许添加 error 分支、不许添加 query param 校验；generator 不许添加 try/catch、不许添加 input sanitization、不许添加多余字段。

| 范式 | W19~W26（深 oracle 路线） | **W33（薄 skeleton 路线）** |
|---|---|---|
| query param | 1-2 个，强约束名 | **0 个** |
| strict-schema | 必备 | **无** |
| error 分支 | 至少 2-3 类 | **无**（无任何 400 路径） |
| 边界拒 | 必备 | **无** |
| 值复算 oracle | 必备 | **无**（响应固定常量） |
| schema 完整性 oracle | 必备 | **必备**（唯一保留的 oracle 形式） |
| 验收重点 | proposer/generator 不漂字段 | **proposer/generator 不画蛇添足** |

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /ping` 请求（不带任何 query / body / header）] → 经过 [playground server 收到请求，不做任何输入校验、不分支、单一处理路径] → 到达 [收到 200 响应，body **顶层 keys 字面等于** `["pong"]`，`.pong === true`（**字面布尔 true，不是字符串 "true"、不是 1、不是 "ok"**）]

具体：

1. 客户端发 `GET /ping` 到 playground server（默认端口 3000）
2. server 不做任何输入校验、不读 query / body / header（**即便客户端带了 query 参也忽略，照样返同一 body**）
3. server 直接返回 HTTP 200，JSON body 为 `{"pong": true}`（字面布尔 true，单一 key `pong`）
4. **没有任何 400 / 404 / 500 分支**——本 endpoint 不存在拒绝输入的语义，所有 GET /ping 请求一律返同一固定 body

## Response Schema

> **目的**：把响应字段 codify 成 oracle，让 proposer 把 schema 完整性 + 字面值断言转成 `jq -e` / `curl` 命令进合同；evaluator 真起服务真校验。
>
> **W33 验收核心**：本段是 proposer 字面照搬的唯一 ground truth。在"几乎没东西可漂移"的前提下，proposer 的"画蛇添足"诱惑（擅自加 query 校验、加 error 分支、加 method 限制）必须被 reviewer 死规则段落识别并打回。

### Endpoint: GET /ping

**Query Parameters**:

- **无任何 query parameter**——本 endpoint 不读 query，也不校验 query
- 客户端带任意 query（如 `/ping?x=1`、`/ping?foo=bar`）应**被静默忽略**，server 照样返同一 200 body `{"pong": true}`
- **proposer / generator 禁止**：擅自添加任何 query param 校验逻辑（如"query 必须为空"返 400）——这违反"trivial spec"语义，本 endpoint 定义层面不存在拒绝路径
- **禁用 query 名清单**（用于反向断言——这些名字带进来都该被静默忽略，不能触发任何 400）: `pong` / `ping` / `status` / `value` / `n` / `x` / `y` / `a` / `b` / `q` / `data`

**Success (HTTP 200)**:

```json
{"pong": true}
```

- `pong` (boolean, 必填): **字面布尔 `true`**（JSON 布尔字面量，不是字符串 `"true"`、不是数字 `1`、不是字符串 `"ok"`、不是对象 `{}`、不是数组 `[]`）
- 顶层 keys 必须**完全等于** `["pong"]`（集合相等，按字母序；**不允许多余字段**——不允许加 `timestamp` / `server` / `version` / `status` / `ok` / `message` / `service` / `uptime` / `node_env` / `request_id` 等任何附加元数据字段）

**Error (HTTP 4xx/5xx)**:

- **本 endpoint 不存在任何 error 分支**——所有 `GET /ping` 请求一律 200
- 即便客户端发 `GET /ping?` 或 `GET /ping?garbage=很长的字符串` 或带任意 header，仍返 200 + `{"pong": true}`
- HTTP 方法 `GET` 之外（`POST`、`PUT`、`DELETE`、`PATCH`、`OPTIONS`、`HEAD`）的行为**由 express 默认行为决定**（一般返 404），proposer / generator **不必显式处理**（不许加 method 守卫代码、不许在合同里写 `POST /ping → 405` 之类的断言）

**禁用响应字段名**（response body 严禁出现，proposer/generator 不得自由发挥同义替代）:

- **首要禁用**（最易漂移的同义名，W33 死规则黑名单）: `ping` / `status` / `ok` / `alive` / `healthy` / `response` / `result` / `message` / `pong_value` / `is_alive` / `is_ok`
- **泛 generic 禁用**: `data` / `payload` / `body` / `output` / `answer` / `value` / `meta` / `info`
- **W19~W26 字段名禁用**（不许复用旧 endpoint 的字段名）: `sum` / `product` / `quotient` / `power` / `remainder` / `factorial` / `negation` / `result` / `operation`
- **复合结构禁用**: 响应不许为嵌套 `{"data": {"pong": true}}` 或 `{"response": {"pong": true}}`——`pong` 必须是顶层 key
- **数组形式禁用**: 响应不许为 `[{"pong": true}]` 或 `{"pong": [true]}`——`pong` 的值必须是字面布尔 true（基本类型）

**禁用值变体**（`.pong` 字面必须是布尔 true）:

- 禁用字符串 `"true"`（带引号）
- 禁用数字 `1`
- 禁用字符串 `"ok"` / `"alive"` / `"yes"` / `"pong"`
- 禁用对象 `{}` / `{"alive": true}`
- 禁用数组 `[]` / `[true]`
- 禁用 `null`、`undefined`（JSON 中表示为缺字段）
- **必须**：字面 JSON 布尔 `true`，即 `typeof res.body.pong === 'boolean' && res.body.pong === true`

**Schema 完整性 oracle**（proposer 必须把以下断言全部 codify 成 contract 里的 `jq -e` 命令）:

- 200 成功响应：`jq -e 'keys | sort == ["pong"]'`（顶层 keys 字面集合相等，唯一一个 key 名为 `pong`）
- 200 成功响应：`jq -e '.pong == true'`（pong 字面布尔 true）
- 200 成功响应：`jq -e '.pong | type == "boolean"'`（pong 类型是 boolean，**不是 string / number / object / array**）
- 200 成功响应：`jq -e 'length == 1'`（顶层只有一个字段）

**HTTP 状态码 oracle**:

- 任意 `GET /ping` 请求（含带 query、带 header、空 query）应返 **HTTP 200**（不是 201、204、404、500）

## 边界情况

> **W33 范式注释**：本 endpoint 在定义层面**不存在边界**——没有输入参数所以没有边界值、没有 error 分支所以没有拒绝路径。下列"边界"项实际是**反向断言**——确认 server **不画蛇添足**地为这些"看似边界"的情况返 4xx。

- **`GET /ping?` 空 query**：返 200 + `{"pong": true}`（不是 400）
- **`GET /ping?x=1` 带未定义 query**：返 200 + `{"pong": true}`（query 被忽略，不是 400）
- **`GET /ping?pong=false` 带同名 query**：返 200 + `{"pong": true}`（query 不影响响应体，pong 仍是字面 true）
- **`GET /ping?garbage=很长字符串...` 含特殊字符 query**：返 200 + `{"pong": true}`（不解析 query）
- **重复请求**：连续多次 `GET /ping` 必须每次都返同一 body（无状态、无计数器、无随机化）
- **响应必须是确定性的**：不许加 `timestamp` / `request_id` / `uptime` 等会随时间变化的字段
- **`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 现有行为不受影响**（不动这八条路由的代码、单测、README 段一个字符）
- **零依赖**：playground 现有零依赖原则保持不变（仅依赖已有的 `express`），不引入新依赖
- **POST/PUT/DELETE/PATCH /ping 的行为**：由 express 默认 404 行为兜底，**不在本任务范围内**（不必显式校验，不必加 method 守卫，不必在测试中断言；测试只覆盖 GET）

## W33 验收：harness pipeline 在 trivial spec 下不画蛇添足

W33 不是 W19~W26 oracle 链的延伸，**核心是 Walking Skeleton 范式验收**——验证 harness pipeline 在"几乎没东西可做错"的最薄一刀 spec 下：

**W33 验收 success criteria**:

1. **planner 输出 PRD**（本文件）：Golden Path 段明确写"零 query / 零 error / 零边界 / 固定响应"
2. **proposer 输出合同**（任一 round）必须满足：
   - response success key 字面 = `pong`（**禁用任一禁用清单字段名替代**：`ping` / `status` / `ok` / `result` / `message` 等）
   - response success value 字面 = 布尔 `true`（**禁用变体**：字符串 `"true"`、数字 `1`、字符串 `"ok"` 等）
   - schema 完整性断言 keys 集合 = `["pong"]`，字面相等
   - **proposer 禁止画蛇添足**：合同不许出现任何 strict-schema 校验、任何 query param 校验、任何 error 分支（除 express 默认 404 之外）、任何 HTTP method 守卫
3. **reviewer 输出**：每 round reviewer 评分必须含 SKILL.md v6.2 全部 7 个评分维度；reviewer 必须识别 W33 的 trivial 语义，**不强求**多 error 分支 / 多边界覆盖（不能因为"oracle 数量少"而 needs_revision）；但 reviewer 必须**严守** schema 完整性 oracle 不缺
4. **generator 输出**：实现真按合同 endpoint `GET /ping` + 响应字段名 `pong` + 字面布尔 `true` **字面照搬**，无 `ping` / `status` / `ok` / `result` / `"true"` / `1` 等漂移
5. **evaluator 输出**：合同里的 `GET /ping → 200 + {pong: true}` happy path oracle 真起服务真 curl 真 jq 校验通过；schema 完整性 oracle（`keys | sort == ["pong"]`、`.pong == true`、`.pong | type == "boolean"`、`length == 1`）全部通过
6. **final_evaluate 状态**：PASS → task = completed

> **W33 验收的失败信号**（任一发生即重开 issue）:
> - proposer 任一 round 合同含 `{ping}` / `{status: "ok"}` / `{result: true}` / `{pong: "true"}` / `{pong: 1}` 等任一禁用形态
> - proposer 任一 round 合同擅自添加 strict-schema / query param 校验 / error 分支（不在 PRD 范围内的画蛇添足）
> - reviewer 任一 round 误把"oracle 数量少"判 needs_revision（错读 W33 trivial 语义）
> - generator 实现添加无关 try/catch / input sanitization / 多余字段（违背 trivial spec）
> - evaluator schema 完整性 oracle 跳过 / 假绿

## 范围限定

**在范围内**：

- 在 `playground/server.js` 在 `/increment` 之后、`app.listen` 之前新增 `GET /ping` 路由（**单行实现**：`app.get('/ping', (req, res) => res.json({ pong: true }));` 或等价的两三行写法）
- 在 `playground/tests/server.test.js` 新增 `GET /ping` describe 块单测，与既有 8 条路由 describe 块平级，覆盖：
  - happy path 至少 3 条：基本 `GET /ping` 返 200、断言 `res.body.pong === true`、断言 `Object.keys(res.body)` 严格等于 `['pong']`
  - **schema 完整性 oracle 核心**：至少 1 条断言 `typeof res.body.pong === 'boolean'`（防 generator 返字符串 `"true"` 或数字 `1`）
  - **反画蛇添足断言**：至少 2 条覆盖"带 query 仍返 200 + 同 body"——例如 `GET /ping?x=1` 返 200 + `{pong: true}`、`GET /ping?pong=false` 返 200 + `{pong: true}`（query 不影响响应）
  - **确定性断言**：至少 1 条覆盖"连续 2 次请求返同一 body"（不许加 timestamp / uptime 等时变字段）
  - 回归断言：`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 至少各 1 条 happy 用例仍然通过
- 在 `playground/README.md` 端点列表加 `/ping`，给出至少 1 个 happy 示例（`GET /ping → 200 {"pong": true}`）；可选标注"trivial endpoint，无 query 参、无 error 分支"
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖
- 不改 `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 的实现或单测（一字不动）
- 不加 strict-schema 校验、query param 校验、error 分支（PRD 定义不存在的不许擅自添加）
- 不加 HTTP method 守卫（POST/PUT/DELETE /ping 由 express 默认处理）
- 不加 rate-limit、auth、CORS、日志、监控、metrics
- 不加 timestamp / uptime / request_id / version 等时变 / 元数据字段
- 不引入 W19~W26 风格的字段名（`result` / `operation` / `sum` / 等）—— pong 是独立命名空间
- 不写跨子项目的集成测试
- 不支持 path param / body / POST，仅 GET 路径无 query

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 响应 body 顶层字段名严格为 `pong`（**字面**，按 W33 死规则不可改名）；字段值严格为字面布尔 `true`（**字面**，不是字符串 / 数字 / 对象 / 数组 / null）]
- [ASSUMPTION: 不读 / 不校验 query，express handler 形如 `(req, res) => res.json({ pong: true })`；query 被静默忽略]
- [ASSUMPTION: HTTP method 之外的路由分发由 express 默认行为兜底（POST /ping → 404）；不必显式加 method 守卫]
- [ASSUMPTION: 响应是无状态的、确定性的——每次 `GET /ping` 返同一 body，无 timestamp / uptime / counter / random]
- [ASSUMPTION: README 段落可以**没有** error / 边界示例（因为本 endpoint 不存在 error 分支）；至少 1 个 happy 示例即可]
- [ASSUMPTION: `/ping` 不与既有 `/health` 重复——虽然 `/health` 也是 trivial happy endpoint，但 `/health` 返 `{ok: true}`，`/ping` 返 `{pong: true}`；shape 不同、key 不同，独立路由独立测试]

## 预期受影响文件

- `playground/server.js`：在 `/increment` 之后新增 `GET /ping` 路由（≈ 1-3 行，最简单的 express handler）
- `playground/tests/server.test.js`：新增 `GET /ping` describe 块（happy 3+ + schema 完整性 oracle 1+ + 反画蛇添足 2+ + 确定性 1+ + 回归断言 8+）
- `playground/README.md`：端点列表加 `/ping`，补 1+ happy 示例

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；按规则归类为 autonomous（与 W19~W26 同分类）
