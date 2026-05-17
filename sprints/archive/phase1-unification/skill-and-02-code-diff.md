# Phase 1 Unification — SKILL.md + .dev-mode schema + 02-code.md + autonomous-research-proxy.md 完整 Edit 指令

> **背景**：删除 /dev 的 Standard 模式，Autonomous（三角色 subagent）成为唯一默认流程。
> **T3 范围**：SKILL.md / .dev-mode schema（仅列出涉及文件的改动点）/ 02-code.md / autonomous-research-proxy.md
> **只读不写**：本文档只草拟 Edit 指令，实际执行由协调 agent 分配

---

## File 1: `packages/engine/skills/dev/SKILL.md`

目标：
- 删除 "## 流程（标准模式）" 章节
- "## 流程（autonomous_mode）" → "## 流程"
- L129+ "## autonomous_mode（全自动模式）" → "## 模式说明"（说明三角色 subagent + 触发条件）
- frontmatter `--autonomous` 说明已废弃
- Stop Hook 章节里"### 标准模式" → 合并成"### 默认模式"

### Edit 1 (改 frontmatter description + trigger + changelog)

**old_string**:
```
---
name: dev
version: 14.17.5
updated: 2026-04-15
description: 统一开发工作流（4-Stage Pipeline）。代码变更必须走 /dev。支持 Harness v2.0 模式。支持 autonomous_mode 全自动模式。autonomous_mode 新增 Step 0.5 PRD Enrich 前置层 + autonomous-research-proxy 用户交互替换层。
trigger: /dev, --task-id <id>, --autonomous
changelog:
  - 7.2.0: autonomous_mode 强制加载 autonomous-research-proxy — Superpowers user 交互点全替换为 Research Subagent
  - 7.1.0: autonomous_mode 新增 Step 0.5 PRD Enrich 前置层 — 粗 PRD 自动丰满
  - 7.0.0: Superpowers 融入 — autonomous_mode 三角色架构
---
```

**new_string**:
```
---
name: dev
version: 15.0.0
updated: 2026-04-18
description: 统一开发工作流（4-Stage Pipeline）。代码变更必须走 /dev。唯一默认流程为 Superpowers 三角色 subagent（Implementer + Spec Reviewer + Code Quality Reviewer），支持 Harness v2.0 模式。Step 0.5 PRD Enrich 前置层 + autonomous-research-proxy 用户交互替换层默认加载。
trigger: /dev, --task-id <id>
changelog:
  - 15.0.0: Phase 1 统一 — 删除 Standard 模式，三角色 Subagent 成为唯一默认流程；--autonomous 标志废弃（保留别名兼容旧脚本，等价于 /dev）；.dev-mode schema 删 autonomous_mode 字段
  - 7.2.0: autonomous_mode 强制加载 autonomous-research-proxy — Superpowers user 交互点全替换为 Research Subagent
  - 7.1.0: autonomous_mode 新增 Step 0.5 PRD Enrich 前置层 — 粗 PRD 自动丰满
  - 7.0.0: Superpowers 融入 — autonomous_mode 三角色架构
---
```

**reason**: 升版本、更新 description 摆正"三角色是唯一默认"、trigger 去掉 --autonomous（保留别名，只在行为文档里说明废弃）、changelog 加 15.0.0。

---

### Edit 2 (删除 "## 流程（标准模式）" 章节 + 改 "流程（autonomous_mode）" 标题)

**old_string**:
```
## 流程（标准模式）

```
Step 0: Worktree  → 创建独立 worktree
Stage 1: Spec     → 主 agent 写 Task Card + DoD → 写 .dev-mode
Stage 2: Code     → 主 agent 写代码 + 逐条验证 DoD
Stage 3: Integrate → push + PR 创建（CI 由 Stop Hook 自动监控）
Stage 4: Ship     → Learning + 标记完成（合并/清理由 Stop Hook 自动执行）
```

## 流程（autonomous_mode）

```
Step 0: Worktree
Step 0.5: PRD Enrich (仅 autonomous_mode，粗 PRD 自动丰满)
Stage 1: Spec (读 enriched PRD)
Stage 2: Code (Subagent 三角色)
Stage 3-4: Integrate + Ship
```
```

