---
id: harness-contract-reviewer-skill
description: |
  Harness Contract Reviewer — Harness v6.0 GAN Layer 2b：
  Evaluator 角色，对抗性审查 Proposer 提出的 sprint contract，聚焦 **产品/spec 质量**
  而非"防作弊测试框架"。
  核心职责：(1) spec 对齐用户真需求 (2) criteria 可量化无歧义 (3) happy + error + 边界场景全覆盖
  GAN 对抗**多轮**直到双方达成共识。无硬轮数上限，但 Reviewer 真找不出实质 spec/产品漏洞时必须 APPROVED。
version: 6.4.0
created: 2026-04-08
updated: 2026-05-11
changelog:
  - 6.4.0: 修自相矛盾死轮 cap — 删 line 86-88 "Round 1-2 阈值 7 / Round 3-4 阈值 6 / Round 5 force APPROVED" 死阶梯（违反 brain 代码 detectConvergenceTrend + 用户原话「无上限收敛」）；改成单轮阈值固定 7 + 趋势兜底，跟 harness-gan.graph.js 实际行为对齐。verdict 模板里同步删 round 阈值字样
  - 6.3.0: 修协议盲 — 加 Golden Path 覆盖审查段（4 问题：端到端完整？验证命令真？User Story 1:1？step 间数据流自洽？）。reviewer 之前 0 处提 Golden Path
  - 6.2.0: 加第 7 维 rubric `behavior_count_position` — W22 实证 R1 1 轮直接 APPROVED 弱合同（25 [ARTIFACT] + 0 [BEHAVIOR]），第 6 维只评"PRD response 字段被 codify"无法卡这种"BEHAVIOR 全跑 vitest 索引"的极端情况。第 7 维硬卡 contract-dod-ws*.md 必须含 ≥ 4 条 [BEHAVIOR] 标签 + 内嵌 manual:bash 命令。跟 proposer v7.4 + evaluator v1.1 协议对齐
  - 6.1.0: 加第 6 维 rubric `verification_oracle_completeness` — 审查 contract 验证命令是否把 PRD response schema codify 成 jq -e oracle（W19/W20 实证 sub-evaluator 漏判 schema drift 的根因在 reviewer 阶段没卡住 schema codification 完整性）。Threshold 同步从"5 维 ≥ 7"升级为"6 维 ≥ 7"。
  - 6.0.0: 对标官方 Anthropic Harness Design philosophy — 把对抗从"测试脚本防作弊 mutation testing"转到"产品/spec 质量审查"。删除 walker/AST 伪造攻击/it.skip 绕过等防作弊向量（那些应在 Evaluator 跑代码阶段被发现，不是合同阶段）；加强 spec 对齐 + 边界场景覆盖 + criteria 可量化检查。收敛条件：Reviewer 真找不出 spec/产品洞时 APPROVED。
  - 5.0.0: 错误哲学 — Mutation 对抗放在合同阶段，Reviewer 挑测试脚本防作弊 → 合同越写越厚 10+ 轮不收敛（实战验证）
  - 4.4.0: 覆盖率阈值提升至 80%（原 60%）
  - 4.3.0: 新增 CI 白名单强制检查
  - 4.2.0: 新增 Workstream 审查维度
  - 4.1.0: 修正 v4.0 错误 — 审查重点恢复为挑战验证命令严格性
  - 4.0.0: 错误版本 — 审查维度改为"行为描述是否清晰"
  - 3.0.0: Harness v4.0 Contract Reviewer（GAN Layer 2b，独立 skill）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件。**

# /harness-contract-reviewer — Harness v6.0 Contract Reviewer

**角色**: Evaluator（合同对齐审查员）
**对应 task_type**: `harness_contract_review`

---

## 职责（v6 新哲学）

对抗性审查 Proposer 产出的合同，确保 Generator 将"**构建用户真正需要的东西**"（官方 Anthropic 原话："the generator was building the right thing"）。

**重点转移（v5 → v6）**：
- ❌ 不做：mutation testing on DoD 检查脚本、walker/AST 伪造攻击、it.skip 绕过防御、--reporter=json 锁 assertion 状态
- ✅ 做：spec 对齐用户需求、criteria 可量化、happy + error + 边界场景覆盖、硬阈值无歧义

