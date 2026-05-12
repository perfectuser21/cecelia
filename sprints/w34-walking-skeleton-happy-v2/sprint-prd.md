# Sprint PRD — Walking Skeleton P1 happy path 验（uncapped fix loop 后首次端到端验证）

## OKR 对齐

- **对应 KR**：Walking Skeleton P1（harness pipeline 端到端 happy path 必须 100% completed，不允许停在 terminal_fail）
- **当前进度**：P1 B1–B11 全部合 main 部署（PR #2903 / #2905 / #2909 / #2907 / #2904 / #2911 / #2913 / #2917 / #2920 / #2924）；最新一颗 PR #2924 把 `MAX_FIX_ROUNDS` 3→20（env `HARNESS_MAX_FIX_ROUNDS` 可覆盖），解决 W32/W33 trivial spec 4 round 后被硬 cap 切 terminal_fail 的"过早放弃"问题。但 uncapped 后端到端是否真能稳定走完 happy path（task_status=completed、PR merged、final_evaluate=PASS），**至今未在 prod 用一条 trivial spec 实证过**——B1–B11 全合，但 happy path 整链一次跑通是空白
- **本次推进预期**：在 playground 上加一个 **故意取所有维度最简形态的** endpoint `GET /uppercase`（单字符串参数、字符串大写映射、零精度坑、零除零坑、零数学边界、零浮点歧义），作为 **harness pipeline happy path 端到端实证**——目标是 task_status=**completed**（不接受 failed / terminal_fail / unconvergent_fail）、PR 合并、final_evaluate=PASS。**fix loop 跑几轮不重要**（理想 1 轮过；2–5 轮也可接受；只要在 20 上限内 PASS 都算 happy path 验证成功）。**不接受 terminal_fail 兜底**——若 task=failed，则 B11 的"质量优先无硬 cap"判断失败，需重开 P1 issue

## 背景

Walking Skeleton P1 修了 11 颗 B 级 bug（dispatcher HOL、slot 实时对齐、reaper 阈值、heartbeat 可信度、dev-task 回写、harness-evaluate dispatch、learning 入库 task_id 列绑定、evaluate_contract 复用 thread_id、MAX_FIX_ROUNDS 3→20 等），全部合 main 部署。但 **端到端 happy path 整链一次跑通至今未实证**：

- **W32** `/ping` spec：generator 漂移到 `/hello` → 字段名错位 → 4 round fix 仍 FAIL → 被 MAX_FIX_ROUNDS=3 cap 切 terminal_fail
- **W33** `/hello?name=X` spec：同样 4 round fix 未让 evaluator PASS → 被 MAX_FIX_ROUNDS=3 cap 切 terminal_fail

W32/W33 失败 root cause **不是 fix loop 真不收敛**，是 3 round 给 generator 改 contract 漂移问题的预算太紧。PR #2924 把上限抬到 20（实际等价无 cap），但 **上限抬高后能否真走通整链**，需要一次 happy path 实证。W34 就是这次实证。

**为什么取 `/uppercase`**：

W34 不像 W19–W26 系列那样追求"oracle 范式新颖"或"strict-schema 难度新增"——W34 的核心命题是 **harness pipeline 端到端能跑完一次**。endpoint 设计采取所有维度的最简形态，**主动消除一切可能让 generator 走偏的歧义**：

| 维度 | W19–W26 历史选择 | W34 `/uppercase` 选择 | 选择理由 |
|---|---|---|---|
| 输入类型 | 数字字符串（精度 / NaN / Infinity 都是坑） | **ASCII 字母字符串**（纯 ASCII，无 Unicode 复杂度） | 消除数字歧义 |
| 算术 | 加 / 减 / 乘 / 除 / 幂 / 模 / 阶乘 / +1（都有边界） | **`text.toUpperCase()` 内建方法**（零边界） | 消除算术边界陷阱 |
| strict-schema | 复杂正则（W22 `^-?\d+(\.\d+)?$` / W24 `^\d+$` / W26 `^-?\d+$`） | **`^[A-Za-z]+$`** 极简白名单 | 消除浮点 / 整数 / 负号歧义 |
| 输出 | `{result, operation}` + 复杂 jq 校验 | **`{result, operation: "uppercase"}`**（保持 W25/W26 字段名约定字面一致） | 复用已验证的 schema 形态 |
| 拒绝路径 | 除零 / 0^0 / 上界 / 下界 / 符号 / 跨调用 | **缺参 + strict-schema 不通过 + 多 query 名** 三条 | 收敛到最简错误分支 |
| query 名 | a/b（W19–W23）、n（W24）、value（W26） | **`text`**（不复用任一旧名） | 防 generator 复读旧模板假绿 |

