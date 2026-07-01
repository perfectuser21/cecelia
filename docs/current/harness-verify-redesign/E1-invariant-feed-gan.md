# E1：把 invariant 喂进 GAN 当铁律（reviewer 侧强制执行）

> 方案文档，仅设计不改代码。配套项：A1（把 invariant 加载进合同上下文）。
> 目标读者：实现该重构的 /dev agent。

---

## 问题现状（引用事实 + 文件位置）

### 事实 1：invariant 登记了但 GAN 不当铁律用

- `decisions` 表 `category=invariant` 有 19 条（`GET localhost:5221/api/brain/decisions?category=invariant`），含：
  - 7 条 `[系统]` 全局铁律：如"真环境验证才算 done""禁止写死屏幕外坐标 / UIA 阈值""租户隔离"等；
  - 5 条 `[Line04]` 客服红线（line/ability 作用域）；
  - 其余为其他线/领域铁律。
- interactive `/dev` 会加载它：`~/.claude-account2/skills/dev/SKILL.md:131`
  ```
  curl -s "localhost:5221/api/brain/decisions?category=invariant&limit=50"
  ```
  以及 SKILL.md:201 的"闭环"说明（生产新坑 → 提炼成 invariant 写回 → 下次 Phase 1 自动喂料）。
- **但 headless harness 的 GAN 两个 skill 完全没提 invariant**：
  - `~/.claude-account2/skills/harness-contract-proposer/SKILL.md` — Step 1.1 只 `curl .../registry?type=api|db_schema|test`（技术上下文），无 invariant 加载；
  - `~/.claude-account2/skills/harness-contract-reviewer/SKILL.md` — 7 维 rubric（第 88-100 行表）无任何"铁律合规"维度，Golden Path 覆盖审查（第 71-86 行）也不对照 invariant。

### 事实 2：GAN 的 prompt 注入点是 Brain 代码，不是 skill 自取

- Reviewer prompt 由 `packages/brain/src/workflows/harness-gan.graph.js:248 buildReviewerPrompt(prdContent, contractContent, round)` 拼装：SKILL 全文 + `## PRD` + `## Proposer 当前合同草案`。**没有 invariant 段**。
- Proposer prompt 同理：`harness-gan.graph.js:218 buildProposerPrompt(prdContent, feedback, round, proposeBranch)`：SKILL 全文 + `## PRD` + `## 上轮 Reviewer 反馈`。
- 两者都由 `harness-gan.graph.js:510 / :592` 在 propose/review 节点调用，env 里已注入 `SPRINT_DIR`、`TASK_ID`。

### 事实 3：rubric 维度是三处硬编码的接口约定（加维成本点）

改 reviewer 维度必须三处同步（Brain registry `type=harness_interface` 的 `harness::rubric-dimensions` 约定）：
1. reviewer SKILL 第 88-141 行 rubric 表 + Step 3 输出 JSON 模板（第 236-246 行）；
2. `packages/brain/src/harness-shared.js:277 ReviewerOutputSchema`（Zod 校验，第 280-288 行）；
3. `packages/brain/src/workflows/harness-gan.graph.js:67 RUBRIC_DIMENSIONS` 数组 + `:173 computeVerdictFromRubric`（阈值判决，`ci_workflow_alignment` 缺失默认 10 的先例在 :180）。
4. 相关测试：`packages/brain/src/workflows/__tests__/harness-gan-convergence.test.js`、`harness-gan-b55-stdout-fallback.test.js` 里的 rubric 样例对象。

### 结论

invariant 是"用生产事故换来的红线"，却只在 interactive /dev 生效；headless harness（Cecelia 自动跑的主路径）里 proposer 可以随手违反、reviewer 也不会挑出来。E1 负责补上 reviewer 侧的强制执行。

---

## 目标