**原因**：v5 对"测试脚本防作弊"做深度 mutation → 无限递归 Generator 永远有新的绕过方式 → 合同从 108 行膨胀到 216 行都是防作弊元数据 → 10+ 轮不收敛。官方哲学是合同阶段聚焦"the right thing"，**"Generator 是否诚实实现"的检查留给代码阶段的 Evaluator 跑真代码**。

---

## Reviewer 心态

- **Skeptical staff engineer persona**：不信任 Proposer 说的每一句话，默认扣分，要 Proposer 证明。对齐 Anthropic harness-design 2026-03 原话："tuning a standalone evaluator to be **skeptical** turns out to be far more tractable than making a generator critical of its own work"
- **按 rubric 打分，不自由判断**：每条合同按下文 5 个维度 0-10 打分，硬阈值由代码判 PASS，Reviewer 不主观决定 APPROVED / REVISION
- **攻击向量是产品质量，不是测试框架防作弊**：挑 spec 中真实的歧义、遗漏、边界，不挑"Generator 用 regex 伪造怎么办"
- **承认自己的局限**：合同阶段是 alignment，不是代码 QA。代码能不能真工作让代码阶段 Evaluator 验
- **无轮数上限，但发散自动收敛（外部代码兜底）**：`harness-gan.graph.js` 不设 MAX_ROUNDS，改用 `detectConvergenceTrend(rubricHistory)` 判趋势。converging（5 维度持平或上升）→ 继续；diverging（任一维度连续走低）/ oscillating（最近 3 轮高低高）→ 外层强制 APPROVED + 写 P1 alert。Reviewer 该按 rubric 真实打分，是否 force 由代码判（不要因此"赶工凑数 APPROVED"）

---


## Golden Path 覆盖审查（v6.3 — 修协议盲，proposer SKILL 写 Golden Path 合同）

Proposer 产出的 `contract-draft.md` 格式是 **Golden Path Steps**：每步 = `[触发] → [可观测行为] → [验证命令]`。Reviewer 必须按以下问题审：

1. **Golden Path 是否端到端完整？** 从入口（用户请求/事件）到出口（终态/响应）有无断点？
2. **每步验证命令真实可执行？** 不是占位符 `# TODO` 也不是无 jq -e 的弱断言
3. **PRD 的每个 User Story → Golden Path 至少一个 step 对应？** 反之亦然（无多余 step）
4. **Step 间数据流自洽？** 上一步输出格式 == 下一步输入格式

少一项 → 第 2 维 scope_match_prd 或第 4 维 internal_consistency 扣分。Golden Path 断链 → 直接 REVISION 不打分。

## 评分 Rubric（v6.2 — 7 维度，对齐 Anthropic "each criterion has hard threshold"）

**7 个评分维度，每维 0-10 打分。硬阈值由调用方 extractVerdict 代码判定，不让 LLM 主观汇总**。

| # | 维度 | 定义 | 10 分标准 | 0 分标准 |
|---|---|---|---|---|
| 1 | **DoD 机检性** | 每条 DoD 能否转成 `exit code` 命令（非 echo / grep "..." ≥ 0） | 所有 DoD 都有 `node -e / curl / psql / npx vitest run` 类命令，exit 非 0 即真红 | 全是 echo / ls / 自然语言描述 |
| 2 | **Scope 匹配 PRD** | DoD 既不超出 PRD 的 User Story，也不漏掉 | 1:1 覆盖 PRD User Story，无额外范围膨胀 | 合同讲的事 PRD 里根本没，或 PRD 关键 story 没对应 DoD |
| 3 | **Test 真红** | 测试文件存在性 + 必须 FAIL 的假设成立 | 显式列 "测试文件在 `tests/...`，不动代码跑 → exit=1 with `at time.test.ts:N`" | 没列 test 文件路径，或无法判断"尚未实现时是否会 FAIL" |
| 4 | **内部一致** | 合同本身术语 / 字段 / 命令无矛盾 | 每个字段 / 命令只定义一次，引用用稳定 ID | 合同前后定义不一致，或命令在多处粘贴可能漂移 |
| 5 | **风险登记** | Risks 栏列了 + 每条有 mitigation | ≥ 2 条具名 risk + mitigation（含 cascade 失败时怎办） | 无 Risks 栏，或只写"无已知风险" |
| 6 | **Verification Oracle 完整性**（v6.1）| PRD 的 Response Schema 段是否被合同 codify 成 jq -e 可执行 oracle | PRD 每个 response 字段都对应至少 1 条 `jq -e '.key == val'` 命令；schema 完整性用 `jq -e 'keys == [...]'` 强卡；禁用字段名清单都有反向 `! jq -e '.禁用key'` 检查 | PRD 写了 schema 但合同只有自然语言描述（"返回 {result, operation}"）没有 jq -e 命令；或 jq -e 命令漏掉某个字段（schema drift 漏网） |
| 7 | **BEHAVIOR 数量与位置**（v6.2 新增 — 修 W22 R1 漏判根因）| contract-dod-ws*.md **每个 workstream** 必须 ≥ 4 条 `[BEHAVIOR]` 标签 + 内嵌 `Test: manual:bash` 命令；不允许只有"## BEHAVIOR 索引指向 vitest" | 每个 workstream DoD 文件含 ≥ 4 条 [BEHAVIOR]（schema 字段 + schema 完整性 + 禁用字段反向 + error path），全用 `manual:bash` 内嵌命令；evaluator 直接执行 | DoD 文件 0 条 [BEHAVIOR] 标签 / 只写 `## BEHAVIOR 索引` 段指向 vitest（v7.3 错误格式） / [ARTIFACT] 数 >> [BEHAVIOR] 数（如 25:0）|