**简化的代价**：W34 不验证任何新 oracle 范式（无 schema 完整性 oracle 升级、无 PR-G 死规则验证、无跨调用不变量）。这是 **刻意的**——W34 只 verify 一件事：harness pipeline 在 happy path（generator 大概率 1–3 round 收敛）+ uncapped fix loop（即使需要 4–10 round 也不会被 cap 切）下，最终 task_status=**completed**。

**预期 fix_round 分布**（用来事后分析 B11 是否真起作用）：

- **理想（happy path 最强信号）**：proposer 一轮过 contract GAN，generator 一轮 push PR，CI green，evaluator PASS，**`fix_round=0` 直接 merge_pr**——证明端到端最短路径走通
- **次理想（happy path 仍算成功）**：`fix_round ∈ [1, 3]`，与 W32/W33 之前的失败模式一样进 fix loop，但这次 round=4/5 时仍能走出来，最终 task=completed
- **B11 触发证据**（仍算 happy path 验证成功）：`fix_round ∈ [4, 19]`，证明若没有 B11 改 3→20，此 task 在 round=4 被切 terminal_fail；现在 uncapped 让它走完
- **失败信号**（W34 验证失败，B11 判断需重审）：`fix_round=20` 真被 sanity 上限切；或 `task=failed`；或 `task=unconvergent_fail`

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /uppercase?text=hello` 请求] → 经过 [playground server 用 strict-schema `^[A-Za-z]+$` 校验 text、调 `text.toUpperCase()` 映射、返回 `{result, operation}`] → 到达 [收到 200 响应，body 顶层 keys 字面等于 `["operation", "result"]`，`result === "HELLO"` 且 `operation === "uppercase"`]

具体：

1. 客户端发 `GET /uppercase?text=<纯 ASCII 字母字符串>` 到 playground server（默认端口 3000）
2. server 验证有且仅有一个 query param `text`（多 query 或缺 text 都拒）
3. server 对 `text` 做 strict-schema 校验：完整匹配 `^[A-Za-z]+$`（**仅 A-Z 与 a-z 字母，至少 1 字符；禁数字、禁空格、禁标点、禁 Unicode、禁空串、禁混入非字母字符**），不通过 → 400
4. 计算 `result = text.toUpperCase()`（JavaScript 内建方法，纯 ASCII 输入下行为确定）
5. 返回 HTTP 200，JSON body 为 `{ "result": <text.toUpperCase()>, "operation": "uppercase" }`（**两个字段都必填，字面字符串 `"uppercase"` 不许变体**）
6. 任一异常（缺参 / strict 不过 / 多 query 名）→ HTTP 400 + `{ "error": "<非空字符串>" }`，body 不含 `result` 也不含 `operation`

## Response Schema

> **目的**：把响应字段 codify 成 oracle，让 proposer 把每个字段 + query param 名 + operation 字面量 + schema 完整性转成 `jq -e` / `curl` 命令进合同；evaluator 真起服务真校验。
>
> **沿用 W26 PR-G 死规则**：proposer SKILL v7.5 已加"字面照搬 PRD 字段名"死规则，本 PRD 在此条款下生效——contract 必须用字面 `result` + `operation` + `"uppercase"`，不许"语义化优化"到 `uppercased` / `upper` / `transformed` / `output` 等同义名。

### Endpoint: GET /uppercase

**Query Parameters**:

- `text` (string, 必填): 待映射的 ASCII 字母串；必须完整匹配 strict-schema 正则 `^[A-Za-z]+$`（**仅 A-Z + a-z 字母，至少 1 字符；禁数字、禁空格、禁标点、禁 `_`、禁 `-`、禁 Unicode 字母如 `é`/`ñ`/`中`、禁空串**）
- **强约束**: proposer / generator 必须**字面用** `text` 作为 query param 名
- **禁用 query 名**: `value` / `input` / `str` / `s` / `string` / `name` / `word` / `chars` / `data` / `q` / `arg` / `a` / `b` / `n` / `t` / `txt` / `content` / `payload`——用错 query 名一律视为合同违约
- 用错 query 名 endpoint 应返 400（缺参分支）

**Success (HTTP 200)**:

```json
{"result": "HELLO", "operation": "uppercase"}
```

- `result` (string, 必填): JS 字符串，**字面等于** `text.toUpperCase()`；对纯 ASCII 字母输入此函数行为确定（`'a'` → `'A'`，`'Z'` → `'Z'`，长度不变）
- `operation` (string, 必填): **字面字符串 `"uppercase"`**，禁用变体 `upper` / `uppercased` / `upper_case` / `to_upper` / `toUpperCase` / `transform` / `transformed` / `op` / `method` / `action` / `type` / `kind`
- 顶层 keys 必须 **完全等于** `["operation", "result"]`（按字母序，集合相等；**不允许多余字段**，不允许加 `text` / `input` / `length` / `original` / `output` / `data` / `payload` / `response` / `meta` 等任何附加字段）

**Error (HTTP 400)**:

```json
{"error": "<非空 string>"}
```

- `error` (string, 必填): 非空字符串（具体文案不强约束）
- 错误响应 body **必须不包含 `result` 字段，也不包含 `operation` 字段**
- 顶层 keys 必须 **完全等于** `["error"]`，不允许多余字段
- 错误时禁用替代字段名：`message` / `msg` / `reason` / `detail` / `details` / `description` / `info` / `code`

**禁用响应字段名**（response body 严禁出现）:

- **首要禁用**（proposer 最易"语义化优化"到的同义名）: `uppercased` / `upper` / `upper_text` / `transformed` / `transformed_text` / `mapped` / `output`
- **泛 generic 禁用**: `value` / `input` / `text` / `data` / `payload` / `response` / `answer` / `out` / `meta` / `original`
- **复用其他 endpoint 字段名禁用**: `sum`（W19）/ `product`（W20）/ `quotient`（W21）/ `power`（W22）/ `remainder`（W23）/ `factorial`（W24）/ `negation`（W25）—— 不许复用

**Schema 完整性 oracle**（proposer 必须把以下断言 codify 成 contract 里的 `jq -e` 命令）:

- 200 成功响应：`jq -e 'keys | sort == ["operation","result"]'`（顶层 keys 字面集合相等）
- 200 成功响应：`jq -e '.operation == "uppercase"'`（operation 字面量字符串严格相等）
- 200 成功响应：`jq -e '.result | type == "string"'`（result 是 string）
- 200 成功响应：`jq -e '.result == "<独立 text.toUpperCase() 复算>"'`（result 值正确）
- 400 错误响应：`jq -e 'keys | sort == ["error"]'`（顶层只一个 error key）
- 400 错误响应：`jq -e '.error | type == "string" and length > 0'`（error 是非空字符串）
- 400 错误响应：`jq -e 'has("result") | not'`（错误响应不含 result）
- 400 错误响应：`jq -e 'has("operation") | not'`（错误响应不含 operation）

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^[A-Za-z]+$`（**仅 ASCII 字母 A–Z 与 a–z，至少 1 字符；禁数字、禁空格、禁标点、禁下划线、禁短横线、禁 Unicode 字母**）

