# PRD: Engine ↔ Superpowers 对齐契约 + DevGate 防退化固化

> Version: 1.0.0
> Created: 2026-04-18
> Owner: Engine 维护者
> Branch: cp-04181830-r7-superpowers-gap

---

## 背景与动机

### 问题陈述

过去数月，Engine 仓库（`packages/engine/`）在"吸收 Superpowers 最佳实践"上出现严重**状态漂移**：

1. **文档吹了，代码没落地**：README / feature-registry 宣称"92% 已吸收 Superpowers"，实际审查发现：
   - 多个 skill 只留占位符 `manual:TODO`
   - 吸收"率"是拍脑袋数字，没有机器可验证的契约支撑
2. **版本号五处漂移**：`package.json` / `package-lock.json` / `VERSION` / `.hook-core-version` / `regression-contract.yaml` 各写各的，`.hook-core-version` 停留在 `13.7.7` 而 `package.json` 已到 `14.17.5`
3. **悬空引用**：Engine skill 中仍有 `superpowers:xxx/yyy.md` 形式的外部引用，但本地并无对应副本，断链不报错
4. **无反向保护**：Superpowers 官方升级了 prompt，Engine 完全感知不到。没有 hash guard，也没有人工告警
5. **越改越乱**：每一轮"对齐"工作都在原有乱象上叠加新文件/新标志位，没有机械门禁约束，熵只增不减

### 为什么现在必须做

- **Harness v4.3 / autonomous_mode** 依赖 Superpowers 的 `brainstorming` / `writing-plans` / `subagent-driven-development` 作为流水线的脊柱。这条脊柱的"本地化副本 + sha256"没有机器验证就是随时可断的隐患
- 下一次 Superpowers 小升级（5.0.8 → 5.1.0）大概率会静默破坏 Engine 的吸收契约，造成线上 `/dev --autonomous` 卡死
- CI 现只跑 L1/L2/L3/L4，无 alignment-gate，任何 PR 都可以绕过对齐检查合入 main

### 非目标（明确不做）

- **不吸收** `using-git-worktrees` / `using-superpowers` / `writing-skills`（Engine 有自己的 worktree / skill 体系，没有重叠需求）
- **不修改** Superpowers 官方源文件 `~/.claude/skills/superpowers/`
- **不引入**"吸收率"指标，用**契约覆盖清单**取代（14 个 skill 每一个都有明确状态：full / partial / not_planned）

---

## 目标

**一句话核心目标**：把 Engine ↔ Superpowers 的对齐状态用**可机器验证的契约 + CI gate** 固化，任何破坏对齐的 PR 在 merge 前被 CI 拒绝。

### 可度量子目标

1. **SG-1**：产出 `packages/engine/contracts/superpowers-alignment.yaml` 契约文件，覆盖 14 个 Superpowers skill（full / partial / not_planned 三态全覆盖）
2. **SG-2**：`manual:TODO` 占位符从现有 N 条 → 0 条
3. **SG-3**：悬空 `superpowers:xxx/yyy.md` 引用从现有 M 条 → 0 条
4. **SG-4**：5 处版本号全部同步到 `14.17.5`（grep 可验证）
5. **SG-5**：CI 新增 `engine-alignment-gate` job，在本 PR 上 green；故意引入一条违规后 CI 能正确拦截

---

## User Stories

- **US-1**：作为 **Engine 维护者**，当我在 PR 中误删一个已吸收的 Superpowers 本地化副本时，CI 必须在 L1 阶段拒绝合并，并在日志中告诉我具体哪个 skill 的 `local_prompt.sha256` mismatch
- **US-2**：作为 **/dev autonomous 流程**，当我加载 `superpowers:brainstorming` 的本地副本时，我可以信任 `packages/engine/skills/dev/prompts/brainstorming/SKILL.md` 的内容与 `superpowers-alignment.yaml` 里记录的 sha256 一致，不会"本地是旧的、契约是新的"
- **US-3**：作为 **Superpowers 升级审视者**，当 Superpowers 官方升级到 5.1.0 且我本地 pull 到新副本后，CI `engine-alignment-gate` 必须告警"官方 sha256 变了，需要重审 Engine 的吸收层"，而不是静默通过
- **US-4**：作为 **Engine 版本发布者**，当我运行 `bash packages/engine/scripts/bump-version.sh patch` 时，5 处版本号被一次性同步，再也不需要人肉改 5 个文件
- **US-5**：作为 **合并 review 者**，当我在 PR 里看到 `engine-alignment-gate = green` 时，我可以相信 Engine 和 Superpowers 的对齐状态是真实的，不是文档里的宣传口径

