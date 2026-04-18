# PRD: Phase 1 模式统一 — 删除 Standard + 孤儿 PR 兜底 Worker

> Version: 1.0.0
> Created: 2026-04-18
> Owner: Engine + Brain 维护者
> Branch: cp-0418xxxx-phase1-dev-mode-unification
> Upstream Initiative: engine-phase1-unification

---

## 背景与动机

### 问题陈述

PR #2406（L1 静态契约）与 #2408（L2 动态契约）合并后，在 harness 流水线真实跑动中暴露了 `/dev` 的**三模式混乱**根因：

1. **Standard 模式已退化为无人使用**：
   - `SKILL.md` 仍在维护"流程（标准模式）"与"流程（autonomous_mode）"两套叙述
   - `02-code.md` 中保留"主 agent 直写"分支，与 Superpowers `subagent-driven-development` 路径并存
   - `parse-dev-args.sh` 中 `--autonomous` 是显式旗标，导致调用者必须"记得加"；不加时进入的标准模式其实没人维护
2. **Harness 模式只是一个快速通道开关，不是独立模式**：
   - `devloop-check.sh` 对 `harness_mode=true` 只做了"跳过 cleanup_done 通用早退 + 只检查 code done + PR 创建"
   - 换句话说 Harness 与 Autonomous 的差异只在"谁决定合并"（Evaluator vs Stop Hook），不是两条流水线
3. **Stop Hook 漏兜底**：
   - 一旦 Stop Hook 判断提前 `exit 0`（例如读取 `.dev-mode` 路径错误、worktree cwd 变化）：
     - Autonomous 模式 PR 会悬在 open 状态
     - Harness 模式 Evaluator 挂掉时 PR 也会悬着
   - Brain 缺少**横向兜底扫描 cp-* PR 的 worker**，孤儿 PR 无人接管

### 为什么现在必须做

- 用户明确决策："`/dev` 只需要一个，我独立的 autonomous 可以走，我不独立的 harness 也可以走。"（2026-04-18）
- Phase 2（未来）要把 Harness Evaluator 降级为 PR required check，彻底消除 harness shortcut。Phase 1 先收敛模式数，让 Phase 2 有清晰的单一主干可改
- 不做模式统一，每加一个新特性（比如 R5/R6/R8）都要在 3 条路径上各写一遍，熵只增不减

### 非目标（明确不做）

- **不删除 `harness_mode`**：Brain 派 harness task 时仍走 `devloop-check.sh` 的 harness 快速通道（Phase 2 才处理）
- **不修改 Harness Evaluator 的行为**：本 Phase 对 `harness-evaluator/SKILL.md` 零改动
- **不删除 `--autonomous` CLI flag**：保留为 no-op + warn，避免老脚本 / CI job 崩溃
- **不触碰 Superpowers 本地化副本 + sha256 契约**（属于 PR #2406 的职责）

---

## 目标

**一句话核心目标**：把 `/dev` 从"三模式分叉"收敛为"单 autonomous 主干 + harness_mode 快速通道 flag"，并在 Brain 端新增 orphan-pr-worker 兜底扫孤儿 PR。

### 可度量子目标

1. **SG-1**：`.dev-mode` schema 删除 `autonomous_mode` 字段（Brain 派发 payload 中的 `autonomous_mode` 字段不再被 Engine 读取）
2. **SG-2**：`devloop-check.sh` 中的 `autonomous_mode` 读取代码行 = 0（grep 可验证）
3. **SG-3**：`SKILL.md` / `02-code.md` 中"标准模式 vs autonomous_mode"的并列叙述删除，统一为单一"流程"章节
4. **SG-4**：`parse-dev-args.sh --autonomous` flag 保留但降级为 no-op + stderr warn（向后兼容）
5. **SG-5**：新增 `packages/brain/src/orphan-pr-worker.js`，每 30 分钟扫一次 `cp-*` open PR，孤儿（age > 2h 且 Brain 无对应 in_progress task）按策略处理
6. **SG-6**：`harness_mode=true` 分支仍保留且单元测试覆盖（向后兼容 Brain harness pipeline）
7. **SG-7**：CI L1/L2 DevGate 全绿；`engine-ci.yml` 不新增 job（本 PR 不引入新 CI gate）

---

## User Stories

