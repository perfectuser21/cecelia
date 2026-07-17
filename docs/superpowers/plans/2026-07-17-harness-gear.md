# harness gear 档位一体化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** harness relay 增加 gear 三档（default/hotfix/segmented）：管道注入 + controller 分叉 + proposer 多段 + generator 定向 + evaluator 段验。

**Architecture:** brain 层加 deriveGear 纯函数与 prompt/env 注入、executor 枚举校验；四个 harness SKILL.md 各加 gear 分支段，档位不触发时行为与现行逐字一致。hotfix 不改 generator（controller 合成极简合同）。

**Tech Stack:** Node ESM + vitest（brain）；SKILL.md 为 prompt 逻辑层。

## Global Constraints

- spec: docs/superpowers/specs/2026-07-17-harness-gear-design.md（所有 exact 语义以它为准）
- TDD 铁律：NO PRODUCTION CODE WITHOUT FAILING TEST FIRST；每 task commit-1 纯测试 / commit-2 纯实现（SKILL.md 任务除外——无测试框架，走"改动+自检声明"单 commit）
- gear 枚举：`['default','hotfix','segmented']`，缺省 'default'，非法 → terminal failed reason='invalid_gear'
- prompt 头注入位置：REVIEW_REQUIRED 行之后一行 `HARNESS_GEAR=${gear}`；env block 加 `HARNESS_GEAR: gear`
- SKILL.md 四个文件的 gear 新段都必须含一句显式声明："HARNESS_GEAR 缺失或 =default 时，本节不生效，行为与现行完全一致"
- 所有输出与注释简体中文
- brain 改动需 version bump（packages/brain/package.json patch +1，并跑 bash scripts/check-version-sync.sh 确认四处同步）

---

### Task 1: brain — deriveGear 纯函数 + executor 校验 + prompt/env 注入（TDD）

**Files:**
- Modify: `packages/brain/src/harness-skill-relay.js`（deriveReviewRequired 旁加 deriveGear；L227-239 prompt 头与 L266-285 env block 注入）
- Modify: `packages/brain/src/executor.js`（~L2956 orchestrator 校验旁加 gear 校验）
- Test: `packages/brain/src/__tests__/harness-skill-relay.test.js`（扩展，仿 deriveReviewRequired describe 块与 spawnSkillRelaySession fake-deps 用例）

**Interfaces（Produces）:**
- `export const GEAR_VALUES = ['default','hotfix','segmented']`
- `export function deriveGear(task)`：`task?.payload?.gear` 为 undefined/null → 'default'；∈GEAR_VALUES → 原值；其他 → throw `new Error('invalid_gear: '+值)`
- executor：deriveGear throw 时任务 terminal failed，result.reason='invalid_gear'（照 missing_orchestrator_flag 的处理形态写）
- prompt 头新行 `HARNESS_GEAR=${gear}`（紧跟 REVIEW_REQUIRED 行）；env 新键 `HARNESS_GEAR`

- [ ] Step 1: 写失败测试——deriveGear 三态（缺省default/三个合法值/非法throw含'invalid_gear'）；spawn 用例断言 prompt 含 `HARNESS_GEAR=default` 且显式 gear=segmented 时含 `HARNESS_GEAR=segmented`；executor 非法 gear → 任务标 failed 且 reason invalid_gear（仿既有 missing_orchestrator_flag 测试，若无则在 skill-relay 测试文件内 mock 断言 deriveGear 被调且 throw 传播）
- [ ] Step 2: `cd packages/brain && npx vitest run src/__tests__/harness-skill-relay.test.js` 确认新用例红、旧用例绿
- [ ] Step 3: commit-1 `test(brain): gear 档位 deriveGear/注入/校验 failing tests`
- [ ] Step 4: 实现 deriveGear + GEAR_VALUES + 注入 + executor 校验（照 spec 决策1/2；executor 处 try/catch deriveGear，catch → 标 failed 走既有 terminal 路径）
- [ ] Step 5: vitest 该文件全绿 + `npx vitest run` brain 相关目录不回归（至少 harness-skill-relay/executor 相关文件）
- [ ] Step 6: version bump：packages/brain/package.json patch +1 + 其余同步处（跑 `bash scripts/check-version-sync.sh` 按报错补齐）
- [ ] Step 7: commit-2 `feat(brain): harness gear 管道——deriveGear+prompt/env注入+invalid_gear校验`

### Task 2: controller SKILL.md — gear 分叉（hotfix 合成合同 + segmented 段循环）

**Files:** Modify: `packages/workflows/skills/harness-controller/SKILL.md`