| 输入示例 | strict-schema 判定 | result 复算 | 期望响应 |
|---|---|---|---|
| `text=hello` | 合法 | `"HELLO"` | 200，`{result: "HELLO", operation: "uppercase"}` |
| `text=HELLO` | 合法（已是大写） | `"HELLO"` | 200，`{result: "HELLO", operation: "uppercase"}` |
| `text=Hello` | 合法（首字母大写） | `"HELLO"` | 200 |
| `text=a` | 合法（单字符） | `"A"` | 200，`{result: "A", operation: "uppercase"}` |
| `text=Z` | 合法（单字符大写） | `"Z"` | 200 |
| `text=AbCdEf` | 合法（混合大小写） | `"ABCDEF"` | 200 |
| `text=` | strict 拒（空串） | — | 400 |
| 缺 text（无 query） | — | — | 400 |
| `text=hello123` | strict 拒（含数字） | — | 400 |
| `text=hello world` | strict 拒（含空格） | — | 400 |
| `text=hello-world` | strict 拒（含短横线） | — | 400 |
| `text=hello_world` | strict 拒（含下划线） | — | 400 |
| `text=hello!` | strict 拒（含标点） | — | 400 |
| `text=123` | strict 拒（纯数字） | — | 400 |
| `text=café` | strict 拒（Unicode 字母 é） | — | 400 |
| `text=中文` | strict 拒（CJK） | — | 400 |
| `text=hello&text=world`（多 text） | 拒（多 query 名） | — | 400 |
| `?value=hello`（错 query 名） | 拒（缺 text） | — | 400 |