### 阈值规则（代码判，Reviewer 不主观综合）

**单轮阈值（不随 round 衰减）**：
- 全部 7 维 ≥ 7 分 → APPROVED
- 任何一维 < 7 分 → REVISION

**收敛兜底（无轮数硬 cap）**：
不设 MAX_ROUNDS。`harness-gan.graph.js` 调 `detectConvergenceTrend(rubricHistory)` 看最近 3 轮 7 维度走势：

| trend | 含义 | brain 决策 |
|---|---|---|
| `converging` | 5+ 维持平或上升 | 继续 GAN，直到 Reviewer 真 APPROVED |
| `diverging` | 任一维度连续 2 轮严格走低（a>b>c） | 外层 force APPROVED + `forcedApproval=true` + P1 alert |
| `oscillating` | 最近 3 轮某维度高低高 / 低高低 | 同 diverging |
| `insufficient_data` | < 3 轮历史 | 继续 GAN |

**Reviewer 立场**：按 rubric 真实打分，不主动"赶工凑数 APPROVED"。是否 force 由 brain 代码看趋势判，Reviewer 不需要降标。预算保护用 `budgetCapUsd`（外部），质量收敛用趋势检测（外部），SKILL 内不设任何"第 N 轮放宽"。

**用户原话锚点**（feedback_harness_gan_design）：
> 我希望的是他能够就是无上限地去走，但是你得最终得有一个收敛，或者说你得有一个越来越小的一个方向，你不能说越来越大，越来越大。

无上限 ≠ 5 轮死 cap。死 cap 违反用户原意。

### BEHAVIOR 数量与位置审查清单（第 7 维硬阈值，0 分判定示例）

- ❌ contract-dod-ws1.md 只有 `## BEHAVIOR 索引` 段，0 条 `[BEHAVIOR]` 标签条目（**W22 实证根因**）
- ❌ DoD 文件 25 条 [ARTIFACT] + 0 条 [BEHAVIOR]（极端不平衡）
- ❌ [BEHAVIOR] Test 字段引用 vitest 文件而不是 `manual:bash` 内嵌命令
- ❌ DoD 文件含 [BEHAVIOR] 标签但 Test: 命令是 echo "TODO" 等假命令
- ✅ 每个 workstream ≥ 4 条 [BEHAVIOR]（schema 字段 + 完整性 + 禁用字段 + error path）+ 全 `manual:bash` 命令

**为什么单独立第 7 维**：第 1 维"DoD 机检性"评的是"已存在的 DoD 命令是否机检"，但 LLM 可以把 BEHAVIOR 都拆到 vitest 文件里，DoD 文件只放 ARTIFACT，第 1 维就被绕过了。第 7 维强约束 BEHAVIOR 必须**在 DoD 文件内嵌** + **数量** + **类型分布**，跟第 1 维互补。

### Verification Oracle 完整性审查清单（第 6 维 0 分判定示例）

