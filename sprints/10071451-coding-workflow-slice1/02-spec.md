---
task_id: 8ad60102-1ed6-42f8-b2b8-b46361ff47cd
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---
# coding workflow 第一刀实现规格

### S-1
对应：I-1、I-2

真实任务端到端跑一遍 intent → spec → chain_check → publish，PR 里出现 01、02 两份 md。

改动文件：
- 无新增代码；使用现有 `packages/brain/scripts/coding-workflow/contract.json` 与 `activities/{intent,spec,chain-check,publish}.mjs`
- 产物：`sprints/10071451-coding-workflow-slice1/01-intent.md`、`sprints/10071451-coding-workflow-slice1/02-spec.md`（由活动生成并经 publish 提交）

验证：
- 用 PR #5783 的 `activity-contract-run.js` 以 `--cwd packages/brain/scripts/coding-workflow` 执行契约，输入 `task_id=8ad60102-1ed6-42f8-b2b8-b46361ff47cd`、`sprint_dir=sprints/10071451-coding-workflow-slice1`、`worktree=<本 worktree 绝对路径>`；四个活动结果均为 `status=completed`。
- `gh pr view <pr_url> --json files -q '.files[].path'` 输出同时包含 `sprints/10071451-coding-workflow-slice1/01-intent.md` 与 `sprints/10071451-coding-workflow-slice1/02-spec.md`。
- chain_check 结果 `outputs.chain_files` 等于 `["01-intent.md","02-spec.md"]`。

### S-2
对应：I-2

02 的 upstream 覆盖 01 全部 I-n，且每个锚点在 01 中真实存在（chain_check 已实现，补一条针对本 sprint 真实产物的断言）。

改动文件：
- `packages/brain/scripts/coding-workflow/lib/md-chain.mjs`（不改，复用校验函数）
- `packages/brain/scripts/coding-workflow/__tests__/md-chain.test.mjs`（已有"合法链通过""未覆盖全部 I-n"用例，保持）

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/md-chain.test.mjs scripts/coding-workflow/__tests__/chain-check.test.mjs` 全部通过。
- 对真实产物运行 chain_check 活动：`echo '{"input":{"task_id":"8ad60102-1ed6-42f8-b2b8-b46361ff47cd","worktree":"<worktree>","sprint_dir":"sprints/10071451-coding-workflow-slice1"}}' | node packages/brain/scripts/coding-workflow/activities/chain-check.mjs`，stdout 结果 `status=completed`，退出码 0。
- 断言 02 frontmatter `upstream` 至少包含 `01-intent.md#I-1`，且 01 中存在 `### I-1` 标题行。

### S-3
对应：I-3

伪造引用、缺文件两类判 FAIL 已有单测覆盖，确认保留并纳入 CI。

改动文件：
- `packages/brain/scripts/coding-workflow/__tests__/md-chain.test.mjs`（已有：伪造锚点、缺上游文件、文件缺失）
- `packages/brain/scripts/coding-workflow/__tests__/chain-check.test.mjs`（已有：伪造锚点 → `failed`/`fatal`/`md_chain_invalid`）
- `packages/brain/scripts/coding-workflow/__tests__/spec.test.mjs`（已有：退出 0 但没写文件 → `fatal spec_missing`）

验证：
- `cd packages/brain && npx vitest run scripts/coding-workflow` 全部通过，且上述用例名出现在输出中。
- 断言：伪造锚点用例结果 `status=failed`、`failure_class=fatal`、`evidence[0].errors` 非空；缺文件用例 `reason_code=spec_missing`，进程退出码 2。

### S-4
对应：I-3

新增 spec 活动超时：claude 子进程超过时限即被终止，判 `retryable` + `claude_timeout`（执行器据此按 `max_attempts=2` 重试），并补单测。

