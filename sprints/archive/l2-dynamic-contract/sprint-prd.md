# PRD: Engine L2 动态契约 — Evidence System + TDD Artifact

> Version: 1.0.0
> Created: 2026-04-18
> Owner: Engine 维护者
> Initiative: Engine ↔ Superpowers 对齐 Wave 2（L2 行为层）
> Upstream: PR #2406（L1 静态契约）
> Branch: cp-04181830-r7-superpowers-gap（follow-up）

---

## 背景与动机

### 问题陈述

PR #2406（L1 静态契约）已固化 Engine ↔ Superpowers 的**结构层**对齐：
- 14 skill 覆盖清单（full / partial / not_planned）写进 `superpowers-alignment.yaml`
- 8 个本地化 prompt 副本 + sha256 防篡改
- 5 处版本号同步 + CI `engine-alignment-gate` 拦截违规

但用户在 R7 review 中明确指出一个根本局限：

> "上次感觉 CI 是静态的，即使加了东西好像也没真保护。这次明确要做'骨'（行为层）而不是'皮'（结构层）。"

**L1 的盲区**：契约能验证"文件存在且内容正确"，但**无法**验证 /dev 运行时是否真的按 Superpowers 方法论执行。下列退化模式 L1 抓不到：

1. **Prompt 存在但未加载**：`subagent-driven-development/SKILL.md` 本地副本的 sha256 正确，但 02-code.md 派发 Implementer 时根本没读它
2. **方法论被静默跳过**：Implementer subagent 被派发，但 prompt 被改成"直接写代码，跳过 TDD"，没有红/绿 log 可验证
3. **Spec Reviewer 流于形式**：spec-reviewer-prompt.md 存在、6 项 checklist 也在文档里，但 /dev 流程根本没调 Reviewer，checklist 永远不运行
4. **Brainstorming 从未触发**：契约登记了 `brainstorming/SKILL.md`，但 autonomous_mode 的 research 阶段没产生任何 brainstorm 决策记录

### 为什么现在必须做

- **Harness v4.3 autonomous_mode** 依赖 subagent-driven-development + test-driven-development 的**真实执行**，而不是契约里的 sha256。下一次任务卡死时，我们需要能在 evidence 里看到"Implementer 在哪个 commit 被派发、TDD red log 是哪个测试"
- **PR #2406 结束前 R7 review** 用户反复强调"这次要搞骨不搞皮"：structural alignment 只是入门券，runtime alignment 才是正票
- **渐进迁移的机会窗口**：L1 把 8 个 skill 全部本地化后，我们第一次拥有**完整 prompt 视图**，可以按 skill 定义 required_events。再拖半年 skill 会继续分化，定义 event schema 的成本只会更高

### 非目标（明确不做）

- **不引入新 Brain 表**：evidence 直接 append 到 worktree 内 JSONL，git 仓库范围内 CI 就能读；减少对 Brain 5221 的耦合
- **不改 Stage 1/3/4**：Stage 1 (Spec) / Stage 3 (CI) / Stage 4 (Merge) 已经有各自门禁，本 Initiative 只在 Stage 2 (Code) 加记录
- **不立即 enforce**：第一轮所有 skill 标 `mode: opt-in`，CI 缺证据只 warn 不 fail。等运行 2-3 周、记录充足后再逐个 PR 转 enforced
- **不改 PR #2406 已有契约字段**：在 yaml 里**追加** `runtime_evidence` 子字段，保持向后兼容（老脚本 ignore 新字段）
- **不加 MAX event 数量限制**：evidence 可能稀疏也可能密集，让场景自然决定

---

## 目标

**一句话核心目标**：把 Engine ↔ Superpowers 对齐从"结构合规"升级为"行为合规"——CI 能基于运行时 evidence 拦截"只改结构不跑方法论"的漂移，下一次 /dev 跑完必须在仓库里留下可验证的方法论执行轨迹。

### 可度量子目标

