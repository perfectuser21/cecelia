# Contract Draft — cecelia-run dry-run 恢复 `--session-id`

Task ID: `58b733b8-ff1f-4120-a394-5bf8e38d4049`

Gear: `hotfix`

Contract status: controller 依据 `sprint-prd.md` 的只读「锚定声明」机械组装；本合同不经过 proposer/reviewer GAN。

## 范围

只修复最新 `origin/main` 已存在的独立回归：`packages/brain/scripts/cecelia-run.sh --dry-run` 已生成 session id，但最终 launcher CLI 没有收到 `--session-id <uuid>`。

允许修改：

- `packages/brain/scripts/cecelia-run.sh`
- `packages/engine/tests/launcher/launcher-dry-run.test.ts`
- 本 sprint 的合同测试与 `e2e-verify.sh`
- 现有门禁机械要求的最小版本/登记文件（仅 CI 明确要求时）

禁止修改：

- PR #4339 的合同、sprint 文件、门禁实现或业务 diff
- `scripts/claude-launch.sh` 的参数语义
- 任何 Golden Path 断言
- 生产数据库或生产凭据

## Golden Path

维护者从最新 `origin/main` 执行 `bash packages/brain/scripts/cecelia-run.sh --dry-run` → 系统生成一次 UUID session id → dry-run 输出把同一个值同时呈现在 `CLAUDE_SESSION_ID=<uuid>` 与 launcher CLI 的 `--session-id <uuid>` → launcher regression、engine 全量测试与 GitHub `engine-tests` 全绿 → 独立 PR 合入 `main`。

## 锚定行为

1. `[BEHAVIOR] dry-run 输出含 --session-id UUID`
2. `[BEHAVIOR] session id 单次生成且环境变量与 CLI 同值`
3. `[BEHAVIOR] launcher-dry-run 既有回归通过`
4. `[BEHAVIOR] packages/engine 全量测试与 GitHub engine-tests 全绿`

上述四条逐字派生自 `sprint-prd.md` 的四条锚定声明。generator 若认为任何一条需要修改，必须返回：

```text
[FATAL] gear=hotfix 禁止顺手改 Golden Path 断言 — 请升档为全流程 sprint 重新对抗合同
```

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| ws1 | `../../tests/regression/engine-tests-session-id-hotfix-599471cf/cecelia-run-session-id.test.ts` | `dry-run 输出含 --session-id UUID` / `session id 单次生成且环境变量与 CLI 同值` | 最新 main 的 CLI 缺 `--session-id`，两条目标断言失败 |
| ws1 | `../../packages/engine/tests/launcher/launcher-dry-run.test.ts` | `cecelia-run.sh --dry-run 输出含 --session-id <uuid>` | 既有 launcher 回归在最新 main 失败 |

## TDD 纪律

1. `(Red)` commit 只能加入或强化合同测试，不得包含生产实现。
2. 在 `(Red)` commit 上真跑定向测试，必须以断言失败证明缺陷，不能因环境/依赖崩溃而红。
3. `(Green)` commit 才能修改 `packages/brain/scripts/cecelia-run.sh`。
4. `(Red)` 后合同测试文件不可修改；如测试本身错误，返回 controller 升档，不得偷偷改测试迁就实现。
5. 两个 commit 均须 push 到 `cp-07260927-58b733b8`，PR 正文须含本 task id。

## E2E 验收

generator 必须生成并真跑：

```bash
bash scripts/smoke/e2e/engine-tests-session-id-hotfix-599471cf.sh
```

脚本必须：

1. 在仓库根目录执行真实 `packages/brain/scripts/cecelia-run.sh --dry-run`。
2. 从输出提取 `CLAUDE_SESSION_ID=<uuid>` 与 `--session-id <uuid>`。
3. 断言两值均为 UUID、完全相同，且 CLI 中 `--session-id` 恰出现一次。
4. 真跑定向 sprint test 与既有 `packages/engine/tests/launcher/launcher-dry-run.test.ts`。
5. 任何失败非零退出，禁止吞错或用静态源码 grep 冒充行为。

持续回归宿主：

- 合同测试已由 `scripts/graduate-sprint-tests.mjs` 纯 rename 入册到 `tests/regression/`，由根 `vitest.config.js` 持续收集。
- E2E wrapper 已入册到 `scripts/smoke/e2e/`，由 nightly E2E glob 持续收集。

## 风险与护栏

| 风险 | 护栏 |
|---|---|
| 生成两个不同 session id | 同一次 dry-run 同时解析 env 与 CLI，断言字节级相等 |
| 仅环境变量假绿 | 必须独立匹配 `--session-id <uuid>` 且出现一次 |
| shell 引号破坏 launcher 参数 | 真跑 dry-run，不接受源码文本检查代替 |
| 顺手改父 PR | PR diff 明确排除 #4339 sprint 与门禁文件 |
| 测试剧场化 | Red 必须是目标断言失败，Green 真跑脚本与 vitest |

## 未覆盖真实链路清单

N/A。本 sprint 的真实链路是本地 shell dry-run + vitest + GitHub Actions `engine-tests`；三层均纳入验收。
