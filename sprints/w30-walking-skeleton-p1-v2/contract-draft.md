# Sprint Contract Draft (Round 4)

Sprint: W30 Walking Skeleton P1 终验 round 2 — playground 加 GET /decrement endpoint
Initiative: a69c58e4-6942-40bf-9a8e-370b936294e9
journey_type: autonomous

**Round 4 修订要点**（对应 Reviewer round 3 反馈 `internal_consistency=6`，2 个 issue）:
- contract-dod-ws1.md 每个 BEHAVIOR 条目显式带 `[BEHAVIOR-N]` 序号标签（N=1..14，按文件出现顺序）；可被 grep 唯一定位
- 修 R9 引用：`BEHAVIOR-13` → `BEHAVIOR-14`（8 路由回归 happy 是第 14 条 BEHAVIOR，round 3 插入 value=-0 spot check 后尾部 +1 偏移）
- 补 R12 引用：`Step 9.5 新增断言` → `BEHAVIOR-11`（value=-0 spot check）；同时保留 BEHAVIOR-2/3/10 引用
- 同步修因 round 3 中段插入 BEHAVIOR-11 导致的尾部 +1 漂移：R1 `BEHAVIOR-11` → `BEHAVIOR-12`、R7 `BEHAVIOR-12` → `BEHAVIOR-13`、R8 `BEHAVIOR-11, BEHAVIOR-12` → `BEHAVIOR-12, BEHAVIOR-13`（reviewer 仅显式点出 R9/R12，但同因漂移需一并对齐，否则 round 5 仍会被打回）

**Round 3 修订要点**（对应 Reviewer round 2 反馈 `risk_registered=4`）:
- 新增 `## Risk Register` 段，显式登记 12 类风险（generator 漂移 / 八进制陷阱 / off-by-one / 精度溢出 / strict-schema 绕过 / query 注入 / 错误体污染 / SSOT drift / 8 路由回归 / 零依赖违约 / 基础设施 P1 B1-B8 终验 / 数字边界），每条带"防御 Step 映射 + DoD 抓手"
- 处理 Reviewer 两条非阻塞 minor note：(a) Step 8/9 加注释申明 cwd 惯例 = repo root；(b) 新增 `value=-0` happy spot check（PRD ASSUMPTION 用 "可选择" 措辞，补上提高完备度）
- 保留 round 2 SSOT 单源结构（`banned-keys.sh`，34 + 10 字段名清单），无字段数变更

**Round 2 修订要点**（对应 Reviewer round 1 反馈 internal_consistency=6，已保留）:
- 新增 `## Stable IDs` 段，把禁用字段名清单单源化到 `sprints/w30-walking-skeleton-p1-v2/banned-keys.sh`
- Step 8 / Step 9 / E2E 脚本 / contract-dod-ws1.md BEHAVIOR-11 / BEHAVIOR-12 一律改成 `source ... && ${BANNED_RESPONSE_KEYS[@]}` / `${BANNED_ERROR_KEYS[@]}` 引用
- 不再有任一处直接粘贴 34 字段名列表（粘贴一处 = SSOT drift 风险）
- Round 1 漏的两个 PRD 字段名（`response`、`out`）按 SSOT 字面补齐到 34（PRD L104）

---

## Stable IDs（SSOT — 禁用字段名单源）

**唯一文本源**: `sprints/w30-walking-skeleton-p1-v2/banned-keys.sh`

该文件定义两个 bash 数组：

| 数组名 | 长度 | 用途 | PRD 来源 |
|---|---|---|---|
| `BANNED_RESPONSE_KEYS` | 34 | 成功响应 body 顶层不许出现的字段名（PR-G 死规则继承） | sprint-prd.md L103-L105（15+10+9 字面照搬） |
| `BANNED_ERROR_KEYS` | 10 | 错误响应 body 顶层不许出现的字段名 | sprint-prd.md L104 错误响应禁用清单 |

**所有验证脚本必须**（不再粘贴 34/10 字段名清单 inline）:

```bash
source sprints/w30-walking-skeleton-p1-v2/banned-keys.sh
# 然后用 "${BANNED_RESPONSE_KEYS[@]}" 或 "${BANNED_ERROR_KEYS[@]}" 引用
```

**SSOT 维护规则**:
- 修改禁用清单 → 只改 `banned-keys.sh` 一处文本源
- 改完一处即"全验证脚本同步生效"（不需要再搜索 4 处 inline 粘贴并改 4 次）
- 任一处 inline 粘贴字段名清单 → 视为 SSOT drift 违约，reviewer 直接 REVISION