- **US-1**：作为 `/dev` 直接使用者（本机手动触发），我调 `/dev <prd>` 不再需要加 `--autonomous` flag，默认就是 Superpowers 三角色 subagent-driven-development 流水线
- **US-2**：作为 Brain harness pipeline 派发者（`harness-graph-runner.js` 中派发 `harness_generate` task），我仍能通过 `.dev-mode` 中 `harness_mode: true` 走快速通道（Stage 2 + PR 创建即可，Evaluator 接管后续）
- **US-3**：作为 Engine 维护者，我阅读 `SKILL.md` 时只会看到一条"流程"，不再有"标准 vs autonomous"的并列叙述，避免"哪个是默认"的混淆
- **US-4**：作为 Brain 维护者，任何原因导致 `cp-*` PR 悬在 open 状态超过 2 小时（无对应 in_progress task），Brain orphan-pr-worker 会自动处理：CI green → auto-merge；CI fail → 打 `needs-attention` label 并在 Brain 告警
- **US-5**：作为 CI job 老脚本维护者，我调用 `/dev --autonomous <prd>` 时仍能正常跑完（flag 被识别为 no-op + warn，不报错）
- **US-6**：作为 Harness Evaluator 角色，我仍能假设 `.dev-mode` 里有 `harness_mode: true` 时 Stop Hook 会快速放行（本 Phase 不改变 Harness 合同）

---

## 功能需求（FR + 成功标准 SC）

### FR-1: 删除 Standard 模式（/dev 统一为 autonomous）

- **SC-1.1**：`packages/engine/skills/dev/SKILL.md` 中「流程（标准模式）」与「流程（autonomous_mode）」合并为单一 `## 流程` 章节，保留 autonomous 三角色流水线
- **SC-1.2**：`packages/engine/skills/dev/steps/02-code.md` 中「主 agent 直写」的分支文案删除或标为"本章节已废弃，统一走 subagent-driven-development"
- **SC-1.3**：`packages/engine/skills/dev/steps/autonomous-research-proxy.md` 加载条件从"autonomous_mode=true 才加载"改为"始终加载"（SKILL.md 顶部引用）
- **SC-1.4**：`packages/engine/lib/devloop-check.sh` 中所有 `autonomous_mode` 读取 / 分支判断代码删除（保留 `harness_mode` 分支）
- **SC-1.5**：`packages/engine/skills/dev/scripts/parse-dev-args.sh` 的 `--autonomous` flag 降级为 no-op + stderr warn（格式：`[WARN] --autonomous is deprecated and now a no-op; /dev is always autonomous`）
- **SC-1.6**：Brain task payload 中若仍有 `autonomous_mode: true`，Engine 侧忽略即可（不报错、不告警）

### FR-2: Brain orphan-pr-worker

- **SC-2.1**：新增 `packages/brain/src/orphan-pr-worker.js`，导出 `scanOrphanPrs(opts)` 函数
- **SC-2.2**：worker 接受 `{ dryRun?: boolean, ageThresholdMs?: number, timeoutMs?: number }` 配置
- **SC-2.3**：`scanOrphanPrs` 行为：
  - 查询所有 `cp-*` open PR（`gh pr list --state open --search "head:cp-"`）
  - 对每个 PR：
    - 获取 `createdAt`，若 `now - createdAt < ageThresholdMs`（默认 2h）→ 跳过
    - 查询 Brain `dev_records` / `tasks` 表，判断是否有对应 `in_progress` task（匹配 `branch` 字段）
    - 若存在对应 in_progress task → 跳过（不是孤儿）
    - 若是孤儿：
      - CI 全绿 → `gh pr merge --auto --squash`
      - CI 有 fail → `gh pr edit --add-label needs-attention` + Brain 写 `alerts` 表告警
      - CI pending → 跳过（下个周期再看）
- **SC-2.4**：`scanOrphanPrs({ dryRun: true })` 只打印计划，不执行 merge / label / alert
- **SC-2.5**：`packages/brain/src/tick.js` 集成 orphan-pr-worker，每 ~30 分钟触发一次（复用现有 `_lastCleanupWorkerTime` 相似的节流机制）
- **SC-2.6**：worker 自身有单元测试 `packages/brain/src/__tests__/orphan-pr-worker.test.js`，覆盖：
  - 年轻 PR（< 2h）跳过
  - 有对应 in_progress task 的 PR 跳过
  - 孤儿 PR + CI green → dry-run 输出 `would-merge`
  - 孤儿 PR + CI fail → dry-run 输出 `would-label + would-alert`

### FR-3: 向后兼容

- **SC-3.1**：`harness_mode=true` 分支在 `devloop-check.sh` 中保留（行数不减少），Brain `harness-graph-runner.js` 派发逻辑不变
- **SC-3.2**：现有 L1/L2 DevGate 全绿：
  - `bash scripts/check-version-sync.sh`
  - `node packages/engine/scripts/devgate/check-dod-mapping.cjs`
  - `node scripts/facts-check.mjs`
- **SC-3.3**：`parse-dev-args.sh --autonomous` 传入时仍能成功 exit 0（只打 warn 不报错）
- **SC-3.4**：Brain `dispatch.payload.autonomous_mode` 字段若存在，Engine 忽略后不影响任务完成

---

## 假设与边界

### 假设

