# Sprint PRD — playground 加 GET /negate endpoint（thin · 单参浮点 strict-schema · involution 自反 oracle · inline SKILL pattern 真生效 PR-E 验收）

## OKR 对齐

- **对应 KR**：W25 Walking Skeleton — Cecelia harness pipeline 端到端 oracle 链路验证（接续 W19 `/sum`、W20 `/multiply`、W21 `/divide`、W22 `/power`、W23 `/modulo`、W24 `/factorial`），并作为 **PR-E 验收**——证明 Bug 7（#2891，commit 47a37d4fc）"`buildGeneratorPrompt` inline SKILL pattern" 修复后，**generator 真正按 SKILL.md v6.2 Step 6.5 inline pattern** 收到完整 SKILL 内容（含 query 名锁死 / 响应字段名锁死 / 禁用别名清单等约束），而非旧 slash-command pattern 下"约束被丢"导致的字段名漂移
- **当前进度**：W19 #2874+#2875 跑通 generator → evaluator；W20 #2878 收紧 strict-schema；W21 #2881 引入"除零兜底"作为 **输入规则级** oracle 探针；W22 #2882 引入"结果有限性兜底"作为 **输出值级** oracle 探针；W23 #2885 引入"符号不变量"作为 **单调用语义不变量级** oracle 探针；W24 #2890 引入"跨调用递推关系"作为 **多调用关系级（级联递推）** oracle 探针并完成 PR-D（Bug 6：reviewer/proposer inline SKILL）验收；2026-05-11 #2891 修 Bug 7（generator 也改成 inline SKILL pattern + 移测试位置满足 lint-test-pairing）
- **本次推进预期**：在 playground 上加第七个 endpoint `/negate`，作为 **PR-E 验收**——证明 Bug 7 修复后 generator 收到的 SKILL 内容真完整生效，体现为 generator **字面遵守**合同里的 query 名 `n` + 响应字段名 `negation`，不漂移到 `value/num/x/result/negated/inverse` 等同义词（W19~W24 实证 5/5 generator 倾向漂字段，PR D 只修 reviewer/proposer，PR E #2891 才补齐 generator）；同时新增 **跨调用自反不变量（involution invariant）** 作为 **多调用关系级（自反复合）** oracle 探针——W24 引入"级联递推 `f(n)=n*f(n-1)`"是 **不同 n 之间的链式关系**，W25 第一次引入 **"同一 f 自我复合后回到原值 `f(f(n))===n`"**：evaluator 须发 ≥ 2 次 curl，第 2 次的输入是第 1 次的输出，再断言"两次 negate 后等于原值"。若 generator 错把 `-n` 写成 `n` / `Math.abs(n)` / `~n+1`（位运算反码会在浮点上失真）/ `0-n` 等等价但不严格的实现，可能在某些边界（如浮点 `-0`、超大整数位反、NaN 传播）下被该自反 oracle 抓住

## 背景

W19~W22 oracle 都是"单次调用值复算"。
W23 `/modulo` 引入"单次调用值满足某不变量"（符号一致）。
W24 `/factorial` 引入"多次调用之间的值满足级联递推关系"（`f(n)=n*f(n-1)`，n 与 n-1 之间）。
W25 `/negate` 把 oracle 推到 **同一函数自我复合后回到原值** —— `f(f(n)) === Number(n)`，即 "应用两次得身份" 的 **involution（对合 / 自反映射）** 性质。这是 W24 级联递推（两次调用之间的输入参数不同：`n` 与 `n-1`）首次扩展到 **两次调用之间输入参数 _也不同但通过函数本身耦合_**（第二次调用的 query 参数 _必须_ 等于第一次调用响应里的 `negation` 字段值）。evaluator 须先发 `GET /negate?n=<n>`，从响应取 `negation`，再用它发 `GET /negate?n=<negation>`，最后断言"二次响应的 `negation` 严等 `Number(<原 n>)`"。这是 W19~W24 单 curl 或独立两 curl 范式的首次 **链式依赖** 扩展。

