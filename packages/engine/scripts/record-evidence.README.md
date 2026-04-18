# record-evidence.sh

L2 动态契约证据记录器。向 `$WORKTREE/.pipeline-evidence.<branch>.jsonl` 追加一条标准化 JSON 行。

## 设计原则

1. 只做 append，从不重写。
2. `sha256` 永远由脚本计算，禁止调用方传 `--prompt-sha256` / `--log-sha256`（防伪造）。
3. `event` 是封闭集（10 个），未知立即拒绝。
4. 必填字段缺失立即 `exit 1`，不做"尽力而为"。
5. `task_id` 必须是 UUID 格式。

## 公共字段（所有 event 共享）

| 字段 | 来源 |
|------|------|
| `version` | 固定 `"1.0"` |
| `ts` | `TZ=Asia/Shanghai date -Iseconds` |
| `task_id` | `--task-id` 或 `.dev-mode.<branch>` 的 `task_id:` 行 |
| `branch` | `--branch` 或 `.dev-mode.*` 文件名或 `git rev-parse --abbrev-ref HEAD` |
| `stage` | `--stage` 或从 `.dev-mode` 推（最后一个 `step_N_xxx: in_progress` → `stage_N_xxx`） |
| `event` | `--event`，closed set |

## 通用参数

```
--event <name>           closed set 之一（见下）
--task-id <uuid>         可选，不传从 .dev-mode 读
--branch <name>          可选，不传从 .dev-mode / git 推
--stage <stage_N_xxx>    可选，不传从 .dev-mode 推
--worktree <path>        可选，默认 $WORKTREE 或 $PWD
--output <path>          可选，默认 <worktree>/.pipeline-evidence.<branch>.jsonl
```

## 10 个 Event 及必填字段

| # | event | 必填参数 | 备注 |
|---|-------|----------|------|
| 1 | `subagent_dispatched` | `--subagent-type --prompt --return-status` | `prompt_sha256` 自动算 |
| 2 | `tdd_red` | `--test-file --test-command --exit-code --log-path` | `log_sha256` 自动算 |
| 3 | `tdd_green` | 同上 | 同上 |
| 4 | `pre_completion_verification` | `--checklist-json --all-pass` | checklist 必须是 JSON array |
| 5 | `critical_gap_abort` | `--reason` | |
| 6 | `blocked_escalation` | `--level --reason --next-action` | `level` 必须整数 |
| 7 | `dispatching_parallel_agents` | `--agents-count --diagnostic-subjects-json` | subjects 必须 JSON array |
| 8 | `architect_reviewer_dispatched` | `--architect-issue --return-status` | |
| 9 | `finishing_discard_confirm` | `--typed-confirm` | true/false |
| 10 | `spec_reviewer_dispatched` | `--context-path` | 语义 = subagent_dispatched + subagent_type=spec_reviewer |

## 常见错误诊断

| 错误信息 | 原因 | 解决 |
|---------|------|------|
| `--event is required` | 没传 event | 加 `--event <name>` |
| `event '...' not in closed set` | event 名称拼错或新加的未注册 | 检查拼写，或先扩容 `ALLOWED_EVENTS` + schema |
| `cannot determine branch` | 不在 worktree 里，也没传 `--branch` | 加 `--branch` 或 `cd` 进 worktree |
| `cannot determine task_id` | `.dev-mode` 里没 `task_id:` 行 | 加 `--task-id` 或修 `.dev-mode` |
| `task_id not a valid UUID` | task_id 格式错 | 检查是否 `8-4-4-4-12` hex |
| `--X is computed by the script` | 用户传了 sha256 字段 | 删除 `--prompt-sha256` / `--log-sha256` |
| `--X must be integer` | `--level` / `--exit-code` / `--agents-count` 非数字 | 传整数 |
| `--X must be 'true' or 'false'` | `--all-pass` / `--typed-confirm` 非 bool | 传 `true` 或 `false` |
| `--X must be JSON array starting with '['` | `--checklist-json` / `--diagnostic-subjects-json` 不是 array | 改为 `'[...]'` |
| `sha256 target not found: ...` | `--prompt` / `--log-path` 文件不存在 | 先创建文件再调用 |
| `assembled JSON failed validation` | 输入含极端字符（极少见） | 用 `--output` 旁路，或简化输入 |
| `stage not inferred, using 'stage_unknown'` | `.dev-mode` 没有 `in_progress` 行 | 显式传 `--stage stage_N_xxx` |

## 运行依赖

- `bash` ≥ 4
- `shasum` 或 `sha256sum`
- `awk`、`sed`、`date`
- 可选：`node` 或 `python3`（用于 JSON 合法性校验，无则跳过）

## 调用示例

```bash
# A. subagent 派发
bash record-evidence.sh --event subagent_dispatched \
  --subagent-type implementer \
  --prompt packages/engine/skills/dev/prompts/implementer-prompt.md \
  --return-status DONE

# B. TDD red
bash record-evidence.sh --event tdd_red \
  --test-file tests/foo.test.ts \
  --test-command "npm test -- tests/foo.test.ts" \
  --exit-code 1 \
  --log-path .tdd-evidence/foo-red.log

# C. 显式传 stage + checklist
bash record-evidence.sh --event pre_completion_verification \
  --stage stage_2_code \
  --all-pass true \
  --checklist-json '[{"id":"c1","pass":true}]'

# D. 完成分支弃用确认
bash record-evidence.sh --event finishing_discard_confirm --typed-confirm true
```