要求（读 spec「组件与数据流」+「错误路径」照写）：
- 入口处新增「档位分流」节：读 prompt 头 HARNESS_GEAR（缺失=default→现行主线不动）
- **hotfix 节**：跳过 Step1 planner/Step2 GAN；校验 payload thin_prd/failing-test 描述（缺→PATCH 任务 failed 明确报错并退出）；用其合成 `${SPRINT_DIR}/contract-draft.md`（含 ## E2E 验收）+ `contract-dod.md`（[BEHAVIOR] 条目）+ `tests/`（复现红测试）commit 到 CONTRACT_BRANCH；随后 Step3-7 与现行完全一致
- **segmented 节**：Step1/2 照跑（派 proposer 时 prompt 透传 HARNESS_GEAR=segmented）；GAN 后先派骨架 generator（payload.is_skeleton 钩子，落全红棋盘 commit）；再按 task-plan.json 的 tasks 串行循环：派 generator 带 `WORKSTREAM_INDEX=<ws_id>` → 派 evaluator 带 `SEGMENT_EVAL=<ws_id>`（FAIL→重派该段带失败摘要，2次仍败→escalate）→ 全段绿后派现行全量 evaluator 总验 → merge → report
- 两节各含"default 不生效"声明句（Global Constraints）

- [ ] Step 1: 读现有 SKILL.md 主线（Step 0-7 与 Step3/4 派发段），按上述要求插入分流节与两个档位节，风格/术语与现文件一致
- [ ] Step 2: 自检——grep 确认 default 主线原文未被改动（git diff 只有新增段落）；输出 diff 摘要
- [ ] Step 3: commit `feat(skills): harness-controller gear 分叉——hotfix合成合同直通+segmented骨架段循环`

### Task 3: proposer SKILL.md — segmented 多段 task-plan

**Files:** Modify: `packages/workflows/skills/harness-contract-proposer/SKILL.md`

要求：现 L30 附近"task-plan.json 始终只输出 1 个 task(ws1)"处加档位分支——HARNESS_GEAR=segmented 时输出多段，schema 原样用 spec 决策6 的 v7 前格式（tasks[] 数组、task_id ws1..N、depends_on 线性链、ws1 唯一可空、estimated_minutes 20-60）；段的划分依据 = Golden Path 步骤中"后段依赖前段真机产物"的接缝；非 segmented 保持单 ws1 原文不动 + default 声明句。

- [ ] Step 1: 插入档位分支段（含完整多段 JSON 示例，抄 spec 决策6 schema）
- [ ] Step 2: 自检 git diff 只新增；commit `feat(skills): proposer segmented 档恢复多 workstream task-plan（v7前schema）`

### Task 4: generator SKILL.md — WORKSTREAM_INDEX 定向

**Files:** Modify: `packages/workflows/skills/harness-generator/SKILL.md`

要求：入口协议段（~L80-105，IS_SKELETON 检测旁）加 WORKSTREAM_INDEX：存在时只实现 task-plan.json 中该 ws 的 scope/files，禁碰其他段的实现文件（测试棋盘是共享的、只许把本段断言点绿不许改断言）；TDD 两 commit 纪律不变（本段红→绿）；缺失时行为与现行一致 + default 声明句。

- [ ] Step 1: 插入 WORKSTREAM_INDEX 段；Step 2: 自检 diff 只新增；commit `feat(skills): generator 支持 WORKSTREAM_INDEX 段定向实现`

### Task 5: evaluator SKILL.md — SEGMENT_EVAL 段级轻验收

**Files:** Modify: `packages/workflows/skills/harness-evaluator/SKILL.md`

要求：relay 入口段（L100-128）加 SEGMENT_EVAL=<ws_id>：跳过 final-E2E，只跑该段 [BEHAVIOR]/tests 断言 + 复跑此前段的测试（回归棘轮：任何已绿变红 → 本段 FAIL 且失败摘要注明回归项）；输出 verdict 格式与现行一致；缺失时全量模式原文不动 + default 声明句。

- [ ] Step 1: 插入 SEGMENT_EVAL 段；Step 2: 自检 diff 只新增；commit `feat(skills): evaluator SEGMENT_EVAL 段级轻验收（跳final-E2E+回归棘轮）`

### Task 6: 收口——dispatcher 验证 + DevGate + 全量回归

- [ ] Step 1: 读 packages/brain/src/dispatcher.js:54-64 确认 segmented 不产生额外 Brain 任务（段循环在 controller session 内）——在 harness-skill-relay.js 相关注释处补一行说明，不改行为
- [ ] Step 2: DevGate 三件套：`node scripts/facts-check.mjs` + `bash scripts/check-version-sync.sh` + `node packages/engine/scripts/devgate/check-dod-mapping.cjs`
- [ ] Step 3: `cd packages/brain && npx vitest run`（全量；OOM 则按目录分批）
- [ ] Step 4: commit `chore: gear 收口——dispatcher并发说明+DevGate 三件套通过`

## Self-Review 结论
spec 7 个决策全部映射到 Task 1-6；无 TBD；接口名（GEAR_VALUES/deriveGear/HARNESS_GEAR/WORKSTREAM_INDEX/SEGMENT_EVAL/is_skeleton）跨任务一致。
