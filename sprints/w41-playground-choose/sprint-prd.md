# Sprint PRD — playground 加 GET /choose（W41 Walking Skeleton demo — 2 轮演示：round 1 漏 0! 基底，round 2 过）

## OKR 对齐

- **对应 KR**：W41 Walking Skeleton — 验证 harness 2 轮再生能力：evaluator 在 round 1 抓出 `0!` 基底缺失 bug，round 2 generator 修复后 PASS
- **当前进度**：W40（fixDispatchNode pr_url/pr_branch 保留）已合入，harness 最后一公里路径打通
- **本次推进预期**：首次演示"设计性 2 轮"场景 — PRD 明确写入 `C(n,0)=1`（依赖 `0!=1`）oracle，round 1 generator 极易漏掉 `k=0` 空乘积基底，evaluator 抓住 → round 2 修复 → PASS

## 背景

W19∼W37 系列 Walking Skeleton 都以 round 1 一次成功为目标（验证 happy path 能跑通）。  
W41 首次将**设计性失败再修复**纳入 demo 范围——PRD 里埋入 `C(n,0)=1` 这个 **0! 基底 oracle**，让 harness evaluator 在 round 1 检测到缺失，round 2 generator 修复后最终过关。

`choose(n, k)` 是二项式系数 C(n,k) = n! / (k! × (n-k)!)。  
- 当 k=0：C(n,0) = n! / (0! × n!) = 1 — 必须依赖 `0! = 1`（空乘积定义）  
- 当 n=k=0：C(0,0) = 0! / (0! × 0!) = 1 — 同理  
- 最自然的 generator round 1 失误：把 factorial 基底写成 `n===1 → 1`（忘记 `n===0` 分支），调用 `factorial(0)` 时要么无限递归、要么返回错值 → C(5,0)/C(0,0) 失败

## Golden Path（核心场景）

HTTP 客户端从 [发起 `GET /choose?n=5&k=2` 请求] →
经过 [playground server：strict-schema 校验 → 0≤k≤n≤20 范围校验 → 迭代计算二项式系数] →
到达 [收到 200 响应，body 为 `{"choose": 10}`，且独立复算严格成立]

具体：

1. 客户端发 `GET /choose?n=<整数>&k=<整数>` 到 playground server（默认端口 3000）
2. server 对 n、k 各自做 strict-schema 校验（白名单正则 `^\d+$`，与 `/factorial` 同款非负整数 regex）
3. 校验通过后，显式判定 `Number(n) > 20` → 400；`Number(k) > Number(n)` → 400
4. 迭代计算 C(n,k)：利用对称性取 `k = Math.min(k, n-k)`，再用乘法递推 `C(n,k) = (n-i+1)/i × C(n,k-1)` 迭代 k 次
5. 返回 HTTP 200 + `{"choose": <整数>}`（精确整数，`n≤20` 保证结果 ≤ C(20,10)=184756，远低于 `Number.MAX_SAFE_INTEGER`）
6. 任一参数缺失 / strict-schema 拒 / `n>20` / `k>n` → HTTP 400 + `{"error": "<非空字符串>"}`

**W41 关键 oracle（round 1 预期失败点）**：
- `choose(5, 0)` → 200 + `{"choose": 1}`（需要 `0!=1`）
- `choose(0, 0)` → 200 + `{"choose": 1}`（需要 `0!=1` 三处）
- `choose(20, 0)` → 200 + `{"choose": 1}`（需要 `0!=1`）

## Response Schema

> **目的**：codify 响应字段，evaluator 用 `jq -e + curl` 实校验。
> 特别关注 `k=0` oracle — 这是"0! 基底"验证点，round 1 generator 极易在此失败。

### Endpoint: GET /choose