## 边界情况

- **单字符 happy**（`text=a` / `text=Z`）必须显式覆盖：generator 不许写出"长度 ≥ 2 才认"的隐式假设
- **已是大写 happy**（`text=HELLO`）必须返 `"HELLO"`，证明 `toUpperCase()` 对已大写串是幂等
- **混合大小写 happy**（`text=AbCdEf`）必须返 `"ABCDEF"`，证明逐字符映射不漏
- **判定顺序**：缺 text → 多 query 名 → strict-schema → 计算。错任一阶段都 400，body 不含 `result`/`operation`
- **零依赖**：playground 现有零依赖原则保持不变，不引入 `validator` / `joi` / `zod` / 任何外部库
- **不允许 Unicode 扩展**：strict-schema 锁死 `^[A-Za-z]+$`，严禁 generator 用 `/^\p{L}+$/u` 或允许 Unicode 字母（W34 happy path 唯一目的就是最简形态走通管线，不接受任何范围扩展）
- **`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 现有行为不受影响**（不动这八条路由的代码、单测、README 段一个字符）
- **不引入跨调用不变量**：单调用 oracle 充分（`result === text.toUpperCase()`）
- **不引入符号 / 精度 / 数学边界**：纯字符串映射，无浮点 / 整数 / 负号 / NaN / Infinity 概念

## Walking Skeleton P1 happy path 验收：harness pipeline 端到端 completed

W34 的核心命题不是"加一个新 endpoint"，是 **验证 harness pipeline 在 happy path + uncapped fix loop 下能真走完整链 task=completed**。endpoint 是验证的载体，不是目标本身。

**Walking Skeleton P1 happy path success criteria**（由 harness 运行后自动检查 / 人工最终签核）:

1. **task 最终状态 = `completed`**（PG `tasks` 表 status 字段；**不接受 `failed` / `terminal_fail` / `unconvergent_fail` / `cancelled` / `timed_out`**）
2. **PR 已合并**（PR_url 在 dev_records 表，merged_at 字段非空）
3. **final_evaluate verdict = `PASS`**（`task_events` 或 `final_e2e_verdict` 字段）
4. **fix_round ≤ 19**（即使进了 fix loop 也在 sanity 上限内收敛；`fix_round=20` 被 sanity 切视为验证失败信号）
5. **playground 八条已有路由（`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment`）回归单测全通过**（任一回归挂视为 generator 破坏现有路由，task 不算 completed）
6. **新 endpoint `/uppercase` 单测全通过**（happy + strict 拒 + 错 query 名 + schema 完整性 + 禁用字段反向断言）

**B11（MAX_FIX_ROUNDS 3→20）真生效证据**（W34 至少需要落地以下任一观测来证明 PR #2924 真有效，不是只改了常量没起作用）:

- **场景 A（理想 happy path，B11 不需触发）**：`fix_round=0`，generator 一轮过，证明端到端最短路径走通；**B11 等于背景兜底，未被实际使用，但 W34 主目标达成**
- **场景 B（fix_round=1–3，仍在旧上限内）**：进 fix loop 但 3 round 内 PASS；**B11 等于背景兜底，证明旧上限对部分 case 已够**
- **场景 C（fix_round=4–19，B11 真触发，最强证据）**：进 fix loop 且超过旧上限 3，但在新上限 20 内 PASS；**证明 B11 改 3→20 真把 W32/W33 类失败救回来——这是 W34 最理想的实证**

**Walking Skeleton P1 happy path 验证失败信号**（任一发生即重开 P1 issue）:

- task=failed（任一原因）
- task=terminal_fail（fix loop 触顶被切）
- fix_round=20（sanity 上限切，证明 spec 真不收敛，但 happy path spec 这么简单不该出现）
- PR 未合并
- final_evaluate=FAIL
- 已有八条路由回归挂任意一条

## 范围限定

**在范围内**：

- 在 `playground/server.js` 在 `/increment` 之后、`app.listen` 之前新增 `GET /uppercase` 路由（含 query 名 / 数量校验 + strict-schema `^[A-Za-z]+$` + `text.toUpperCase()` 算术 + 返回 `{result, operation: "uppercase"}`）
- 在 `playground/tests/server.test.js` 新增 `describe('GET /uppercase', ...)` 块单测，与既有 describe 块平级，覆盖：
  - happy path（含单字符 `a`/`Z`、全小写 `hello`、全大写 `HELLO`、混合大小写 `AbCdEf` 至少 5 条；显式断言 `result === text.toUpperCase()`）
  - strict-schema 拒（空串、含数字、含空格、含标点、含下划线、含短横线、含 Unicode 字母 `café`、CJK `中文`、`text=` 各至少 1 条）
  - 缺参（无 text query）拒
  - 错 query 名（如 `?value=hello`）拒
  - 多 query 名（如 `?text=hello&text=world`）拒
  - 至少 2 条 **schema 完整性 oracle** 断言：
    - 至少 1 条断言 `Object.keys(res.body).sort()` 严格等于 `['operation', 'result']`
    - 至少 1 条断言 `res.body.operation === 'uppercase'`（字面字符串）
  - 至少 1 条断言：失败响应 body 不含 `result` 且不含 `operation`
  - 至少 1 条断言：失败响应 `Object.keys(res.body).sort()` 严格等于 `['error']`
  - 回归断言：`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 至少各 1 条 happy 用例仍然通过