---

## Risk Register（v7 round 3 — 对应 Reviewer round 2 `risk_registered=4` 反馈）

> **目的**：显式登记本 sprint 的实现/验收风险，每条标注**触发条件 / 影响面 / 防御机制 / 哪个 Step 抓 / DoD 抓手 / 残留概率**。
> Generator 与 Evaluator 在执行/对抗时优先盯这些登记项；任一漏抓的风险若实证生效 → 视为合同纸老虎，需重开 issue。

| # | 风险 | 触发条件 | 影响 | 防御机制 | 抓手 Step | DoD 抓手 | 残留概率 |
|---|---|---|---|---|---|---|---|
| **R1** | **Generator 字段名漂到禁用同义** | LLM 自由发挥把 `result` 改 `decremented` / `predecessor` / `prev` / `n_minus_one`，或把 `operation: "decrement"` 改 `"dec"` / `"decr"` / `"minus_one"` | PR-G 死规则失效；W30 内容侧验失败 | (a) PRD `## Response Schema` 字面字段名 + (b) Step 1 jq -e 字面值断言 + (c) Step 8 SSOT 34 字段反向断言 | Step 1, Step 8 | ARTIFACT-5 (server.js 含 `operation: 'decrement'` + `result` 字面) + BEHAVIOR-1 + BEHAVIOR-12 | 低（PR-G 死规则 W26 已验证生效，本 sprint round 1→2 SSOT 单源化进一步加固） |
| **R2** | **Generator 八进制陷阱**（`parseInt(value, 8)`） | 看到字符串 `"01"` 错用 `parseInt(value, 8)` → `parseInt("01", 8) === 1`（巧合等于 `Number("01")`），但 `parseInt("09", 8) === 0`（NaN→0）会在 `value=09` 时出错（虽然本 sprint 没显式测 `value=09`，但 generator 漂到 `parseInt(value, 8)` 仍存隐患） | 多数 happy 看似过，特定值假绿；`Number(value)` 才是正解 | Step 7 + Step 9.5 显式 `value=01` / `value=-01` / `value=-0` 三例固化"`Number()` 十进制归一"语义 | Step 7, Step 9.5 | BEHAVIOR-10 | 低 |
| **R3** | **Off-by-one 零边界算错** | LLM 把 `Number(value) - 1` 错写成 `Number(value)` 或 `Number(value) + 1` 或 `-Number(value) - 1`；尤其 `value=0`/`value=1` 边界容易过其他用例但在零点错算 | 多数路径过；零边界假绿 | Step 2 显式 `value=0 → result=-1`、`value=1 → result=0`、`value=-1 → result=-2` 三例 + 单测 off-by-one describe 块 | Step 2 | BEHAVIOR-2, BEHAVIOR-3 | 低 |
| **R4** | **JS Number 精度溢出未拒** | Generator 漏写绝对值上界判定，或写错成 `> Number.MAX_SAFE_INTEGER`（=`9007199254740991`），让 `value=9007199254740991` 漏网；`Number(9007199254740991) - 1 === 9007199254740990` 看似 OK，但 `value=9007199254740992` 时 `Number(value)` 已不精确（IEEE 754 把它解析成 9007199254740992，但实际是 boundary） | 大数 happy 假绿；返回值可能漂移 | (a) PRD 法定上界 `9007199254740990` 不是 MAX_SAFE_INTEGER；(b) Step 3 精度上下界 happy + Step 4 上下界 +1 / -1 / 远超拒；(c) ARTIFACT-4 grep `9007199254740990` 字面值 | Step 3, Step 4 | ARTIFACT-4 + BEHAVIOR-4, BEHAVIOR-5, BEHAVIOR-6, BEHAVIOR-7 | 极低 |
| **R5** | **strict-schema 绕过** | regex 写错（如 `^\d+$` 漏前导负号，或 `^[-+]?\d+$` 错加前导 +，或 `\d+` 不锚定首尾允许 `1.5abc` 部分匹配过） | strict 拒变弱；非法输入回 200 假绿 | Step 5 列 14 个非法输入逐个 400 断言（含 `1.5` / `+5` / `--5` / `5-` / `1e2` / `0xff` / `1,000` / `1 000` / 空串 / `abc` / `Infinity` / `NaN` / `-`） | Step 5 | BEHAVIOR-8 + ARTIFACT-2（grep `^-?\\d+$` 字面 regex） | 低 |
| **R6** | **Query 唯一性漏洞**（多余 key / 错 key 未拒） | Generator 只判 `value` 存在，没用 `Object.keys(req.query).length === 1`；`?value=5&extra=1` 仍返 200 → schema 完整性破坏隐患（PRD 法定多余 key 拒） | Schema 完整性纸老虎；W26 同类 oracle 在 W30 失守 | Step 6 列 4 例（缺/错名 n/错名 a/多余 extra）逐个 400 + ARTIFACT-6 grep `Object.keys(req.query).length === 1` 字面 | Step 6 | BEHAVIOR-9 + ARTIFACT-6 | 低 |
| **R7** | **错误体混合污染** | 400 响应同时含 `error` + `result` / `operation`；或用 `message`/`reason`/`detail` 等替代字段名 | 错误体 schema 不纯；下游消费方解析歧义 | Step 9 SSOT BANNED_ERROR_KEYS 10 字段反向断言 + 错误体 keys=["error"] 完整性断言 | Step 4, Step 9 | BEHAVIOR-6 (`has("result") | not` + `has("operation") | not`) + BEHAVIOR-13 | 低 |
| **R8** | **SSOT drift**（inline 粘贴字段名清单） | LLM 看到 `${BANNED_RESPONSE_KEYS[@]}` 体感"不够直观"，又把 34 字段名 inline 粘贴回脚本一处 → 与 SSOT 文件不同步漂移 | 改一处忘改另一处；reviewer round 2 已抓过 round 1 漏 2 个字段（response, out）的此类问题 | (a) SSOT 唯一源 `banned-keys.sh` + (b) 所有验证脚本一律 `source ... && ${BANNED_..._KEYS[@]}` + (c) ARTIFACT-9 grep `${#BANNED_RESPONSE_KEYS[@]} == 34` 长度断言 | Step 8, Step 9 | ARTIFACT-9 + BEHAVIOR-12, BEHAVIOR-13 | 低（round 2 修复后稳定） |
| **R9** | **8 路由回归破坏** | Generator 改 `/decrement` 时误删/误改 `/health` `/sum` 等已有路由的 handler，或把 strict-schema 常量 share 一份导致 `/increment` 行为漂移 | 已有功能假绿；CI 单测 fail | Step 10 8 路由 happy 各 1 条断言 + 单测文件含 8 路由回归 describe 块 + PRD ASSUMPTION："可同文件复用 STRICT_INT，但路由 handler 内必须独立调一次" | Step 10 | BEHAVIOR-14 + (单测文件回归断言) | 低（W19~W26 实证已有路由保留稳定） |
| **R10** | **零依赖原则破坏** | LLM 自动 import `zod` / `joi` / `ajv` / `bignumber.js` / `big-integer` / `mathjs` 想"更严"地校验；或引入 BigInt 重写"为了大数" | 违反 PRD 范围；引入维护负担 + 包体积 | (a) PRD 范围"不在范围内"段显式禁；(b) ARTIFACT-1~6 全部 grep `playground/server.js` 含特定 pattern，不允许 import 新包；(c) generator 不允许动 `playground/package.json` | (隐式 contract scope) | ARTIFACT-1~6 grep 行为；package.json 不在 task-plan files 列表 | 低 |
| **R11** | **基础设施 P1 B1~B8 终验失效**（reaper 误杀 / 状态不回写 / dispatch_events 缺记 / dispatcher HOL block 等） | W30 harness_initiative 长跑 → 触发任一 P1 修复回归（如 reaper 30→60min 阈值改回去 / harness_* 豁免漏 / reportNode 不写 tasks.status / dispatch_events 写库失败 / dispatcher HOL skip 失效 / slot accounting 漂移 / consciousness loop guidance 无 TTL / fleet heartbeat 假活） | P1 修复未真生效；Walking Skeleton P1 终验失败需重开对应 issue | (a) PRD `## Walking Skeleton P1 终验 round 2：基础设施侧 success criteria` 段 10 项 + (b) 不在本 contract Step 范围内（本 contract 是 W30 内容侧载体），由人工 / 后续巡检脚本验 | (out-of-contract — 基础设施侧观测) | (out-of-contract — 不属代码改动 DoD) | 中（P1 B1~B8 是新合的 fix，本 sprint 是首次终验承压；W29 round 1 已暴露 B8） |
| **R12** | **数字边界异常**（`-0` / 前导 0 / 负号位置） | strict regex 误把 `-0` / `01` / `-01` 拒掉；或 `Number("-0") === -0` 后续算术错走 `Object.is(-0, 0)` 检查 | 边界 happy 假红 | (a) Step 2 含 `-1`；(b) Step 7 含 `01` / `-01`；(c) Step 9.5 含 `-0` happy（round 3 新增） | Step 2, Step 7, Step 9.5 | BEHAVIOR-2, BEHAVIOR-3, BEHAVIOR-10, BEHAVIOR-11 | 低 |