---

## 功能需求（FR + 成功标准 SC）

### FR-1: Superpowers 对齐契约文件

- **SC-1.1**：`packages/engine/contracts/superpowers-alignment.yaml` 存在且为合法 YAML
- **SC-1.2**：契约 `skills` 数组长度 = 14（覆盖 Superpowers 5.0.7 全部 skill）
- **SC-1.3**：每个 `coverage_level: full` 或 `coverage_level: partial` 的 skill 必须有：
  - `anchor_file`：Engine 侧本地化副本路径
  - `required_keywords`：本地副本必须包含的关键词列表（至少 3 个）
  - `local_prompt_sha256`：本地副本的 sha256（由 DevGate 脚本校验）
- **SC-1.4**：`coverage_level: not_planned` 的 skill 必须有 `reason` 字段说明为什么不吸收

### FR-2: 5-8 个 Superpowers prompt 本地化副本

- **SC-2.1**：`packages/engine/skills/dev/prompts/` 目录存在
- **SC-2.2**：下列 skill 的本地副本全部存在（T1 产出）：
  - `brainstorming/SKILL.md`
  - `writing-plans/SKILL.md`
  - `executing-plans/SKILL.md`
  - `subagent-driven-development/SKILL.md`
  - `test-driven-development/SKILL.md`
  - `verification-before-completion/SKILL.md`
  - `systematic-debugging/SKILL.md`（partial，仅保留"F4 调用时机"片段）
  - `receiving-code-review/SKILL.md`
- **SC-2.3**：每个本地副本的实际 sha256 与 `superpowers-alignment.yaml` 中登记值一致

### FR-3: 3 个 DevGate 脚本可执行

- **SC-3.1**：`packages/engine/scripts/devgate/check-superpowers-alignment.cjs` 存在且 `node <script>` 退出码为 0（当前分支已修复违规时）
- **SC-3.2**：`packages/engine/scripts/devgate/check-engine-hygiene.cjs` 存在，能扫描 `manual:TODO` / 悬空 `superpowers:` 引用 / 空 `regression-contract.yaml`，发现违规退出码非零
- **SC-3.3**：`packages/engine/scripts/bump-version.sh patch --dry-run` 存在，能一次打印 5 处版本号的预期 diff
- **SC-3.4**：3 个脚本各自有对应单元测试（`tests/engine/devgate/*.test.ts`）

### FR-4: CI 新增 engine-alignment-gate

- **SC-4.1**：`.github/workflows/engine-ci.yml` 新增 job 名为 `engine-alignment-gate`
- **SC-4.2**：该 job 执行顺序为 `check-version-sync → check-superpowers-alignment → check-engine-hygiene`
- **SC-4.3**：任一 check 失败 → job fail → PR 合并被 required-check 拒绝
- **SC-4.4**：在本 PR 内**故意引入**一条违规（例如改一个 sha256）验证 gate 触发，然后回滚

### FR-5: 版本号同步

- **SC-5.1**：5 处版本号全部为 `14.17.5`：
  - `packages/engine/package.json` `version`
  - `packages/engine/package-lock.json` 中 engine 包自身的 `version`
  - `packages/engine/VERSION`
  - `packages/engine/.hook-core-version`
  - `packages/engine/regression-contract.yaml` 的 `engine_version` 字段
- **SC-5.2**：`bash packages/engine/scripts/check-version-sync.sh` 退出码为 0
- **SC-5.3**：`feature-registry.yml` 新增本次 changelog 条目，指向 `R7-superpowers-alignment`

### FR-6: 清理违规

- **SC-6.1**：`grep -r 'manual:TODO' packages/engine` 无输出
- **SC-6.2**：`packages/engine` 下无悬空 `superpowers:xxx/yyy.md` 引用（要么本地化到 `skills/dev/prompts/`，要么删除）
- **SC-6.3**：`packages/engine/regression-contract.yaml` 要么非空，要么明确含 `allow_empty: true` 标记

