# Sprint Contract Draft (Round 1)

**Sprint**: 修复 gan_no_push_streak 误判——提案分支观测退到 origin 本地 remote + 缺 base_repo 不兜底
**journey_type**: autonomous
**target_environment**: local_api（node_deps 可用；postgres 不参与——观测逻辑纯字符串/命令推导，测试用注入 fake pool）

锚定父路声明：独立小路（无父路）——本 sprint 是 harness GAN 观测层的缺陷修复，journey `e6f803f2` 现有 ability 均为 planned 态（PRD 累积 FR 段：本 line 暂无已验收 golden-path）。

gp-anchor: skipped (product-map.json not found)  <!-- cecelia 仓无 product-map/generated/product-map.json -->
contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在），走代码层 Contract Gate + skill 内置规则

---

## Response Schema（推导来源: N/A — 任务无 HTTP 响应）

N/A — 本任务是 Brain 内部 orchestrator 观测逻辑修复（`collectGroundTruth` 提案 remote 解析），
无新增/变更 HTTP 端点，无 request/response schema。验收 oracle = 该模块的 Vitest 单元测试
（真 `collectGroundTruth` / 真 `deriveCounters` / 真 `derive`，注入 fake pool + fake execCmd）。
Reviewer 第 6 维按 [BEHAVIOR] 数量与真执行断言占比把关。

---

## Golden Path

[proposer 真推提案分支] → [ground-truth 在正确 GitHub remote 上观测] → [GAN 正常收敛，不误判 no-push]

### Step 1: 触发——任务缺 base_repo 但有 repo，proposer 已真推分支
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步「任务 payload 带 repo 但缺 base_repo；proposer 已把 cp-harness-propose-r1-<shortTask>-... 分支真推到 GitHub」。

**可观测行为**: `collectGroundTruth` 解析提案 remote 时，按兜底链 `base_repo → repo`（经 `parseBaseRepo` + `DEFAULT_REPO_MAP`）把 `repo:"cecelia"` 解析为 `perfectuser21/cecelia`。

**验证命令**:
```bash
# 缺 base_repo、含 repo:"cecelia"，注入可记录命令的 execCmd → ls-remote 目标必须是 GitHub remote
(cd /workspace && npx vitest run --no-cache sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts -t 'B-01')
# 期望：exit 0；实际 ls-remote 命令含 https://github.com/perfectuser21/cecelia.git，不含 "ls-remote --heads origin"
```

**硬阈值**: 测试 exit 0；`ls-remote` 命令目标 = `https://github.com/perfectuser21/cecelia.git`，`ls-remote --heads origin` 不出现。

---

### Step 2: 系统处理——在正确 remote 上观测到已推分支
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步「ls-remote 打到 https://github.com/<slug>.git 而非 origin」+ 第 3 步「proposeBranchRn 观测到 ≥1」。

**可观测行为**: 在有已推 propose 分支的 ls-remote 输出下，`observed.proposeBranchRn ≥ 1`，`observed.proposeBranch` 被观测到。

**验证命令**:
```bash
(cd /workspace && npx vitest run --no-cache sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts -t 'B-02')
# 期望：exit 0；observed.proposeBranchRn >= 1，proposeBranch === 已推分支名
```

**硬阈值**: `proposeBranchRn ≥ 1`，`proposeBranch` 非 null。

---

### Step 3: 出口——GAN 不误判 no-push；不确定时 fail-closed
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步「noPushStreak 保持 0；deriveGan 不返回 gan_no_push_streak」+ PRD 边界「base_repo 与 repo 均不可解析：不得静默退 origin 把空结果当权威 no-push」。

**可观测行为**:
- (a) 正确观测（rn≥1、分支真推进）喂给 `derive` → 不返回 `gan_no_push_streak`、不 `mark_failed`；致盲观测（rn=0、intent 全记 0）才让 `noPushStreak` 累积到误判——作根因锚点对照。
- (b) `base_repo` 与 `repo` 均缺失/不可解析时，**不发出**结构性致盲的 `git ls-remote --heads origin`（origin 看不到 GitHub 已推分支，其空结果不得成为「未推送」的权威输入）。

**验证命令**:
```bash
(cd /workspace && npx vitest run --no-cache sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts -t 'B-03')
(cd /workspace && npx vitest run --no-cache sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts -t 'B-05')
# 期望：均 exit 0；B-03 断言 execCmd.calls 无 ls-remote --heads origin；B-05 断言正确观测 derive!=gan_no_push_streak
```

**硬阈值**: B-03 exit 0（无 origin 盲查）；B-05 exit 0（正确观测 `derive().reason != 'gan_no_push_streak'` 且 `action != 'mark_failed'`）。

---

### Step 4: 零回归红线——base_repo 正常可解析行为不变
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入。理由：PRD 边界明确要求「base_repo 正常可解析：行为逐字节不变（零回归红线）」，需一条对照断言锁死 base_repo 齐全路径不被兜底链改写。

