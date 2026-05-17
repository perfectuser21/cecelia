# Engine L2 Dynamic Contract — Evidence JSONL Schema

**版本**: 1.0.0
**日期**: 2026-04-18
**作者**: T1 Agent（Engine L2 动态契约 Initiative）
**关联契约**: `packages/engine/contracts/superpowers-alignment.yaml`（L1 PR #2406）

---

## 0. 目的与原则

### 0.1 问题陈述

L1 契约（静态结构）只能保证"Engine 仓库在 HEAD 时刻包含必要的文件和关键词"，不能保证"在某一次 /dev 运行里，它真的按这套方法论执行了"。

例：某人把 `02-code.md` §2.2 Implementer 段落保留关键词不变，但把实际代码改成绕过 subagent 直接写。L1 grep 通过，实际执行偏航。

### 0.2 L2 解决方案

在 /dev 运行时，每个关键节点 append 一行结构化 JSON 到 evidence 日志。CI 后置校验这条日志是否满足契约要求的 event 清单。

### 0.3 不可伪造设计原则

| 机制                     | 说明                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| `sha256` 字段不接外部值  | `record-evidence.sh` 自己对实际文件 `shasum -a 256` 算，不接受 --sha 参数 |
| `exit_code` 不接外部值   | `record-evidence.sh --exec "<cmd>"` 由 runner 执行并记录真实退出码       |
| `ts` 用服务器时钟        | `date -u +%Y-%m-%dT%H:%M:%S+08:00`，不接受 --ts 参数                     |
| `task_id` 从 Brain 校验  | 写入前 `curl localhost:5221/api/brain/tasks/<id>` 核对任务存在           |
| 日志不可回写（append only）| `record-evidence.sh` 只用 `>>`；文件 `chmod -w` 写满后由 Stage 3 搬到 sprints/ |
| log 文件内容 sha256      | `tdd_red/green` 的 `log_sha256` 对实际 log 文件算，不接受外部值          |

---

## 1. 文件位置规则

### 1.1 运行时（不进 git）

- **Evidence JSONL**: `$WORKTREE/.pipeline-evidence.<branch>.jsonl`
  - append-only JSONL（每行一个 event 对象）
  - 属于 Worktree 本地，`.gitignore` 忽略
- **TDD logs**: `$WORKTREE/.tdd-evidence/<test-slug>-<phase>.log`
  - 每条 tdd_red/green event 对应一个 log 文件
  - `.gitignore` 忽略

### 1.2 Stage 3 Integrate 前归档（进 git，CI 可读）

```bash
# Stage 3 integrate.md 新增 step：
mkdir -p sprints/$SPRINT_NAME/tdd-evidence
mv $WORKTREE/.pipeline-evidence.$BRANCH.jsonl sprints/$SPRINT_NAME/pipeline-evidence.jsonl
mv $WORKTREE/.tdd-evidence/* sprints/$SPRINT_NAME/tdd-evidence/
git add sprints/$SPRINT_NAME/pipeline-evidence.jsonl sprints/$SPRINT_NAME/tdd-evidence/
```

- **归档后路径（CI 读取）**:
  - `sprints/<sprint-name>/pipeline-evidence.jsonl`
  - `sprints/<sprint-name>/tdd-evidence/<test-slug>-<phase>.log`
- **SSOT**: `$SPRINT_NAME` 取自 `.sprint-name` 文件（Stage 1 写入），CI 从这个文件取而不是 branch 名推断。

### 1.3 `.gitignore` 条目（必须）

```
# L2 evidence — 仅归档后的 sprints/*/pipeline-evidence.jsonl 入库
.pipeline-evidence.*.jsonl
.tdd-evidence/
```

---

## 2. 通用字段（每条 event 必填）

```json
{
  "version": "1.0",
  "ts": "2026-04-18T20:15:33+08:00",
  "task_id": "5c9a7e8b-1234-4abc-9def-012345678901",
  "branch": "cp-04181830-r7-superpowers-gap",
  "stage": "stage_2_code",
  "event": "tdd_red",
  "...": "event-specific fields"
}
```