**Risk Register 维护规则**:

1. 任一新发现的实现/验收风险 → 加新行进表，标 `# R{N+1}`，必须填全所有 7 列
2. Generator / Evaluator 实证某风险生效（"我以为防住了但 X 发生了"）→ 该行残留概率 ↑（"低" → "中" → "高"），并在 changelog 记录证据
3. 残留概率"高"且无新防御机制 → 视为合同纸老虎，必须升级到 Reviewer REVISION 流程
4. R11 不属 contract step 范围（基础设施观测）但必须在 register 显式登记，让 Evaluator 知道终验不止"内容侧 vitest 过"

---

## Golden Path

[HTTP 客户端发 `GET /decrement?value=<整数字符串>` 到 playground] → [server 做 query 唯一性 + strict-schema `^-?\d+$` + `|Number(value)| ≤ 9007199254740990` 校验] → [显式拒一切不通过 → 400 `{error:"..."}`；通过则计算 `Number(value)-1`] → [200 `{result:<Number(value)-1>, operation:"decrement"}`，顶层 keys 字面集合 == `["operation","result"]`，不含 `${BANNED_RESPONSE_KEYS[@]}` 任一]

---

### Step 1: 入口 — happy `GET /decrement?value=5` 返 200 + strict-schema response

**可观测行为**: 客户端用合法整数串调用，server 200，返回严 schema response（字面字段名 `result` + `operation`，operation 字面值 `"decrement"`，顶层 keys 恰好两个）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3201 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3201/decrement?value=5")
echo "$RESP" | jq -e '.result == 4' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation == "decrement"' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e '.result | type == "number"' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e '.operation | type == "string"' || { kill $SPID; exit 1; }
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: `result === 4`（独立复算 `5 - 1`）；`operation === "decrement"`（字面字符串严格相等，禁 contains / startsWith）；顶层 keys 字面集合 == `["operation","result"]`（按字母序，集合相等，不允许多余字段）。