1. **SG-1**：定义 10 种 evidence event types 的封闭集合（schema 文档 + JSON example）
2. **SG-2**：新增 `packages/engine/scripts/record-evidence.sh`，能 append 合法 JSONL 到 worktree 内文件
3. **SG-3**：新增 `packages/engine/scripts/devgate/check-pipeline-evidence.cjs`，支持 `opt-in` / `enforced` 双模式
4. **SG-4**：10 个 full-coverage skill 在 `superpowers-alignment.yaml` 里都有 `runtime_evidence` 字段，全部标 `mode: opt-in`
5. **SG-5**：Implementer prompt + Spec Reviewer prompt + 02-code.md 完成插桩，下次 /dev 跑完 pipeline-evidence.jsonl 能真实产出
6. **SG-6**：CI 集成 Pipeline Evidence Gate，opt-in 阶段只 warn 不 block，但 warn 输出清单可读

---

## User Stories

- **US-1**：作为 **Engine 维护者**，我希望任何修改 /dev 流程的 PR 必须产出 `sprints/<branch>/pipeline-evidence.jsonl` 证明运行时真的跑了相应 skill；缺 evidence 时 CI 给出 warn 清单（opt-in）或 fail（enforced）
- **US-2**：作为 **Implementer subagent 的派发者（/dev Stage 2）**，我希望 Implementer 交付的 `DONE` 附带 TDD 红/绿 log artifact，Reviewer 可在 PR 评论里验证
- **US-3**：作为 **Spec Reviewer subagent**，我希望 checklist 第 6 项"TDD artifact 存在且红→绿顺序正确"写进 prompt，不是人工记着要查
- **US-4**：作为 **autonomous_mode 流水线**，我希望每次 brainstorming / writing-plans / executing-plans 触发时都留下 JSONL 记录，便于事后 Evaluator 复盘哪一步走偏
- **US-5**：作为 **CI 维护者**，我希望 Pipeline Evidence Gate 支持 opt-in → enforced 渐进迁移，不会一次把所有 skill 打 fail 阻塞所有 PR
- **US-6**：作为 **方法论漂移的审视者**，当某个 PR 把 02-code.md 里 `record-evidence subagent_dispatched` 那行删掉时，下一次 /dev 跑不产生对应 event，CI warn 输出能把违规 PR 指出来

---

## 功能需求（FR + 成功标准 SC）

### FR-1: Evidence JSONL Schema（封闭集合 + example）

- **SC-1.1**：`docs/engine/pipeline-evidence-schema.md` 存在，定义 10 种 event types 的封闭集合：
  - `brainstorm_started` / `brainstorm_committed`
  - `plan_written`（writing-plans 产出）
  - `plan_executed`（executing-plans 触发）
  - `subagent_dispatched`（Implementer/Spec-Reviewer 等派发）
  - `subagent_returned`（subagent 产出 DONE）
  - `tdd_red`（红色测试写下）
  - `tdd_green`（测试通过）
  - `verification_passed`（verification-before-completion 过关）
  - `review_requested`（requesting-code-review 触发）
- **SC-1.2**：每条记录必填字段：`version`（schema 版本）/ `ts`（ISO 8601）/ `task_id`（UUID）/ `branch` / `stage`（dev stage 1/2/3/4）/ `event`（closed set）
- **SC-1.3**：每个 event type 有 event-specific required fields（例如 `subagent_dispatched` 需要 `subagent_type` + `prompt_sha256`；`tdd_red` 需要 `test_file` + `failure_output_sha256`）
- **SC-1.4**：schema 文档为每个 event 附完整 JSON example（方便脚本直接复制）

### FR-2: record-evidence.sh recorder