**new_string**:
```
## 流程

```
Step 0: Worktree  → 创建独立 worktree
Step 0.5: PRD Enrich → 粗 PRD 由 Enrich Subagent 多轮自反思丰满
Step 0.7: Decision Query → 查 Brain decisions 表作为硬约束
Stage 1: Spec     → 读 enriched PRD，内嵌 superpowers:brainstorming + writing-plans 自主产出 Task Card + Plan
Stage 2: Code     → 三角色 Subagent（Implementer / Spec Reviewer / Code Quality Reviewer）
Stage 3: Integrate → push + PR 创建（CI 由 Stop Hook 自动监控）
Stage 4: Ship     → Learning + 标记完成（合并/清理由 Stop Hook 自动执行）
```
```

**reason**: 删除整段 Standard 流程 + 合并 autonomous 流程到唯一 "## 流程"。补进 Step 0.5/0.7，明确 Stage 1/2 走 Superpowers + 三角色。

---

### Edit 3 (改 "Stop Hook 完成条件" 章节：删"标准模式"标题、合并为"默认模式")

**old_string**:
```
## Stop Hook 完成条件（devloop-check.sh）

### 标准模式

```
0. cleanup_done: true → exit 0（结束）
1. step_1_spec done？
2. step_2_code done？ + DoD 全部 [x]
3. PR 已创建？
4. CI 通过？（失败→Stop Hook 指导修复→重推）
5. PR 已合并？→ cleanup.sh + cleanup_done → exit 0
6. step_4_ship done？→ 自动合并 PR → cleanup.sh → cleanup_done → exit 0
```

### Harness 模式（harness_mode: true）
```

**new_string**:
```
## Stop Hook 完成条件（devloop-check.sh）

### 默认模式

```
0. cleanup_done: true → exit 0（结束）
1. step_1_spec done？
2. step_2_code done？ + DoD 全部 [x]
3. PR 已创建？
4. CI 通过？（失败→Stop Hook 指导修复→重推）
5. PR 已合并？→ cleanup.sh + cleanup_done → exit 0
6. step_4_ship done？→ 自动合并 PR → cleanup.sh → cleanup_done → exit 0
```

### Harness 模式（harness_mode: true）
```

**reason**: "标准模式" → "默认模式"（因为三角色已经是默认）。完成条件逻辑不变。

---

### Edit 4 (改 L129+ "## autonomous_mode（全自动模式）" 章节 → "## 模式说明")

**old_string**:
```
## autonomous_mode（全自动模式）

**触发**: `/dev --autonomous` 或 Brain task payload `autonomous_mode: true`

**加载顺序 (v14.14.0)**: `/dev --autonomous` 启动后, 主 agent 必须先加载 `packages/engine/skills/dev/steps/autonomous-research-proxy.md` 到系统 context, 再进入 Step 0. 该文件定义 Superpowers 所有 user 交互点 -> Research Subagent 的替换规则。只有加载了 `autonomous-research-proxy.md`, 后续 Superpowers skill 链中的所有 user 交互才会被 Subagent 代替。

**流程**:
- Stage 1: `superpowers:brainstorming` + `superpowers:writing-plans` 自主产出 plan（跳过用户交互）
- Stage 2: `superpowers:subagent-driven-development` 三角色（Implementer / Spec Reviewer / Code Quality Reviewer）
- Stage 3-4: 不变（push / PR / CI / merge 自动化）

**跳过**:
- 所有用户交互问询（2-3 方案选择、DoD 确认等）
- Implementer 的"有问题要问吗"

**不跳过**（质量兜底）:
- Spec Reviewer 审查（不信任 Implementer 报告）
- Code Quality Reviewer 审查
- 失败升级规则（BLOCKED 3 次升级、Reviewer 3 轮换 implementer、3 task BLOCKED 重做 plan）
- Stop Hook 所有检查
- CI 自动合并

**适用场景**: PRD 已给，agent 有能力自己做技术决策，无需用户在实现阶段介入
```