**Query Parameters**（v8.2 约束 query param 名）：
- `n`（non-negative-integer-as-string，必填）：完整匹配 `^\d+$`，且 `Number(n) ≤ 20`
- `k`（non-negative-integer-as-string，必填）：完整匹配 `^\d+$`，且 `Number(k) ≤ Number(n)`
- **禁用 query 名**：`x` / `y` / `a` / `b` / `p` / `q` / `r` / `m` / `i` / `j` / `val` / `value` / `num` / `number` / `input` / `input1` / `input2` / `v1` / `v2` / `n1` / `n2` / `top` / `bot` / `bottom` / `choose_n` / `choose_k`
- **强约束**：generator 必须字面用 `n` 和 `k` 作为 query param 名；用错名 endpoint 应返 400（缺参分支）或 404

**Success (HTTP 200)**：
```json
{"choose": <number>}
```
- `choose`（number，必填）：精确整数，等于独立迭代复算 C(n,k)；`n≤20` 保证结果必为精确整数，无精度损失
- 顶层 keys 必须**完全等于** `["choose"]`，不允许多余字段

**Error (HTTP 400)**：
```json
{"error": "<非空 string>"}
```
- 顶层 keys 必须**完全等于** `["error"]`；body 不含 `choose`
- 禁用替代字段名：`message` / `msg` / `reason` / `detail` / `description`

**禁用响应字段名**：`result` / `value` / `answer` / `c` / `cnk` / `combination` / `binomial` / `coeff` / `coefficient` / `data` / `payload` / `output` / `sum` / `product` / `factorial` / `quotient` / `power` / `remainder`

**Schema 完整性**：response 顶层 keys 必须**完全等于** `["choose"]`，不允许多余字段（不允许加 `n`、`k`、`operation`、`result` 等附加字段）

**W41 关键（0! 基底 oracle）**：

| 输入 | 期望 200 结果 | 说明 |
|------|-------------|------|
| `n=5, k=0` | `{"choose":1}` | C(5,0)=1，依赖 0!=1 |
| `n=0, k=0` | `{"choose":1}` | C(0,0)=1，依赖 0!=1 |
| `n=20, k=0` | `{"choose":1}` | C(20,0)=1，依赖 0!=1 |
| `n=5, k=5` | `{"choose":1}` | C(5,5)=1，依赖 0!=1（分母含 0!） |
| `n=5, k=2` | `{"choose":10}` | 标准 happy path |
| `n=10, k=3` | `{"choose":120}` | happy path |
| `n=20, k=10` | `{"choose":184756}` | 精度上界 happy path |

## 边界情况

- **`k=0`**（W41 核心）：C(n,0)=1 对所有合法 n；依赖 `0!=1`（空乘积）；generator round 1 最易在此失败
- **`k=n`**：C(n,n)=1；与 `k=0` 对称，同样依赖 `0!=1`（分子 n!，分母 `n! × 0!`）
- **`n=0, k=0`**：合法，返 `{"choose":1}`（0!=1）；C(0,0) 是最小非平凡边界
- **`k > n`**：拒，返 400；数学上 C(n,k)=0 但 endpoint 显式拒绝（避免 generator 悄悄返 0 假绿）
- **`n=20`（上界）**：合法；C(20,10)=184756，精确整数，< MAX_SAFE_INTEGER
- **`n=21`（上界 +1）**：拒，返 400；虽然 C(21,k) 仍在 MAX_SAFE_INTEGER 范围，但 hard cap 在 20 保持一致
- **前导 0**：`n=05` 通过 strict（`^\d+$` 允许），`Number("05")=5`，与 `n=5` 等价；proposer 须把此用例写进 happy 分支
- **零依赖**：playground 零依赖原则不变，不引入 mathjs / combinatorics 等外部库
- **对称性利用**：实现可用 `Math.min(k, n-k)` 减少迭代次数，但结果必须与不用对称性一致

## 范围限定