---

## 假设与边界

### 假设

- A-1：Superpowers 5.0.7 是当前本地 pin 的版本（T1 已产出对应本地副本）
- A-2：T2 产出的违规清单在本 PR 执行期间未被其他 PR 变动（冲突时以本 PR 为准）
- A-3：Ubuntu runner 上 `node` ≥ 18 / `js-yaml` 已在 engine 依赖中
- A-4：`.hook-core-version` 从 `13.7.7` 跳到 `14.17.5` 不会破坏 Hook 兼容（hook 只读取大版本号判断）

### 边界

- **不吸收** `using-git-worktrees` / `using-superpowers` / `writing-skills`（契约中标 `not_planned`）
- **不修改** Superpowers 源文件（`~/.claude/skills/superpowers/`）
- **不重写** 现有 `01-spec.md` / `02-code.md` 流程（只在 `SKILL.md` 顶部补 `prompts/` 引用）
- **不引入"吸收率"指标**（用契约覆盖清单替代）
- **systematic-debugging** 保留 `coverage_level: partial`（原因：Engine 的 F4 调用时机与官方不一致，只吸收决策树那一段）

---

## 受影响文件（完整列表）

### 新增（T1 + T3 产出）

```
packages/engine/contracts/superpowers-alignment.yaml
packages/engine/skills/dev/prompts/brainstorming/SKILL.md
packages/engine/skills/dev/prompts/writing-plans/SKILL.md
packages/engine/skills/dev/prompts/executing-plans/SKILL.md
packages/engine/skills/dev/prompts/subagent-driven-development/SKILL.md
packages/engine/skills/dev/prompts/test-driven-development/SKILL.md
packages/engine/skills/dev/prompts/verification-before-completion/SKILL.md
packages/engine/skills/dev/prompts/systematic-debugging/SKILL.md
packages/engine/skills/dev/prompts/receiving-code-review/SKILL.md
packages/engine/skills/dev/prompts/manifest.yaml
```

### 新增（T4 产出）

```
packages/engine/scripts/devgate/check-superpowers-alignment.cjs
packages/engine/scripts/devgate/check-engine-hygiene.cjs
packages/engine/scripts/bump-version.sh
tests/engine/devgate/alignment-check.test.ts
tests/engine/devgate/hygiene-check.test.ts
tests/engine/devgate/bump-version.test.ts
```

### 修改（T2 违规清单 + T5 CI/Hook patch）

```
packages/engine/package.json           # version → 14.17.5
packages/engine/package-lock.json      # version → 14.17.5（两处）
packages/engine/VERSION                # → 14.17.5
packages/engine/.hook-core-version     # 13.7.7 → 14.17.5
packages/engine/regression-contract.yaml  # engine_version → 14.17.5 + 非空
packages/engine/feature-registry.yml   # 新增 changelog 条目
.github/workflows/engine-ci.yml        # 新增 engine-alignment-gate job
packages/engine/skills/**/*.md         # 清理 manual:TODO + 悬空引用（按 T2 清单）
```

### 产出文档（本任务）

```
docs/learnings/cp-04181830-superpowers-alignment.md
```

---

## 成功标准

> 以下标准在 PR merge 前全部满足。

- **SM-1**：`bash packages/engine/scripts/check-version-sync.sh` → exit 0
- **SM-2**：`node packages/engine/scripts/devgate/check-superpowers-alignment.cjs` → exit 0
- **SM-3**：`node packages/engine/scripts/devgate/check-engine-hygiene.cjs` → exit 0
- **SM-4**：CI `engine-alignment-gate` job 在本 PR 的最后一次 push 上 green
- **SM-5**：本 PR 中途故意引入一条违规（例如改一个 sha256），CI 能在该 commit 拦截；随后回滚，最终 commit green
- **SM-6**：合并后下一个 PR 若在 `prompts/` 目录改一个字节未同步 sha256，CI 自动拦截（用一个简单的 dry-run PR 验证，不合并）
- **SM-7**：Learning 文件 `docs/learnings/cp-04181830-superpowers-alignment.md` 存在且含 `### 根本原因` + `### 下次预防` 两节