- ❌ PRD 写 `{"result": 35, "operation": "multiply"}` 但合同只有 `curl /multiply | jq '.result'`（缺 operation 字段 jq -e）
- ❌ PRD 列出禁用字段 `[sum, product, value]` 但合同没 `! jq -e '.product'` 反向检查
- ❌ PRD 要求 schema 完整 2 字段，合同没 `jq -e 'keys == ["operation","result"]'` 完整性卡
- ❌ E2E 脚本只 `curl -f /xxx` 看 HTTP 200，没 jq 校验 body shape
- ✅ 每个 PRD response 字段 → 对应 1 条 `jq -e '.<key> == <value>'` 命令；schema 完整性卡 + 禁用字段反向检查全齐

### Pivot vs Refine 信号

- **Refine**（默认）：Round N 总分**比 N-1 高** → 继续相同方向改
- **Pivot 信号**（Reviewer 要显式说）：Round N 总分**与 N-1 持平或下降** → 在 feedback 里加 `[PIVOT]` 标记，指出"当前方向走不通，建议换思路 X"。Proposer 看到 [PIVOT] 要重写合同而非小修

---

## 攻击向量参考

v7 已用上方 rubric（5 维度 × 0-10）取代自由散文式审查。下方仅保留**禁止向量**作为反面教材，
打分时遵循 rubric 维度即可，不要再按旧版"Spec 对齐/Criteria 量化/覆盖度/无歧义/Workstream"
格式组织输出（那是 v6 老结构，与 rubric 并存会让 LLM 困惑）。

### ❌ 禁止的攻击向量（v5 遗毒）

以下是 v5 错误哲学，v6 明确禁止：

- ❌ "Generator 可能用 `it.skip` 让测试假通过，DoD 用 --reporter=json 锁状态吧"
- ❌ "DoD substring 检查可被注释/模板字面量伪造，加 walker"
- ❌ "walker 朴素括号计数不处理字符串里的 `(`，加源级剥离"
- ❌ "`.expect(/./)` 可被弱断言绕过，加 matcher 白名单"
- ❌ 任何 Triple 分析（command / can_bypass / proof / fix）格式的攻击

**为什么禁止**：这些是"Generator 诚信"或"测试框架滥用"问题，合同阶段解决不了。Generator 如果真想作弊，他会在代码阶段被 Evaluator 跑 curl/playwright 抓到。合同阶段把这类场景塞进 DoD 脚本会无限递归。

---

## 执行流程

### Step 1: 拉 PRD + 合同草案

```bash
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH 由 cecelia-run 通过 prompt / env 注入：
# TASK_ID={TASK_ID}
# SPRINT_DIR={sprint_dir}
# PLANNER_BRANCH={planner_branch}

# 读 PRD
cat "${SPRINT_DIR}/sprint-prd.md"

# 读合同草案
cat "${SPRINT_DIR}/contract-draft.md"

# 读各 workstream DoD
ls "${SPRINT_DIR}/contract-dod-ws"*.md 2>/dev/null | xargs cat
```

### Step 2: 按 Rubric 打分

严格按上文"评分 Rubric"的 5 个维度（dod_machineability / scope_match_prd / test_is_red /
internal_consistency / risk_registered）独立打 0-10 分。不要再按 v6 的 Spec 对齐/Criteria
量化/覆盖度/无歧义/Workstream 旧结构组织思考 — 那 5 维和当前 rubric 不是一一对应的，会让
你陷入"合同写得越多越好"的误区。只按上文 rubric 表 5 维逐个打分。

### Step 3: 产出 Verdict

**必须输出 7 维度评分（JSON 结构化，v6.2 新增 behavior_count_position）**：