- **SC-2.1**：`packages/engine/scripts/record-evidence.sh` 存在且可执行
- **SC-2.2**：自动从 `.dev-mode` 读 `task_id` + `branch`，无需每次传参
- **SC-2.3**：传入 `--prompt <path>` 时自动 `sha256sum` 防伪造（手动拼的 hash 不被接受 → 脚本只接受"文件路径"）
- **SC-2.4**：校验 `--event` 在封闭集合内（白名单），非法 event exit 非零
- **SC-2.5**：校验每个 event 的 event-specific 必填字段，缺字段 exit 非零
- **SC-2.6**：追加写到 `$WORKTREE/.pipeline-evidence.<branch>.jsonl`（默认路径；支持 `--output` 覆盖）
- **SC-2.7**：每条 JSONL 行为合法 JSON（单行，末尾换行）

### FR-3: check-pipeline-evidence.cjs CI gate

- **SC-3.1**：`packages/engine/scripts/devgate/check-pipeline-evidence.cjs` 存在，`node <script>` 可运行
- **SC-3.2**：读 `sprints/<branch>/pipeline-evidence.jsonl`（或者回退到 worktree 下 `.pipeline-evidence.*.jsonl`），解析每行 JSON
- **SC-3.3**：根据 `superpowers-alignment.yaml` 中 `runtime_evidence.required_events` 校验覆盖：每个 full skill 的必需 event 在 JSONL 里都有对应记录（用 `task_id` + `event` correlation）
- **SC-3.4**：`mode: opt-in` 的 skill 缺 event → stdout warn + exit 0（不阻塞）
- **SC-3.5**：`mode: enforced` 的 skill 缺 event → stderr fail + exit 非零
- **SC-3.6**：脚本自带至少 5 个单元测试（vitest）：
  1. 合法 JSONL 全覆盖 → exit 0
  2. opt-in 缺 event → warn 但 exit 0
  3. enforced 缺 event → exit 非零
  4. 非法 JSON 行 → exit 非零
  5. required_events 字段 schema mismatch → exit 非零
- **SC-3.7**：校验字段合法性时支持 `assert_fields` 声明（例如 `subagent_dispatched` 必须带 `prompt_sha256`）

### FR-4: 契约扩展（runtime_evidence 字段）

- **SC-4.1**：`superpowers-alignment.yaml` 每个 `coverage_level: full` 的 skill 新增 `runtime_evidence` 子字段：
  ```yaml
  runtime_evidence:
    mode: opt-in              # opt-in | enforced（第一轮全 opt-in）
    required_events:
      - event: subagent_dispatched
        assert_fields: [subagent_type, prompt_sha256]
  ```
- **SC-4.2**：第一轮所有 skill 的 `runtime_evidence.mode` 必须是 `opt-in`（严禁 enforced，留后续 PR 收紧）
- **SC-4.3**：`test-driven-development` 的 `required_events` 必须同时包含 `tdd_red` 和 `tdd_green`（两个 event 都缺就无法证明 TDD 执行）
- **SC-4.4**：`subagent-driven-development` 的 `required_events` 必须包含 `subagent_dispatched` + `subagent_returned` 成对
- **SC-4.5**：`check-superpowers-alignment.cjs`（PR #2406 产出）保持不变，即老 gate 不读 `runtime_evidence` 字段，保持向后兼容

### FR-5: Implementer Prompt + Spec Reviewer Checklist

- **SC-5.1**：`packages/engine/skills/dev/prompts/subagent-driven-development/implementer-prompt.md` 新增段落"TDD 交付物要求"：
  - Implementer 必须先写失败测试并提交 `tdd_red` evidence（附 failure output）
  - 再写 implementation 让测试变绿，提交 `tdd_green` evidence（附 passing output）
  - 返回 `DONE` 前必须附带 `tdd_red_commit_sha` + `tdd_green_commit_sha` 两个字段
- **SC-5.2**：`packages/engine/skills/dev/prompts/subagent-driven-development/spec-reviewer-prompt.md` 新增核心检查第 6 项：
  - "TDD artifact 验证：检查 pipeline-evidence.jsonl 中是否有配对的 tdd_red + tdd_green 事件，且 red 在 green 之前"
