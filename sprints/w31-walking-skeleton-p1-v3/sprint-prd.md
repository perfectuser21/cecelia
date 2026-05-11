# Sprint PRD — playground 加 GET /decrement endpoint（Walking Skeleton P1 终验 round 3 · long timeout）

## OKR 对齐

- **对应 KR**：W31 Walking Skeleton — Cecelia harness pipeline 端到端 oracle 链路验证（接续 W19 `/sum`、W20 `/multiply`、W21 `/divide`、W22 `/power`、W23 `/modulo`、W24 `/factorial`、W26 `/increment`），并作为 **Walking Skeleton P1 终验 round 3（long timeout）**——证明 P1 B1（reportNode 回写 task.status, #2903）/ B2（zombie reaper, #2905）/ B3（slot accounting 实时对齐, #2909）/ B4（consciousness-loop guidance TTL, 7eb7a2fc5）/ B5（dispatcher HOL skip, #2911）/ B6（dispatch_events 真写入, #2904）/ B7（fleet heartbeat 可信度修复, cc7901ccb）/ B8（reaper threshold 30→60min + harness_* 豁免, #2913）/ B9（lookupHarnessThread 加 harness-evaluate dispatch, #2917）九项修复 **联合生效**：harness initiative 跑到底无 dispatcher 死锁、无 zombie 误杀、无 callback 404、无 task status 永卡 `in_progress`
- **当前进度**：W19~W26 跑通七条 endpoint，演进出"strict-schema + 输入规则拒 + 输出值兜底 + 单调用语义不变量 + 多调用递推不变量 + 字段名字面相等 oracle"六类 oracle 范式；W26 `/increment` 通过 PR-G（proposer SKILL v7.5 死规则）；P1 B1-B9 全部合 main；W29（round 1）卡在 reaper 误杀（B8 修），W30（round 2）卡在 evaluator callback 404（B9 修）；本次 round 3 是 B8+B9 同时合后第一次跑通完整 long-timeout pipeline 的 ground truth
- **本次推进预期**：在 playground 上加第八个 endpoint `/decrement`，作为 **P1 round 3 长超时验收** 的具体载体——PRD 字面锁死 response 字段为 `{result, operation: "decrement"}`、query 名为 `value`、strict-schema `^-?\d+$`、双侧精度上界 `|value| ≤ 9007199254740990`，与 W26 `/increment` **结构对称但 operation 字面量不同**。Pipeline 在 long-timeout 配置下（`ZOMBIE_REAPER_IDLE_MIN ≥ 60`，B8 默认值）应跑完 planner → proposer GAN ≥ 1 round → reviewer APPROVED → generator 出 PR → evaluator GAN ≥ 1 round → final_evaluate PASS → task=completed 全链路无中断。任一 P1 修复**未真生效**（zombie 误杀 harness_* / dispatcher 死锁 / callback 404 / status 不回写）则 round 3 失败、重开对应 issue

## 背景

Walking Skeleton P1 设计目标是把 Cecelia harness pipeline 从"单 endpoint 跑通"加厚成"长时间运行（数十分钟到数小时）稳定不死锁"。B1-B9 九项修复全部合 main 后，必须在真实 long-timeout 配置下跑一条完整 initiative 才能证明组合生效。

历史轨迹：

- **W29（round 1，pre-B8）**：harness_initiative 派出 30 min 后 zombie-reaper 默认 30 min 阈值把 harness_proposer/reviewer 全部 reap → task=failed。**B8 修**：阈值 30→60min，且对 `task_type LIKE 'harness_%'` 全部豁免（不管阈值）
- **W30（round 2，pre-B9）**：harness_initiative 跑 1h+ 后 ws1 sub-task 卡 `await_callback`。evaluator container 已 exit=1 但 `lookupHarnessThread` 不认 `graph_name='harness-evaluate'`（PR #2901 引入的 sub-graph 节点没注册 lookup dispatch）→ 永远返 `null` → 404 → graph state 永久暂停。**B9 修**：lookup router 加 `case 'harness-evaluate'` dispatch
- **W31（round 3，post-B8+B9）**：B8+B9 同时合后第一次真跑。本 PRD 是这次跑的 PRD（用 `/decrement` 作 substrate）。预期跑完 ≥ 1h 不死、final_evaluate PASS、task=completed 真持久化

**为什么挑 `/decrement` 作 substrate**：

