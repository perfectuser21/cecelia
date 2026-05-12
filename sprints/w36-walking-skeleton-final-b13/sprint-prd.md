# Sprint PRD — playground 加 GET /decrement endpoint（W36 Walking Skeleton P1 final happy · B13 fix 后回归）

## OKR 对齐

- **对应 KR**：W36 Walking Skeleton P1 — Cecelia harness pipeline 端到端 final happy 回归验收（B1~B13 全部 P1 基础设施 bug 修复落地后的首次完整 happy 走通）
- **当前进度**：W19~W24 + W26 共 7 条 playground endpoint 已合入 main 并跑通过 harness pipeline；2026-05-10~2026-05-11 期间集中修了 13 个 P1 基础设施 bug（B1~B13），其中最后一个 B13（#2927，commit ad40689bb）修复了 `harness-initiative` graph restart 撞 unique 约束 `initiative_contracts_initiative_id_version_key` 致 task failed —— `runOnce` + `dbUpsertNode` 两处 INSERT 加 ON CONFLICT DO UPDATE 让 graph 任意节点 resume 都幂等。Round 1+2 RCA 实测 24h 失败 92%（32 failed / 2 success），失败 91% 是基础设施（reaper 误杀 / dispatcher HOL / batch overload / graph 非幂等 restart 等），P1 修复合入后窗口内既无新失败也无新成功 —— **系统在 idle 等待首条 final happy 任务跑通来证明全链路恢复**
- **本次推进预期**：W36 是 B13 fix 之后的**首条 walking skeleton final happy** —— 在 playground 上加第 8 条 endpoint `GET /decrement`，作为 P1 全部修复完成后的回归验收：planner → proposer(GAN) → reviewer(GAN) → generator(TDD) → evaluator → initiative-review 六段全跑通且 `final_e2e_verdict=PASS`、`task.status=completed`，证明 B1~B13 全部修复（特别是 B10 evaluate_contract thread_id 复用、B11 MAX_FIX_ROUNDS 3→20、B13 graph restart 幂等三个最直接影响 happy 走通的 fix）真生效。若 W36 走通，则 Walking Skeleton P1 阶段宣告完成、可推进 P2（heartbeat / batch throttle / executor 重构）

## 背景

W36 不是新功能交付，是**回归验收任务** —— 用一个**故意设计为最简单**的 playground endpoint（单参整数、无浮点、无多调用关系、无符号歧义、无精度爆炸），最大化降低 happy 路径上业务侧的失败概率，**让任何残留失败都明确归因到基础设施层 / harness pipeline 协议层**。

为什么选 `/decrement`：

1. **是 W26 `/increment` 的精确镜像**：单 query param `value`、strict-schema `^-?\d+$`、双侧绝对值上界拒、`Number(value) - 1` 单调用算术、返回 `{result, operation: "decrement"}` —— W26 已实测此模式可走通 harness pipeline（包括 evaluator 真起服务真 curl 真 jq 校验），W36 在同结构下只换一个减法符号 + 一个 operation 字面字符串，业务侧失败概率近 0
2. **复用 W26 全部 oracle 范式**：值复算（`result === Number(value) - 1`）、strict-schema 白名单（整数允负）、输入规则级拒（绝对值上界）、schema 完整性 oracle（`keys | sort == ["operation","result"]`）、字段名字面相等 oracle（PR-G 死规则）—— proposer / reviewer / generator / evaluator 全链都有 W26 模板可对照
3. **故意保留"字段名字面照搬"考点**：response 字段名为 generic `{result, operation: "decrement"}`，operation 字面字符串 `"decrement"` —— 与 W25 negate 漂到 `{negation}`、proposer "语义化优化"的诱惑同形态。若 PR-G 死规则在 W26 已落地，W36 不应再次复现漂移；若 W36 复现漂移，说明 PR-G 死规则对 `decrement` 这种新动词不泛化，需重开 issue
4. **唯一与 W26 不同的考点**：W26 是 `value + 1`，单调递增；W36 是 `value - 1`，单调递减 —— 验 generator 不会盲目复读 W26 实现把 `-` 抄成 `+`（即 generator 真按合同实现而非"抄上次"）