**可观测行为**: `base_repo` 为完整 GitHub URL 时，`ls-remote` 仍打 `https://github.com/perfectuser21/cecelia.git`，不退 origin。

**验证命令**:
```bash
(cd /workspace && npx vitest run --no-cache sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts -t 'B-04')
# 期望：exit 0；base_repo 全 url 时 ls-remote 目标不变
```

**硬阈值**: 测试 exit 0；命令目标 = GitHub remote，`--heads origin` 不出现。

---

## 已知约束（来自回归测试 + 累积 FR + Unified Map）

- [ground-truth.test.js] 「跨仓库任务从 payload.base_repo 查询 proposal refs，不读取 Brain origin」→ 兜底链改动必须与该既有用例共存不回退（base_repo 直给 slug 仍打 GitHub）。
- [counters.js] `noPushStreak = terminalFalseStreak(proposerOutcomes)`，`proposerOutcomes` 依据 intent.observed.proposeBranchRn 的逐轮推进；观测退 origin 恒 0 是误判根因。
- [derive.js:982] `caps.noPushStreakExceeded(noPushStreak)`（`MAX_NO_PUSH_STREAK=2`）→ `gan_no_push_streak` mark_failed；本 sprint 不改此阈值/语义。
- [累积FR] context-manifest：本 line 暂无已验收历史 golden-path（journey ability 均 planned 态），无额外 FR 约束。
- [MAP] `map_scope`/`map_repo` 未在 task.payload 配置（本 attempt payload 未带）→ `[MAP_NOT_CONFIGURED]`，无 must_run_assertions 注入；不回退领域硬编码。

---

## 禁 mock 边清单

本单改动涉及**跨模块数据传递**（`collectGroundTruth` 提案 remote 解析 → `observed.proposeBranchRn` → `deriveCounters` → `derive` 状态机输入）——按 v9.12 硬规则，failing test 必须不 mock 被改的那条边：

- `collectGroundTruth`（remote 解析逻辑本体）↔ `git 子进程`（本单改的就是构造给 git 的 ls-remote 命令目标）：测试必须真调 `collectGroundTruth`，只在**最外层** git 边界注入可记录命令的 fake `execCmd`，断言实际下发的命令字符串（不 mock `collectGroundTruth` 内部的 remote 解析）。
- `collectGroundTruth` 输出 ↔ `deriveCounters` ↔ `derive`（观测值 → 计数器 → 状态机的数据接力）：B-05 用真 `deriveCounters` + 真 `derive`，不 stub 任一环。

允许 mock 的**外层无关边界**：DB `pool`（postgres 不参与——本单是命令字符串/观测推导，非 DB 写路径；`runtime_resources.postgres=false`）与 `fileExists/readFile`（prd/callback 文件读取，与本单逻辑无关）。这两者是整份 `ground-truth.test.js` 既有约定的注入边界，非被改的边。

---

## 真实调用方请求 shape

N/A — 本单不涉及「设备/agent 调服务端」，无外部真实调用方；改动是 Brain 内部对 git remote 的命令构造。

## 未覆盖真实链路清单

（本合同无第三方 API 调用、无 force_*/stub/假数据顶替真实链路。测试注入的 fake `pool`/`execCmd` 是最外层 IO 边界（DB/git 子进程），非「真实链路点被 mock 顶替」——被测的 remote 解析逻辑本体真跑。N/A）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | `collectGroundTruth` 解析提案 remote 时按 `base_repo → repo` 兜底链解析 GitHub slug；无法解析 slug 时不发出致盲 origin 盲查（fail-closed）。 |
| **NFR（做得多好）** | 非功能 | 沿用 `execTolerant` 既有 ls-remote 容错，不新增阻塞/超时；base_repo 齐全路径零回归。 |
| **Invariant（永不违反）** | 不变量 | 本地 origin 结构上看不到 GitHub 已推分支，其空结果不得作为「未推送」权威结论累积 noPushStreak（INV-1）。 |
| **判定点（怎么知道）** | 模糊现实判断 | 见判定点登记表。 |
| **保质期（何时过期）** | 失效 | 不涉及 token/数据保质期；解析规则随 DEFAULT_REPO_MAP 演进（不在本单范围）。 |
| **死亡告警（停了谁知道）** | 告警 | 观测无法解析真实 remote 时须留痕（不静默吞成 no-push），便于归因；回归测试常驻 brain-CI，规则被破当场红。 |
| **失败语义（挂了怎么办）** | 故障 | 见失败语义声明。remote 不可解析 = fail-closed（不据空 origin 结果 mark_failed），不确定性交既有 no-verdict/budget/hop 上限收口。 |
| **效果确认（已发≠已生效）** | 回执 | 观测的「生效」= ls-remote 命令目标为真实 GitHub remote 且能观测到已推分支；由 B-01/B-02 断言命令字符串与 proposeBranchRn。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳 | 静默丢消息 |
| ⚠️ 提案分支是否已推到 GitHub | A. ls-remote 打真实 GitHub slug（base_repo→repo 兜底）; B. ls-remote 打本地 origin | A（B 结构性致盲，弃用） | origin 是 Brain 本地检出 remote，看不到 GitHub 已推分支；A 打到真 slug 才能观测 | 误判「未推送」→ noPushStreak 累积 → 真提案被 mark_failed（本 sprint 根因） |
| ⚠️ base_repo 与 repo 均不可解析时的观测结论 | A. 退 origin 拿空结果当权威 no-push; B. fail-closed 不发盲查、不据此累积 | B | origin 空结果无信息量，当权威即制造「假 no-push」 | 把不可观测误当已确认未推 → 假 mark_failed |