- 与 W26 `/increment` **结构对称**：query 名同样是 `value`，strict-schema 同样是 `^-?\d+$`，精度上界同样是 `|value| ≤ 9007199254740990`——这种"几乎相同但 operation 不同"的形态恰好考验 proposer/generator 是否会**犯"懒省事直接复用 /increment 模板"的错**（generator 易把 `operation: "increment"` 漏改成 "decrement"；proposer 易复用 W26 合同字面），符合 W26 PR-G 死规则的延伸验收
- 算术语义最简单（`result = Number(value) - 1`），不像 W22 power 有 `0^0` 不定式、W23 modulo 有符号问题、W24 factorial 有跨调用递推——保持算术零歧义，把测试压力集中在**长时间 pipeline 稳定性**而不是 oracle 复杂度
- 双侧精度上界 oracle 与 W26 同形态（`|value| > 9007199254740990` → 400），proposer 不需要发明新 oracle 范式，专心把 P1 长超时跑稳即可

| oracle 形式 | W19 sum | W20 mul | W21 div | W22 pow | W23 mod | W24 fact | W26 inc | **W31 dec** |
|---|---|---|---|---|---|---|---|---|
| 值复算严格相等 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（`result === Number(value) - 1`） |
| strict-schema 白名单 | — | ✓（浮点） | ✓ | ✓ | ✓ | ✓（`^\d+$`） | ✓（`^-?\d+$`） | ✓（**复用 `^-?\d+$` 整数允负，与 W26 同**） |
| 输入规则级拒 | — | — | ✓（b=0） | ✓（0^0） | ✓（b=0） | ✓（n>18） | ✓（`|value|>9007199254740990`） | ✓（**复用 W26 同上界双侧拒**） |
| 输出值级兜底 | — | — | — | ✓ | — | — | — | —（上界已挡） |
| 单调用语义不变量 | — | — | — | — | ✓（sign） | — | — | — |
| 多调用递推不变量 | — | — | — | — | — | ✓ | — | — |
| 字段名字面相等 oracle | — | — | — | — | — | — | ✓（PR-G） | ✓（**proposer 不许把 `operation: "decrement"` 漏成 "increment" / "dec" / "subtract" / "minus_one"**） |
| **长超时 pipeline 稳定性验收**（W31 核心） | — | — | — | — | — | — | — | **✓（≥ 1h 真跑无 reaper 误杀、无 dispatcher 死锁、无 callback 404、无 status 永卡）** |

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /decrement?value=5` 请求] → 经过 [playground server 用 strict-schema `^-?\d+$` 校验 value、显式拒绝 `|Number(value)| > 9007199254740990`（精度上界）、计算 `Number(value) - 1` 并返回] → 到达 [收到 200 响应，body **顶层 keys 字面等于** `["operation", "result"]`，`result === Number(value) - 1` 且 `operation === "decrement"`（**字面量字符串，不许变体**）]

具体：

1. 客户端发 `GET /decrement?value=<十进制整数字符串，含可选前导负号>` 到 playground server（默认端口 3000）
2. server 检查 query 顶层 keys 是否**只包含 `value` 一个 key**（与 W26 `/increment` 实现一致，挡多余 query 参）
3. server 对 `req.query.value` 做 strict-schema 校验（白名单正则 `^-?\d+$`，**与 W19~W23 浮点 regex `^-?\d+(\.\d+)?$` 不同，与 W24 `^\d+$` 不同；与 W26 `^-?\d+$` 相同但**必须独立写一份字面量或独立常量名，不许 import W26 的 `STRICT_INT`——避免复用造成 bundling-time 隐式耦合**）
4. strict-schema 通过后，**显式判定 `Math.abs(Number(value)) > 9007199254740990`**（即 `Number.MAX_SAFE_INTEGER - 1`），是则返回 HTTP 400 + `{ "error": "<非空说明字符串>" }`，body 不含 `result` 字段也不含 `operation` 字段
5. 计算 `result = Number(value) - 1`（普通整数减 1，JS Number 在此范围内精确）
6. 返回 HTTP 200，JSON body 为 `{ "result": <Number(value)-1>, "operation": "decrement" }`（**两个字段都必填，operation 字面字符串 `"decrement"` 不许变体**）
7. 任一参数缺失 / 多余 query / 不通过 strict-schema / `|value| > 9007199254740990` → HTTP 400 + `{ "error": "<非空字符串>" }`，body 不含 `result` 也不含 `operation`

## Response Schema

> **目的**：把响应字段 + query param 名 + operation 字面量 + schema 完整性 codify 成 oracle，让 proposer 把每个字段转成 `jq -e` / `curl` 命令进合同；evaluator 真起服务真校验。
>
> **W31 长超时验收核心**：本段是 proposer **字面照搬**的唯一 ground truth。Proposer SKILL v7.5 死规则要求：contract `jq -e` 用的 key 名 / operation 字面量 / 禁用清单 / schema keys 集合，**全部必须与本段字面相等**（grep 对比通过）。任一漂移视为 PR-G 死规则未持续生效（W26 已验过但 W31 重复验，确保未回归）。

### Endpoint: GET /decrement

**Query Parameters**（v8.2 — 强制约束 query param 名）:

- `value` (integer-as-string, 必填): 待减 1 的整数；必须完整匹配 strict-schema 正则 `^-?\d+$`（**十进制整数字符串，含可选前导负号；禁小数、禁前导 +、禁科学计数法、禁十六进制、禁千分位**），且 `Math.abs(Number(value)) <= 9007199254740990`
- **强约束**: proposer / generator 必须**字面用** `value` 作为 query param 名（与 W26 `/increment` 一致）
- **禁用 query 名**: `n` / `x` / `y` / `m` / `k` / `i` / `j` / `a` / `b` / `p` / `q` / `val` / `num` / `number` / `int` / `integer` / `input` / `arg` / `arg1` / `input1` / `v1` / `v` / `count` / `size` / `len` / `length` / `target` / `from` / `start`
- 用错 query 名 endpoint 应返 400（缺参分支）或 404
- query string 顶层 keys 必须**只含 `value`** 一个 key；额外参数（如 `?value=5&extra=x`）→ 400

**Success (HTTP 200)**:

```json
{"result": <number>, "operation": "decrement"}
```

- `result` (number, 必填): JS Number，**字面等于** `Number(value) - 1`；由于 `|value| ≤ 9007199254740990 < MAX_SAFE_INTEGER`，`result` 必为精确整数无浮点损失
- `operation` (string, 必填): **字面字符串 `"decrement"`**，禁用变体 `dec` / `decr` / `decremented` / `decrementation` / `minus_one` / `subtract_one` / `sub_one` / `sub` / `pred` / `predecessor` / `prev` / `previous` / `op` / `method` / `action` / `type` / `kind` / `increment`（**特别警告：不可漏改 W26 模板的 `"increment"` 字面**）
- 顶层 keys 必须 **完全等于** `["operation", "result"]`（按字母序，集合相等；**不允许多余字段**，不允许加 `value` / `input` / `n` / `output` / `data` / `payload` / `response` / `meta` 等任何附加字段）

**Error (HTTP 400)**:

```json
{"error": "<非空 string>"}
```

- `error` (string, 必填): 非空字符串（具体文案不强约束）
- 错误响应 body **必须不包含 `result` 字段，也不包含 `operation` 字段**（防"既报错又给值"的混合污染）
- 顶层 keys 必须 **完全等于** `["error"]`，不允许多余字段
- 错误时禁用替代字段名：`message` / `msg` / `reason` / `detail` / `details` / `description` / `info` / `code`

**禁用响应字段名**（response body 严禁出现，proposer/generator 不得自由发挥同义替代）:

- **首要禁用**（最易漂到的同义名 + W26 复用诱惑）: `decremented` / `decrement_result` / `prev` / `previous` / `predecessor` / `pred` / `n_minus_one` / `minus_one` / `sub_one` / `subtracted` / `sub` / `dec` / `decr` / `decrementation`
- **跨任务复用诱惑禁用**: `incremented`（W26 同义对偶）/ `n_plus_one`（W26 同义对偶）/ `successor`（W26 同义对偶）
- **泛 generic 禁用**: `value` / `input` / `output` / `data` / `payload` / `response` / `answer` / `out` / `meta`
- **复用其他 endpoint 字段名禁用**: `sum`（W19）/ `product`（W20）/ `quotient`（W21）/ `power`（W22）/ `remainder`（W23）/ `factorial`（W24）/ `result`（W26 风格 generic 字段名本身允许 — 但 W26 用 `result` 已成共识，必须照搬，否则违反字面法定）

**字段命名锁死的原因**：W26 PR-G 已实证 proposer 在没有死规则约束时倾向把字段"语义化优化"成 `{incremented}` / `{next}` 等。W31 是首个**算术对偶**（与 W26 镜像）的 endpoint，proposer 还可能犯**第二类错**：直接抄 W26 合同（query/字段/正则全部一样）但**漏改 `operation` 字面量 "increment" → "decrement"**，或反之把字段名命成 `{decremented}` 与 W26 `{incremented}` 对偶。两类错都是 proposer SKILL v7.5 死规则的真实测试。

**Schema 完整性 oracle**（proposer 必须把以下断言全部 codify 成 contract 里的 `jq -e` 命令）:

- 200 成功响应：`jq -e 'keys | sort == ["operation","result"]'`（顶层 keys 字面集合相等）
- 200 成功响应：`jq -e '.operation == "decrement"'`（operation 字面量，**字符串严格相等**，不是 contains/startsWith；**特别测试是否漏改 W26 模板的 "increment"**）
- 200 成功响应：`jq -e '.result | type == "number"'`（result 是 number）
- 200 成功响应：`jq -e '.result == <独立 Number(value)-1 复算>'`（result 值正确）
- 400 错误响应：`jq -e 'keys | sort == ["error"]'`（顶层只一个 error key）
- 400 错误响应：`jq -e '.error | type == "string" and length > 0'`（error 是非空字符串）
- 400 错误响应：`jq -e 'has("result") | not'`（错误响应不含 result）
- 400 错误响应：`jq -e 'has("operation") | not'`（错误响应不含 operation）

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^-?\d+$`（**十进制整数，允许前导负号；与 W19~W23 浮点 `^-?\d+(\.\d+)?$` 不同，与 W24 `^\d+$` 不同；与 W26 字面相同但**必须独立写一份字面量或常量名**，禁止 import 复用 W26 实现的 STRICT_INT** — 保持 endpoint 实现解耦**）