**new_string**:
```
## 模式说明

**触发**: `/dev` 或 Brain task payload 任何 task（默认启用；`--autonomous` 标志已废弃，保留为 no-op 别名）

**加载顺序**: `/dev` 启动后, 主 agent 必须先加载 `packages/engine/skills/dev/steps/autonomous-research-proxy.md` 到系统 context, 再进入 Step 0。该文件定义 Superpowers 所有 user 交互点 → Research Subagent 的替换规则。只有加载了 `autonomous-research-proxy.md`, 后续 Superpowers skill 链中的所有 user 交互才会被 Subagent 代替。

**流程**:
- Step 0.5: Enrich Subagent 多轮自反思丰满 PRD
- Step 0.7: 查 Brain decisions 表作为硬约束
- Stage 1: `superpowers:brainstorming` + `superpowers:writing-plans` 自主产出 plan（跳过用户交互）
- Stage 2: `superpowers:subagent-driven-development` 三角色（Implementer / Spec Reviewer / Code Quality Reviewer）
- Stage 3-4: push / PR / CI / merge 自动化

**跳过**:
- 所有用户交互问询（2-3 方案选择、DoD 确认等）
- Implementer 的"有问题要问吗"

**不跳过**（质量兜底）:
- Spec Reviewer 审查（不信任 Implementer 报告）
- Code Quality Reviewer 审查
- 失败升级规则（BLOCKED 3 次升级、Reviewer 3 轮换 implementer、3 task BLOCKED 重做 plan）
- Stop Hook 所有检查
- CI 自动合并

**废弃标志兼容**:
- `--autonomous` CLI 标志等价于 `/dev`（不报错、不额外触发任何分支，仅为旧脚本兼容）
- Brain task payload `autonomous_mode: true` 在 parse-dev-args.sh 中被忽略并打印 DEPRECATED 日志
```

**reason**: 章节标题换掉、删掉"适用场景"（没有 Standard 模式之后不再需要区分），新加"废弃标志兼容"说明。

---

## File 2: `.dev-mode.<branch>` schema — 所有写入点 / 读取点清单

**目标**：删 `autonomous_mode:` 行。T3 只负责 skills/dev/ 内部；devloop-check.sh / worktree-manage.sh / parse-dev-args.sh 由 T2 或其他 Worker 处理。

### 写入点

#### 写入点 1: `packages/engine/skills/dev/steps/00-worktree-auto.md`

> T3 未直接读到该文件内容，但从 T3 范围 Grep 结果推断该文件可能写 `autonomous_mode:` 到 .dev-mode。**T3 建议**：由 T1/T2 独立审阅 00-worktree-auto.md 第一次写 `.dev-mode` 的模板段。如果里面出现 `autonomous_mode: true/false` 行，应删除。

**改动指令**（待 T1/T2 验证行号）：
```
old_string: autonomous_mode: <value>\n
new_string: （整行删除）
```

---

### 读取点

#### 读取点 1: `packages/engine/skills/dev/scripts/parse-dev-args.sh:59`

T3 范围内唯一的读取点。

**改动指令**：
```
old_string:
        jq -r '.payload.autonomous_mode // false' 2>/dev/null || echo "false")

new_string:
        (DEPRECATED: autonomous_mode field ignored; /dev is always autonomous)
        echo "true"  # 默认即三角色 subagent，保留变量避免下游脚本炸
```

**reason**: 字段废弃后 parse-dev-args.sh 不再从 payload 读取。为避免下游读变量时 unbound，简单返回 "true" 字符串（也可以彻底删除该变量，由 T2 根据 devloop-check.sh 的依赖决定）。

**备注**：具体代码重写建议交由 T2 统一定稿（T2 处理 devloop-check.sh + parse-dev-args.sh）。T3 只标记"此处有改动点"。

---

#### 读取点 2: `packages/engine/skills/dev/steps/02-code.md:31`

由本 T3 在 File 3 处理，见下。

---

#### 读取点 3: `packages/engine/skills/dev/steps/00.5-enrich.md:18`

T3 范围内（但不在本任务 4 个文件清单里）。建议由同批 Worker 处理——该 step 本身仅在 autonomous 下激活，移除 autonomous_mode 判断后等价于"永远激活"，逻辑正好对应"三角色唯一默认"。