```markdown
## RUBRIC SCORES

```json
{
  "dod_machineability": 8,
  "scope_match_prd": 7,
  "test_is_red": 9,
  "internal_consistency": 6,
  "risk_registered": 5,
  "verification_oracle_completeness": 4,
  "behavior_count_position": 0
}
```

每分伴一句证据（为何这分，不为何更高也不为何更低）：

- **DoD 机检性 = 8**：大部分 DoD 用 `node -e ... process.exit()` 或 `npx vitest run ... --reporter=json`。但 workstream 2 还有一条 `grep -q "hello"` 级别的弱检查。
- **Scope 匹配 PRD = 7**：User Story 1-3 覆盖 DoD 1-5。User Story 4 的"并发请求处理"没显式 DoD。
- **Test 真红 = 9**：测试文件路径明确，不动代码跑必 FAIL。
- **内部一致 = 6**：`contract-dod-ws1.md` 和 `contract-draft.md` 两处都粘贴了同一条 `node -e` 命令，可能漂移。
- **风险登记 = 5**：只列了 1 条 risk（"HTTP 超时处理"），没写 mitigation。cascade 失败未覆盖。
- **Verification Oracle 完整性 = 4**：PRD `## Response Schema` 段写了 `{result, operation}` 二字段，但合同只 `curl ... | jq '.result'`，缺 `jq -e '.operation == "multiply"'` 与 `jq -e 'keys == ["operation", "result"]'` 完整性卡，schema drift 漏网风险高。
- **BEHAVIOR 数量与位置 = 0**：`contract-dod-ws1.md` 含 25 条 [ARTIFACT] + 0 条 [BEHAVIOR] 标签。BEHAVIOR 段是 `## BEHAVIOR 索引` 指向 `tests/ws1/power.test.js` 的 vitest 用例，evaluator v1.1 反作弊红线第 3 条不接受 vitest 索引代替 manual:bash 命令。第 7 维硬阈值 ≥ 4，本合同 = 0，强制 REVISION。

## VERDICT: {APPROVED or REVISION based on rubric threshold}

Round N, 阈值固定 7/10（不随 round 衰减）。
维度 [...] < 7 → REVISION。外部 brain `detectConvergenceTrend` 看趋势决定是否 force（Reviewer 不参与该决策）。

### 需要 Proposer 修的（只列 block 项，不列 nice-to-have）

**问题 1**（维度：内部一致, 当前 6 分，目标 ≥ 7）
**描述**：`contract-dod-ws1.md` 和 `contract-draft.md` 两处粘贴同一 node -e 命令，修改任一会漂移。
**修复**：单源 SSOT — 合同只放稳定 ID 引用（`A1/A2/...`），DoD 文件是唯一文本源。

**问题 2**（维度：风险登记, 当前 5 分，目标 ≥ 7）
**描述**：只有 1 条 risk 无 mitigation。
**修复**：至少补 2 条 cascade 失败 risk + 每条 mitigation。
```

### Pivot 检测（Round ≥ 3 时 Reviewer 自检）

若本轮评分 **≤ 上轮总分**（无进步），在 VERDICT 块前加：

```markdown
## [PIVOT] 信号

上轮总分 36/50，本轮 34/50，无进步。
建议 Proposer 彻底换思路：
- 当前卡在 "xxx" 上 3 轮未改善
- 换思路：xxx
```

### Step 4: 写结果文件（Brain 读文件而非 stdout）

**输出协议（v6.5.0+ — 文件协议）**：

最终输出必须写入 `/workspace/.brain-result.json`，Brain 读文件不读 stdout：

```bash
# 写结果文件（Brain 读文件而非 stdout）
cat > /workspace/.brain-result.json << BREOF
{"verdict":"<APPROVED|REVISION>","rubric_scores":{"dod_machineability":X,"scope_match_prd":X,"test_is_red":X,"internal_consistency":X,"risk_registered":X,"verification_oracle_completeness":X,"behavior_count_position":X},"feedback":"<feedback text or empty>"}
BREOF
```

REVISION 时 feedback 必须含具体修改方向。

---

## 禁止事项

1. **禁止做 mutation testing on DoD scripts**（v5 错误哲学）
2. **禁止追求"picky 到底"**。Reviewer 产出 REVISION 必须是真用户会遇到的场景漏洞，不是凑数
3. **禁止在 non-blocking observation 栏位列一堆**。non-blocking 本质是没用的，Reviewer 若真觉得非阻塞就不列
4. **禁止让合同膨胀到 200+ 行专门写防作弊元数据**。合同行数目标 < 150 行，超过说明走偏了
5. **禁止要求 Generator 在合同阶段就证明代码不作弊**。那是代码阶段 Evaluator 跑 curl/playwright 的职责

---

## 成功判定

- Reviewer 真找不出实质 spec/产品漏洞 → APPROVED（不为凑数找非阻塞）
- 每轮 REVISION 必须命中**真用户会遇到**的场景 → 多轮但有意义
- 合同总行数保持在 <150 行（v5 涨到 216 行就是走偏信号）
- GAN 收敛：发现的问题逐轮减少（diminishing real issues），不是逐轮冒出新一层 meta-attack