并行地，W36 是 B13 之后**首次让 harness-initiative graph 真跑完六段**的任务：
- planner（本任务，输出 PRD）
- proposer GAN（合同起草 + 多轮 reviewer 对抗，B10 thread_id 复用 + B11 MAX_FIX_ROUNDS 20 保 GAN 不被硬 cap 截断）
- reviewer GAN（评分 + 反馈）
- generator TDD（red commit + green commit，B11 多轮修复保失败可恢复）
- evaluator（真起服务真 curl 真 jq 校验）
- initiative-review（最终验收 + B9 lookupHarnessThread harness-evaluate 派发 + B13 graph restart 幂等）

若 W36 任一节点崩了又 resume，**B13 ON CONFLICT DO UPDATE 必须让 resume 不撞 unique 约束**；这是 B13 fix 在 production 路径上的首次实战检验。

| oracle 形式 | W19 sum | W20 mul | W21 div | W22 pow | W23 mod | W24 fact | W26 inc | **W36 dec** |
|---|---|---|---|---|---|---|---|---|
| 值复算严格相等 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（`result === Number(value) - 1`） |
| strict-schema 白名单 | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（`^-?\d+$` 整数允负） |
| 输入规则级拒 | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（`|value| > 9007199254740990` 拒） |
| 输出值级兜底 | — | — | — | ✓ | — | — | — | —（上界已挡） |
| schema 完整性 oracle（顶层 keys 集合相等） | — | — | — | — | — | — | ✓ | ✓ |
| 字段名字面相等 oracle（PR-G 死规则） | — | — | — | — | — | — | ✓ | ✓ |
| **B13 graph restart 幂等回归**（W36 专用） | — | — | — | — | — | — | — | **✓（任一节点 resume 不撞 unique）** |

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /decrement?value=5` 请求] → 经过 [playground server 用 strict-schema `^-?\d+$` 校验 value、显式拒绝 `|Number(value)| > 9007199254740990`（精度上界）、计算 `Number(value) - 1` 并返回] → 到达 [收到 200 响应，body **顶层 keys 字面等于** `["operation", "result"]`，`result === Number(value) - 1` 且 `operation === "decrement"`（**字面量字符串，不许变体**）]

具体：

1. 客户端发 `GET /decrement?value=<十进制整数字符串，含可选前导负号>` 到 playground server（默认端口 3000）
2. server 对 value 做 strict-schema 校验（白名单正则 `^-?\d+$`，**与 W19~W23 浮点 regex `^-?\d+(\.\d+)?$` 不同，与 W24 `^\d+$` 不同；可复用 W26 的 `STRICT_INTEGER` 常量或就地写字面量**）
3. strict-schema 通过后，**显式判定 `Math.abs(Number(value)) > 9007199254740990`**（即 `Number.MAX_SAFE_INTEGER - 1`），是则返回 HTTP 400 + `{ "error": "<非空说明字符串>" }`，body 不含 `result` 字段（拒掉精度超界）
4. 计算 `result = Number(value) - 1`（普通整数减 1，JS Number 在此范围内精确）
5. 返回 HTTP 200，JSON body 为 `{ "result": <Number(value)-1>, "operation": "decrement" }`（**两个字段都必填，字面字符串 "decrement" 不许变体**）
6. 任一参数缺失 / 不通过 strict-schema / `|value| > 9007199254740990` → HTTP 400 + `{ "error": "<非空字符串>" }`，body 不含 `result` 也不含 `operation`

并行 happy（pipeline 层 final-happy 验收，**非 endpoint 的业务行为**，但属于本 PRD 的成功条件）：

7. Brain 派发 `harness_initiative` task `230fe8f9-0544-48cf-8437-88755ad8860e`，graph 依次执行 planner → proposer → reviewer → generator → evaluator → initiative-review 六段
8. 任一节点崩溃 / 被 reaper 误杀 / docker 重启后 resume —— graph 节点 INSERT 不撞 `initiative_contracts_initiative_id_version_key` unique 约束（**B13 ON CONFLICT DO UPDATE 兜底**）
9. 最终 `final_e2e_verdict=PASS` 且 `task.status=completed`，无 watchdog_deadline / 无 zombie reaper / 无 dispatcher HOL skip

## Response Schema

> **目的**：把响应字段 codify 成 oracle，让 proposer 把每个字段 + query param 名 + operation 字面量 + schema 完整性转成 `jq -e` / `curl` 命令进合同；evaluator 真起服务真校验。
>
> **PR-G 死规则继承**：本段是 proposer **字面照搬**的唯一 ground truth。Proposer SKILL v7.5 死规则要求：contract `jq -e` 用的 key 名 / operation 字面量 / 禁用清单 / schema keys 集合，**全部必须与本段字面相等**（grep 对比通过）。任一漂移即视为回归。

### Endpoint: GET /decrement

**Query Parameters**（强制约束 query param 名，避免 proposer/generator 漂移）:

- `value` (integer-as-string, 必填): 待减 1 的整数；必须完整匹配 strict-schema 正则 `^-?\d+$`（**十进制整数字符串，含可选前导负号；禁小数、禁前导 +、禁科学计数法、禁十六进制、禁千分位**），且 `Math.abs(Number(value)) <= 9007199254740990`
- **强约束**: proposer / generator 必须**字面用** `value` 作为 query param 名
- **禁用 query 名**: `n` / `x` / `y` / `m` / `k` / `i` / `j` / `a` / `b` / `p` / `q` / `val` / `num` / `number` / `int` / `integer` / `input` / `arg` / `arg1` / `input1` / `v1` / `v` / `count` / `size` / `len` / `length` / `target` —— 用错 query 名一律视为合同违约
- 用错 query 名 endpoint 应返 400（缺参分支）或 404

**Success (HTTP 200)**:

```json
{"result": <number>, "operation": "decrement"}
```

- `result` (number, 必填): JS Number，**字面等于** `Number(value) - 1`；由于 `|value| ≤ 9007199254740990 < MAX_SAFE_INTEGER`，`result` 必为精确整数无浮点损失
- `operation` (string, 必填): **字面字符串 `"decrement"`**，禁用变体 `dec` / `decr` / `decremented` / `decrementation` / `minus_one` / `sub_one` / `subtract_one` / `pred` / `predecessor` / `prev` / `previous` / `op` / `method` / `action` / `type` / `kind`
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

- **首要禁用**（W25/W26 实证 proposer 最易漂到的同义名，PR-G 死规则黑名单）: `decremented` / `previous` / `prev` / `predecessor` / `n_minus_one` / `minus_one` / `pred` / `dec` / `decr` / `decrementation` / `subtraction`
- **泛 generic 禁用**: `value` / `input` / `output` / `data` / `payload` / `response` / `answer` / `out` / `meta`
- **复用其他 endpoint 字段名禁用**: `sum`（W19）、`product`（W20）、`quotient`（W21）、`power`（W22）、`remainder`（W23）、`factorial`（W24）、`negation`（W25 未合入）—— 不许复用

**字段命名锁死的原因**：W26 实证 proposer 看到 generic `{result, operation}` 命名 + PR-G 死规则后能字面照搬 `result` + `"increment"` 不漂移；W36 用同形态命名 `{result, operation: "decrement"}` 验 PR-G 死规则对**新动词**（首次出现的 `decrement` 字面量）是否同样泛化。若 proposer 漂到 `{decremented}` / `{previous}` / `{result, operation: "dec"}` 等任一禁用形态，则 PR-G 死规则对新动词不泛化，需重开 issue。

**Schema 完整性 oracle**（proposer 必须把以下断言全部 codify 成 contract 里的 `jq -e` 命令）:

- 200 成功响应：`jq -e 'keys | sort == ["operation","result"]'`（顶层 keys 字面集合相等）
- 200 成功响应：`jq -e '.operation == "decrement"'`（operation 字面量，**字符串严格相等**，不是 contains/startsWith）
- 200 成功响应：`jq -e '.result | type == "number"'`（result 是 number）
- 200 成功响应：`jq -e '.result == <独立 Number(value)-1 复算>'`（result 值正确）
- 400 错误响应：`jq -e 'keys | sort == ["error"]'`（顶层只一个 error key）
- 400 错误响应：`jq -e '.error | type == "string" and length > 0'`（error 是非空字符串）
- 400 错误响应：`jq -e 'has("result") | not'`（错误响应不含 result）
- 400 错误响应：`jq -e 'has("operation") | not'`（错误响应不含 operation）

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^-?\d+$`（**十进制整数，允许前导负号；与 W19~W23 浮点 `^-?\d+(\.\d+)?$` 不同，与 W24 `^\d+$` 不同；可与 W26 共享同一 regex 常量，generator 选择就地写字面量或复用 W26 已存常量均可，但禁止复用 W19~W23 的 `STRICT_NUMBER`**）