并行地，W25 是 **PR-E 验收任务**：Bug 7（commit 47a37d4fc）补齐了 PR-D 漏修的 `buildGeneratorPrompt` —— 把 generator prompt 也从 "slash command +（不能复用 SKILL 文本）"改成 "inline SKILL pattern（'你是 X agent。按下面 SKILL 指令工作。\n\n[SKILL 全文]\n\n...'）"，使 generator 真正收到 SKILL.md v6.2 Step 6.5 的完整文本（含"字面用合同里的 query 名 / 响应字段名"约束、禁用别名清单、`[BEHAVIOR]` per query param 等）。W19~W24 实证 generator **5/5 W 任务都漂字段名**，PR-D 只修 reviewer/proposer 没修 generator，PR-E 才补齐。**W25 本次 generator 提交的 `playground/server.js` 必须字面用 `n` 作为 query 名 + 字面用 `negation` 作为响应字段名，不许出现 `value/num/x/result/negated/inverse/opposite/sign_flipped` 等同义词；否则视为 Bug 7 修复失效**，这就是"PR-E-acceptance：验 generator inline SKILL pattern 真生效"的含义。

此外，W25 的 strict-schema 是 **首条显式允许负数与小数的单参** endpoint——W24 `/factorial` 切到 `^\d+$`（整数非负）是因为阶乘只在非负整数上定义；W25 `/negate` 必须重新允许负数与小数（负数的负数才是 involution oracle 的核心 path），所以 **沿用 W20/W21/W22/W23 的浮点 regex** `^-?\d+(\.\d+)?$`。这里的"沿用"和 W24 的"切到新 regex"互为对比：W25 不切回 W24 的 `^\d+$`，但也不该 generator 自己发明 `^[\d.+\-eE]+$` 之类宽松 regex（实证 generator 可能在"看到要支持负数"时擅自放宽到接受科学计数法）。

W25 oracle 设计：

| oracle 形式 | W19 sum | W20 multiply | W21 divide | W22 power | W23 modulo | W24 factorial | **W25 negate** |
|---|---|---|---|---|---|---|---|
| 值复算严格相等 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓（独立 `-Number(n)` 复算） |
| strict-schema 白名单 | — | ✓ `^-?\d+(\.\d+)?$` | ✓（同） | ✓（同） | ✓（同） | ✓ `^\d+$`（不同） | ✓ `^-?\d+(\.\d+)?$`（**回到浮点 regex**，与 W24 形成对比） |
| 输入规则级拒 | — | — | ✓（b=0） | ✓（0^0） | ✓（b=0） | ✓（n > 18） | — |
| 输出值级兜底 | — | — | — | ✓（`Number.isFinite`） | — | — | — |
| 单调用语义不变量 | — | — | — | — | ✓（sign） | — | — |
| 多调用级联递推 | — | — | — | — | — | ✓（f(n)=n·f(n-1)） | — |
| **多调用自反复合** | — | — | — | — | — | — | **✓（`f(f(n))===n`）** ← W25 新增 |
| **PR 验收**（GAN inline SKILL） | — | — | — | — | — | PR-D（reviewer/proposer） | **PR-E（generator）** ← W25 |