| 字段        | 类型   | 必填 | 约束                                                                 |
| ----------- | ------ | ---- | -------------------------------------------------------------------- |
| `version`   | string | ✓    | 固定 `"1.0"`，schema 升级时 bump                                    |
| `ts`        | string | ✓    | ISO 8601 + `+08:00` 时区（北京时间），runner 注入，外部不可改       |
| `task_id`   | string | ✓    | Brain UUIDv4，预先由 runner 查 Brain 确认存在                       |
| `branch`    | string | ✓    | `cp-MMDDHHNN-xxx` 格式，`git rev-parse --abbrev-ref HEAD` 获取       |
| `stage`     | enum   | ✓    | `stage_1_spec` \| `stage_2_code` \| `stage_3_integrate` \| `stage_4_ship` |
| `event`     | enum   | ✓    | 见 §3 Event Types 闭集                                              |

---

## 3. Event Types 闭集（共 9 种）

以下 9 种事件为 **L2 v1.0 官方闭集**。新增事件需 bump `version` 到 1.1 并更新契约 schema。

### 3.1 `subagent_dispatched`

**触发时机**: Implementer / Spec Reviewer / Code Quality Reviewer / Architect Reviewer / Parallel Diagnostic subagent 被 Task tool 派出时。

**Event-specific 字段**:

| 字段              | 类型   | 必填 | 说明                                                                                     |
| ----------------- | ------ | ---- | ---------------------------------------------------------------------------------------- |
| `subagent_type`   | enum   | ✓    | `implementer` \| `spec_reviewer` \| `code_quality_reviewer` \| `architect_reviewer` \| `parallel_diagnostic` |
| `prompt_path`     | string | ✓    | `packages/engine/skills/dev/prompts/<skill>/SKILL.md` 或 `.prompts/<name>.md`         |
| `prompt_sha256`   | string | ✓    | 64-hex，runner 自算                                                                     |
| `return_status`   | enum   | ✓    | `DONE` \| `DONE_WITH_CONCERNS` \| `NEEDS_CONTEXT` \| `BLOCKED` \| `ARCHITECTURE_ISSUE` |
| `round`           | int    |      | subagent-driven loop 的轮次（1/2/3/...），便于追踪 BLOCKED 升级                         |

**完整例子**:

```json
{
  "version": "1.0",
  "ts": "2026-04-18T20:15:33+08:00",
  "task_id": "5c9a7e8b-1234-4abc-9def-012345678901",
  "branch": "cp-04181830-r7-superpowers-gap",
  "stage": "stage_2_code",
  "event": "subagent_dispatched",
  "subagent_type": "implementer",
  "prompt_path": "packages/engine/skills/dev/prompts/subagent-driven-development/SKILL.md",
  "prompt_sha256": "3f8a92c1b4d5e6f78901234567890abcdef1234567890abcdef1234567890abc",
  "return_status": "DONE",
  "round": 1
}
```

---

### 3.2 `tdd_red`

**触发时机**: Implementer 在 TDD "先红"阶段首次运行测试且 exit != 0。

**Event-specific 字段**:

| 字段            | 类型   | 必填 | 说明                                                                  |
| --------------- | ------ | ---- | --------------------------------------------------------------------- |
| `test_file`     | string | ✓    | 测试文件相对路径，如 `tests/foo.test.ts`                             |
| `test_command`  | string | ✓    | 完整测试命令，如 `npm test -- tests/foo.test.ts`                     |
| `exit_code`     | int    | ✓    | runner 自己执行后填充，**必须 != 0**（由 record 脚本 assert）         |
| `log_path`      | string | ✓    | 相对 $WORKTREE 的 log 路径，如 `.tdd-evidence/foo-red.log`           |
| `log_sha256`    | string | ✓    | 64-hex，log 文件内容的 sha256，runner 自算                            |
| `test_slug`     | string | ✓    | 用于 correlate tdd_red ↔ tdd_green，建议 `<test_file 去扩展名转_>`     |

**完整例子**:

```json
{
  "version": "1.0",
  "ts": "2026-04-18T20:22:15+08:00",
  "task_id": "5c9a7e8b-1234-4abc-9def-012345678901",
  "branch": "cp-04181830-r7-superpowers-gap",
  "stage": "stage_2_code",
  "event": "tdd_red",
  "test_file": "tests/warroom.test.ts",
  "test_command": "npm test -- tests/warroom.test.ts",
  "exit_code": 1,
  "log_path": ".tdd-evidence/warroom-red.log",
  "log_sha256": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345a",
  "test_slug": "tests_warroom"
}
```