| 输入示例 | strict-schema 判定 | 业务规则 | 计算结果（独立复算） | 期望响应 |
|---|---|---|---|---|
| `value=0` | 合法 | 在范围内 | -1 | 200，`{result: -1, operation: "decrement"}` |
| `value=1` | 合法 | 在范围内 | 0 | 200，`{result: 0, operation: "decrement"}` |
| `value=5` | 合法 | 在范围内 | 4 | 200，`{result: 4, operation: "decrement"}` |
| `value=-1` | 合法 | 在范围内 | -2 | 200，`{result: -2, operation: "decrement"}` |
| `value=-5` | 合法 | 在范围内 | -6 | 200，`{result: -6, operation: "decrement"}` |
| `value=100` | 合法 | 在范围内 | 99 | 200，`{result: 99, operation: "decrement"}` |
| `value=-100` | 合法 | 在范围内 | -101 | 200，`{result: -101, operation: "decrement"}` |
| `value=9007199254740990` | 合法 | 在范围内（**精度上界**） | 9007199254740989 | 200，`{result: 9007199254740989, operation: "decrement"}` |
| `value=-9007199254740990` | 合法 | 在范围内（**精度下界**） | -9007199254740991 | 200，`{result: -9007199254740991, operation: "decrement"}` |
| **`value=9007199254740991`** | strict 通过但超上界 | **拒** | — | **400**（`|value| > 9007199254740990` 上界拒） |
| **`value=-9007199254740991`** | strict 通过但超下界 | **拒** | — | **400**（`|value| > 9007199254740990` 下界拒） |
| **`value=99999999999999999999`** | strict 通过但远超上界 | **拒** | — | **400**（上界拒） |
| `value=01` | strict 通过（`^-?\d+$` 允许前导 0；`Number("01")=1`） | 在范围内 | 0 | **200**，`{result: 0, operation: "decrement"}` |
| `value=-01` | strict 通过（前导 0 允许） | 在范围内 | -2 | 200，`{result: -2, operation: "decrement"}` |
| `value=1.0` | strict 拒（小数点） | — | — | 400 |
| `value=1.5` | strict 拒（小数点） | — | — | 400 |
| `value=+5` | strict 拒（前导 +） | — | — | 400 |
| `value=--5` | strict 拒（双重负号） | — | — | 400 |
| `value=5-` | strict 拒（尾部负号） | — | — | 400 |
| `value=1e2` | strict 拒（科学计数法） | — | — | 400 |
| `value=0xff` | strict 拒（十六进制） | — | — | 400 |
| `value=1,000` | strict 拒（千分位逗号） | — | — | 400 |
| `value=1 000` | strict 拒（含空格） | — | — | 400 |
| `value=` | strict 拒（空串） | — | — | 400 |
| `value=abc` | strict 拒 | — | — | 400 |
| `value=Infinity` | strict 拒 | — | — | 400 |
| `value=NaN` | strict 拒 | — | — | 400 |
| `value=-` | strict 拒（仅负号无数字） | — | — | 400 |
| 缺 value（无 query） | — | — | — | 400 |
| `value=5&extra=x`（多余 key） | — | 拒（key 数 != 1） | — | 400 |
| 只有 `extra=x`（缺 value） | — | 拒 | — | 400 |