> ⚠️ 两个判定点误判后果均为「不可逆地 mark_failed 真提案」（严重），已在 PRD Golden Path/边界作对抗锚点拍过；本合同 notes 无新增待用户确认判定点。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| base_repo 缺、repo 可解析 | 解析 repo 得真 slug，打 GitHub remote | 是（纯读观测，无副作用） | 无需降级 |
| base_repo 与 repo 均不可解析 | fail-closed：不发 origin 盲查，proposeBranchRn 记为不可观测（0，但不作权威 no-push 输入） | 是 | 不确定性交既有 no-verdict/budget/hop 上限收口，不新增失败态 |
| ls-remote 命令本身失败/超时 | 沿用 `execTolerant` 容错，失败不得被解读为「未推送」 | 是 | 既有容错语义不变 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本单是 Brain 内部 orchestrator 观测逻辑，无对外暴露 agent 输入面。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

> 本单为 Brain 内部纯逻辑修复，postgres 不参与（`runtime_resources.postgres=false`），无需 migration/signup/服务启动。
> Mode B final-e2e = 跑本 sprint 的 Vitest 回归全绿 + 跑 brain 包内既有 orchestrator 回归确保零回归。
> vitest 工作目录死规则（v9.25）：sprints/** 下的合同测试从仓库根 `npx vitest run` 合法（root vitest include 覆盖 sprints/**）；对 packages/brain/src/** 的调用必须用子 shell `(cd packages/brain && npx vitest run ...)`。

```bash
#!/bin/bash
set -euo pipefail
cd /workspace

# 1. 本 sprint 回归测试（root vitest；exercises 被改的 collectGroundTruth remote 解析边）全绿
npx vitest run --no-cache sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts --reporter=verbose

# 2. 永久回归同源落进 brain 包内 orchestrator 测试，用该包自身 vitest 配置跑（子 shell，禁从根跑 src/**）
(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/ground-truth.test.js --reporter=verbose)

# 3. 零回归：既有 counters/derive 单测不被本单改动破坏
(cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/counters.test.js ./src/orchestrator/__tests__/derive.test.js --reporter=verbose)

echo "✅ Golden Path 验证通过：gan_no_push_streak 误判已修复，零回归"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `taskPayload.repo` 为不可解析垃圾值（如 `"::"`、空字符串、非映射键）→ 应走 fail-closed（不发 origin 盲查），不得抛异常崩溃 collectGroundTruth。
- 重复提交: 同一 run 多轮观测（多次 collectGroundTruth）→ 每次解析结果一致，无状态残留。
- 中途中断: ls-remote 抛错（execCmd throw 带 err.stdout）→ `execTolerant` 容错路径仍不把失败解读为「未推送」。
- 边界值: base_repo 为完整 URL 带 `.git`/不带 `.git`/带尾 `/` → 解析结果稳定为同一 slug（parseBaseRepo 现有规则，不得被本单改动影响）。
发现分级: P0/P1（真提案被误 mark_failed / base_repo 齐全路径回归）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## 永久回归落位（CLAUDE.md 规则 20）

sprints/** 下的合同测试在 harness Sprint Tests CI 跑，但按 brain vitest 政策非常驻（sprint 目录可清）。
因此 generator 必须把「缺 base_repo 有 repo → 打 GitHub remote 不退 origin」这条回归**同源新增**进
`packages/brain/src/orchestrator/__tests__/ground-truth.test.js`（brain-CI 常驻，`预期受影响文件`已列），
并在该新增 it() 的名或体中带唯一 marker 字符串 `gan_no_push_streak-fallback-regression`（ARTIFACT-3 机检）。
既有「跨仓库任务从 payload.base_repo 查询」用例是 base_repo 直给 slug 路径，不能替代本单「缺 base_repo 走 repo 兜底」路径。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 缺 base_repo 有 repo 打 GitHub remote | `sprints/08180432-kernel-364584d3/tests/gan-nopush-remote.test.ts` | B-01 | 修前 ls-remote 退 origin → FAIL |
| proposeBranchRn 观测到 ≥1 | 同上 | B-02 | （fake exec 下同绿，作 golden-path 结果锚点）|
| 均不可解析 fail-closed 不发 origin 盲查 | 同上 | B-03 | 修前发出 ls-remote --heads origin → FAIL |
| base_repo 正常零回归 | 同上 | B-04 | 修前后同绿（对照锁死）|
| derive 后果 不产生 gan_no_push_streak | 同上 | B-05 | 致盲观测 noPushStreak≥2 锚点 |