---

### 3.3 `tdd_green`

**触发时机**: Implementer 写完实现后，同一个 `test_file` 再次运行测试且 exit == 0。

**Event-specific 字段**: 同 `tdd_red`，但 `exit_code` **必须 == 0**，`log_path` 固定 `-green.log` 后缀。

**Correlation 约束**（由 CI 校验）:

- 每条 `tdd_green` 必须存在对应 `tdd_red`（按 `test_slug` 字段匹配）
- `tdd_red.ts < tdd_green.ts`（时间先后）
- `tdd_red.test_file == tdd_green.test_file`

**完整例子**:

```json
{
  "version": "1.0",
  "ts": "2026-04-18T20:45:02+08:00",
  "task_id": "5c9a7e8b-1234-4abc-9def-012345678901",
  "branch": "cp-04181830-r7-superpowers-gap",
  "stage": "stage_2_code",
  "event": "tdd_green",
  "test_file": "tests/warroom.test.ts",
  "test_command": "npm test -- tests/warroom.test.ts",
  "exit_code": 0,
  "log_path": ".tdd-evidence/warroom-green.log",
  "log_sha256": "b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef12345abcd",
  "test_slug": "tests_warroom"
}
```

---

### 3.4 `pre_completion_verification`

**触发时机**: Implementer 在报 DONE 前、Post-Complete Gate（02-code.md §2.6）跑完自证清单。

**Event-specific 字段**:

| 字段              | 类型    | 必填 | 说明                                                                             |
| ----------------- | ------- | ---- | -------------------------------------------------------------------------------- |
| `checklist_items` | array   | ✓    | 每项 `{id: string, test_command: string, exit_code: int, pass: bool}`           |
| `all_pass`        | bool    | ✓    | 所有 `pass` 的 &&，runner 自算                                                  |
| `dod_source`      | string  | ✓    | DoD 文件路径，如 `.dod-<branch>.md`                                              |

**完整例子**:

```json
{
  "version": "1.0",
  "ts": "2026-04-18T20:50:11+08:00",
  "task_id": "5c9a7e8b-1234-4abc-9def-012345678901",
  "branch": "cp-04181830-r7-superpowers-gap",
  "stage": "stage_2_code",
  "event": "pre_completion_verification",
  "checklist_items": [
    {
      "id": "BEHAVIOR-1",
      "test_command": "npm test -- tests/warroom.test.ts",
      "exit_code": 0,
      "pass": true
    },
    {
      "id": "BEHAVIOR-2",
      "test_command": "node -e \"require('fs').accessSync('packages/brain/src/foo.js')\"",
      "exit_code": 0,
      "pass": true
    }
  ],
  "all_pass": true,
  "dod_source": ".dod-cp-04181830-r7-superpowers-gap.md"
}
```

---

### 3.5 `critical_gap_abort`

**触发时机**: Stage 1 Spec 的 §0.2.5 Step 5 检测到 plan 有致命缺口（例："核心文件不存在"），autonomous 模式触发 abort。

**Event-specific 字段**:

| 字段             | 类型   | 必填 | 说明                                                                     |
| ---------------- | ------ | ---- | ------------------------------------------------------------------------ |
| `reason`         | string | ✓    | 自由文本，人读，如 "PRD 要求改 foo.js 但该文件不存在"                   |
| `trigger_rule`   | enum   | ✓    | 5 条 abort trigger 之一：`core_file_missing` \| `dep_not_installed` \| `api_not_exist` \| `schema_mismatch` \| `arch_conflict` |
| `brain_task_id`  | string |      | 自动创建的 Brain `autonomous_aborted` task 的 UUID                       |

**完整例子**:

```json
{
  "version": "1.0",
  "ts": "2026-04-18T19:30:12+08:00",
  "task_id": "5c9a7e8b-1234-4abc-9def-012345678901",
  "branch": "cp-04181830-r7-superpowers-gap",
  "stage": "stage_1_spec",
  "event": "critical_gap_abort",
  "reason": "PRD 要求修改 packages/brain/src/nonexistent.js，该文件不存在于 HEAD。",
  "trigger_rule": "core_file_missing",
  "brain_task_id": "7f1b2c3d-9999-4000-8abc-def123456789"
}
```

