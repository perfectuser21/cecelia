# 02-code.md Evidence 插桩点 Diff（T4 产出）

> **作者**：T4 Agent
> **日期**：2026-04-18
> **源文件**：`packages/engine/skills/dev/steps/02-code.md` v9.5.0（544 行）
> **目标文件**：`packages/engine/scripts/record-evidence.sh`（T3 产出）
> **配合**：T1（契约 schema）+ T5（Implementer prompt 修改）

---

## 0. 总览决策

### 0.1 最终插桩点数量与优先级

| # | 位置（源文件行号） | 事件类型 | 优先级 | 是否插桩 |
|---|---|---|---|---|
| 1 | §2.2 Implementer 派发前 (L99 附近) | `subagent_dispatched` | P0 | ✅ |
| 2 | §2.3 Spec Reviewer 派发前 (L149 附近) | `subagent_dispatched` | P0 | ✅ |
| 3 | §2.4 Code Quality Reviewer 派发前 (L210 附近) | `subagent_dispatched` | P2 | ✅ |
| 4 | §2.2 Implementer 返回 DONE 后（TDD Red） | `tdd_red` | P0 | ✅（配合 T5） |
| 5 | §2.2 Implementer 返回 DONE 后（TDD Green） | `tdd_green` | P0 | ✅（配合 T5） |
| 6 | §2.5 BLOCKED Level 1 (L235) | 不插（噪音） | - | ❌ |
| 7 | §2.5 BLOCKED Level 2 (L236-237) | `blocked_escalation` | P1 | ✅ |
| 8 | §2.5 BLOCKED Level 3 (L238-239) | `blocked_escalation` + `dispatching_parallel_agents` | P1 | ✅ |
| 9 | §2.5 BLOCKED Level 4 (L240) | `blocked_escalation` | P1 | ✅ |
| 10 | §2.3/2.4 ARCHITECTURE_ISSUE 分支 | `architect_reviewer_dispatched` | P2 | ✅ |
| 11 | §2.6 Pre-Completion Verification Gate (L261-269) | `pre_completion_verification` | P0 | ✅ |

**最终插桩点**：7 个物理位置 + 2 个 TDD 事件（配合 T5）= 9 个事件类型，分布为 **P0×5 / P1×2 / P2×2**。

### 0.2 不插桩决策与理由

**Level 1 BLOCKED（第 1 次补 context 重派）不插**
- 理由：Level 1 是常规重试，几乎每个 task 都会发生 1-2 次，插了会让 evidence log 淹没在噪音里
- 只从 Level 2 开始记录，这是真正的"升级信号"
- 契约里 `blocked_escalation` 的 `min_occurrences: 0`，不记也不违反

**standard mode（§3）不插**
- 理由：standard mode 是"主 agent 直接写代码"，不派 subagent，不存在"必须证明被执行"的点
- §3.3 DoD 逐条验证本身就有 `[x]` 勾选做证据，再插 evidence 是冗余
- 契约 schema 已设计为 `harness_mode=false && autonomous_mode=false` 时跳过大部分检查

**harness mode（§1）不插**
- 理由：harness mode 由 sprint-evaluator 独立验证，不在 /dev 的 Stage 2 证明范围内
- Evaluator 有自己的 evidence 体系（sprint-eval-log.md）

---

## 1. 插桩点详细 Diff

### 插桩点 1：Implementer 派发前（§2.2 L99）— P0

**位置定位**：L99 "输入 prompt 模板（参考 `superpowers:subagent-driven-development/implementer-prompt.md`）"

**匹配 anchor（Edit 工具用）**：
```
输入 prompt 模板（参考 `superpowers:subagent-driven-development/implementer-prompt.md`）：
- Task 完整描述（从 plan 复制，包括所有 Step）
```

**插入内容**（在该段落前新增代码块）：
````markdown
**派遣前记录 evidence（对齐 Superpowers `subagent-driven-development`）**：

```bash
# Evidence: Implementer subagent dispatch
# 契约 skill=superpowers:subagent-driven-development
# 事件=subagent_dispatched, subagent-type=implementer
TASK_ID=$(grep "^current_task:" ".plan-${BRANCH_NAME}.md" 2>/dev/null | awk '{print $2}' || echo "unknown")
bash packages/engine/scripts/record-evidence.sh \
  --event subagent_dispatched \
  --subagent-type implementer \
  --prompt-path "packages/engine/skills/dev/prompts/subagent-driven-development/implementer-prompt.md" \
  --task-id "$TASK_ID" \
  --round 1
```
````