1. **喂料**：把与本 sprint 相关的 invariant（全局 `[系统]` + 本 line/ability 作用域）显式送进 GAN reviewer 的上下文。
2. **强制**：reviewer 逐条对照 invariant 审 proposer 的合同；proposer 若违反或"放松"（悄悄降低标准、加 mock 兜过、写死环境假设值绕过真验）任何一条红线 → reviewer 必须打 REVISION。
3. **可判决**：不靠 reviewer 自由发挥，而是新增一维 rubric `invariant_compliance`，命中违反直接 < 7，走 Brain `computeVerdictFromRubric` 硬阈值判 REVISION。
4. **不重复 A1**：加载/作用域筛选由 A1 一次完成并落成 sprint 目录产物；E1 只消费该产物 + 加审查维度，不再二次 curl decisions。

---

## 具体改动

### 改动 1：新增 rubric 第 8 维 `invariant_compliance`（reviewer SKILL）

在 `harness-contract-reviewer/SKILL.md`：

- rubric 表（第 88 行起）从 7 维扩到 8 维，新增：

  | # | 维度 | 定义 | 10 分标准 | 0 分标准 |
  |---|---|---|---|---|
  | 8 | **invariant_compliance（铁律合规）** | 合同（Golden Path / DoD / E2E 脚本）是否**违反或放松**注入的任一条 invariant 红线 | 逐条对照 `## 铁律（invariant）` 段，每条都不被违反、不被降级、不被 mock/写死假值绕过；无相关 invariant 时填 10（N/A） | 命中任一违反：真机/生产 env 类铁律被 mock 兜过、"真环境验证才算 done"被 CI 绿冒充、租户隔离被跨租户查询破坏、写死屏幕外坐标/UIA 阈值绕真验 等 → 直接 0 分 |

- **判据（写进 SKILL，reviewer 逐条走）**：对每条注入的 invariant 回答"合同里有没有哪一步会违反它？有没有哪条 [BEHAVIOR] 悄悄把它的验收标准降下来（如把真机验证换成 mock、把 done 定在照不到真实世界的地方）？"。命中 → 在 feedback 里点名"违反 invariant #<id>：<原文摘要>"，该维 0 分。
- **与已有 Golden Path 覆盖审查第 9/10 条呼应**（第 83-84 行"接缝只用 mock 断言 → 打回""写死环境假设值无真验 → 打回"）：那两条本质就是 `[系统]` 铁律"真环境验证才算 done""禁止写死屏幕外坐标/UIA 阈值"的具体化。新维度把它们从"零散审查项"升级为"对照登记表逐条判决"，且覆盖全部 19 条而非只这两类。
- 阈值规则（第 102-106 行）扩为 8 维：`invariant_compliance` 与其它维一样 **< 7 → REVISION**；无相关 invariant 注入时填 10（N/A，直接过），先例同 `ci_workflow_alignment`。
- Step 3 输出 JSON 模板（第 236-246 行）加 `"invariant_compliance": X`；Step 4 写 `/workspace/.brain-result.json` 的 `rubric_scores` 同步加该 key。

### 改动 2：Brain 侧三处接口同步（加维配套）

1. `harness-shared.js:277 ReviewerOutputSchema.rubric_scores` 加：
   ```js
   invariant_compliance: z.number().min(1).max(10).optional().default(10),
   ```
   （用 `.optional().default(10)`，与 `ci_workflow_alignment` 同款，向后兼容旧输出。）
2. `harness-gan.graph.js:67 RUBRIC_DIMENSIONS` 数组追加 `'invariant_compliance'`。
3. `harness-gan.graph.js:173 computeVerdictFromRubric`：在缺字段默认逻辑（:180 `ci_workflow_alignment` 返回 10 的分支）旁，为 `invariant_compliance` 加同样"缺失=10（N/A pass）"兜底，保证旧数据/无 invariant sprint 不被误判。
4. 更新 Brain registry `harness::rubric-dimensions` 接口约定条目（`type=harness_interface`），记为 8 维。
5. 更新测试样例对象（`harness-gan-convergence.test.js` / `harness-gan-b55-stdout-fallback.test.js`）补 `invariant_compliance` 字段；新增一条测试：某维为 `invariant_compliance:5` 时 `computeVerdictFromRubric` 返回 REVISION。

### 改动 3：注入点 —— reviewer prompt 带上 `## 铁律` 段（Brain 代码，消费 A1 产物）

在 `harness-gan.graph.js:248 buildReviewerPrompt` 增参数并注入：

