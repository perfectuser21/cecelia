---
task_id: 10ae95bd-55c4-43f2-a7d5-399466ed7d26
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2"]
---
# 规格：runner 测试隔离外部 CODING_WF_* 环境变量

根因：runner 测试用 `childEnv(process.env)` 构造子进程环境，`childEnv` 保留全部 `CODING_WF_*`（`protocol.test.mjs` 明确要求保留，不能改）。外部变量因此泄漏进被测子进程：
- `sandbox.mjs` 的 `runnerEnv` 只覆盖 REPO/WORKTREE_BASE/LOG_DIR/LOCK_DIR/EXECUTOR/GH_BIN/SKIP_NPM_CI。外部的 `CODING_WF_AUTOMERGE=0` 会让期望调用 gh 的 `run-once.test.mjs` 用例失败。外部的 `CODING_WF_RUN_TIMEOUT_MS`、`CODING_WF_LIST_LIMIT`、`CODING_WF_FAILED_RETENTION_DAYS`、`CODING_WF_KILL_GRACE_MS` 等会改变默认行为。
- `runner-sh.test.mjs` 的 `env = { ...childEnv(), ... }` 会带入外部的 `CODING_WF_MAIN_LOG`。「主日志未超限/滚动」用例里的日志路径被覆盖，且用例之间互相污染。
- `install.test.mjs` 的 `env = { ...childEnv(), ... }` 会带入外部的 `CODING_WF_REPO`、`CODING_WF_ORIGIN_URL`、`CODING_WF_AUTOMERGE`。这会破坏「默认 clone 路径」「plist 不含 AUTOMERGE」等断言。

修复方向：只改测试侧，在构造测试环境时统一剥离 `CODING_WF_*`，不改生产代码，也不改 `childEnv` 语义。

### S-1
对应：I-1、I-2

改动文件：
- `packages/brain/scripts/coding-workflow/runner/__tests__/helpers/sandbox.mjs`：新增并导出 `cleanTestEnv(base = process.env, opts)`。它在 `childEnv(base, opts)` 基础上删除所有以 `CODING_WF_` 开头的键，并且不修改 `base`。`runnerEnv` 的基底从 `childEnv(process.env, { stripClaude: true })` 改为 `cleanTestEnv(process.env, { stripClaude: true })`。其余显式覆盖（沙箱路径、FAKE_GH 等）和 `...extra` 保持不变，所以用例内显式传入的 `CODING_WF_AUTOMERGE: '0'` 等仍然生效。
- `packages/brain/scripts/coding-workflow/runner/__tests__/runner-sh.test.mjs`：`env = { ...childEnv(), CODING_WF_REPO: clone, CODING_WF_ORIGIN_URL: origin }` 改为 `{ ...cleanTestEnv(), ... }`。从 `./helpers/sandbox.mjs` 引入 `cleanTestEnv`，并去掉不再使用的 `childEnv` import。
- `packages/brain/scripts/coding-workflow/runner/__tests__/install.test.mjs`：`...childEnv()` 改为 `...cleanTestEnv()`。同样替换 import。

验证：
1. I-2（不设变量）：先 `env | grep '^CODING_WF_'` 确认无输出，再运行 `cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__`。断言：退出码 0，输出中无 failed 用例。
2. I-1（外部变量污染）：运行 `cd packages/brain && CODING_WF_REPO=/nonexistent CODING_WF_AUTOMERGE=0 CODING_WF_MAIN_LOG=/tmp/cw-x.log npx vitest run scripts/coding-workflow/runner/__tests__`。断言：退出码 0，输出中无 failed 用例；`/tmp/cw-x.log` 不存在或未被测试写入，说明 `CODING_WF_MAIN_LOG` 没有泄漏进 runner.sh 子进程。
3. 回归保护：`cd packages/brain && npx vitest run scripts/coding-workflow/__tests__/protocol.test.mjs` 仍通过，证明 `childEnv` 语义（保留 `CODING_WF_*`）未被改动。

### S-2
对应：I-1（回归测试固化）

改动文件：
- `packages/brain/scripts/coding-workflow/runner/__tests__/plan.test.mjs`（或同目录新增 `sandbox-env.test.mjs`，二选一，优先新增小文件以避免 plan.test 职责膨胀）：新增用例，断言 `cleanTestEnv({ HOME: '/h', CODING_WF_REPO: '/x', CODING_WF_AUTOMERGE: '0', CODING_WF_MAIN_LOG: '/l', GIT_DIR: '/g', KEEP: '1' })` 的结果满足：
  - 不含任何 `CODING_WF_` 开头的键。
  - 不含 `GIT_DIR`。
  - 保留 `HOME` 与 `KEEP`。
  - 传入的原对象未被修改。
  - 另一条用例断言 `runnerEnv(sb, url)` 在 `process.env.CODING_WF_AUTOMERGE='0'` 时返回值的 `CODING_WF_AUTOMERGE` 为 `undefined`。用例在 `finally` 中还原 `process.env`。

验证：`cd packages/brain && npx vitest run scripts/coding-workflow/runner/__tests__` 全绿，新用例在回退 S-1 的 `runnerEnv` 改动后应失败（先红后绿）。该用例永久留在仓库作为回归测试。