**为什么需要**：
- 证明 autonomous_mode 真的派了 Implementer subagent（T2 契约 `subagent-driven-development.min_occurrences >= 1`）
- 被 T6 lint 消费，证明 "autonomous mode 三角色派遣闭环"

---

### 插桩点 2：Spec Reviewer 派发前（§2.3 L149）— P0

**位置定位**：L149 "输入 prompt（参考 `superpowers:subagent-driven-development/spec-reviewer-prompt.md`）"

**匹配 anchor**：
```
输入 prompt（参考 `superpowers:subagent-driven-development/spec-reviewer-prompt.md`）：
- 上述 5 项
- 指令："不要信任 Implementer 的报告。自己读代码逐行对比。"
```

**插入内容**（在该段落前新增代码块）：
````markdown
**派遣前记录 evidence（对齐 Superpowers `requesting-code-review` + `subagent-driven-development`）**：

```bash
# Evidence: Spec Reviewer dispatch
# 契约 skill=superpowers:requesting-code-review, superpowers:subagent-driven-development
# 事件=subagent_dispatched, subagent-type=spec_reviewer
HEAD_SHA=$(git rev-parse HEAD)
BASE_SHA=$(git merge-base origin/main HEAD)
bash packages/engine/scripts/record-evidence.sh \
  --event subagent_dispatched \
  --subagent-type spec_reviewer \
  --prompt-path "packages/engine/skills/dev/prompts/subagent-driven-development/spec-reviewer-prompt.md" \
  --task-id "$TASK_ID" \
  --diff-range "${BASE_SHA}..${HEAD_SHA}" \
  --round 2
```
````

**为什么需要**：
- 证明 Spec Reviewer 被派（契约 `requesting-code-review.min_occurrences >= 1`，`subagent-driven-development.spec_reviewer_rounds >= 1`）
- `diff-range` 字段同时证明"5 项规范化"里的 commit SHA 要求被满足

---

### 插桩点 3：Code Quality Reviewer 派发前（§2.4 L210）— P2

**位置定位**：L210 "输入 prompt（参考 `superpowers:subagent-driven-development/code-quality-reviewer-prompt.md`）"

**匹配 anchor**：
```
输入 prompt（参考 `superpowers:subagent-driven-development/code-quality-reviewer-prompt.md`）：
- 上述 5 项
- 实现完成的 task 描述
- git diff（BASE_SHA..HEAD_SHA）
```

**插入内容**：
````markdown
**派遣前记录 evidence**：

```bash
# Evidence: Code Quality Reviewer dispatch
# 事件=subagent_dispatched, subagent-type=code_quality_reviewer
bash packages/engine/scripts/record-evidence.sh \
  --event subagent_dispatched \
  --subagent-type code_quality_reviewer \
  --prompt-path "packages/engine/skills/dev/prompts/subagent-driven-development/code-quality-reviewer-prompt.md" \
  --task-id "$TASK_ID" \
  --diff-range "${BASE_SHA}..${HEAD_SHA}" \
  --round 3
```
````

**为什么需要**：
- 证明 3 角色闭环完整（契约 `subagent-driven-development.quality_reviewer_rounds >= 1`）
- P2 理由：比起 Spec Reviewer，Code Quality Reviewer 是可选的（有些任务只需 Spec Compliant）

---

### 插桩点 4 + 5：TDD Red/Green（§2.2 Implementer 返回 DONE 后）— P0，配合 T5

**位置定位**：§2.2 L104 "4 种状态 + 主 agent 行为" 表格之后

**匹配 anchor**：
```
| `BLOCKED` | 搞不定 | 见 2.5 失败自愈 |

**相关目录全套回归（强制）**:
```

**插入内容**（在表格后、"相关目录全套回归"段之前新增）：
````markdown
**Implementer 返回 DONE 时记录 TDD evidence（配合 T5 prompt 改造）**：

T5 要求 Implementer 在返回 DONE 报告里附：
- `RED_LOG_PATH`: 红灯阶段 vitest 日志路径（eg `/tmp/tdd-red-<task>-<sha>.log`）
- `GREEN_LOG_PATH`: 绿灯阶段 vitest 日志路径
- `TEST_FILE`: 对应测试文件相对路径

主 agent（controller）收到 DONE 后立即记录：