**改动方向**（供其他 Worker 参考）：
- 删 L18 `AUTONOMOUS_MODE=$(grep ...)` 及后续"仅 autonomous_mode=true 激活"判断
- 改标题、描述、changelog 从"仅 autonomous_mode 激活"→"默认激活"

---

#### 读取点 4: `packages/engine/skills/dev/steps/00.7-decision-query.md:25/67`

同读取点 3 处理方向：删 L25 变量读取 + L67 Brain task meta 里的 autonomous_mode 字眼。

---

#### 读取点 5: `packages/engine/skills/dev/steps/01-spec.md:33, 37, 78, 81, 233, 253`

范围大，建议单独 Worker 处理。主要改动：
- L33 删 `AUTONOMOUS_MODE=$(echo "$TASK_JSON" | jq -r '.payload.autonomous_mode // false')`
- L37 删 `autonomous_mode = true` 分支条件（默认走原 §0.2）
- L78 标题 "## 0.2 autonomous_mode = true 时" → "## 0.2 自主流程（默认）"
- L81 描述 "autonomous_mode=true 时, 本 step 不再由主 agent 直接写 Task Card" → "本 step 由主 agent 内嵌 superpowers:brainstorming 自主产出..."
- L233 .dev-mode 模板删 `autonomous_mode: true`
- L253 删整个 "### autonomous_mode = false（默认，现有流程不变）" 章节

---

#### 读取点 6: `packages/engine/skills/dev/steps/04-ship.md:137, 146`

改动方向：
- L137 删 `AUTO=$(grep "^autonomous_mode:" ...)` 判断
- L146 删 "autonomous_mode: true → aborting discard" 条件，改成无条件 abort（因为 autonomous 就是唯一模式）

---

## File 3: `packages/engine/skills/dev/steps/02-code.md`

**目标**：
- 删除 Section 0 的 `AUTONOMOUS_MODE=...` 读取 + 三分支判断（改成 harness vs default 二分支）
- 删除 Section 3 "standard mode（默认流程）" 整段
- Section 2 标题去掉 "autonomous_mode = true 时" 字样，改成"默认流程"
- changelog 补 10.0.0

### Edit 1 (更新 frontmatter)

**old_string**:
```
---
id: dev-step-02-code
version: 9.5.0
created: 2026-03-14
updated: 2026-04-18
changelog:
  - 9.5.0: R7 — Root-Cause Tracing 补 Phase 2 Pattern Analysis（逐字搬自 systematic-debugging/SKILL.md L122-150），原 4+1 步重组为 Phase 1/3/4，完整对齐官方 4-Phase 调试方法论
  - 9.4.0: F3 — 补 Superpowers 三个核心纪律到 Implementer prompt（Condition-Based Waiting / Pre-Completion Verification / Root-Cause Tracing），对齐 Superpowers 5.0.7 systematic-debugging + verification-before-completion
  - 9.3.0: autonomous 分支 Implementer 派遣时机改为来自 Superpowers subagent-driven-development skill，Research Subagent 处理 user 交互
  - 9.2.0: Implementer 开始前读 .decisions-<branch>.yaml 作为硬约束；Spec Reviewer 核心检查 5 验决策一致性
  - 9.1.0: Subagent Implementer/Reviewer 加全套回归强制规则（改 hooks/→跑 tests/hooks/ 全套，防止只跑新测试漏 T4 冲突）
  - 9.0.0: 新增 autonomous_mode — Subagent 三角色全自动（Implementer + Spec Reviewer + Code Quality Reviewer），失败自愈，Verification Gate
  - 7.1.0: Harness v2.0 适配 — harness_mode 下读 sprint-contract 写代码，跳过 DoD 逐条验证
  - 7.0.0: 精简 — 删除 Generator subagent、code_review_gate、独立 Evaluator。主 agent 直接写代码。
---
```

