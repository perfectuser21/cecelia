# coding workflow 第一刀设计：intent → spec 两步 md 链

- Brain 任务：8ad60102-1ed6-42f8-b2b8-b46361ff47cd
- PrepPRD：`sprints/10071451-coding-workflow-slice1/prep-prd.md`（主理人 2026-10-07 确认）
- 决策：896fb590、09ffb675、22ef1a72

## 目标

用"契约 + 活动"的方式跑 coding 链的前两步，每一步产出一份带上游引用的 md，全部进 git。执行器复用 PR #5783 的 `activity-contract-run.js`（json-stdio-v1），本刀只交付契约和活动。

## 位置

```
packages/brain/scripts/coding-workflow/
  contract.json              # coding_spec 契约
  lib/protocol.mjs           # 读 stdin、写唯一结果 JSON、日志走 stderr
  lib/md-chain.mjs           # frontmatter/锚点解析与链校验（纯函数）
  lib/intent.mjs             # 验收条目提取与 01-intent.md 渲染（纯函数）
  prompts/spec.md            # spec 活动的薄 prompt
  activities/intent.mjs
  activities/spec.mjs
  activities/chain-check.mjs
  activities/publish.mjs
  __tests__/*.test.mjs       # vitest 已 include scripts/**
```

执行器以 `--cwd packages/brain/scripts/coding-workflow` 调用，`entry` 写 `activities/<name>.mjs`。

## 数据流

工作流输入（执行器 stdin 的 `input`）：

| 字段 | 含义 |
|---|---|
| run_tag | 本次运行标识 |
| task_id | Brain 任务完整 UUID |
| worktree | cp-* worktree 绝对路径 |
| sprint_dir | 相对 worktree 的 sprint 目录 |
| brain_url | 默认 `http://localhost:5221` |

执行器把输入与前序活动 outputs 累积成上下文传给下一个活动。

| order | key | phase | 做什么 | outputs |
|---|---|---|---|---|
| 1 | intent | setup | GET 任务 → 提取验收条目 → 写 `01-intent.md` | `intent_file`、`intent_ids` |
| 2 | spec | source | `claude -p` + `prompts/spec.md`，cwd=worktree → 写 `02-spec.md` | `spec_file` |
| 3 | chain_check | batch_end | 校验 sprint 目录下 01、02 | `chain_files` |
| 4 | publish | batch_end | `git -C` add/commit/push → `gh pr create`（已存在则复用） | `pr_url` |

## md 链格式

```markdown
---
task_id: <uuid>
step: intent | spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2"]
---
### I-1
<验收条目原文>
```

锚点规则：标题行 `### <ID>`，ID 匹配 `^[A-Z]+-\d+$`。spec 的条目用 `### S-n`，每条写明对应的 I-n。

## 校验规则（chain_check）

1. 每份 md 都有 frontmatter，`task_id` 与输入一致。
2. `upstream` 每一项为 `文件#锚点`，文件在同目录存在，且该文件含 `### 锚点`。
3. `02-spec.md` 的 upstream 覆盖 `01-intent.md` 的全部 I-n。
4. 01 的 upstream 为空数组。

任一不过 → `failed` + `fatal`，errors 列表写入 evidence。

## 验收条目提取（intent）

优先 `payload.acceptance`（字符串数组）。没有的话，在 description 中找"验收"字样后的内容：按 `-`/`①`/`1.` 等列表项或"；"切分，去空。两处都为空 → `needs_human`。Brain 返回 404/400 → `fatal`；网络失败或 5xx → `retryable`。

## spec 活动

- 命令默认 `claude`，可用环境变量 `CODING_WF_CLAUDE_BIN` 覆盖（测试用假脚本）。
- 参数：`-p <prompt> --permission-mode acceptEdits`，prompt 由 `prompts/spec.md` 填入 task_id、文件路径、全部 I-n。
- 子进程 stdout/stderr 全部转发到本活动的 stderr。
- 退出码非 0：输出含 auth/login/quota 字样 → `needs_human`，否则 `retryable`。
- 跑完 `02-spec.md` 不存在 → `fatal`。格式问题交给 chain_check 判定。

## publish 活动

- 工作区以外的改动不提交：只 `git add -- <sprint_dir>`。
- 无改动可提交时不报错，继续查找 PR。
- push 失败 → `retryable`。
- `gh pr list --head <branch>` 已有 PR → 复用其 URL；否则 `gh pr create --draft`。
- gh 鉴权失败 → `needs_human`。

## 契约要点

- 每个活动的 failure 只声明自己会报的分类，且非空。
- spec 设 `max_attempts: 2`，其余为 1。
- budget：intent 60s、spec 900s、chain_check 30s、publish 900s；heartbeat 统一 30s。publish 由原 120s 调为 900s（终审裁定）：本仓 pre-push 钩子会跑全量 quickcheck（约 10 分钟），publish 内 `git push` 不加 `--no-verify`，120s 必超时。

## 错误处理

结果 JSON 只能写一次到 stdout，所有日志走 stderr。`completed` 退出码 0，`partial`/`failed` 退出码 2。未捕获异常统一包成 `failed` + `fatal`。

## 测试策略

| 档 | 内容 |
|---|---|
| unit | md-chain：合法链通过；伪造锚点、缺上游文件、task_id 不一致、未覆盖全部 I-n 四种判错。intent：payload.acceptance 优先；描述"验收"段解析；两处都无判 needs_human |
| integration（子进程） | 以 stdin/stdout 真实调用每个活动：intent 用本地假 Brain HTTP 服务；spec 用假 claude 脚本（正常写文件 / 不写文件 / 认证失败 / 超时睡眠）；chain_check 用临时目录；publish 用临时 git 仓 + 假 gh。校验结果 JSON 满足执行器结果格式（schema_version=1、run_tag 回传、completed 时 failure_class 为 null、evidence 为数组） |
| 契约形状 | 单测断言 contract.json 每个活动的 phase/entry/protocol/budget/failure 满足执行器规则 |
| E2E | 用 #5783 分支上的 `activity-contract-run.js` 对真实任务跑一遍，PR 里出现 01、02 两份 md，链校验通过 |

## 不做

执行器本体、kernel、Work Router、harness-planner、Commander 陪跑、us-vps。