```bash
# 从 Implementer 返回 JSON/Markdown 解析（T5 规范的报告格式）
RED_LOG=$(echo "$IMPLEMENTER_REPORT" | grep "^RED_LOG_PATH:" | awk '{print $2}')
GREEN_LOG=$(echo "$IMPLEMENTER_REPORT" | grep "^GREEN_LOG_PATH:" | awk '{print $2}')
TEST_FILE=$(echo "$IMPLEMENTER_REPORT" | grep "^TEST_FILE:" | awk '{print $2}')

# Evidence: TDD Red phase（测试先红）
# 契约 skill=superpowers:test-driven-development
bash packages/engine/scripts/record-evidence.sh \
  --event tdd_red \
  --task-id "$TASK_ID" \
  --test-file "$TEST_FILE" \
  --log-path "$RED_LOG"

# Evidence: TDD Green phase（代码变绿）
bash packages/engine/scripts/record-evidence.sh \
  --event tdd_green \
  --task-id "$TASK_ID" \
  --test-file "$TEST_FILE" \
  --log-path "$GREEN_LOG"
```

**缺 RED_LOG_PATH / GREEN_LOG_PATH 的 DONE 报告 = BLOCKED**（Spec Reviewer 在 §2.3 审查时打回）。
````

**为什么需要**：
- **P0 最重要**：TDD 是 Superpowers `test-driven-development` skill 的核心，没 red-green 日志 = 撒谎完成
- 契约 `test-driven-development.required_events = ['tdd_red', 'tdd_green']`，缺任一 = 违约
- T5 Implementer prompt 必须规范化 DONE 报告格式，本插桩才能拿到 log path

---

### 插桩点 6：BLOCKED Level 2（§2.5 L236-237）— P1

**位置定位**：§2.5 "Implementer 连续 BLOCKED" 代码块

**匹配 anchor**：
```
**Implementer 连续 BLOCKED**:
```
第 1 次 → 补 context 重派（同模型）
第 2 次 → 派 Spec Reviewer 审 Implementer 是否漏读关键信息
```

**插入内容**（在代码块后新增）：
````markdown
**升级时记录 evidence**：

```bash
# 第 2 次 BLOCKED：派 Spec Reviewer 诊断
bash packages/engine/scripts/record-evidence.sh \
  --event blocked_escalation \
  --level 2 \
  --task-id "$TASK_ID" \
  --next-action "spec_reviewer_diagnosis" \
  --blocked-reason "$(echo "$IMPLEMENTER_REPORT" | grep "^BLOCKED_REASON:" | cut -d: -f2-)"

# 第 3 次 BLOCKED：派 dispatching-parallel-agents
# 契约 skill=superpowers:dispatching-parallel-agents
bash packages/engine/scripts/record-evidence.sh \
  --event blocked_escalation \
  --level 3 \
  --task-id "$TASK_ID" \
  --next-action "dispatching_parallel_agents"

bash packages/engine/scripts/record-evidence.sh \
  --event dispatching_parallel_agents \
  --task-id "$TASK_ID" \
  --agents-count 3 \
  --diagnostic-subjects "implementation_path,error_root_cause,alternative_approaches"

# 第 4 次 BLOCKED：创 Brain task（人介入）
bash packages/engine/scripts/record-evidence.sh \
  --event blocked_escalation \
  --level 4 \
  --task-id "$TASK_ID" \
  --next-action "brain_task_autonomous_blocked_escalation"
```
````

**为什么需要**：
- 升级链条每一层是 Superpowers `executing-plans` 的"check in with human"纪律的 autonomous 等价物
- Level 3 触发时，`dispatching-parallel-agents` skill 事件是契约明确要求的
- Level 4 证明 autonomous 到达人介入边界，是 Brain 托管信号

---

### 插桩点 7：ARCHITECTURE_ISSUE 分支（§2.3 L180-184）— P2

**位置定位**：§2.3 "Controller 动作" 代码块后

**匹配 anchor**：
```
Controller 动作：
- **不**让 Implementer 直接改
- 创 Brain task `task_type=arch_review`，附上 Reviewer 的 proposal
- 当前 Implementer 循环暂停，等 architect-reviewer 出 spec 后再重派
```

**插入内容**（在 "重派" 之后新增）：
````markdown
**升级 architect-reviewer 时记录 evidence（对齐 Superpowers `receiving-code-review`）**：

```bash
# Evidence: ARCHITECTURE_ISSUE 升级
# 契约 skill=superpowers:receiving-code-review
bash packages/engine/scripts/record-evidence.sh \
  --event architect_reviewer_dispatched \
  --task-id "$TASK_ID" \
  --architecture-issue-reason "$(echo "$REVIEWER_REPORT" | grep "^reason:" | cut -d: -f2-)" \
  --brain-task-type "arch_review"