**new_string**:
```
---
id: dev-step-02-code
version: 10.0.0
created: 2026-03-14
updated: 2026-04-18
changelog:
  - 10.0.0: Phase 1 统一 — 删除 standard mode 分支（主 agent 直写 + 逐条 DoD），三角色 Subagent 成为唯一默认流程；仅保留 harness_mode 作为独立分支
  - 9.5.0: R7 — Root-Cause Tracing 补 Phase 2 Pattern Analysis（逐字搬自 systematic-debugging/SKILL.md L122-150），原 4+1 步重组为 Phase 1/3/4，完整对齐官方 4-Phase 调试方法论
  - 9.4.0: F3 — 补 Superpowers 三个核心纪律到 Implementer prompt（Condition-Based Waiting / Pre-Completion Verification / Root-Cause Tracing），对齐 Superpowers 5.0.7 systematic-debugging + verification-before-completion
  - 9.3.0: autonomous 分支 Implementer 派遣时机改为来自 Superpowers subagent-driven-development skill，Research Subagent 处理 user 交互
  - 9.2.0: Implementer 开始前读 .decisions-<branch>.yaml 作为硬约束；Spec Reviewer 核心检查 5 验决策一致性
  - 9.1.0: Subagent Implementer/Reviewer 加全套回归强制规则（改 hooks/→跑 tests/hooks/ 全套，防止只跑新测试漏 T4 冲突）
  - 9.0.0: 新增 autonomous_mode — Subagent 三角色全自动（Implementer + Spec Reviewer + Code Quality Reviewer），失败自愈，Verification Gate
  - 7.1.0: Harness v2.0 适配 — harness_mode 下读 sprint-contract 写代码，跳过 DoD 逐条验证
  - 7.0.0: 精简 — 删除 Generator subagent、code_review_gate、独立 Evaluator。主 agent 直接写代码。
---
```

**reason**: 升 10.0.0 + 加 changelog 说明 Phase 1 删 standard 分支。

---

### Edit 2 (改顶部说明 "主 agent 直接写代码" 错误描述)

**old_string**:
```
# Stage 2: Code — 探索 + 写代码 + 验证 DoD

> 主 agent 直接写代码，逐条验证 DoD。不经 subagent。

**Task Checkpoint**: `TaskUpdate({ taskId: "2", status: "in_progress" })`
```

**new_string**:
```
# Stage 2: Code — 三角色 Subagent 全自动

> 主 agent 作为协调者，对 `.plan-${BRANCH}.md` 的每个 task 派 3 轮 subagent（Implementer / Spec Reviewer / Code Quality Reviewer）。

**Task Checkpoint**: `TaskUpdate({ taskId: "2", status: "in_progress" })`
```

**reason**: 老描述"主 agent 直接写代码"来自 Standard 模式，在唯一默认流程下错误。

---

### Edit 3 (改 Section 0 模式判断：三分支→二分支)

**old_string**:
```
## 0. 模式判断（harness / autonomous / standard）

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
HARNESS_MODE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
AUTONOMOUS_MODE=$(grep "^autonomous_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
```

- `harness_mode = true` → 走 **Section 1**
- `autonomous_mode = true` → 走 **Section 2**
- 其他 → 走 **Section 3**（standard）
```

**new_string**:
```
## 0. 模式判断（harness / default）

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
HARNESS_MODE=$(grep "^harness_mode:" "$DEV_MODE_FILE" 2>/dev/null | awk '{print $2}' || echo "false")
```

- `harness_mode = true` → 走 **Section 1**（Harness v2.0 Generator 简化流程）
- 其他 → 走 **Section 2**（默认三角色 Subagent 流程）
```

**reason**: 删 AUTONOMOUS_MODE 读取；三分支变二分支。

---

### Edit 4 (改 Section 2 标题 + 版本说明，摆正"唯一默认")

**old_string**:
```
## 2. autonomous_mode = true 时（Subagent 三角色全自动）

**v9.3.0 autonomous 分支变化**:
autonomous_mode=true 时, Implementer subagent 派遣仍由主 agent 做,
但触发时机来自 Superpowers `subagent-driven-development` skill 而非本 step 直接。
Research Subagent 处理 Superpowers 链中的 user 交互, Implementer 做实际实现。

主 agent 作为协调者，对 `.plan-${BRANCH}.md` 的每个 task 派 3 轮 subagent。
```