```js
// A1 已把作用域筛选后的 invariant 落到 SPRINT_DIR/sprint-invariants.md（见"依赖"）
export function buildReviewerPrompt(prdContent, contractContent, round, invariantsContent) {
  ...
  if (invariantsContent) {
    parts.push('', '## 铁律（invariant — 红线，proposer 违反/放松任一条 → invariant_compliance 维 0 分 → REVISION）', invariantsContent);
  }
  ...
}
```

- `invariantsContent` 来源：读 A1 产出的 `${SPRINT_DIR}/sprint-invariants.md`（`:592` 调用处已能拿到 `sprintDir`/`worktreePath`，用 `readContractFile` 同款 `git show`/fs 读法）。
- 文件不存在（A1 未运行）→ `invariantsContent=null`，reviewer 维度填 10（N/A）自然降级，不阻塞。**E1 不在这里补 curl**——加载是 A1 的单一职责，避免两处各查一次、作用域口径漂移。

### 改动 4（可选，收窄口子）：proposer 侧只做提示，不重复加载

- proposer 违反 invariant 的第一道防线是 A1（把 invariant 放进合同上下文，让 proposer 一开始就不违反）。
- E1 只在 `buildProposerPrompt`（:218）末尾追加一句静态提示（不注入全文，全文由 A1 管）："本 sprint 存在铁律约束，见合同上下文 `## 铁律` 段；违反将被 reviewer 的 invariant_compliance 维直接打回。" 让 proposer 知道有这道门。
- 这样 proposer 侧不做第二次 curl / 第二份 invariant 文本，SSOT 仍在 A1 的 `sprint-invariants.md`。

---

## 喂哪些 invariant（作用域规则）

由 A1 生成、E1 消费，口径统一如下：

| 类别 | 判定 | 是否喂 |
|---|---|---|
| 全局 `[系统]` 铁律 | decision title 前缀 `[系统]`，或未标 line 前缀 | **总是喂**（每个 sprint 都受约束，如真环境验证、租户隔离、写死坐标禁令）|
| line 作用域 `[LineXX]` | title 前缀 `[LineXX]` 且 == 本 sprint 的 journey/line | 命中才喂（如 `[Line04]` 客服红线只在 line04 sprint 喂）|
| ability 作用域 | decision 关联 `ability_id` == 本 sprint 的 ability | 命中才喂 |
| 其它 line 的铁律 | line 前缀 ≠ 本 sprint line | **不喂**（避免噪声，reviewer 只审相关红线）|

- 本 sprint 的 line/ability 来自 harness task payload（`journey_id` / `ability_id`）。
- 无法判定 line 时（journey_id 缺失）→ 只喂 `[系统]` 全局条，保守但不漏红线。

---

## DoD

- [ ] `harness-contract-reviewer/SKILL.md` rubric 从 7 维变 8 维，新增 `invariant_compliance`，含判据文字 + N/A 规则 + Step 3/4 JSON 模板更新。
  Test: `manual: node -e "const s=require('fs').readFileSync(process.env.HOME+'/.claude-account2/skills/harness-contract-reviewer/SKILL.md','utf8'); if(!/invariant_compliance/.test(s)) process.exit(1)"`
- [ ] `harness-shared.js ReviewerOutputSchema.rubric_scores` 含 `invariant_compliance`（optional default 10）。
  Test: `manual: node -e "const s=require('fs').readFileSync('packages/brain/src/harness-shared.js','utf8'); if(!/invariant_compliance/.test(s)) process.exit(1)"`
- [ ] `harness-gan.graph.js RUBRIC_DIMENSIONS` 含 `invariant_compliance`，`computeVerdictFromRubric` 对其缺失兜底为 10。
  Test: `manual: node -e "const s=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8'); if(!/invariant_compliance/.test(s)) process.exit(1)"`
- [ ] [BEHAVIOR] `buildReviewerPrompt` 传入 `invariantsContent` 时，输出 prompt 含 `## 铁律` 段；传 null 时不含且不报错。
  Test: `tests/harness-gan-invariant-prompt.test.js`（新增单测，断言两种分支）
