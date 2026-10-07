# 小改动 PrepPRD：coding workflow 第一刀——intent→spec 两步 md 链，跑在通用活动执行器上

- Brain 任务：8ad60102-1ed6-42f8-b2b8-b46361ff47cd
- 决策：896fb590（Commander + workflow + md 产物链）、09ffb675（coding 四类一架梯子）、22ef1a72（本刀取舍）
- 来源盘点：6ab2d8a6（https://claude.ai/artifact/5JJs91SyATmHQKc4cr6mNN）
- GP-Anchor: none(infra)

## 改什么

| 件 | 内容 |
|---|---|
| 契约 `coding_spec.json` | 符合 PR #5783 `activity-contract.js` 校验：workflow、activities[key/order/budget{max_duration_s,heartbeat_s}/failure{empty_ok,retryable,fatal,needs_human.cases}/runtime{protocol:json-stdio-v1,phase,entry,argv,on_failure,max_attempts}]；每个活动会报的失败分类必须在 failure 里声明（否则 undeclared_failure_class 停链） |
| 活动 ① intent（确定性） | 按完整 UUID 读 Brain 任务；验收条目优先 `payload.acceptance`，缺则解析 description 中「验收」段；渲染 `sprints/<dir>/01-intent.md`，frontmatter `task_id`、`upstream: []`，条目锚点 `### I-1`…`### I-n`；两处都无 → needs_human |
| 活动 ② spec | `claude -p` + coding 专用薄 prompt，输入 01-intent.md，产出 `02-spec.md`；frontmatter `upstream` 必须覆盖全部 `01-intent.md#I-n`。不加载 harness-planner（其自带 push、固定 sprint-prd.md、读 payload.thin_prd，三处冲突） |
| 活动 ③ md-chain-check（确定性） | task_id 一致；upstream 每条 `文件#锚点` 文件存在且锚点存在；02 覆盖 01 全部 I-n；任一不过 → fatal |
| 活动 ④ publish | `git -C <worktree>` add/commit/push cp 分支 → `gh pr create`；已有 PR 复用（幂等）；gh 401/scope 不足 → needs_human；push 被拒 → retryable |
| 位置 | `packages/brain/scripts/coding-workflow/`（契约 + 活动）；测试放 vitest include 覆盖目录 |
| 不碰 | 执行器本体、kernel、Work Router、harness-planner、us-vps |

## 活动约定（来自审查）

- 进程 cwd = 执行器 `--cwd`（契约目录），worktree 与 sprint 目录必须经 input 传入，git 一律 `git -C`。
- stdout 只输出一个结果 JSON（schema_version=1、run_tag 原样、failure_class completed 时为 null、evidence 数组）；所有日志走 stderr；completed 必须 exit 0，partial exit 2。

## 错误路径

| 依赖 | 场景 | 分类 | 处置 |
|---|---|---|---|
| Brain API | 不通/超时 | retryable | 重试 1 次后停链 |
| Brain API | 任务不存在/ID 非法 | fatal | 停链 |
| Brain API | 无验收条目 | needs_human | 停链待补 |
| claude CLI | 超 max_duration_s | retryable（执行器判） | max_attempts=2 |
| claude CLI | 认证/额度失败 | needs_human | 停链 |
| claude CLI | 产物缺失/frontmatter 不合规 | fatal（chain-check） | 停链保留草稿 |
| git | worktree 脏/分支冲突 | fatal | 停链不覆盖 |
| git | push 被拒 | retryable | 重试 1 次 |
| gh | 401/scope 不足 | needs_human | commit 留本地 |
| gh | PR 已存在 | completed | 回执已有 PR URL |

## 验收

- [ ] 真实任务跑一遍：PR 的 `sprints/<dir>/` 有 01-intent.md、02-spec.md；02 upstream 指向 01 全部 I-n 且锚点存在
- [ ] 单测：md-chain-check 对伪造锚点/缺上游文件/task_id 不一致/未覆盖全部 I-n 四种判 fatal；intent 无验收判 needs_human；超时用假 entry 测判 retryable
- [ ] 所有活动输出通过 `parseActivityResult` 校验；契约通过 `parseActivityContract` 校验
- [ ] CI 全绿；结果回写 Brain 8ad60102