**new_string**:
```
## 2. 默认流程（Subagent 三角色全自动）

**v10.0.0 说明**：此为 /dev 唯一默认流程。Implementer subagent 派遣由主 agent 做，
触发时机来自 Superpowers `subagent-driven-development` skill。
Research Subagent 处理 Superpowers 链中的 user 交互, Implementer 做实际实现。

主 agent 作为协调者，对 `.plan-${BRANCH}.md` 的每个 task 派 3 轮 subagent。
```

**reason**: 去掉"autonomous_mode = true 时"条件措辞 + 改成"唯一默认"表述。

---

### Edit 5 (删除 Section 3 整个 standard mode 章节)

**old_string**:
```
---

## 3. standard mode（默认流程）

### 3.1 探索代码

读取 Task Card 的「实现方案」部分，探索相关文件：

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
TASK_CARD=".task-${BRANCH_NAME}.md"
cat "$TASK_CARD"
```

**探索规则**：先读再改，理解现有代码，确认受影响的文件和函数。

---

### 3.2 写代码

直接修改代码文件，按 Task Card 实现方案执行。

**代码规范**：
- 不加多余注释、不加 console.log
- 不改 Scope 外的文件
- 单文件 > 500 行考虑拆分

---

### 3.3 逐条验证 DoD

> **仅非 Harness 模式执行此步骤。** Harness 模式由 Evaluator 独立验证。

**对 Task Card 每个 DoD 条目执行 Test 命令验证**：

```
对每个 DoD 条目：
  1. 运行 Test: 命令
  2. 通过 → 勾选 [x]
  3. 失败 → 修复代码 → 重新验证
  4. 全部 [x] → 进入 Stage 3
```

### 本地测试

```bash
cd packages/engine && npx vitest run <相关测试文件>
```

---

### 3.4 标记完成 + 持久化

```bash
BRANCH_NAME=$(git rev-parse --abbrev-ref HEAD)
DEV_MODE_FILE=".dev-mode.${BRANCH_NAME}"
sed -i '' 's/step_2_code: pending/step_2_code: done/' "$DEV_MODE_FILE"
# .dev-mode 不提交到 git（.gitignore 已排除），只保留在本地
```

---

## Implementer 必须遵守的 Superpowers 纪律（v9.4.0 / Engine v14.16.0 补全）
```

**new_string**:
```
---

## Implementer 必须遵守的 Superpowers 纪律（v9.4.0 / Engine v14.16.0 补全）
```

**reason**: 彻底删除 Section 3 的 3.1/3.2/3.3/3.4（共约 50 行），只保留"Implementer 必须遵守..."后续章节。

---

## File 4: `packages/engine/skills/dev/steps/autonomous-research-proxy.md`

**目标**：
- 开头 "autonomous_mode=true 时必须加载到系统 context" → "**/dev 默认必须加载到系统 context**"
- 删除所有"仅 autonomous_mode"措辞（主要影响 L11 / Tier 3 / L105 confidence low 那段提 autonomous 中断）

### Edit 1 (改 frontmatter + 顶部描述)

**old_string**:
```
---
id: dev-step-autonomous-research-proxy
version: 1.0.0
created: 2026-04-15
changelog:
  - 1.0.0: 初版 — Superpowers user 交互点全替换为 Research Subagent
---

# Autonomous Research Proxy — User 交互点替换清单

> **autonomous_mode=true 时必须加载到系统 context**
> POC 已验证可行（2026-04-15，.bak gitignore 任务，27s Subagent 调研给出高置信度结论+发现原任务冗余）
```

**new_string**:
```
---
id: dev-step-autonomous-research-proxy
version: 2.0.0
created: 2026-04-15
updated: 2026-04-18
changelog:
  - 2.0.0: Phase 1 统一 — /dev 默认加载本文件（不再 gated 于 autonomous_mode），"仅 autonomous_mode" 措辞改为"默认"
  - 1.0.0: 初版 — Superpowers user 交互点全替换为 Research Subagent
---

# Research Proxy — User 交互点替换清单