---

### Step 2: off-by-one 零边界 — `value=0 → result=-1`、`value=1 → result=0`

**可观测行为**: 减 1 算术在零附近不偏移；`0` 减 1 是 `-1`，`1` 减 1 是 `0`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3202 node server.js & SPID=$!
sleep 2
curl -fs "localhost:3202/decrement?value=0" | jq -e '.result == -1 and .operation == "decrement"' || { kill $SPID; exit 1; }
curl -fs "localhost:3202/decrement?value=1" | jq -e '.result == 0 and .operation == "decrement"' || { kill $SPID; exit 1; }
curl -fs "localhost:3202/decrement?value=-1" | jq -e '.result == -2 and .operation == "decrement"' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: 三条 jq -e 全过；`value=0 → result=-1`、`value=1 → result=0`、`value=-1 → result=-2`，**字面值复算严格相等**。

---

### Step 3: 精度上下界 happy — `value=±9007199254740990` 返精确整数

**可观测行为**: 在 `|value| ≤ 9007199254740990` 范围内，`Number(value)-1` 精确无浮点损失；精度下界 `value=-9007199254740990 → result=-9007199254740991`（恰 === `Number.MIN_SAFE_INTEGER`）。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3203 node server.js & SPID=$!
sleep 2
curl -fs "localhost:3203/decrement?value=9007199254740990" | jq -e '.result == 9007199254740989 and .operation == "decrement"' || { kill $SPID; exit 1; }
curl -fs "localhost:3203/decrement?value=-9007199254740990" | jq -e '.result == -9007199254740991 and .operation == "decrement"' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: 两条 jq -e 全过；精度下界 `result === -9007199254740991`（=== `Number.MIN_SAFE_INTEGER`）。

---

### Step 4: 精度上下界拒 — `|value| > 9007199254740990` 返 400