## 边界情况

- **`value === 0`**（结果为 -1）合法且必须返 `{result: -1, operation: "decrement"}`；显式断言，防 off-by-one（漏写 `n - 1` 写成 `n`）
- **`value === 1`**（结果为 0）合法且必须返 `{result: 0, operation: "decrement"}`；显式断言，防把 0 当 falsy 漏返
- **`value === -1`**（结果为 -2）合法且必须返 `{result: -2, operation: "decrement"}`
- **`value === "9007199254740990"`**（精度上界）合法返 `{result: 9007199254740989, operation: "decrement"}`
- **`value === "-9007199254740990"`**（精度下界）合法返 `{result: -9007199254740991, operation: "decrement"}`；**特别**：`-9007199254740991 === Number.MIN_SAFE_INTEGER` 字面相等，显式断言
- **`value === "9007199254740991"`** 必须 HTTP 400（上界拒），body 不含 `result` 也不含 `operation`
- **`value === "-9007199254740991"`** 必须 HTTP 400（下界拒，超精度下界），body 不含 `result` 也不含 `operation`
- **判定顺序必须严格**：keys 数 != 1 或缺 value → strict-schema → `|Number(value)| > 9007199254740990` 显式拒 → 计算 `Number(value) - 1` → 200。错任一阶段都返 400 且 body 不含 `result`/`operation`
- **前导 0** 处理：`value=01` 通过 strict（`^-?\d+$` 允许）且 `Number("01") === 1`，与 `value=1` 等价返 `{result: 0, operation: "decrement"}`。`value=-01` 通过 strict 且 `Number("-01") === -1`，与 `value=-1` 等价返 `{result: -2, operation: "decrement"}`
- **零依赖**：playground 现有零依赖原则保持不变，不引入 `bignumber.js` / `big-integer` / 任何外部库；不引入 BigInt 重写
- **JS Number 在范围内是精确整数**：`|value| ≤ 9007199254740990` 时 `Number(value) - 1` 精确无损；超过则 IEEE 754 双精度浮点表达不再唯一，故拒
- **不出现结果非有限的情况**：对任意合法 `value`，`Number(value) - 1` 必有限精确——因此本 endpoint **不需要** W22 风格的 `Number.isFinite` 兜底
- **不出现符号问题**：strict-schema 接受任意符号整数，结果可正可负可零；不需要 W23 风格符号 oracle
- **不出现跨调用关系**：单调用 oracle 充分（`result === Number(value) - 1`），不需要 W24 风格递推 oracle
- **`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 现有行为不受影响**（不动这八条路由的代码、单测、README 段一个字符）
- **W26 `/increment` 的实现解耦保证**：不 import / 复用 W26 实现中的常量名（如 `STRICT_INT`）；新写一份字面量或独立常量，避免 bundling-time 隐式耦合，确保 generator 不会通过"refactor 复用"假绿

## P1 终验 round 3（long timeout）验收：B1-B9 联合生效

W31 不仅是 W19~W26 oracle 链的延伸，**核心是 Walking Skeleton P1 终验 round 3**——验证 B1-B9 九项修复**联合生效**在 long-timeout 真实 pipeline 跑里：

**P1 终验 success criteria**（由 harness 运行后自动检查 / 人工最终签核）:

1. **B1 验收 — task status 回写**：
   - final_evaluate PASS 后 30s 内 `tasks.status` 字段从 `in_progress` → `completed` 真持久化（curl `localhost:5221/api/brain/tasks/{task_id}` 返 `status=completed`）
   - W31 task_id `960e97e7-bc90-4a97-8a36-473d5a6c1e33`、initiative_id `960e97e7-bc90-4a97-8a36-473d5a6c1e33`（同 id）
2. **B2 验收 — zombie reaper**：
   - 跑期间无任何 `task_type LIKE 'harness_%'` 任务被 reaper 标 failed（reaper 必须真豁免）
   - 跑完后查 brain log `grep -E '\[reaper\] zombie' /var/log/brain.log` → harness_* 命中数 = 0
3. **B3 验收 — slot accounting**：
   - 跑期间 `available_slots > 0` 时 dispatcher 真派得出新任务（不会因 stale in_progress 计数挂死）
4. **B4 验收 — consciousness-loop guidance TTL**：
   - stale decision 不会污染本次 round 3 调度（决策时间戳 vs TTL 检查通过）
5. **B5 验收 — dispatcher HOL skip**：
   - 队首任务派不出时（如 owner offline）dispatcher 真 skip 找下一个，不阻塞队列
6. **B6 验收 — dispatch_events 真写入**：
   - 跑期间 `SELECT COUNT(*) FROM dispatch_events WHERE created_at > now() - interval '2 hours'` ≥ ws1 sub-task 数 + GAN round 数
   - `curl localhost:5221/api/dispatch/recent` 返非空、含本次 W31 task_id
7. **B7 验收 — fleet heartbeat**：
   - 跑期间 owner heartbeat 真实反映 worker 在线状态，不出现"offline 但派出任务"
8. **B8 验收 — reaper threshold 30→60min + harness 豁免**：
   - reaper 默认 60min 阈值生效；harness_* 全部豁免（即使 > 60min idle 也不 reap）
   - 推荐 ENV `ZOMBIE_REAPER_IDLE_MIN=120` 进一步放宽（long timeout）
9. **B9 验收 — lookupHarnessThread harness-evaluate dispatch**：
   - evaluator container 退出后 callback 真到达对应 graph thread（无 404）
   - `grep -E '\[harness-thread-lookup\] unknown graph_name=harness-evaluate' /var/log/brain.log` → 命中数 = 0
   - PG thread_checkpoints 表中 `harness-evaluate:` 前缀的 thread 真有 dispatch 记录、不会永卡 await_callback

**Pipeline 级 success criteria**:

1. **planner**（本文件）：生成 sprint-prd.md（What），跑完 ≤ 5 min
2. **proposer GAN**：合同字面照搬 PRD `## Response Schema` 段（response keys / operation 字面 / 禁用清单 / schema keys 集合全部字面相等）；每个 query param ≥ 1 条独立 `[BEHAVIOR]` 验；reviewer round-1+ APPROVED
3. **generator**：实现真按合同 query 名 `value` + 响应字段名 `result` + `operation: "decrement"` **字面照搬**，无 `decremented` / `prev` / `incremented`（漏改 W26 模板）等漂移；TDD 两次 commit（Red → Green）
4. **evaluator GAN**：合同里所有 oracle（`value=9007199254740990 → result=9007199254740989` 精度上界、`value=-9007199254740990 → result=-9007199254740991` 精度下界、`value=9007199254740991 → 400` 上界拒、`value=-9007199254740991 → 400` 下界拒、`value=01 → result=0` 前导 0、`value=1.0 → 400` strict 拒、`value=0 → result=-1` off-by-one 防御）全部执行且通过；schema 完整性 oracle (`keys | sort == ["operation","result"]`) 真起服务真 curl 真 jq 校验通过
5. **final_evaluate**：PASS → task=completed → 进 `dev-records` 表 → PR merged