W25 强制 evaluator 在标准的"值复算严格相等"之外，**额外**断言 **跨调用自反复合关系**：
1. 输入非法（缺参 / strict-schema 拒）→ 400
2. 输入合法 → 200 + `{negation: <-Number(n)>}`，且必须满足：
   - **值正确**：`negation === -Number(n)`（标准 oracle，沿用 W19~W24 范式）
   - **自反不变量**：独立第二次请求 `GET /negate?n=<第一次响应的 negation>`，断言 "第二次响应的 `negation` 严等 `Number(<原 n>)`"（W25 新增 oracle 形式：**链式依赖**——第二次请求的 query 参数等于第一次响应的字段值）
   - **零/负零稳定性**：`n=0` 与 `n=-0` 都必须返 `{negation: 0}`（JSON 序列化下 `-0` 被规范成 `0`，故二者不可区分；自反 oracle 在 n=0 上退化为身份，应仍通过）

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /negate?n=5` 请求] → 经过 [playground server 用 strict-schema（浮点白名单 `^-?\d+(\.\d+)?$`）校验 n、独立复算 `-Number(n)` 并返回] → 到达 [收到 200 响应，body 为 `{ "negation": -5 }`，且 `negation === -Number(n)` 严格成立，且对该响应再发一次 `GET /negate?n=-5` 必返 `{ "negation": 5 }`，二次响应的 `negation` 严等原始 `Number("5")`（自反 oracle）]

具体：

1. 客户端发 `GET /negate?n=<合法十进制数字串>` 到 playground server（默认端口 3000）
2. server 对 n 做 strict-schema 校验（白名单正则 `^-?\d+(\.\d+)?$`——与 W20/W21/W22/W23 完全同款；**不复用** W24 `/factorial` 的 `^\d+$` 整数白名单——必须沿用旧浮点 regex 以接受负数 / 小数）
3. strict-schema 通过后，**不做任何业务规则拒**（不像 W21/W22/W24 有 b=0 / 0^0 / n>18 这类输入域拒）—— `-Number(n)` 在所有 strict-schema 合法输入上都有定义且结果有限
4. 计算 `result = -Number(n)`（取相反数；JavaScript 一元负号原生支持负数、小数、负零）
5. 返回 HTTP 200，JSON body 为 `{ "negation": result }`（JS Number；JSON 序列化下 `-0` 自动规范成 `0`）
6. 任一参数缺失 / 不通过 strict-schema → HTTP 400 + `{ "error": "<非空字符串>" }`，body 不含 `negation`

## Response Schema

> 把响应字段 codify 成 oracle，让 proposer 把每个字段 + query param 名转成 `jq -e` / `curl` 命令，evaluator 真起服务真校验。避免 generator 自由发挥 query 名（W22 实证 generator 漂移到 `a/b`；W25 极易漂移到 `value/x/num/number/input/v` 等同义词）或漂移结果字段名（W19/W20 实证 generator 倾向把字段写成 generic `result`；W25 极易漂移到 `negated/inverse/opposite/sign_flipped` 等近义词）。
>
> **PR-E 验收命门**：本任务的 generator 输出 **必须** 字面使用 `n`（query 名）+ `negation`（响应字段名）。若 generator 提交的 `playground/server.js` 出现 `value`/`x`/`num`/`result`/`negated`/`inverse` 等任何同义词，视为 Bug 7（commit 47a37d4fc）修复失效，应重开 issue 调查 `buildGeneratorPrompt` inline SKILL pattern 是否真传到 LLM。

### Endpoint: GET /negate

**Query Parameters**:
- `n` (signed-decimal-as-string, 必填): 待取负的输入参数；必须完整匹配 strict-schema 正则 `^-?\d+(\.\d+)?$`（**有符号十进制数字串**，允许负号 / 小数点；与 W20/W21/W22/W23 同款）
- **强约束**: generator 必须**字面用** `n` 作为 query param 名
- **禁用 query 名**: `x` / `y` / `m` / `k` / `i` / `j` / `a` / `b` / `p` / `q` / `value` / `val` / `num` / `number` / `int` / `integer` / `float` / `decimal` / `input` / `arg` / `arg1` / `input1` / `v1` / `v` / `count` / `size` / `target` / `operand` / `data` —— generator 不得用任何别名替代 `n`；用错 query 名 endpoint 应返 400（缺参分支）或 404
- 用错 query 名一律视为合同违约（与 W22 v8.2 / W23 / W24 加固保持一致）

**Success (HTTP 200)**:
```json
{"negation": <number>}
```
- `negation` (number, 必填): JS Number，等于独立复算 `-Number(n)`；对 `n` 是整数串则 `negation` 是其相反整数，对 `n` 是小数串则 `negation` 是其相反小数；`n=0` 或 `n=-0` 时 `negation === 0`（JSON 下 `-0` 规范为 `0`，client 不可区分）
- 顶层 keys 必须 **完全等于** `["negation"]`，**不允许多余字段**（不允许加 `operation`、`result`、`n`、`input`、`value`、`negated`、`inverse`、`opposite`、`sign`、`sign_flipped`、`original`、`output` 等任何附加字段）

**Error (HTTP 400)**:
```json
{"error": "<非空 string>"}
```
- `error` (string, 必填): 非空字符串（具体文案不强约束）
- 错误响应 body **必须不包含 `negation` 字段**（防"既报错又给值"的混合污染）
- 顶层 keys 必须 **完全等于** `["error"]`，不允许多余字段
- 错误时禁用替代字段名：`message` / `msg` / `reason` / `detail` / `details` / `description` / `info`

**禁用响应字段名**（response body 严禁出现，generator 不得自由发挥同义替代）：
- `result`、`value`、`answer`、`negated`、`inverse`、`opposite`、`sign_flipped`、`flipped`、`neg`、`minus`、`output`、`out`、`data`、`payload`、`response`
- `sum`、`product`、`quotient`、`power`、`remainder`、`factorial`（这是 W19/W20/W21/W22/W23/W24 的字段名，**严禁** 复用到 `/negate`——同 W24 对 W23 / W19~W22 字段名的禁用规则）

**字段命名锁死的原因**：W19/W20 实测出 generator 倾向把结果字段写成 `result`（generic），违反"动作-结果名"一致命名规约（add→sum / multiply→product / divide→quotient / power→power / modulo→remainder / factorial→factorial / **negate→negation**）。本 endpoint 显式锁定 `negation`，proposer 必须把 `jq -e '.negation | type == "number"'` 与 `jq -e 'keys == ["negation"]'` 作为强制 oracle 命令写进合同。**这也是 PR-E 验收的命门**——若 generator 字面用 `negation`（不漂移），证明 Bug 7 inline SKILL pattern 真把 SKILL.md Step 6.5 的字段名锁死约束传到了 LLM；若漂到 `negated/inverse/result/value`，证明 SKILL 内容仍丢失，Bug 7 修复未真生效。

## strict-schema 定义（合法输入白名单）

合法 query 参数字符串必须 **完整匹配** 正则：`^-?\d+(\.\d+)?$`（**有符号十进制数字串**；与 W20/W21/W22/W23 完全同款；**不复用** W24 `/factorial` 的 `^\d+$` 整数白名单——sign 取反必须支持负数与小数）

| 输入示例 | strict-schema 判定 | 计算结果（独立复算 `-Number(n)`） | 期望响应 |
|---|---|---|---|
| `n=5` | 合法 | -5 | 200，`{negation: -5}` |
| `n=-5` | 合法 | 5 | 200，`{negation: 5}` |
| `n=0` | 合法 | -0（JSON 下规范为 0） | 200，`{negation: 0}` |
| `n=-0` | 合法 | 0 | 200，`{negation: 0}` |
| `n=0.0` | 合法 | -0（JSON 下规范为 0） | 200，`{negation: 0}` |
| `n=-0.0` | 合法 | 0 | 200，`{negation: 0}` |
| `n=3.14` | 合法 | -3.14 | 200，`{negation: -3.14}` |
| `n=-3.14` | 合法 | 3.14 | 200，`{negation: 3.14}` |
| `n=100` | 合法 | -100 | 200，`{negation: -100}` |
| `n=-100` | 合法 | 100 | 200，`{negation: 100}` |
| `n=1.5` | 合法 | -1.5 | 200，`{negation: -1.5}` |
| `n=+5` | strict 拒（前导 +） | — | 400 |
| `n=05` | 合法（`^-?\d+(\.\d+)?$` 允许前导 0） | -5 | 200，`{negation: -5}`（与 `n=5` 等价） |
| `n=1e2` | strict 拒（科学计数法） | — | 400 |
| `n=Infinity` | strict 拒（字母串） | — | 400 |
| `n=-Infinity` | strict 拒 | — | 400 |
| `n=NaN` | strict 拒 | — | 400 |
| `n=0xff` | strict 拒（十六进制 / 含非数字字符 x） | — | 400 |
| `n=1,000` | strict 拒（千分位） | — | 400 |
| `n=` | strict 拒（空串） | — | 400 |
| `n=abc` | strict 拒 | — | 400 |
| `n=5.` | strict 拒（点后无数字） | — | 400 |
| `n=.5` | strict 拒（点前无数字） | — | 400 |
| `n=--5` | strict 拒（双负号） | — | 400 |
| 缺 n（无 query） | — | — | 400 |

## 边界情况

- **`n === 0` 与 `n === -0`** 都必须返 `{negation: 0}`（JS 内部 `-Number("0") === -0`，`JSON.stringify({negation: -0}) === '{"negation":0}'`，client 不可区分；显式断言两条用例，防 generator 错写 `n === '-0' → negation: -0` 字符串污染或返 `{ negation: '-0' }` 字符串型）
- **`n === -0.0` 与 `n === 0.0`** 同上（小数 `0.0`/`-0.0` 在 `Number(...)` 下分别得 `0` / `-0`，输出仍是 `{negation: 0}`）
- **自反不变量**（W25 核心 oracle 探针）：所有 strict 合法的 n 必须满足 **链式自反关系**——先 `GET /negate?n=<n>` 得 `r1.negation`；再 `GET /negate?n=<r1.negation>` 得 `r2.negation`，断言 `r2.negation === Number(<原 n>)`。具体：
  - `n=5` → r1.negation=-5 → r2.negation=5 → 5 === Number("5") ✓
  - `n=-3.14` → r1.negation=3.14 → r2.negation=-3.14 → -3.14 === Number("-3.14") ✓
  - `n=0` → r1.negation=0 → r2.negation=0 → 0 === Number("0") ✓（退化为身份）
  - **若 generator 错写**：`Math.abs(n)`（返绝对值）→ 第二次 `Math.abs(-5)=5≠Number("5")? 5===5 ✓` 居然碰巧过；但若用 `n=5` 测，第一次 `Math.abs(5)=5≠-5`，标准值 oracle 立刻断
  - **若 generator 错写**：`~Number(n)+1`（位运算反码）→ 浮点 `5.5` 会被位运算截断到整数，标准值 oracle 立刻断
  - **若 generator 错写**：`n` 直接返回（忘了取负）→ 标准值 oracle 立刻断
  - **若 generator 错写**：`String(-Number(n))`（返回字符串型）→ schema oracle `.negation | type == "number"` 立刻断
- **判定顺序必须严格**：缺参 → strict-schema 校验 → 计算 → 200。错任一阶段都返 400 且 body 不含 `negation`
- **前导 0** 处理：`n=05` 通过 strict（`^-?\d+(\.\d+)?$` 允许）且 `Number("05") === 5`，与 `n=5` 等价返 `{negation: -5}`。这是 strict-schema 的客观语义，proposer 须把此用例写进合同的 happy 分支
- **小数精度**：`-Number("3.14") === -3.14` 在 JS Number 下精确；但 `-Number("0.1") === -0.1` 在某些表达下可能因浮点累积有微差——本 endpoint 不引入累积运算，单次取负不引入精度漂移，故 oracle 用 `===` 严等即可（不需要 `Math.abs(a-b) < 1e-10` 容差）
- **零依赖**：playground 现有零依赖原则保持不变，不引入 `bignumber.js` / `decimal.js` / 任何外部库
- **strict-schema 顺序与 W20/W21/W22/W23/W24 一致**：缺参 → 类型 + 正则 → 算术（W25 无 W21/W22/W24 那层"业务规则拒"，因为单一元取负在 strict 合法输入上无非法子集）
- **`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial` 现有行为不受影响**（不动这七条路由的代码、单测、README 段一个字符）
- **不出现结果非有限的情况**：对任意 strict 合法 n，`-Number(n)` 一定有限——因此本 endpoint **不需要** W22 风格的 `Number.isFinite` 兜底
- **不出现符号问题需要不变量**：负的负是正、零的负是零，这本身就是 oracle 要验的；不需要 W23 风格独立符号 oracle

## PR-E 验收：Bug 7 generator inline SKILL pattern 真生效

W25 不仅是 W24 oracle 链的延伸，**同时是 PR-E 验收任务**——验证 #2891（Bug 7 fix，commit 47a37d4fc）之后 generator 在 GAN 链路中真按 SKILL.md v6.2 Step 6.5 inline SKILL pattern 收到完整 SKILL 内容，体现为对合同里 query 名 + 响应字段名的 **字面遵守**。

**PR-E 验收 success criteria**（由 harness 运行后自动检查 / 人工最终签核）：

1. **generator 输出 server.js**：本次 sprint 的 generator commit 在 `playground/server.js` 中：
   - `app.get('/negate', ...)` 中 `req.query.n` 必须字面用 `n`（**不许**用 `req.query.value`/`req.query.num`/`req.query.x`/`req.query.input`/`req.query.v` 等任何别名）
   - 响应 `res.json({ negation: ... })` 必须字面用 `negation` 作为字段名（**不许**用 `negated`/`inverse`/`opposite`/`result`/`value`/`answer`/`sign_flipped`/`flipped`/`neg`/`minus` 等任何同义词）
   - 缺任一条即视为 Bug 7 修复 **未真生效**，需重开 issue 调查 `harness-utils.js` `buildGeneratorPrompt` 是否真把 SKILL.md 内容 inline 进 prompt
2. **generator 输出 tests/server.test.js**：测试断言 `expect(res.body.negation).toBe(...)` 与 `expect(Object.keys(res.body).sort()).toEqual(['negation'])` 必须用字面 `negation`，不漂移
3. **proposer 输出 sprint-contract.md**：合同包含 ≥ 1 条 `[BEHAVIOR]` per query param（v7.4 约束），query param `n` 真出现 ≥ 1 条独立 `[BEHAVIOR]` 验
4. **reviewer 输出**：本次 sprint 的 reviewer round-1+ 输出仍按 SKILL.md v6.2 的 7 维 rubric 评分（PR-D 验收的延续），含 `verification_oracle_completeness` 与 `behavior_count_position` 两维
5. **evaluator 输出**：合同里的：
   - 标准值 oracle（如 `n=5 → negation=-5`、`n=-3.14 → negation=3.14`）
   - 自反不变量 oracle（如 "先 n=5 拿 r1.negation=-5，再以 r1.negation 为 query 发 GET /negate?n=-5 拿 r2.negation=5，断言 r2.negation === Number('5')"）
   - schema 严等 oracle（`keys == ["negation"]`）
   - query 别名拒 oracle（`?value=5` 应 400 不含 negation）
   - strict 拒 oracle（`?n=1e2`、`?n=Infinity` 等应 400）
   
   全部执行且通过

> PR-E 验收的失败信号：generator 提交的 `server.js` 出现 `value`/`num`/`x`/`result`/`negated`/`inverse` 等任何同义词；或合同 `[BEHAVIOR]` per query param 缺失；或 evaluator 跳过自反 oracle / 别名拒 oracle。

## 范围限定

**在范围内**：

- 在 `playground/server.js` 在 `/factorial` 之后、`app.listen` 之前新增 `GET /negate` 路由（含 strict-schema `^-?\d+(\.\d+)?$` 校验 + `-Number(n)` 取负 + 返 `{negation: result}`），可复用已有 `STRICT_NUMBER` 常量（W20 引入，已被 W20/W21/W22/W23 复用）
- 在 `playground/tests/server.test.js` 新增 `GET /negate` describe 块单测，与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial` describe 块平级，覆盖：
  - happy path（含 `n=5`、`n=-5`、`n=0`、`n=-0`、`n=3.14`、`n=-3.14`、`n=100`、`n=-100` 至少 8 条；其中 `n=0` 和 `n=-0` 各必须有独立用例显式断言 `negation === 0`；至少 1 条整数 + 1 条小数 + 1 条负数 + 1 条负小数 + 1 条负零的组合）
  - strict-schema 拒（前导 +、双负号、点前无数字、点后无数字、科学计数法、十六进制、千分位、空串、字母串、Infinity、NaN、缺参 各至少 1 条，合计至少 12 条）
  - 至少 4 条 oracle 值断言：`expect(res.body.negation).toBe(<独立复算>)`，证明返回值与独立复算 `-Number(n)` 严格相等（覆盖正整数 / 负整数 / 正小数 / 负小数 各至少 1 条）
  - **W25 核心**：至少 3 条 **跨调用自反不变量（involution）** oracle 断言，在同一测试用例里发两次 supertest 请求：先 `GET /negate?n=<n>`、把第一次响应的 `body.negation` 转字符串作为第二次 query value、断言"第二次响应的 `body.negation` 严等 `Number(<原 n>)`"；至少 1 条覆盖正整数（如 `n=5`）、至少 1 条覆盖负小数（如 `n=-3.14`）、至少 1 条覆盖零（`n=0`，退化为身份验证）
  - 至少 1 条 schema oracle：断言 `Object.keys(res.body).sort()` 严格等于 `['negation']`（成功响应不含多余字段）
  - 至少 1 条断言：失败响应 body 不含 `negation` 字段
  - 至少 1 条断言：失败响应 `Object.keys(res.body).sort()` 严格等于 `['error']`（错误响应不含多余字段，含 `negation` 即失败）
  - 至少 2 条 query 别名锁死断言：`GET /negate?value=5` 与 `GET /negate?x=5` 都 400 且不含 `negation`
  - 至少 1 条 schema type 断言：`expect(typeof res.body.negation).toBe('number')`（防 generator 返字符串型 `"-5"`）
  - 回归断言：`/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial` 至少各 1 条 happy 用例仍然通过