改动文件：
- `packages/brain/scripts/coding-workflow/activities/spec.mjs`：`runChild` 增加超时，默认 870000ms（低于契约 budget 900s），可由环境变量 `CODING_WF_SPEC_TIMEOUT_MS` 覆盖；到时先 SIGTERM，5s 后未退出再 SIGKILL，返回 `{ timedOut: true }`；主流程遇 `timedOut` 返回 `fail('retryable', 'claude_timeout')`，不再检查产物。
- `packages/brain/scripts/coding-workflow/__tests__/fixtures/fake-claude.mjs`：新增 `FAKE_CLAUDE_MODE=sleep`，只打印一行后 `setTimeout` 长睡（例如 60s）不写文件。
- `packages/brain/scripts/coding-workflow/contract.json`：spec 的 `failure.retryable` 增加 `claude_timeout`。
- `packages/brain/scripts/coding-workflow/__tests__/contract.test.mjs`：`REPORTED.spec.retryable` 增加 `claude_timeout`。
- `packages/brain/scripts/coding-workflow/__tests__/spec.test.mjs`：新增用例"claude 超时 -> retryable claude_timeout"。

验证：
- 新用例设 `FAKE_CLAUDE_MODE=sleep`、`CODING_WF_SPEC_TIMEOUT_MS=500`，断言：结果 `status=failed`、`failure_class=retryable`、`reason_code=claude_timeout`，退出码 2，整个活动耗时 < 10s，`02-spec.md` 不存在。
- `cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/spec.test.mjs scripts/coding-workflow/__tests__/contract.test.mjs` 全部通过。

### S-5
对应：I-4

新增 report 活动（order 5，phase `finalize`），把运行结果回写 Brain 任务；不改任务状态（PR 合并后才置 completed）。

改动文件：
- 新增 `packages/brain/scripts/coding-workflow/activities/report.mjs`：输入 `task_id`、`brain_url`（默认 `http://localhost:5221`）、`pr_url`、`branch`、`chain_files`、`sprint_dir`；`PATCH {brain_url}/api/brain/tasks/{task_id}`，body `{"result":{"coding_workflow":{"pr_url","branch","sprint_dir","chain_files","run_tag","host":os.hostname()}}}`。分类：缺 `pr_url` → `fatal pr_url_missing`；404/400 → `fatal task_not_found`；5xx/408/429/网络错误 → `retryable brain_unavailable`；其他非 2xx → `fatal brain_http_<code>`。成功 outputs `{ reported: true }`。
- `packages/brain/scripts/coding-workflow/contract.json`：追加 `report` 活动（order 5、phase `finalize`、entry `activities/report.mjs`、budget 30s/heartbeat 30s、max_attempts 1、failure 只声明上述分类）。
- `packages/brain/scripts/coding-workflow/__tests__/contract.test.mjs`：活动顺序改为五个，`EXPECTED`/`REPORTED` 增加 report。
- 新增 `packages/brain/scripts/coding-workflow/__tests__/report.test.mjs`：本地假 Brain HTTP 服务。

验证：
- 单测断言：成功时假 Brain 收到恰好一次 `PATCH /api/brain/tasks/<id>`，body `result.coding_workflow.pr_url` 等于输入；404 → `fatal task_not_found`；500 → `retryable brain_unavailable`；缺 `pr_url` → `fatal pr_url_missing` 且不发请求；stdout 只有一个结果 JSON。
- `cd packages/brain && npx vitest run scripts/coding-workflow` 全部通过。
- E2E 后查库：`curl -s localhost:5221/api/brain/tasks/8ad60102-1ed6-42f8-b2b8-b46361ff47cd | jq '.result.coding_workflow.pr_url'` 等于 S-1 的 PR URL。

### S-6
对应：I-4

不碰 kernel、不在 us-vps 执行。

改动文件：
- 无额外改动；约束由 S-5 回写的 `host` 字段与 diff 范围检查验证。

验证：
- `git diff --name-only origin/main...HEAD` 的每一行都以 `packages/brain/scripts/coding-workflow/`、`sprints/10071451-coding-workflow-slice1/` 或 `docs/superpowers/` 开头；没有任何 `packages/brain/src/` 下的文件，也没有路径含 `kernel`。
- `grep -rniE "kernel" packages/brain/scripts/coding-workflow/activities packages/brain/scripts/coding-workflow/lib` 无输出。
- E2E 后 `curl -s localhost:5221/api/brain/tasks/8ad60102-1ed6-42f8-b2b8-b46361ff47cd | jq -r '.result.coding_workflow.host'` 不含 `us-vps`。