```
````

**为什么需要**：
- 证明 Reviewer 的 "Involves your human partner if architectural" 升级路径被走
- P2 理由：大部分 task 不触发 ARCHITECTURE_ISSUE，契约 `min_occurrences: 0`

---

### 插桩点 8：Pre-Completion Verification（§2.6 L261-269）— P0

**位置定位**：§2.6 "所有 task 完成后" Gate 段落

**匹配 anchor**：
```
对 `.task-${BRANCH}.md` 每个 DoD 条目：
1. 运行 `Test:` 命令
2. 检查 exit code
3. 有证据才勾 [x]
4. 无证据 → 修 → 重跑

全部 [x] → `sed -i '' 's/step_2_code: pending/step_2_code: done/' ".dev-mode.${BRANCH_NAME}"`
```

**插入内容**（在 `sed -i` 行之前新增）：
````markdown
**通过 Gate 前记录 evidence（对齐 Superpowers `verification-before-completion`）**：

```bash
# 汇总 DoD checklist 结果
DOD_CHECKLIST_JSON=$(node -e "
  const fs = require('fs');
  const md = fs.readFileSync('.task-${BRANCH_NAME}.md', 'utf8');
  const items = [...md.matchAll(/^- \[([ x])\] (.+)\$/gm)].map(m => ({
    checked: m[1] === 'x',
    description: m[2].slice(0, 120)
  }));
  console.log(JSON.stringify(items));
")

ALL_PASS=$(echo "$DOD_CHECKLIST_JSON" | node -e "
  const items = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  console.log(items.every(i => i.checked) ? 'true' : 'false');
")

# Evidence: Pre-Completion Verification Gate
# 契约 skill=superpowers:verification-before-completion
bash packages/engine/scripts/record-evidence.sh \
  --event pre_completion_verification \
  --all-pass "$ALL_PASS" \
  --checklist-json "$DOD_CHECKLIST_JSON" \
  --branch "$BRANCH_NAME"

if [[ "$ALL_PASS" != "true" ]]; then
  echo "ERROR: Pre-Completion Verification 未全通过，不能标 step_2_code: done"
  exit 1
fi
```
````

**为什么需要**：
- **P0 最重要**：这是整个 Stage 2 唯一的"Gate"，不证明等于允许"should pass / probably works"
- 契约 `verification-before-completion.required_events = ['pre_completion_verification']` + `all_pass_required: true`
- CI L2 会拉取这个 evidence 做最后把关

---

## 2. 主 agent 直写 vs 派 subagent 处理方式

### 2.1 问题本质

当前 PR #2406 的 /dev 在 main claude agent 里执行 Stage 2，有两种实际执行路径：

| 路径 | 触发条件 | Evidence 产生 |
|---|---|---|
| **A. 派 subagent**（autonomous_mode=true） | 主 agent 用 Task tool 派 Implementer/Reviewer | `subagent_dispatched` 等事件正常产生 |
| **B. 主 agent 直写**（autonomous_mode=false 或主 agent 自判） | 主 agent 自己 Edit/Write 代码 | `subagent_dispatched` 事件**根本不发生** |

如果硬要求 `subagent_dispatched.min_occurrences >= 1`，路径 B 会误判违约。

### 2.2 推荐处理方式

**A. 契约层（T1 负责）用 `mode: opt-in` + 条件触发**

T1 定义契约时，`subagent-driven-development` 等"派 subagent"类 skill 契约应写：

```yaml
skill: superpowers:subagent-driven-development
mode: opt-in
trigger_condition:
  autonomous_mode: true  # 只在 .dev-mode.${BRANCH}.autonomous_mode=true 时强制
required_events:
  - subagent_dispatched:
      subagent_type: implementer
      min_occurrences: 1
  - subagent_dispatched:
      subagent_type: spec_reviewer
      min_occurrences: 1
```

**B. 主 agent 直写路径只要求 P0 通用事件**

无论哪条路径都必须产生：
- `tdd_red` + `tdd_green`（所有代码变更，不分路径）
- `pre_completion_verification`（所有 task 结束必须过 Gate）

主 agent 直写时，02-code.md §3.3 DoD 验证那里也要插一个 `pre_completion_verification` 事件（不在本次 T4 范围，但 T4 需要提示 T1/T2 考虑扩展到 §3.3）。

**C. T6 lint 脚本读 `.dev-mode.${BRANCH}` 做分支判断**

```python
# T6 pseudocode
dev_mode = load_dev_mode_file()
if dev_mode.autonomous_mode:
    enforce_skills = ['subagent-driven-development', 'requesting-code-review',
                      'test-driven-development', 'verification-before-completion']
else:
    enforce_skills = ['test-driven-development', 'verification-before-completion']
```

这样 T6 能正确区分"autonomous 模式没派 subagent = 违约"和"standard 模式没派 subagent = 正常"。

### 2.3 PR #2406 本次的预期行为

- PR #2406 本身是 /dev 直接开发（autonomous_mode=false）
- 预期 evidence log 只包含 `pre_completion_verification`，不强制 `subagent_dispatched`
- T6 lint 不报违约

这是**刻意设计的 degraded mode**：契约能力到位，但只在 autonomous_mode 启用时才全部生效。

---

## 3. 插桩顺序与依赖

**对 T5 的依赖**：
- 插桩点 4+5（TDD Red/Green）依赖 T5 规范化 Implementer prompt 输出（RED_LOG_PATH / GREEN_LOG_PATH）
- T5 完成前，这两个插桩点代码可以先就位，但数据字段会缺失 → 接受 `log-path=""` 并由 T3 record-evidence.sh 做 warn

**对 T3 的依赖**：
- 所有插桩点都依赖 `packages/engine/scripts/record-evidence.sh` 已实现
- record-evidence.sh 需要支持所有这些 `--event` 值和对应字段

**T4 独立工作范围**：
- 本文档完整列出所有插桩点的物理位置 + diff 内容
- 执行插桩动作（修改 02-code.md）属于另一个 Agent（T7？）的工作，不在本次 T4 范围

---

## 4. 插桩后 02-code.md 的预估行数变化

- 当前 544 行
- 插桩点 1：+13 行
- 插桩点 2：+15 行
- 插桩点 3：+12 行
- 插桩点 4+5：+28 行
- 插桩点 6：+26 行
- 插桩点 7：+10 行
- 插桩点 8：+25 行
- **预估新行数**：~673 行（+24%）

接近 "单文件 >500 行拆分" 的阈值，建议考虑：
- 把 evidence 插桩代码抽到 `packages/engine/skills/dev/scripts/emit-stage-2-evidence.sh`
- 02-code.md 只调用 `bash packages/engine/skills/dev/scripts/emit-stage-2-evidence.sh <event> <args>`
- 这个重构属于 T4 后续优化，不在本次范围

---

## 5. 风险与已知限制

1. **shell 变量污染**：插桩代码依赖 `$TASK_ID` `$BRANCH_NAME` `$IMPLEMENTER_REPORT` `$REVIEWER_REPORT` 等变量，在 02-code.md 的"文档式 bash"里是假定的，真正由 main agent 逐条构造。T4 假定 main agent 能正确维护这些变量。

2. **IMPLEMENTER_REPORT 格式未规范化**：当前 02-code.md 没有严格定义 Implementer DONE 报告格式。T5 必须补齐（TDD fields），否则 grep 解析会失败。

3. **record-evidence.sh 参数校验**：如果 T3 实现很严格（缺字段直接 exit 1），T4 这些插桩点可能在数据不全时让 Stage 2 挂掉。建议 T3 采用 warn-only 容错模式。

4. **autonomous_mode=false 路径的 Gate**：本 T4 只覆盖 §2（autonomous），§3（standard）的 Pre-Completion Gate 未插桩。如 T1 契约要求 standard mode 也记录 `pre_completion_verification`，需额外追加一个插桩点到 §3.3。

---

## 6. 交付清单

| 项 | 状态 |
|---|---|
| 本文档路径 | `/Users/administrator/claude-output/engine-l2-dynamic-contract/docs/02-code-instrumentation.md` |
| 插桩点数量 | 7 物理位置 × 9 事件类型（P0×5 / P1×2 / P2×2） |
| 对 T1 的请求 | 支持 `mode: opt-in` + `trigger_condition.autonomous_mode` |
| 对 T3 的请求 | record-evidence.sh 支持所有列出的 `--event` 值 + 容错 warn-only |
| 对 T5 的请求 | Implementer DONE 报告规范化 RED_LOG_PATH / GREEN_LOG_PATH / TEST_FILE |
| 对 T6 的请求 | 读 `.dev-mode.${BRANCH}` 区分 autonomous/standard 做差异化 enforcement |