- 在 `playground/README.md` 端点列表加 `/negate`，给出 happy（含 `n=0`、负数、小数）、strict 拒、自反 oracle 示例 各至少 1 个
- 保持 playground 零依赖原则（不引入新依赖）

**不在范围内**：

- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖（不加 zod / joi / ajv / bignumber.js / decimal.js / mathjs / 任何外部库；不引入 BigInt）
- 不改 `/health`、`/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial` 的实现或单测（一字不动）
- 不引入位运算 `~Number(n)+1` 或 `0-Number(n)` 实现（明确锁死用一元负号 `-Number(n)`，最直白且对负零行为最一致）
- 不支持复数 / 矩阵 / 向量取负（本 endpoint 仅支持标量数字）
- 不做 rate-limit、auth、CORS、日志结构化等非功能特性
- 不写跨子项目的集成测试
- 不支持 path param / body / POST，仅 GET + query string
- 不加 `Number.isFinite` 结果兜底（一元负号在 strict 合法输入上结果一定有限；加多余兜底视为合同违约）
- 不写记忆化 / 缓存层（每次请求独立计算）
- 不引入 `Math.sign` / `Math.abs` 等中间步骤（直接 `-Number(n)`，最薄实现）
- 不切回 W24 `^\d+$` 整数白名单 regex（必须支持负数与小数）

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest 方案，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: 错误响应格式为 HTTP 400 + `{ error: "<非空字符串>" }`（与 `/sum`、`/multiply`、`/divide`、`/power`、`/modulo`、`/factorial` 一致）]
- [ASSUMPTION: strict-schema 复用 W20 引入的 `STRICT_NUMBER = /^-?\d+(\.\d+)?$/` 常量（W20/W21/W22/W23 共用；W24 因整数语义另写 `^\d+$`，本 W25 回到浮点 regex 故复用 W20）]
- [ASSUMPTION: 响应 body 字段名为 `negation`（与 `sum`、`product`、`quotient`、`power`、`remainder`、`factorial` 同一命名规约——动作的语义结果名）]
- [ASSUMPTION: 取负实现用一元负号 `-Number(n)`（不用 `0 - Number(n)` 或位反 `~Number(n) + 1`，避免边界差异）]
- [ASSUMPTION: 自反 oracle 在单测层用 supertest 在同一 `it()` 里两次 `await request(app).get(...)`，第二次 query 用 `String(r1.body.negation)`（因为 `JSON.stringify(-0)==='0'` 故 -0 路径在 JSON parse 后变 0，自反闭环不破裂）；不要求 evaluator 在 contract 层一定用两条 `curl`（contract 层 evaluator 可以仍是单 curl + jq，但必须有至少一条独立的链式自反关系命令——本 PRD 只锁 What）]
- [ASSUMPTION: `n=0` 与 `n=-0` 在 JSON 响应中不可区分（`{negation: 0}`），proposer 不应在合同中要求 client 区分二者]
- [ASSUMPTION: 只支持 query string 传参，不支持 path param / body / POST]
- [ASSUMPTION: `error` 字段值是否包含中文不强制约束，只要求是非空字符串（与现有路由一致），具体文案由 generator 决定]
- [ASSUMPTION: 自反 oracle 不要求覆盖 strict 边界值如 `n=05`（前导 0），因为第一次响应 negation=-5（数字型）转字符串是 `"-5"`，第二次响应 negation=5（数字型）转字符串是 `"5"`，已涵盖正负切换；前导 0 路径无独立必要]

## 预期受影响文件

- `playground/server.js`：在 `/factorial` 之后新增 `GET /negate` 路由 + 复用 `STRICT_NUMBER` regex + `-Number(n)` 取负（≈ 10 行）
- `playground/tests/server.test.js`：新增 `GET /negate` describe 块（happy 8+ + strict 拒 12+ + 值 oracle 4+ + 自反 oracle 3+ + schema 严等 + type 断言 + 错误体不含 `negation` + 别名锁 2+ + 回归断言 7+）
- `playground/README.md`：端点列表加 `/negate`，补 happy（含负数、小数、零）/ strict 拒 / 自反 oracle 示例 各示例

## journey_type: autonomous
## journey_type_reason: playground 是独立 HTTP server 子项目，本次只动 server 路由 + 单测 + README，无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议；按规则归类为 autonomous（与 W19 /sum、W20 /multiply、W21 /divide、W22 /power、W23 /modulo、W24 /factorial 同分类）