---

### 3.6 `blocked_escalation`

**触发时机**: Implementer 报 `BLOCKED` 后，BLOCKED 升级链 v2（02-code.md §2.5）的每一级触发。

**Event-specific 字段**:

| 字段           | 类型   | 必填 | 说明                                                                                                                   |
| -------------- | ------ | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `level`        | int    | ✓    | 1 \| 2 \| 3（第几次 BLOCKED）                                                                                          |
| `reason`       | string | ✓    | Implementer 报 BLOCKED 的原因文本                                                                                     |
| `next_action`  | enum   | ✓    | level 1 → `retry_with_context`; level 2 → `create_brain_task`; level 3 → `dispatching_parallel_agents` \| `escalate_human` |
| `prev_round`   | int    | ✓    | 触发时 Implementer 已走完的轮次（用于排查连续失败）                                                                    |

**完整例子**:

```json
{
  "version": "1.0",
  "ts": "2026-04-18T21:08:55+08:00",
  "task_id": "5c9a7e8b-1234-4abc-9def-012345678901",
  "branch": "cp-04181830-r7-superpowers-gap",
  "stage": "stage_2_code",
  "event": "blocked_escalation",
  "level": 3,
  "reason": "Implementer 连续 3 次报 BLOCKED，均为 DB schema 不匹配",
  "next_action": "dispatching_parallel_agents",
  "prev_round": 3
}
```

---

### 3.7 `dispatching_parallel_agents`

**触发时机**: BLOCKED 升级链 level=3 触发后，主 agent 派 3 个独立 diagnostic subagent 并行调查根因。

**Event-specific 字段**:

| 字段                     | 类型   | 必填 | 说明                                                                        |
| ------------------------ | ------ | ---- | --------------------------------------------------------------------------- |
| `agents_count`           | int    | ✓    | 必须 >= 2（契约约束：parallel 的意义是并行调查）                            |
| `diagnostic_subjects`    | array  | ✓    | 每个 agent 要调查的主题（string 数组），长度 == `agents_count`             |
| `parent_blocked_ts`      | string | ✓    | 对应的 `blocked_escalation` 事件的 `ts`，用于 correlate                     |

**完整例子**:

```json
{
  "version": "1.0",
  "ts": "2026-04-18T21:09:30+08:00",
  "task_id": "5c9a7e8b-1234-4abc-9def-012345678901",
  "branch": "cp-04181830-r7-superpowers-gap",
  "stage": "stage_2_code",
  "event": "dispatching_parallel_agents",
  "agents_count": 3,
  "diagnostic_subjects": [
    "检查 DB schema 是否匹配 DEFINITION.md EXPECTED_SCHEMA_VERSION",
    "检查 migration 是否遗漏",
    "检查 Implementer 上下文是否遗漏关键文件"
  ],
  "parent_blocked_ts": "2026-04-18T21:08:55+08:00"
}
```

---

### 3.8 `architect_reviewer_dispatched`

**触发时机**: Spec Reviewer / Code Quality Reviewer 在审查时发现"这是架构问题，不是 Implementer 能改的"，返回 `ARCHITECTURE_ISSUE`，主 agent 派 architect-reviewer 产出新 spec。

**Event-specific 字段**:

| 字段               | 类型   | 必填 | 说明                                                               |
| ------------------ | ------ | ---- | ------------------------------------------------------------------ |
| `architect_issue`  | string | ✓    | Reviewer 报告的架构问题摘要                                       |
| `issue_category`   | enum   | ✓    | `design_boundary` \| `data_flow` \| `system_constraint`           |
| `return_status`    | enum   | ✓    | `ARCHITECTURE_ISSUE` \| `OK`（OK 表示 architect-reviewer 复核后否决原判定） |
| `new_spec_path`    | string |      | 若 architect 产出新 spec，填路径（如 `.architect-spec-<branch>.md`） |

**完整例子**:

```json
{
  "version": "1.0",
  "ts": "2026-04-18T21:35:44+08:00",
  "task_id": "5c9a7e8b-1234-4abc-9def-012345678901",
  "branch": "cp-04181830-r7-superpowers-gap",
  "stage": "stage_2_code",
  "event": "architect_reviewer_dispatched",
  "architect_issue": "当前实现让 Brain 直接读 Worktree 文件系统，违反 Brain ↔ Worktree 隔离边界",
  "issue_category": "design_boundary",
  "return_status": "ARCHITECTURE_ISSUE",
  "new_spec_path": ".architect-spec-cp-04181830-r7-superpowers-gap.md"
}
```

---

### 3.9 `finishing_discard_confirm`

**触发时机**: Stage 4 Ship 的 §4.3 Discard 路径被触发（autonomous 下 Research Subagent Tier 1 直接固定 option 2，但若走到 discard 分支必须产生此事件）。

**Event-specific 字段**:

| 字段                | 类型   | 必填 | 说明                                                                                         |
| ------------------- | ------ | ---- | -------------------------------------------------------------------------------------------- |
| `typed_confirm`     | bool   | ✓    | autonomous 下**必为 true**（由 Research Subagent 代替人输入确认字符串）                      |
| `confirm_source`    | enum   | ✓    | `human_stdin` \| `research_subagent` \| `brain_task_review`（autonomous 只允许后两者）      |
| `discard_targets`   | array  | ✓    | 将被删除的资源列表：`["branch", "commits", "worktree"]`                                     |
| `brain_task_id`     | string |      | 若走 `brain_task_review`（不自动销毁），Brain `finish_branch_discard_review` task 的 UUID |

**完整例子**:

```json
{
  "version": "1.0",
  "ts": "2026-04-18T22:10:00+08:00",
  "task_id": "5c9a7e8b-1234-4abc-9def-012345678901",
  "branch": "cp-04181830-r7-superpowers-gap",
  "stage": "stage_4_ship",
  "event": "finishing_discard_confirm",
  "typed_confirm": true,
  "confirm_source": "brain_task_review",
  "discard_targets": ["branch", "commits", "worktree"],
  "brain_task_id": "8c1d2e3f-4444-4111-9000-abcdef987654"
}
```

---

## 4. Schema 保留字与前向兼容

- `version` 字段是**第一个**字段，便于将来做 parser dispatch。
- 新增 event type 必须 bump minor：1.0 → 1.1。增字段（不破坏旧解析）bump patch。
- 删字段或改 enum 取值 = breaking，必须 bump major。
- CI 校验器遇到 `version > EXPECTED` 的行应 warn 但不 fail（下游容忍）。
- CI 校验器遇到 `event` 不在闭集的行应 fail（L2 不允许 skill 偷加事件）。

---

## 5. 运行时写入接口

### 5.1 `record-evidence.sh` 命令签名

```bash
# 必备位置参数：event type
# 必带：--task-id, --stage
# event-specific 字段通过 --field=value 形式传入
# 对于 tdd_red/green，强制用 --exec 让脚本自己跑命令

record-evidence.sh <event> \
  --task-id=$BRAIN_TASK_ID \
  --stage=stage_2_code \
  [--exec="<command>"] \
  [--prompt-path=...] \
  [--test-file=...] \
  [--<other event fields>]
```

### 5.2 不可伪造点

- `ts`：脚本内部 `date +%Y-%m-%dT%H:%M:%S+08:00`，不读 --ts 参数
- `prompt_sha256`：脚本内部 `shasum -a 256 $prompt_path`，不读 --sha 参数
- `log_sha256`：对 --exec 捕获的日志算
- `exit_code`：`record-evidence.sh --exec` 执行命令后 `$?` 捕获
- `task_id`：脚本先 `curl localhost:5221/api/brain/tasks/$TASK_ID` 验证 200，否则拒绝

---

## 6. 契约侧引用

L2 契约（见 `superpowers-alignment-v2.yaml`）为每个 `coverage_level: full` 的 skill 新增 `runtime_evidence` 字段，定义：

- `mode: opt-in | enforced`：opt-in 缺证据 warn 不 fail，enforced 缺证据 fail
- `required_events`：event 类型 + min_occurrences + assert_fields + correlation

第一轮全部 10 个 full skill 标 `opt-in`，待 CI 与 /dev 磨合稳定（至少 2 周无假阳性）再逐个切 enforced。

---

**End of Schema Spec v1.0.0**