> **P1 round 3 失败信号**（任一发生即重开对应 issue）:
> - harness_* 任务被 reaper 标 failed（B2/B8 未真生效）
> - callback 404 / graph 卡 await_callback（B9 未真生效）
> - task.status 永卡 `in_progress`（B1 未真生效）
> - dispatcher 死锁（B3/B5 未真生效）
> - dispatch_events 表空（B6 未真生效）
> - proposer 合同含 `{decremented}` / `{prev}` / `operation: "increment"`（W26 模板漏改）等任一禁用形态（PR-G 死规则回归）
> - generator 实现与合同字段名不一致（PR-E 死规则回归）

## 范围限定

**在范围内**：

- 在 `playground/server.js` 在 `/factorial` 之后、`app.listen` 之前新增 `GET /decrement` 路由（含 `keys.length===1 && keys[0]==='value'` 校验 + strict-schema `^-?\d+$` + `|Number(value)| > 9007199254740990` 显式上下界拒 + `Number(value) - 1` 算术 + 返回 `{result, operation: "decrement"}`）
- 在 `playground/tests/server.test.js` 新增 `GET /decrement` describe 块单测，与既有八个 endpoint describe 块平级，覆盖：
  - happy path（含 `value=0`、`value=1`、`value=-1`、`value=5`、`value=-5`、`value=100`、`value=-100`、`value=9007199254740990`、`value=-9007199254740990` 至少 9 条；其中 `value=0`、`value=1`、`value=-1` 各必须有独立用例显式断言 `result === -1` / `result === 0` / `result === -2` 防 off-by-one；`value=-9007199254740990` 必须显式断言 `result === Number.MIN_SAFE_INTEGER`）
  - 上界 / 下界拒（`value=9007199254740991`、`value=-9007199254740991`、`value=99999999999999999999` 至少 3 条）
  - strict-schema 拒（小数 `1.5`、小数 `1.0`、前导 +、双重负号、尾部负号、科学计数法、十六进制、千分位、空格、空串、字母串、Infinity、NaN、仅负号 各至少 1 条）
  - 多余 query 拒（`?value=5&extra=x` → 400，且 body 不含 `result`/`operation`）至少 1 条
  - 至少 3 条 oracle 值断言：`expect(res.body.result).toBe(<独立 Number(value)-1 复算>)`，证明返回值与独立复算严格相等（其中至少 1 条覆盖精度上界 `value=9007199254740990 → result=9007199254740989`，1 条覆盖精度下界 `value=-9007199254740990 → result=-9007199254740991`）
  - **schema 完整性 oracle** 至少 2 条断言：
    - 至少 1 条断言 `Object.keys(res.body).sort()` 严格等于 `['operation','result']`（成功响应 keys 字面集合相等，不含多余字段）
    - 至少 1 条断言 `res.body.operation === 'decrement'`（operation 字面字符串严格相等，不是 contains/startsWith；**显式 NOT** `=== 'increment'` 防漏改 W26 模板）
  - 至少 1 条断言：失败响应 body 不含 `result` 字段，也不含 `operation` 字段
  - 至少 1 条断言：失败响应 `Object.keys(res.body).sort()` 严格等于 `['error']`（错误响应不含多余字段）
  - 回归断言：`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 至少各 1 条 happy 用例仍然通过
- 在 `playground/README.md` 端点列表加 `/decrement`，给出 happy（含 `value=0`、`value=1` 边界、精度上下界 `±9007199254740990`）、上下界拒（`value=±9007199254740991`）、strict 拒（小数 / 科学计数法 / 千分位 各示例）、多余 query 拒 至少 7 个示例
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码（**P1 B1-B9 修复全部已合 main，本次跑用既有实现验证；任何修复回归在另开 issue**）
- 不引入新依赖（不加 zod / joi / ajv / bignumber.js / big-integer / mathjs / 任何外部库；不引入 BigInt 重写）
- 不改 `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 的实现或单测（一字不动）
- 不放宽精度上界（不接受 `|value| > 9007199254740990` 用 BigInt 或字符串大数表达）
- 不做 rate-limit、auth、CORS、日志结构化等非功能特性
- 不写跨子项目的集成测试
- 不支持 path param / body / POST，仅 GET + query string
- 不加 `Number.isFinite` 结果兜底（strict + 绝对值上界已保证结果有限精确；加多余兜底视为合同违约）
- 不写记忆化 / 缓存层（每次请求独立计算）
- 不引入"语义化优化"字段名（`decremented` / `prev` / `predecessor` / `n_minus_one` 等）；PRD 字面法定不可改
- 不从 W26 `/increment` 实现 import 复用任何常量（`STRICT_INT` 等）；写独立字面量或独立常量名
- 不引入 W23 单调用语义不变量 oracle（减量算术无符号问题）
- 不引入 W24 跨调用递推不变量 oracle（单调用 oracle 充分）

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应格式为 HTTP 400 + `{ error: "<非空字符串>" }`（与既有八个 endpoint 一致）]
- [ASSUMPTION: strict-schema 用原生 RegExp `^-?\d+$`（与既有 `STRICT_NUMBER` 浮点 regex 不同，与 W24 整数非负 regex 不同；与 W26 字面相同但**独立写一份字面量或新常量名**，严禁 import 复用 W26 实现的 `STRICT_INT` 制造 endpoint 间耦合）]
- [ASSUMPTION: 响应 body 顶层字段名严格为 `result` 与 `operation`（**字面**，按 PR-G 死规则不可改名）；operation 值严格为字符串 `"decrement"`（字面；**绝不漏改 W26 模板的 `"increment"`**）]
- [ASSUMPTION: 精度上界 `9007199254740990` 的依据：`Number.MAX_SAFE_INTEGER === 9007199254740991`，所以 `value - 1 ≥ -MAX_SAFE_INTEGER` 当且仅当 `value ≥ -9007199254740990`；上侧 `value ≤ 9007199254740990` 保证 `value - 1 < MAX_SAFE_INTEGER` 精确；统一双侧绝对值上界与 W26 `/increment` 对称]
- [ASSUMPTION: 减 1 计算用 `Number(value) - 1`（普通 JS 数值算术），不用 BigInt（无必要，且响应必须是 JS Number）]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body / POST]
- [ASSUMPTION: `error` 字段值是否包含中文不强制约束，只要求是非空字符串（与现有路由一致），具体文案由 generator 决定]
- [ASSUMPTION: query param 名严格为 `value`（与 W26 `/increment` 一致；不复用 `n`、`a`、`b` 避免 generator 复读其他 endpoint 模板）]
- [ASSUMPTION: query 顶层 keys 只允许 `value` 一个；额外 query 参（如 `?value=5&extra=x`）→ 400（与 W26 `/increment` 实现一致：`Object.keys(req.query)` 长度严格 = 1 且元素严格 = `'value'`）]
- [ASSUMPTION: `0` 与 `-0` 的 strict 判定：`^-?\d+$` 接受字符串 `-0`，`Number("-0") === -0`，`-0 - 1 === -1`，故 `value=-0` 合法返 `{result: -1, operation: "decrement"}`；与 `value=0` 等价]
- [ASSUMPTION: 前导 0 `01`、`-01` 通过 strict 后 `Number()` 自动归一化为 `1` / `-1`，结果分别 `0` / `-2`；proposer 须把此用例写进合同 happy 分支以挡 generator 错用 `parseInt(value, 8)` 八进制解析]
- [ASSUMPTION: P1 终验 round 3 跑时 `ZOMBIE_REAPER_IDLE_MIN` ENV 设 `>= 120`（long timeout，B8 默认 60 已够但 long 更安全；harness_* 已豁免不依赖此值，但保留更宽阈值兜底 cascade 错误任务）]
- [ASSUMPTION: P1 B1-B9 修复全部已合 main（截至本 PRD 写时 `git log` 含 #2903 #2905 #2909 7eb7a2fc5 #2911 #2904 cc7901ccb #2913 #2917 共 9 提交），本次 round 3 跑在 B9 之后第一次 truely fresh run]

## 预期受影响文件

- `playground/server.js`：在 `/factorial` 之后新增 `GET /decrement` 路由 + `keys.length===1 && keys[0]==='value'` 校验 + strict-schema `^-?\d+$` 校验 + `|Number(value)| > 9007199254740990` 显式上下界拒 + `Number(value) - 1` 算术 + 返回 `{result, operation: "decrement"}`（≈ 10-13 行；与 W26 `/increment` 实现长度相当）
- `playground/tests/server.test.js`：新增 `GET /decrement` describe 块（happy 9+ + 上下界拒 3+ + strict 拒 13+ + 多余 query 拒 1+ + 值 oracle 3+ + schema 完整性 oracle 2+ + 错误体不含 result/operation 断言 1+ + 错误体 keys=["error"] 断言 1+ + 回归断言 8+）
- `playground/README.md`：端点列表加 `/decrement`，补 happy（含 `value=0`、`value=1` 边界、精度上下界）/ 上下界拒 / strict 拒 / 多余 query 拒 各示例（至少 7 个）

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；按规则归类为 autonomous（与 W19~W26 同分类）。Pipeline 本身（B1-B9 修复联合验收）在 brain 内部跑，但 PRD 的代码 deliverable 限定在 playground，PRD 不动 brain 代码——故 journey_type 维持 autonomous 而非 dev_pipeline。