- **SC-5.3**：两个 prompt 修改后的 sha256 回写 `superpowers-alignment.yaml`（走 PR #2406 的 sha256 gate）

### FR-6: 02-code.md 关键点插桩

- **SC-6.1**：`packages/engine/skills/dev/02-code.md` 在以下 5-7 个关键点加 `record-evidence.sh` 调用：
  1. Stage 2 开始 → `subagent_dispatched`（派发 Implementer 前）
  2. Implementer 返回 → `subagent_returned`
  3. Implementer 内部 TDD red → `tdd_red`
  4. Implementer 内部 TDD green → `tdd_green`
  5. Spec Reviewer 派发前 → `subagent_dispatched`
  6. Spec Reviewer 返回 → `subagent_returned`
  7. verification-before-completion 过关 → `verification_passed`
- **SC-6.2**：每处插桩都使用 `bash packages/engine/scripts/record-evidence.sh --event <e> --prompt <p> --output <o>` 调用形式（保证 sha256 由脚本自动算，不被手动伪造）
- **SC-6.3**：插桩失败不阻断 /dev 主流程（非硬依赖；evidence append 失败 log warn 即可）

### FR-7: CI 集成（新 gate job）

- **SC-7.1**：`.github/workflows/ci.yml`（或 `engine-ci.yml`）在 `engine-tests` job 之后新增 `pipeline-evidence-gate` step
- **SC-7.2**：step 执行 `node packages/engine/scripts/devgate/check-pipeline-evidence.cjs`
- **SC-7.3**：opt-in 阶段 step exit 0 即通过，不阻塞合并
- **SC-7.4**：step 输出 warn 清单要清晰（每条缺失独立一行，skill_name → missing_event → mode）
- **SC-7.5**：当某个 skill 切换到 enforced 时，无需改 CI 配置（check 脚本自己读 yaml 里 `mode` 字段）

---

## 假设与边界

### 假设

- **A-1**：PR #2406 已合入 main，`superpowers-alignment.yaml` / `check-superpowers-alignment.cjs` / 8 个本地 prompt 副本就位
- **A-2**：`.dev-mode` 文件格式中已有 `task_id` 和 `branch` 字段（符合 engine-devline.md 记录）
- **A-3**：CI runner 可写 worktree 内 `.pipeline-evidence.*.jsonl`（git 默认忽略，未入仓）
- **A-4**：sprints 目录已有（harness v4.3 使用），本 Initiative 只追加 `pipeline-evidence.jsonl`，不改其他 sprint 结构
- **A-5**：`js-yaml` / `sha256sum`（GNU coreutils）在 Ubuntu runner 已具备
- **A-6**：本轮 opt-in → enforced 迁移预计至少运行 2-3 周；本 Initiative 只做 opt-in，enforced 放 R8+

### 边界

- **不做** Brain DB 表扩充（evidence 只进 git，CI 能直接读）
- **不做** 实时监控（JSONL 是批处理模型，/dev 跑完后才 check）
- **不做** Stage 1/3/4 插桩（Stage 2 先跑通，其他阶段留后续 Initiative）
- **不做** 过期清理（pipeline-evidence.jsonl 随 branch 消亡即消亡，主干不留）
- **不碰** Stop Hook / DevGate 既有脚本（只**新增** check-pipeline-evidence.cjs，不改老 gate）
- **不做** enforce 迁移（第一轮全 opt-in；enforce 计划写进 roadmap 给 R8 做）
- **不改** 02-code.md 主干流程（只在关键点**插入** recorder 调用，不重排顺序）

---

## 受影响文件（完整列表）

### 新增

```
docs/engine/pipeline-evidence-schema.md                        # Schema 文档 + 10 event JSON example
packages/engine/scripts/record-evidence.sh                     # JSONL recorder
packages/engine/scripts/devgate/check-pipeline-evidence.cjs    # CI gate
tests/engine/devgate/pipeline-evidence.test.ts                 # 至少 5 个测试 case
docs/learnings/cp-04181830-l2-dynamic-contract.md              # Learning
```