**在范围内**：
- `playground/server.js` 在 `/factorial` 之后、`/increment` 之前（或末尾、`app.listen` 之前）新增 `GET /choose` 路由
- `playground/tests/server.test.js` 新增 `describe('GET /choose')` 块，覆盖：
  - happy path（含 `k=0` n=5/n=0/n=20 各 1 条、`k=n` 1 条、中间值 2 条）
  - 上界拒（n>20 至少 2 条）
  - k>n 拒（至少 2 条）
  - strict-schema 拒（缺参 n/k 各 1 条；负数 / 小数 / 科学计数法 / 十六进制 / 字母串各 1 条）
  - schema oracle：`Object.keys(res.body).sort()` 严格等于 `['choose']`
  - 值 oracle：`choose(10,3)===120`、`choose(5,2)===10`、`choose(0,0)===1`、`choose(20,10)===184756` 各 1 条
  - **W41 核心**：`choose(5,0)===1`、`choose(n,0)===1`（n=20）、`choose(n,n)===1`（n=5）各显式断言
  - 回归断言：`/health`、`/sum`、`/factorial`、`/increment`、`/decrement` 各 1 条 happy 仍然通过
- `playground/README.md` 端点列表加 `/choose`，给出 happy（含 k=0 边界）、k>n 拒、strict 拒 示例各 1 个

**不在范围内**：
- 不改 brain / engine / dashboard / apps / packages 任何代码
- 不引入新依赖
- 不改其他 8 条已有路由（`/health`/`/sum`/`/multiply`/`/divide`/`/power`/`/modulo`/`/factorial`/`/increment`/`/decrement`）的实现或单测
- 不支持 C(n,k)=0（k>n 一律 400，不悄返 0）
- 不引入 BigInt / mathjs / 任何外部库
- 不支持 path param / body / POST

## 假设

- [ASSUMPTION: 单测沿用 vitest + supertest，与现有 `playground/tests/server.test.js` 同栈]
- [ASSUMPTION: strict-schema 用 `^\d+$`（非负整数，与 `/factorial` 同款），n 和 k 各自独立校验]
- [ASSUMPTION: 响应字段名为 `choose`（对应操作语义，与 `sum`/`product`/`quotient`/`factorial` 命名规约一致）]
- [ASSUMPTION: 上界 n≤20：C(20,10)=184756 远低于 MAX_SAFE_INTEGER，不需要精度保护；21 处 hard cap 保持简洁性]
- [ASSUMPTION: k>n 返回 400 而非 0（数学上 C(n,k)=0 当 k>n，但 endpoint 显式拒绝，防 generator 悄悄返 0 假绿）]
- [ASSUMPTION: 计算用迭代乘法 `C(n,k) = ∏(n-i+1)/(i) for i=1..k`（整除每步保持整数，精确无误差）；不强制用 n!/k!/(n-k)! 公式（避免 generator 被 factorial 子函数的 0! bug 绑架，但 evaluator oracle 仍需覆盖 k=0 即空乘积=1）]
- [ASSUMPTION: n=0,k=0 合法，返 1；这是 walking skeleton 的 0! 基底最严格测试]
- [ASSUMPTION: 错误响应与其他 endpoint 一致：HTTP 400 + `{"error":"<非空字符串>"}`]
- [ASSUMPTION: W41 2 轮设计：round 1 generator 漏掉 `k=0` 返回 1 的基底（极自然的 off-by-one 或递归基底缺失）→ evaluator 通过 `choose(5,0)=1` oracle 抓住 → round 2 修复 → PASS；PRD 无需写明"允许 round 1 失败"，这是 harness demo 约定]

## 预期受影响文件

- `playground/server.js`：在 `/factorial` 之后新增 `GET /choose` 路由（strict-schema `^\d+$` 校验 + n>20 上界拒 + k>n 范围拒 + 迭代计算 C(n,k)，≈ 15 行）
- `playground/tests/server.test.js`：新增 `describe('GET /choose')` 块（happy 7+ + 上界拒 2+ + k>n 拒 2+ + strict 拒 6+ + 值 oracle 4+ + k=0 oracle 3+ + schema oracle 1+ + 回归断言 5+）
- `playground/README.md`：端点列表加 `/choose`，补 happy（含 k=0）/ k>n 拒 / strict 拒示例

## journey_type: autonomous
## journey_type_reason: 只动 playground 子项目（server.js + tests + README），无 UI / 无 brain tick / 无 engine hook / 无远端 agent 协议，与 W19∼W37 系列同分类