- [ ] [BEHAVIOR] 单测：`computeVerdictFromRubric` 在 `invariant_compliance:5`（其余全 8）时返回 REVISION；缺该字段时按 10 处理不误判。
  Test: `packages/brain/src/workflows/__tests__/harness-gan-convergence.test.js`（补 case）
- [ ] [BEHAVIOR] 端到端：造一条违反某 `[系统]` invariant 的合同草案（如真机 RPA 步骤只用 `MOCK_*` 兜过），跑 reviewer，`invariant_compliance < 7` 且 verdict=REVISION，feedback 点名该 invariant。
  Test: `tests/harness-reviewer-invariant-e2e.test.ts`（喂 fixture 合同 + fixture invariant，断言 verdict + feedback 命中）
- [ ] Brain registry `harness::rubric-dimensions` 接口约定更新为 8 维。
- [ ] 旧测试样例对象补 `invariant_compliance` 字段，全绿。

---

## 依赖（与 A1 分工）

| 项 | A1 负责 | E1 负责 |
|---|---|---|
| 查 `decisions?category=invariant` | ✅ 唯一加载点 | ❌ 不重复 curl |
| 作用域筛选（全局 + 本 line/ability） | ✅ 按上表规则筛 | 消费筛好的结果 |
| 落产物 `${SPRINT_DIR}/sprint-invariants.md` | ✅ 写文件（GAN 双方共享的 SSOT） | 读该文件 |
| 注入 **proposer** 合同上下文（让 proposer 先天不违反） | ✅ | 仅加一句静态提示指向该段 |
| 注入 **reviewer** prompt `## 铁律` 段 | — | ✅ `buildReviewerPrompt` 读 md 注入 |
| 新增 rubric `invariant_compliance` 维 + 判决 | — | ✅ SKILL + 三处接口 + 测试 |

**契约点**：A1 与 E1 约定文件名 `sprint-invariants.md` 与内部格式（每条一行：`- [invariant #<id>] <title>：<content 摘要>`）。E1 的 reviewer 判据按此格式逐条对照。若 A1 尚未落地，E1 可先按"文件不存在→N/A 降级"上线（不阻塞、不误判），A1 到位后自动生效——两者可独立合并、互不阻塞。

---

## 风险与注意

1. **加维是三处硬编码的接口变更**：SKILL / Zod schema / RUBRIC_DIMENSIONS 必须同批改，漏一处会让 `computeVerdictFromRubric` 因字段不齐返回 null，降级到 LLM 文字判决（reviewer SKILL 第 19 行、graph :180 已有此陷阱记录）。用 `.optional().default(10)` + 缺失兜底降低风险。
2. **N/A 语义别写死过关**：无相关 invariant 时填 10 是对的，但要防"reviewer 偷懒把有 invariant 的 sprint 也填 10"。判据里要求：只要 `## 铁律` 段非空，reviewer 必须逐条给出"未违反"的一句证据，否则该维不得填 10（同 `ci_workflow_alignment` 未读 workflow 强制 0 分的先例）。
3. **别让 invariant 触发合同膨胀（B50 发散）**：invariant 是"红线不许碰"，不是"再加严谨度"。reviewer 只在合同**违反**红线时打回，不能借 invariant 要求 proposer 加 PRD 之外的额外验证（否则撞上第 2 维 scope 超覆盖 + Brain 膨胀 force-approve）。SKILL 判据要写明："invariant 只判'有没有踩线'，不判'够不够多'"。
4. **作用域误伤**：全局 `[系统]` 条对每个 sprint 都喂，若某条铁律表述过泛（如"真环境验证才算 done"）可能对纯逻辑改动 sprint 造成误 REVISION。缓解：reviewer 判据要求"该 sprint 的 Golden Path 是否真的碰到这条铁律管辖的接缝"——没碰到就不算违反（呼应 proposer 接缝清单）。
5. **降级不静默失败**：`sprint-invariants.md` 读取失败要留一行日志（区分"A1 没跑"vs"读文件报错"），避免 invariant 被静默跳过却无人知。
6. **多轮收敛**：invariant_compliance 是硬红线，命中即 REVISION，但收敛趋势检测（`detectConvergenceTrend`）仍生效——proposer 改掉违反后该维应回到 10，不影响无上限收敛设计。