- A-1：PR #2406（L1 契约）+ #2408（L2 动态契约）已合并到 main，本 PR 基于最新 main 起步
- A-2：Brain `dev_records` 表有 `branch` 字段（用于匹配 PR head → task），若没有 FR-2 需要先加 migration
- A-3：Runner 上 `gh` CLI 已认证（`GH_TOKEN` 或 `GITHUB_TOKEN`），`gh pr list --state open --search "head:cp-"` 可直接调用
- A-4：Brain tick loop 已在 prod 以 5 秒周期跑动，30 分钟节流通过 `now - _lastOrphanPrWorkerTime > 30 * 60 * 1000` 守住
- A-5：`harness_mode` 分支在本 Phase 保留；Phase 2（后续 PR）才删除

### 边界

- **不修改** `harness-evaluator/SKILL.md`（Harness v5.2 合同不动）
- **不新增 CI job**（本 Phase 不引入 alignment-gate 类新门禁）
- **不改 Superpowers 本地化副本** / **不改 sha256 契约**（属于 #2406 职责）
- **不处理 non-cp-* branch 的 PR**（例如 feature/*，由人工 review）
- **不做 orphan worker 的 Brain Dashboard UI**（只在 `alerts` 表写入，后续 PR 可加 UI）

---

## 受影响文件（完整列表）

### 新增

```
packages/brain/src/orphan-pr-worker.js
packages/brain/src/__tests__/orphan-pr-worker.test.js
docs/learnings/cp-0418xxxx-phase1-dev-mode-unification.md
```

### 修改

```
packages/engine/skills/dev/SKILL.md
  - 合并「流程（标准模式）」+「流程（autonomous_mode）」为单一「## 流程」
  - description/changelog 去"支持 autonomous_mode 全自动模式"表述
  - autonomous-research-proxy.md 从条件加载改为始终加载

packages/engine/skills/dev/steps/02-code.md
  - 删除 / 标记废弃"主 agent 直写"分支
  - 统一走 Superpowers subagent-driven-development

packages/engine/skills/dev/steps/autonomous-research-proxy.md
  - 顶部说明从"仅 autonomous 时加载"改为"默认加载"

packages/engine/skills/dev/steps/01-spec.md
  - 清理 "autonomous_mode" 条件分支

packages/engine/skills/dev/steps/00.5-enrich.md
  - 清理 "autonomous_mode" 条件（Enrich 始终执行 or 读 task payload 决定）

packages/engine/lib/devloop-check.sh
  - 删除 autonomous_mode 读取 / 分支判断
  - 保留 harness_mode 分支不动

packages/engine/skills/dev/scripts/parse-dev-args.sh
  - --autonomous flag 降级为 no-op + stderr warn

packages/engine/feature-registry.yml
  - 新增 changelog 条目：phase1-dev-mode-unification

packages/engine/package.json
packages/engine/package-lock.json
packages/engine/VERSION
packages/engine/.hook-core-version
packages/engine/regression-contract.yaml
  - 5 处版本号 bump（minor）

packages/brain/src/tick.js
  - 集成 orphan-pr-worker 调度（30 分钟节流）
```

### 涉及但不改动（回归覆盖）

```
packages/engine/hooks/stop.sh
packages/engine/hooks/stop-dev.sh
  - 两个 hook 仍调用 devloop-check.sh，harness_mode 分支保留即回归安全

packages/workflows/skills/harness-evaluator/
  - Harness Evaluator 合同不动
```

---

## 成功标准

> 以下标准在 PR merge 前全部满足。

- **SM-1**：`grep -rn autonomous_mode packages/engine/lib/` → 无输出
- **SM-2**：`grep -rn "autonomous_mode:" packages/engine/skills/dev/` → 无输出（SKILL.md / steps / scripts 全部清理）
- **SM-3**：`bash scripts/check-version-sync.sh` → exit 0
- **SM-4**：`node packages/engine/scripts/devgate/check-dod-mapping.cjs` → exit 0
- **SM-5**：`node packages/brain/src/orphan-pr-worker.js --dry-run` → exit 0 并有 JSON 输出
- **SM-6**：`npx vitest run packages/brain/src/__tests__/orphan-pr-worker.test.js` → all green
- **SM-7**：`node -e "const c=require('fs').readFileSync('packages/brain/src/tick.js','utf8');if(!c.includes('orphan-pr-worker'))process.exit(1)"` → exit 0
- **SM-8**：`node -e "const c=require('fs').readFileSync('packages/engine/lib/devloop-check.sh','utf8');if(!c.includes('harness_mode'))process.exit(1)"` → exit 0（向后兼容守卫）
- **SM-9**：`bash packages/engine/skills/dev/scripts/parse-dev-args.sh --autonomous /tmp/fake-prd.md 2>&1 | grep -c deprecated` ≥ 1（warn 消息存在）
- **SM-10**：CI engine-ci.yml + brain-ci.yml 全绿
- **SM-11**：Learning 文件 `docs/learnings/cp-0418xxxx-phase1-dev-mode-unification.md` 存在且含 `### 根本原因` + `### 下次预防` 两节