> **/dev 默认必须加载到系统 context**（Phase 1 之后，三角色 Subagent 为唯一默认流程，本文件是其依赖）
> POC 已验证可行（2026-04-15，.bak gitignore 任务，27s Subagent 调研给出高置信度结论+发现原任务冗余）
```

**reason**: 版本升 2.0.0、标题去 "Autonomous" 字眼（变 "Research Proxy"）、加载条件由 autonomous 限定改为默认。

---

### Edit 2 (改 Tier 3 行 "autonomous 永不启用")

**old_string**:
```
| brainstorming "Offer visual companion" | autonomous 永不启用 |
```

**new_string**:
```
| brainstorming "Offer visual companion" | /dev 永不启用（无浏览器 context） |
```

**reason**: 去 autonomous 字眼，说清楚真实原因（无浏览器）。

---

### Edit 3 (改 Confidence Handling 低置信度段的 autonomous 字眼)

**old_string**:
```
| low | 暂停 autonomous, 创 Brain task "需决策: <问题>", 设 .dev-mode step_1_spec: awaiting_human_decision 等 Alex 异步回复 |
```

**new_string**:
```
| low | 暂停 /dev, 创 Brain task "需决策: <问题>", 设 .dev-mode step_1_spec: awaiting_human_decision 等 Alex 异步回复 |
```

**reason**: 去 autonomous 字眼。

---

### Edit 4 (改 Step 分工表里的 autonomous 字眼)

**old_string**:
```
| Step 0.7 Decision Query | ~~主流程自动执行~~ -> Research Subagent 可选调用的查询工具 | v1.1.0 重塑 |
| autonomous-research-proxy (本文件) | 主 agent 的 interaction 替换规则 | 新增 |
```

**new_string**:
```
| Step 0.7 Decision Query | ~~主流程自动执行~~ -> Research Subagent 可选调用的查询工具 | v1.1.0 重塑 |
| research-proxy (本文件) | 主 agent 的 interaction 替换规则 | 新增 |
```

**reason**: 文件名还是 autonomous-research-proxy.md（T3 范围不改文件名，避免大量引用更新），但表格里的 skill 表示去 autonomous 字眼。

---

### Edit 5 (改 POC 参考段里的 autonomous 字眼 — 无需改，保留"POC 历史")

POC 段和交互点替代矩阵 v2（L121 之后）保留原 autonomous 字眼不动，理由：
- 矩阵和 POC 属于历史叙事（F4 修复节点、审计日志），不是规则面
- 改这些会破坏可追溯性，反而模糊 Phase 1 之前的设计决策
- Phase 1 的意图是"autonomous 变成唯一默认"，旧历史叙述仍有效

**无改动**。

---

## 汇总

| File | Edit 数 | 关键变化 |
|---|---|---|
| SKILL.md | 4 | 删 Standard 流程章节 / 改标题 "autonomous_mode" → "模式说明" / 加 --autonomous 废弃说明 / 升 15.0.0 |
| .dev-mode schema | 6 个读取点 + 1 个写入点 | T3 范围内只直接改 parse-dev-args.sh:59（其余读写点归 T1/T2） |
| 02-code.md | 5 | 删 Section 3 整段 standard mode / 模式判断三→二分支 / Section 2 去 "autonomous_mode" 措辞 / 升 10.0.0 |
| autonomous-research-proxy.md | 4 | 加载条件由 autonomous gated → /dev 默认 / 标题去 "Autonomous" 字眼 / POC 段保留历史 |

---

## T3 识别的 Phase 1 后续清理（超出本任务 4 文件，需其他 Worker 处理）

- `packages/engine/skills/dev/steps/00.5-enrich.md` — "仅 autonomous_mode=true 激活" 判断，改成默认激活
- `packages/engine/skills/dev/steps/00.7-decision-query.md` — 同上
- `packages/engine/skills/dev/steps/01-spec.md` — §0.2 标题、L78/L81/L233/L253 多处
- `packages/engine/skills/dev/steps/04-ship.md` — L137/L146 discard 分支判断
- `packages/engine/skills/dev/steps/00-worktree-auto.md` — `.dev-mode` 模板生成处
- `packages/engine/lib/devloop-check.sh` — T2 处理
- `packages/engine/feature-registry.yml` — changelog 条目 L120/L146/L170（历史叙述，可保留）
- `packages/engine/tests/skills/decision-query-step.test.ts` / `research-proxy-integration.test.ts` — 更新测试断言（不再断言"仅 autonomous_mode 激活"）