**可观测行为**: 上界 +1（`9007199254740991`）与下界 -1（`-9007199254740991`）都必须 HTTP 400 + `{error:"..."}`，body 不含 `result` 也不含 `operation`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3204 node server.js & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3204/decrement?value=9007199254740991")
[ "$CODE" = "400" ] || { echo "上界 +1 应 400 实际 $CODE"; kill $SPID; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3204/decrement?value=-9007199254740991")
[ "$CODE" = "400" ] || { echo "下界 -1 应 400 实际 $CODE"; kill $SPID; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3204/decrement?value=99999999999999999999")
[ "$CODE" = "400" ] || { echo "远超上界应 400 实际 $CODE"; kill $SPID; exit 1; }
ERR=$(curl -s "localhost:3204/decrement?value=9007199254740991")
echo "$ERR" | jq -e 'has("result") | not' || { kill $SPID; exit 1; }
echo "$ERR" | jq -e 'has("operation") | not' || { kill $SPID; exit 1; }
echo "$ERR" | jq -e '.error | type == "string" and length > 0' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: 三条上下界拒全 400；错误 body 不含 `result` 也不含 `operation`；`error` 是非空字符串。

---

### Step 5: strict-schema 拒 — 一切不匹配 `^-?\d+$` 的输入返 400

**可观测行为**: 小数 / 前导 + / 双重负号 / 尾部负号 / 科学计数法 / 十六进制 / 千分位 / 空格 / 空串 / 字母串 / Infinity / NaN / 仅负号 全拒。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3205 node server.js & SPID=$!
sleep 2
for INPUT in "1.5" "1.0" "%2B5" "--5" "5-" "1e2" "0xff" "1%2C000" "1%20000" "" "abc" "Infinity" "NaN" "-"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3205/decrement?value=${INPUT}")
  [ "$CODE" = "400" ] || { echo "value=${INPUT} 应 400 实际 ${CODE}"; kill $SPID; exit 1; }
done
kill $SPID
```

**硬阈值**: 14 条非法输入全返 400（`%2B`=`+`，`%2C`=`,`，`%20`=空格，URL 编码以正确传输）。

---

### Step 6: 错 query 名 / 缺 query / 多余 query 返 400（query 唯一性约束）

**可观测行为**: 唯一允许的 query key 是 `value`；缺 / 错名（`n` / `a` / `x`）/ 多余 key 一律 400。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3206 node server.js & SPID=$!
sleep 2
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3206/decrement")
[ "$CODE" = "400" ] || { echo "缺 query 应 400 实际 $CODE"; kill $SPID; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3206/decrement?n=5")
[ "$CODE" = "400" ] || { echo "错 query 名 n 应 400 实际 $CODE"; kill $SPID; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3206/decrement?a=5")
[ "$CODE" = "400" ] || { echo "错 query 名 a 应 400 实际 $CODE"; kill $SPID; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3206/decrement?value=5&extra=1")
[ "$CODE" = "400" ] || { echo "多余 query 应 400 实际 $CODE"; kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: 4 条 query 唯一性违约全返 400。

---

### Step 7: 前导 0 happy `value=01 → result=0`（禁 generator 错用八进制解析）

**可观测行为**: strict-schema `^-?\d+$` 允许前导 0；`Number("01") === 1`（十进制，非八进制）；故 `result === 0`。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3207 node server.js & SPID=$!
sleep 2
curl -fs "localhost:3207/decrement?value=01" | jq -e '.result == 0 and .operation == "decrement"' || { kill $SPID; exit 1; }
curl -fs "localhost:3207/decrement?value=-01" | jq -e '.result == -2 and .operation == "decrement"' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: `value=01 → result=0`、`value=-01 → result=-2`（**禁 generator 错用 `parseInt(value, 8)` 八进制；`Number()` 自动十进制归一化**）。

---

### Step 8: 禁用字段名反向 — response 严禁出现 `${BANNED_RESPONSE_KEYS[@]}` 任一（SSOT 引用，不 inline 粘贴）

**可观测行为**: PR-G 死规则继承——response 顶层不能含任一禁用字段名。禁用清单 SSOT 单源在 `sprints/w30-walking-skeleton-p1-v2/banned-keys.sh::BANNED_RESPONSE_KEYS`（34 个；逐项字面照搬 PRD L103-L105）。

**验证命令**（脚本 source SSOT，不再 inline 粘贴 34 字段名）:
```bash
# Note: cwd 假定 = repo root（contract 验证命令惯例，evaluator 默认在此），故 `source sprints/...` 路径用相对路径即可。
# 若 evaluator 实现把 cwd 切走，应在外层包 `cd $(git rev-parse --show-toplevel)`（E2E 脚本已这么写）。
# 关键陷阱：source 必须在 `&` 之前用 `;` 隔离（不要用 `&&`），否则整个 `&&` 链会进入背景子 shell，
# source 不会作用到父 shell，BANNED_RESPONSE_KEYS 在父 shell 为空，for 循环零次迭代，假绿。
source sprints/w30-walking-skeleton-p1-v2/banned-keys.sh
cd playground && PLAYGROUND_PORT=3208 node server.js & SPID=$!
sleep 2
RESP=$(curl -fs "localhost:3208/decrement?value=5")
for BANNED in "${BANNED_RESPONSE_KEYS[@]}"; do
  echo "$RESP" | jq -e "has(\"${BANNED}\") | not" >/dev/null \
    || { echo "FAIL: 禁用字段 ${BANNED} 出现在 /decrement 响应"; kill $SPID; exit 1; }
done
echo "✅ ${#BANNED_RESPONSE_KEYS[@]} 个禁用字段全部反向断言通过"
kill $SPID
```

**硬阈值**: SSOT 中 `${#BANNED_RESPONSE_KEYS[@]}` 个禁用字段名 `jq has() | not` 反向断言全过（当前 SSOT 长度 = 34，按 PRD L103-L105 字面对齐：15 首要 + 10 泛 generic + 9 endpoint 复用）。当 SSOT 文件长度变化时，本 Step 自动用新长度，不需要改本 Step 的脚本一字符。

---

### Step 9: error body schema 完整性 — 错误响应 keys 恰好 `["error"]`，不含 `${BANNED_ERROR_KEYS[@]}` 任一

**可观测行为**: 任一 400 错误响应顶层 keys 严格等于 `["error"]`；错误体不含 `${BANNED_ERROR_KEYS[@]}` 中任一字段（包括 `result`/`operation` 防混合污染，以及 `message`/`msg`/`reason`/`detail` 等替代字段名禁用）。

**验证命令**（脚本 source SSOT，不再 inline 粘贴 10 字段名）:
```bash
# Note: cwd 假定 = repo root，与 Step 8 同（contract 验证惯例）。
source sprints/w30-walking-skeleton-p1-v2/banned-keys.sh
cd playground && PLAYGROUND_PORT=3209 node server.js & SPID=$!
sleep 2
ERR=$(curl -s "localhost:3209/decrement?value=abc")
echo "$ERR" | jq -e 'keys | sort == ["error"]' || { kill $SPID; exit 1; }
echo "$ERR" | jq -e '.error | type == "string" and length > 0' || { kill $SPID; exit 1; }
for BANNED in "${BANNED_ERROR_KEYS[@]}"; do
  echo "$ERR" | jq -e "has(\"${BANNED}\") | not" >/dev/null \
    || { echo "FAIL: 错误响应含禁用字段 ${BANNED}"; kill $SPID; exit 1; }
done
echo "✅ 错误体 keys=[error] + ${#BANNED_ERROR_KEYS[@]} 个错误响应禁用字段反向断言全过"
kill $SPID
```

**硬阈值**: 错误体顶层 keys 字面 `["error"]`，`error` 是非空字符串，不含 SSOT `${BANNED_ERROR_KEYS[@]}` 任一（当前长度 10）。

---

### Step 9.5: `value=-0` happy spot check（PRD ASSUMPTION 可选择项，round 3 补完备度）

**可观测行为**: PRD ASSUMPTION 段写 "`value=-0` strict 合法且 `Number('-0') - 1 === -1`，可选择把此用例放进 happy 分支"。round 3 选择放入，挡 generator 把 `^-?\d+$` regex 改成 `^(0|-?[1-9]\d*)$`（错把"-0"判 strict 拒）的实现漂移。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3295 node server.js & SPID=$!
sleep 2
curl -fs "localhost:3295/decrement?value=-0" | jq -e '.result == -1 and .operation == "decrement"' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: `value=-0 → result=-1`（strict 接受 `-0` 字符串；`Number("-0") === -0`；`-0 - 1 === -1`）。

---

### Step 10: 已有 8 路由回归 happy（`/health` `/sum` `/multiply` `/divide` `/power` `/modulo` `/factorial` `/increment`）

**可观测行为**: 加 `/decrement` 不破坏已有 8 路由任一行为。

**验证命令**:
```bash
cd playground && PLAYGROUND_PORT=3210 node server.js & SPID=$!
sleep 2
curl -fs "localhost:3210/health" | jq -e '.ok == true' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/sum?a=2&b=3" | jq -e '.sum == 5' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/multiply?a=7&b=5" | jq -e '.product == 35' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/divide?a=10&b=2" | jq -e '.quotient == 5' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/power?a=2&b=3" | jq -e '.power == 8' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/modulo?a=10&b=3" | jq -e '.remainder == 1' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/factorial?n=5" | jq -e '.factorial == 120' || { kill $SPID; exit 1; }
curl -fs "localhost:3210/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' || { kill $SPID; exit 1; }
kill $SPID
```

**硬阈值**: 8 条已有路由 happy 全过；`/increment` 仍返 `{result, operation:"increment"}` 字段名不变。

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: autonomous

**完整验证脚本** (`scripts/golden-path-w30.sh`):

```bash
#!/bin/bash
set -e
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
# 引用 SSOT 单源禁用清单 — 本 E2E 脚本不 inline 粘贴 34/10 字段名
source "$ROOT/sprints/w30-walking-skeleton-p1-v2/banned-keys.sh"

cd "$ROOT/playground"
PLAYGROUND_PORT=3299 node server.js &
SPID=$!
trap "kill $SPID 2>/dev/null" EXIT
sleep 2

# 1. happy
RESP=$(curl -fs "localhost:3299/decrement?value=5")
echo "$RESP" | jq -e '.result == 4' >/dev/null
echo "$RESP" | jq -e '.operation == "decrement"' >/dev/null
echo "$RESP" | jq -e 'keys | sort == ["operation","result"]' >/dev/null

# 2. off-by-one
curl -fs "localhost:3299/decrement?value=0" | jq -e '.result == -1' >/dev/null
curl -fs "localhost:3299/decrement?value=1" | jq -e '.result == 0' >/dev/null
curl -fs "localhost:3299/decrement?value=-1" | jq -e '.result == -2' >/dev/null

# 3. precision boundary happy
curl -fs "localhost:3299/decrement?value=9007199254740990" | jq -e '.result == 9007199254740989' >/dev/null
curl -fs "localhost:3299/decrement?value=-9007199254740990" | jq -e '.result == -9007199254740991' >/dev/null

# 4. precision boundary reject
for V in "9007199254740991" "-9007199254740991" "99999999999999999999"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3299/decrement?value=${V}")
  [ "$CODE" = "400" ] || { echo "FAIL: value=${V} 应 400 实际 ${CODE}"; exit 1; }
done

# 5. strict-schema rejects
for INPUT in "1.5" "1.0" "%2B5" "--5" "5-" "1e2" "0xff" "1%2C000" "" "abc" "Infinity" "NaN" "-"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3299/decrement?value=${INPUT}")
  [ "$CODE" = "400" ] || { echo "FAIL: value=${INPUT} 应 400 实际 ${CODE}"; exit 1; }
done

# 6. query uniqueness
for Q in "" "?n=5" "?a=5" "?value=5&extra=1"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "localhost:3299/decrement${Q}")
  [ "$CODE" = "400" ] || { echo "FAIL: /decrement${Q} 应 400 实际 ${CODE}"; exit 1; }
done

# 7. leading zero happy (not octal) + value=-0 (round 3 risk R12 spot check)
curl -fs "localhost:3299/decrement?value=01" | jq -e '.result == 0' >/dev/null
curl -fs "localhost:3299/decrement?value=-01" | jq -e '.result == -2' >/dev/null
curl -fs "localhost:3299/decrement?value=-0" | jq -e '.result == -1 and .operation == "decrement"' >/dev/null

# 8. banned response field names — 引用 SSOT BANNED_RESPONSE_KEYS（不 inline 粘贴）
RESP=$(curl -fs "localhost:3299/decrement?value=5")
for BANNED in "${BANNED_RESPONSE_KEYS[@]}"; do
  echo "$RESP" | jq -e "has(\"${BANNED}\") | not" >/dev/null \
    || { echo "FAIL: 禁用字段 ${BANNED} 出现"; exit 1; }
done
echo "  → ${#BANNED_RESPONSE_KEYS[@]} 个 response 禁用字段反向断言全过"

# 9. error body purity — 引用 SSOT BANNED_ERROR_KEYS（不 inline 粘贴）
ERR=$(curl -s "localhost:3299/decrement?value=abc")
echo "$ERR" | jq -e 'keys | sort == ["error"]' >/dev/null
echo "$ERR" | jq -e '.error | type == "string" and length > 0' >/dev/null
for BANNED in "${BANNED_ERROR_KEYS[@]}"; do
  echo "$ERR" | jq -e "has(\"${BANNED}\") | not" >/dev/null \
    || { echo "FAIL: 错误体含禁用字段 ${BANNED}"; exit 1; }
done
echo "  → ${#BANNED_ERROR_KEYS[@]} 个 error 禁用字段反向断言全过"

# 10. regression 8 routes
curl -fs "localhost:3299/health" | jq -e '.ok == true' >/dev/null
curl -fs "localhost:3299/sum?a=2&b=3" | jq -e '.sum == 5' >/dev/null
curl -fs "localhost:3299/multiply?a=7&b=5" | jq -e '.product == 35' >/dev/null
curl -fs "localhost:3299/divide?a=10&b=2" | jq -e '.quotient == 5' >/dev/null
curl -fs "localhost:3299/power?a=2&b=3" | jq -e '.power == 8' >/dev/null
curl -fs "localhost:3299/modulo?a=10&b=3" | jq -e '.remainder == 1' >/dev/null
curl -fs "localhost:3299/factorial?n=5" | jq -e '.factorial == 120' >/dev/null
curl -fs "localhost:3299/increment?value=5" | jq -e '.result == 6 and .operation == "increment"' >/dev/null

echo "✅ W30 Golden Path 验证通过（10 段 + SSOT 引用零 inline 粘贴）"
```

**通过标准**: 脚本 exit 0。

---

## Workstreams

workstream_count: 1

### Workstream 1: playground 加 GET /decrement 路由 + 单测 + README

**范围**: 仅动 `playground/server.js`（加 `/decrement` 路由，≈12-15 行）、`playground/tests/server.test.js`（加 `GET /decrement` describe 块，≈80-100 行单测）、`playground/README.md`（加 `/decrement` 段，6+ 示例）。**不动** brain / engine / dashboard / apps / packages 任何代码；**不动** `/health` `/sum` `/multiply` `/divide` `/power` `/modulo` `/factorial` `/increment` 八条已有路由一个字符；**不引入新依赖**（保持零依赖）。

**大小**: M（≈100-200 行新增）

**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/decrement.test.js`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/decrement.test.js` | value=5 → 200, value=0 → 200 + result=-1, value=1 → 200 + result=0, value=-1 → 200 + result=-2, 上界 happy, 下界 happy, 上界 +1 拒, 下界 -1 拒, 远超上界, 缺 value 参数, 错 query 名 n, 多余 query, value=01 → 200 + result=0, value=-0 → 200 + result=-1, 顶层 keys 字面集合, operation 字面字符串严格等于, 响应不含任一禁用字段, 错误体 keys 字面, 错误体不含 message, {ok:true}, {sum:5}, {product:35}, {quotient:5}, {power:8}, {remainder:1}, {factorial:120}, {result:6 | 当前 server.js 无 `/decrement` 路由 → 所有 happy 与 strict 用例 404 → vitest FAIL |

---

## PR-G 死规则继承（v7.5 — Bug 8 修复）

本合同 **字面照搬** PRD `## Response Schema` 段（不许"语义化优化"）:

| 元素 | PRD 法定 | 合同字面 |
|---|---|---|
| query param 名 | `value` | `value` |
| 成功 response keys 集合 | `["operation","result"]` | `["operation","result"]` |
| `result` 字段类型 | `number` | `number` |
| `operation` 字段字面值 | `"decrement"` | `"decrement"` |
| 错误 response keys 集合 | `["error"]` | `["error"]` |
| 禁用响应字段名 | 见 PRD L103-L105（34 个；首要 15 + 泛 generic 10 + endpoint 复用 9）| 全部 SSOT 化到 `sprints/w30-walking-skeleton-p1-v2/banned-keys.sh::BANNED_RESPONSE_KEYS`，下游 4 处验证脚本一律 `source ... && ${BANNED_RESPONSE_KEYS[@]}` 引用 |

**自查通过证据**:
1. `bash -c 'source sprints/w30-walking-skeleton-p1-v2/banned-keys.sh && echo "${#BANNED_RESPONSE_KEYS[@]}"'` 输出 `34`（与 PRD L103-L105 字面对齐）
2. `bash -c 'source sprints/w30-walking-skeleton-p1-v2/banned-keys.sh && echo "${#BANNED_ERROR_KEYS[@]}"'` 输出 `10`
3. Contract response keys ⊆ PRD 允许列表（`result`, `operation`, `error`）；PRD 禁用清单字段名仅出现在 SSOT 文件与反向 `! has(...)` 断言里，**绝不在**正向 jq -e 命令出现
4. Contract / DoD 文件 grep 不到任一处 inline 粘贴的 34/10 字段名列表（粘贴 = SSOT 违约）

**SSOT 单源化的好处**:
- 修改禁用清单 → 改一处（`banned-keys.sh`）即可，无需搜索 4 处 inline 粘贴并改 4 次
- 内部一致性 100%：4 处验证脚本永远引用同一份字段名集合
- 漏字段（如 round 1 漏 `response`、`out` 共 2 个）问题在 SSOT 层一改全到位