- 在 `playground/README.md` 端点列表加 `/uppercase`，给出 happy（单字符 + 全小写 + 混合大小写）+ strict 拒（含数字 / 空格 / Unicode）+ 错 query 名 至少 5 个示例
- 保持 playground 零依赖原则

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / ajv / validator / 任何外部库）
- 不改 `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 的实现或单测（一字不动）
- 不扩展 strict-schema 到 Unicode 字母 / 数字 / 空格 / 标点（happy path 唯一目的就是最简）
- 不做 rate-limit、auth、CORS、日志结构化
- 不写跨子项目集成测试
- 不支持 path param / body / POST，仅 GET + query string
- 不引入跨调用不变量 oracle（单调用 `result === text.toUpperCase()` 充分）
- 不引入"语义化优化"字段名（`uppercased` / `upper` / `transformed` / `mapped` 等）
- 不验证任何新 oracle 范式——W34 的命题是 **harness pipeline 端到端走通**，不是 oracle 创新

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应格式为 HTTP 400 + `{ error: "<非空字符串>" }`（与现有八条路由一致）]
- [ASSUMPTION: strict-schema 用原生 RegExp `^[A-Za-z]+$`（与既有 `STRICT_NUMBER`、`STRICT_INT` 都不同，单独写一份新常量如 `STRICT_ASCII_ALPHA` 或就地写字面量，二选一；严禁复用旧 regex 假绿）]
- [ASSUMPTION: 响应 body 顶层字段名严格为 `result` 与 `operation`（**字面**，按 PR-G 死规则不可改名）；operation 值严格为字符串 `"uppercase"`（字面）]
- [ASSUMPTION: 大写映射用 JavaScript 内建 `String.prototype.toUpperCase()`，无需手写字符码映射]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body / POST]
- [ASSUMPTION: query param 名严格为 `text`（与既有路由 `a/b/n/value` 形成可区分集合；不复用避免 generator 复读模板）]
- [ASSUMPTION: 多 query 名场景（如 Express 默认把 `?text=a&text=b` 解析成数组）的判定路径：generator 可用 `Array.isArray(req.query.text)` 或 `Object.keys(req.query).length !== 1` 判定，二选一]
- [ASSUMPTION: B11（MAX_FIX_ROUNDS=20）已在 prod brain 通过 env 或代码默认值生效；harness pipeline dispatch W34 task 时无需额外配置]
- [ASSUMPTION: harness pipeline 完整链路（planner → proposer → reviewer → generator → CI → evaluator → merge_pr → final_evaluate → reportNode → tasks.status='completed' 回写）所有 B1–B11 修复已部署 prod brain]

## 预期受影响文件

- `playground/server.js`：在 `/increment` 之后新增 `GET /uppercase` 路由 + query 数量校验 + strict-schema `^[A-Za-z]+$` + `text.toUpperCase()` 算术 + 返回 `{result, operation: "uppercase"}`（≈ 10–14 行）
- `playground/tests/server.test.js`：新增 `describe('GET /uppercase', ...)` 块（happy 5+ + strict 拒 9+ + 缺参 + 错 query 名 + 多 query 名 + schema 完整性 oracle 2+ + 禁用字段反向断言 + 错误体 keys=['error'] 断言 + 八路由回归 8+ 条）
- `playground/README.md`：端点列表加 `/uppercase` 段（happy 3+ + strict 拒 3+ + 错 query 名 1+ 示例）

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；与 W19~W26 同分类（autonomous）