### 修改

```
packages/engine/contracts/superpowers-alignment.yaml           # 10 个 full skill 追加 runtime_evidence 字段
packages/engine/skills/dev/prompts/subagent-driven-development/implementer-prompt.md    # TDD 交付物段落
packages/engine/skills/dev/prompts/subagent-driven-development/spec-reviewer-prompt.md  # 第 6 项 checklist
packages/engine/skills/dev/02-code.md                           # 5-7 个关键点插桩
.github/workflows/ci.yml                                        # pipeline-evidence-gate step（或 engine-ci.yml）
packages/engine/feature-registry.yml                            # 新增 R8-l2-dynamic-contract changelog
packages/engine/package.json + VERSION + .hook-core-version + package-lock.json + regression-contract.yaml  # 版本 bump
```

---

## 成功标准

> 以下标准在 PR merge 前全部满足。

- **SM-1**：`pipeline-evidence-schema.md` 定义 10 event types 完整（含 JSON example），schema 文档 ≥ 400 行
- **SM-2**：`bash packages/engine/scripts/record-evidence.sh --event subagent_dispatched --subagent-type implementer --prompt <path> --task-id <uuid> --branch test --output /tmp/x.jsonl` 产出合法单行 JSONL
- **SM-3**：`node packages/engine/scripts/devgate/check-pipeline-evidence.cjs` 在本 PR 上 exit 0（opt-in 模式，warn 清单可为空或非空均可）
- **SM-4**：`npm test -- tests/engine/devgate/pipeline-evidence.test.ts` 至少 5 个 case 全绿
- **SM-5**：`node packages/engine/scripts/devgate/check-superpowers-alignment.cjs` 仍 exit 0（L1 gate 向后兼容，未被 L2 字段污染）
- **SM-6**：CI `pipeline-evidence-gate` step 在本 PR green（opt-in 不阻塞）
- **SM-7**：下一次真实 /dev 任务运行时，worktree 内产出 `.pipeline-evidence.<branch>.jsonl` 且含至少 4 种 event（`subagent_dispatched` / `subagent_returned` / `tdd_red` / `tdd_green`）
- **SM-8**：Learning `docs/learnings/cp-04181830-l2-dynamic-contract.md` 含 `### 根本原因` + `### 下次预防` 两节
- **SM-9**：feature-registry.yml 含 `R8-l2-dynamic-contract` changelog 条目

---

## 风险与开闭

### 主要风险

- **R-1**：Implementer subagent 忘记调 `record-evidence`，导致 tdd_red / tdd_green 永远缺失 → 第一轮 opt-in 只 warn，等 Implementer prompt 稳定后再转 enforced
- **R-2**：pipeline-evidence.jsonl 被手动编辑（绕 CI）→ `prompt_sha256` 由 recorder 自动计算，手动构造不通过 schema 验证；且 JSONL 写进 worktree 后 git 历史可追溯
- **R-3**：opt-in 一直不转 enforced（方法论 gate 成摆设）→ 本 PRD 非目标已写明 enforced 迁移放 R8；R8 Initiative 已占 roadmap 位
- **R-4**：`runtime_evidence` 字段扩展导致 L1 gate 崩溃 → L1 gate 只读明确字段（`anchor_file` / `required_keywords` / `local_prompt_sha256`），新字段自动 ignore；回归测试覆盖

### 迁移路径（opt-in → enforced）

第 1 轮（本 Initiative）：全部 opt-in，warn 清单可见
第 2 轮（R8）：先转 `test-driven-development` + `subagent-driven-development` 到 enforced（这两个 event 信号最强）
第 3 轮（R9）：转 `verification-before-completion` + `requesting-code-review`
第 4 轮（R10+）：剩余 skill 逐个转 enforced

每轮转 enforced 前必须验证连续 2 周以上 PR 的 evidence 完备率 ≥ 95%。