| 输入示例 | strict-schema 判定 | 业务规则 | 计算结果（独立复算） | 期望响应 |
|---|---|---|---|---|
| `value=0` | 合法 | 在范围内 | -1 | 200，`{result: -1, operation: "decrement"}` |
| `value=1` | 合法 | 在范围内 | 0 | 200，`{result: 0, operation: "decrement"}` |
| `value=5` | 合法 | 在范围内 | 4 | 200，`{result: 4, operation: "decrement"}` |
| `value=-1` | 合法 | 在范围内 | -2 | 200，`{result: -2, operation: "decrement"}` |
| `value=-5` | 合法 | 在范围内 | -6 | 200,`{result: -6, operation: "decrement"}` |
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
| `value=+5` | strict 拒（前导 +；regex 只允许前导负号） | — | — | 400 |
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

## 边界情况

- **`value === 0` 与 `value === 1`**（结果分别为 -1 和 0）合法且必须返 `{result: -1, operation: "decrement"}` / `{result: 0, operation: "decrement"}`；显式断言，**防 generator 把 W26 `+1` 抄成 W36 也是 `+1`** —— 这是 W36 区分 generator "真按合同实现" vs "盲目复读 W26 模板"的关键 off-by-one 断言
- **`value === "9007199254740990"`**（精度上界字符串）合法且必须精确返 `{result: 9007199254740989, operation: "decrement"}`；显式断言 `result === Number.MAX_SAFE_INTEGER - 2`
- **`value === "-9007199254740990"`** 合法且必须精确返 `{result: -9007199254740991, operation: "decrement"}`；显式断言 `result === -(Number.MAX_SAFE_INTEGER)`（即 `-9007199254740991`）—— **注意：W26 increment 的下界 happy 结果是 `-9007199254740989`，W36 decrement 的下界 happy 结果是 `-9007199254740991`，不可混淆**
- **`value === "9007199254740991"`**（精度上界 +1）必须 HTTP 400，body 不含 `result` 也不含 `operation`
- **`value === "-9007199254740991"`** 必须 HTTP 400（下界拒）
- **判定顺序必须严格**：缺参 → strict-schema → `|Number(value)| > 9007199254740990` 显式拒 → 计算 `Number(value)-1` → 200。错任一阶段都返 400 且 body 不含 `result`/`operation`
- **前导 0** 处理：`value=01` 通过 strict（`^-?\d+$` 允许）且 `Number("01") === 1`，与 `value=1` 等价返 `{result: 0, operation: "decrement"}`。这是 strict-schema 客观语义，proposer 须把此用例写进合同的 happy 分支
- **零依赖**：playground 现有零依赖原则保持不变，不引入 `bignumber.js` / `big-integer` / 任何外部库
- **JS Number 在范围内是精确整数**：`|value| ≤ 9007199254740990` 时 `Number(value) - 1` 精确无损；超过则 IEEE 754 双精度浮点表达不再唯一，故拒。**严禁 generator 用 BigInt 重写**（响应必为 JS Number 而非 BigInt 字符串）
- **strict-schema 顺序与 W20/W21/W22/W23/W24/W26 一致**：缺参 → 类型 + 正则 → 业务规则（绝对值上界拒）→ 算术
- **`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 现有行为不受影响**（不动这八条路由的代码、单测、README 段一个字符）
- **不出现结果非有限的情况**：对任意合法 `value`，`Number(value) - 1` 必有限精确——因此本 endpoint **不需要** W22 风格的 `Number.isFinite` 兜底；绝对值上界已挡掉精度问题
- **不出现符号问题**：strict-schema 接受任意符号整数，结果可正可负可零；不需要 W23 风格符号 oracle
- **不出现跨调用关系**：单调用 oracle 充分（`result === Number(value) - 1`），不需要 W24 风格递推 oracle

## W36 Walking Skeleton P1 final happy 验收

W36 不仅是 W19~W26 oracle 链的延伸，**核心是 B1~B13 全部 P1 修复完成后的回归验收任务**——验证基础设施层（reaper / dispatcher / graph restart 幂等 / thread_id 复用 / MAX_FIX_ROUNDS）真生效，让 harness pipeline 端到端首次 final happy 走通。

**验收 success criteria**（由 harness 运行后自动检查 / 人工最终签核）:

1. **planner 输出**（本任务）：sprint-prd.md 符合 Golden Path 格式 + Response Schema 段 + journey_type=autonomous
2. **proposer 输出**（任一 round 合同）必须包含以下 **字面字段名**（grep PRD keys vs contract keys 字面相等）:
   - response success key 字面 = `result` 与 `operation`（**禁用任一禁用清单字段名替代**：`decremented` / `previous` / `prev` / `predecessor` / `n_minus_one` / `minus_one` / `pred` / `dec` / `decr` 等）
   - operation 字面值 = 字符串 `"decrement"`（**禁用变体**：`"dec"` / `"decr"` / `"minus_one"` / `"sub_one"` / `"pred"` 等）
   - response error key 字面 = `error`（禁用 `message` / `msg` / `reason` 等）
   - schema 完整性断言 keys 集合 = `["operation","result"]`（成功）/ `["error"]`（错误），字面相等
3. **proposer 输出合同**必须有 **每个 query param ≥ 1 条独立 `[BEHAVIOR]` 验**：query param `value` 真出现 ≥ 1 条 `[BEHAVIOR]` 验
4. **reviewer 输出**：每 round reviewer 评分必须含 SKILL.md v6.2 全部 **7 个评分维度**（含 `verification_oracle_completeness` 与 `behavior_count_position`）；reviewer 第 6 维 `verification_oracle_completeness` 必须按"死规则"对比表（response key / operation 值 / 禁用清单 / schema keys 集合）逐项审 proposer 合同字面相等
5. **generator 输出**：实现真按合同 query 名 `value` + 响应字段名 `result` + `operation: "decrement"` **字面照搬**；算术运算字面是 `Number(value) - 1`（**减号，不是加号**，不盲目抄 W26）；无 `decremented` / `previous` / `decremented_value` / `result_value` 等漂移
6. **evaluator 输出**：合同里的 `value=9007199254740990 → result=9007199254740989` 精度上界 happy、`value=-9007199254740990 → result=-9007199254740991` 精度下界 happy、`value=9007199254740991 → 400` 上界拒、`value=-9007199254740991 → 400` 下界拒、`value=0 → result=-1` off-by-one、`value=1 → result=0` off-by-one、`value=01 → result=0` 前导 0、`value=1.0 → 400` strict 拒 这八类 oracle 全部执行且通过；schema 完整性 oracle（`keys | sort == ["operation","result"]`）必须真起服务真 curl 真 jq 校验通过
7. **B13 graph restart 幂等回归**：harness-initiative graph 节点 INSERT 全部走 ON CONFLICT DO UPDATE，无 `initiative_contracts_initiative_id_version_key` unique violation 错误；即便 graph 节点中途崩溃 + resume，restart 后 INSERT 不报错（W34/W35 的复现路径在 W36 不应再触发）
8. **final_evaluate 状态**：PASS → task = completed → initiative-review APPROVED

> **W36 验收的失败信号**（任一发生即重开 issue / 回退 B13~B11 等 P1 修复）:
> - graph restart 仍撞 unique 约束（B13 fix 在 production 路径上不生效）
> - dispatcher HOL skip / reaper 误杀 W36 任务（B5/B8 fix 不生效）
> - MAX_FIX_ROUNDS 被截断在 3 轮以内（B11 fix 不生效）
> - evaluate_contract thread_id 不复用 task graph thread_id（B10 fix 不生效）
> - proposer 任一 round 合同含 `{decremented}` / `{previous}` / `{result, operation: "dec"}` 等任一禁用形态（PR-G 死规则对新动词不泛化）
> - generator 实现把 `-1` 抄成 `+1`（盲目复读 W26）
> - evaluator schema 完整性 oracle 跳过 / 假绿
> - watchdog_deadline / zombie reaper / docker exit=125 等 24h RCA 模式复现

## 范围限定

**在范围内**：

- 在 `playground/server.js` 在 `/factorial` 之后、`app.listen` 之前新增 `GET /decrement` 路由（含 strict-schema `^-?\d+$` 校验 + `|Number(value)| > 9007199254740990` 显式上界拒 + 普通减 1 算术 + 返回 `{result, operation: "decrement"}`）
- 在 `playground/tests/server.test.js` 新增 `GET /decrement` describe 块单测，与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` describe 块平级，覆盖：
  - happy path（含 `value=0`、`value=1`、`value=-1`、`value=5`、`value=-5`、`value=100`、`value=-100`、`value=9007199254740990`、`value=-9007199254740990` 至少 9 条；其中 `value=0`、`value=1` 各必须有独立用例显式断言 `result === -1` / `result === 0` 防 off-by-one、防盲目抄 W26 `+1`）
  - 上界 / 下界拒（`value=9007199254740991`、`value=-9007199254740991`、`value=99999999999999999999` 至少 3 条）
  - strict-schema 拒（小数 `1.5`、小数 `1.0`、前导 +、双重负号、尾部负号、科学计数法、十六进制、千分位、空格、空串、字母串、Infinity、NaN、仅负号 各至少 1 条）
  - 至少 3 条 oracle 值断言：`expect(res.body.result).toBe(<独立 Number(value)-1 复算>)`，证明返回值与独立复算严格相等（其中至少 1 条覆盖精度下界 `value=-9007199254740990 → result=-9007199254740991`）
  - **W36 PR-G 核心**：至少 2 条 **schema 完整性 oracle** 断言：
    - 至少 1 条断言 `Object.keys(res.body).sort()` 严格等于 `['operation','result']`（成功响应 keys 字面集合相等，不含多余字段）
    - 至少 1 条断言 `res.body.operation === 'decrement'`（operation 字面字符串严格相等，不是 contains/startsWith）
  - 至少 1 条断言：失败响应 body 不含 `result` 字段，也不含 `operation` 字段
  - 至少 1 条断言：失败响应 `Object.keys(res.body).sort()` 严格等于 `['error']`（错误响应不含多余字段）
  - 至少 1 条断言：错 query 名 `n=5` → 400（缺 value 参数路径）
  - 回归断言：`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 至少各 1 条 happy 用例仍然通过
- 在 `playground/README.md` 端点列表加 `/decrement`，给出 happy（含 `value=0`、`value=1` 边界、精度上界 `9007199254740990`）、上界拒（`value=9007199254740991`）、下界拒（`value=-9007199254740991`）、strict 拒（小数 / 科学计数法 / 千分位 各示例）至少 6 个示例
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / ajv / bignumber.js / big-integer / mathjs / 任何外部库；不引入 BigInt 重写）
- 不改 `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 的实现或单测（一字不动）
- 不放宽上界（不接受 `|value| > 9007199254740990` 用 BigInt 或字符串大数表达）
- 不做 rate-limit、auth、CORS、日志结构化等非功能特性
- 不写跨子项目的集成测试
- 不支持 path param / body / POST，仅 GET + query string
- 不加 `Number.isFinite` 结果兜底（strict + 绝对值上界已保证结果有限精确；加多余兜底视为合同违约）
- 不写记忆化 / 缓存层（每次请求独立计算）
- 不引入"语义化优化"字段名（`decremented` / `previous` / `pred` 等）；PRD 字面法定不可改
- 不引入 W23 单调用语义不变量 oracle（减量算术无符号问题）
- 不引入 W24 跨调用递推不变量 oracle（单调用 oracle 充分）
- 不修任何 brain / harness pipeline / dispatcher / reaper / graph 代码（W36 是这些组件的回归验收任务，本任务只交付 playground endpoint；若 W36 走通过程中暴露任何残留 P1 bug，开独立 issue 修，不在本任务范围）

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应格式为 HTTP 400 + `{ error: "<非空字符串>" }`（与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial`、`/increment` 一致）]
- [ASSUMPTION: strict-schema 用原生 RegExp `^-?\d+$`（与既有 `STRICT_NUMBER` 浮点 regex 不同；可复用 W26 已有的整数 regex 常量或就地写字面量，二选一）]
- [ASSUMPTION: 响应 body 顶层字段名严格为 `result` 与 `operation`（**字面**，按 PR-G 死规则不可改名）；operation 值严格为字符串 `"decrement"`（字面）]
- [ASSUMPTION: 上界选 `9007199254740990` 的依据：`Number.MAX_SAFE_INTEGER === 9007199254740991`，所以 `value - 1 ≥ -MAX_SAFE_INTEGER` 当且仅当 `value ≥ -9007199254740990`；正侧对称取 `value ≤ 9007199254740990`，统一双侧绝对值上界与 W26 完全对称]
- [ASSUMPTION: 减 1 计算用 `Number(value) - 1`（普通 JS 数值算术），不用 BigInt（无必要，且响应必须是 JS Number）]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body / POST]
- [ASSUMPTION: `error` 字段值是否包含中文不强制约束，只要求是非空字符串（与现有路由一致），具体文案由 generator 决定]
- [ASSUMPTION: query param 名严格为 `value`（与既有路由 `a`、`b`、`n` 形成可区分集合；与 W26 同名 `value` 复用合理，因为两者都是"单整数输入"语义）]
- [ASSUMPTION: `0` 与 `-0` 的 strict 判定：`^-?\d+$` 接受字符串 `-0`，`Number("-0") === -0`，`-0 - 1 === -1`，故 `value=-0` 合法返 `{result: -1, operation: "decrement"}`；与 `value=0` 等价]
- [ASSUMPTION: 前导 0 `01`、`-01` 通过 strict 后 `Number()` 自动归一化为 `1` / `-1`，结果分别 `0` / `-2`；proposer 须把此用例写进合同 happy 分支以挡 generator 错用 `parseInt(value, 8)` 八进制解析]
- [ASSUMPTION: 不依赖 W25 `/negate`（未合入 main，仅在 W26 PRD 背景里提及），W36 不引用 negate 实现也不引用其单测]

## 预期受影响文件

- `playground/server.js`：在 `/factorial` 之后新增 `GET /decrement` 路由 + strict-schema `^-?\d+$` 校验 + `|Number(value)| > 9007199254740990` 显式上界拒 + `Number(value) - 1` 算术 + 返回 `{result, operation: "decrement"}`（≈ 12-15 行）
- `playground/tests/server.test.js`：新增 `GET /decrement` describe 块（happy 9+ 含 0/1 off-by-one 防盲抄 W26 + 精度上下界、上下界拒 3+、strict 拒 13+、值 oracle 3+、schema 完整性 oracle 2+、错误体不含 result/operation 断言、错误体 keys=["error"] 断言、错 query 名 400 断言、前导 0 happy、8 路由回归 1 条/路由）
- `playground/README.md`：端点列表加 `/decrement`，补 happy（含 `value=0`、`value=1` 边界、精度上界）/ 上界拒 / 下界拒 / strict 拒 各示例（至少 6 个）

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；按规则归类为 autonomous（与 W19~W24/W26 同分类）
