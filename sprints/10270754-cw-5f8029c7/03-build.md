---
task_id: 5f8029c7-6f55-441a-b7d0-70688ac0cfb9
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5", "02-spec.md#S-6"]
---

### B-1
对应 S-1。改动 `docs/registry/coding-workflow-authority.json`、`packages/brain/scripts/coding-workflow/lib/authority-refs.mjs`、`activities/intent.mjs`、`__tests__/authority-refs.test.mjs`，以及受管声明所需的 `new-task.mjs`、`runner/run-once.mjs`。复用候选的可信 Git 索引、路径与 kind 对账、正文摘要、历史版本和 Git replace 防护。先执行 `npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs --maxWorkers=1 --minWorkers=1`：实现前 2 项失败，均为解析模块缺失，退出码 1；实现后同命令 3 项通过，退出码 0；完整命令后为 4 项通过。验证只写任务允许的 coding-workflow 测试与临时 Git 仓库。提交：`51aa5b2a3`、`efc8576db`、`817a465db`、`becf97199`、`9da00120c`。

规格差异：候选以可信 clone 的 `origin/main` SHA 首次绑定并冻结到任务，而非在模块内写死索引 commit 常量；URL 实际原因为 `authority_source_unsupported`、状态为 `missing`，不是规格写的 `external_authority_unsupported`、`unsupported`。受管 required 失败在写 01 前返回，01 内看不到该失败引用事实。这些差异未通过修改固定候选掩盖。

### B-2
对应 S-2。改动 `packages/brain/scripts/coding-workflow/new-task.mjs`、`activities/intent.mjs`、`lib/intent.mjs`、`runner/run-once.mjs`、`__tests__/new-task.test.mjs`、`__tests__/intent.test.mjs`，并在 `runner/README.md` 记录声明方式。完整命令中 new-task 46 项、intent 42 项通过，含任务回执、旧任务、required 阻断和 01 输出。实现前含这两文件及 runner 的组合命令启动后 90 秒无测试结果，已中断，退出码 130；不能算作 S-2 的 RED。验证材料限允许的测试文件与受控假 Brain；未访问生产。提交：`51aa5b2a3`、`efc8576db`、`817a465db`、`becf97199`、`c77446c95`。

### B-3
对应 S-3。改动 `packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs`、`intent.test.mjs`、`new-task.test.mjs`、`brain-transport.test.mjs`、`helpers/run-activity.mjs`、`helpers/brain-transport.mjs`、`fixtures/brain-fetch-preload.mjs`。执行 `CODING_WF_TEST_TRANSPORT=ipc npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/brain-transport.test.mjs --maxWorkers=1 --minWorkers=1`：辅助模块引入前 suite 因模块缺失失败、退出码 1；引入后 11 项通过、退出码 0。完整 Native IPC 命令 194 项通过。只改测试辅助层，生产活动保留 HTTP fetch；IPC 结果不证明 TCP、重定向或 Response.url。提交：`9da00120c`、`c77446c95`。

### B-4
对应 S-4。改动 `packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs`、`runner/__tests__/helpers/sandbox.mjs`、`runner/__tests__/fixtures/fake-executor.mjs`、`runner/__tests__/fixtures/executor-ipc-preload.mjs`；固定候选也改动 `runner/run-once.mjs` 的受管引用绑定，原有结果跳过和失败回写断言保留。完整命令中 run-once 28 项、run-once-recovery 11 项通过。实现前组合命令无结果而中断，不能算作 S-4 的 RED。验证限真实 runner 子进程及测试受控任务服务，未读写生产旧任务。提交：`efc8576db`、`817a465db`、`becf97199`、`e56ecc303`、`a57d063a9`。

### B-5
对应 S-5。改动 `packages/brain/scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs`、`runner/__tests__/helpers/owned-processes.mjs`、`runner/__tests__/fixtures/fake-executor.mjs`、`__tests__/helpers/procs.mjs`、`runner/__tests__/run-once.test.mjs`。执行 `CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1`：辅助模块引入前 3 项因模块缺失失败、退出码 1；完整命令引入后该文件 5 项通过。真实 PID/PPID、签名与 nonce 的测试限定在本轮临时进程，未操作真机或宿主已有进程。提交：`a3c7546ac`、`a57d063a9`。

### B-6
对应 S-6。只读确认固定候选 HEAD `65664cf3fbdffaa53a5d77f9084cbf27ac0e3b4a`，其九个提交依序连接到 initial base `95d3d6b9647a4accc748a4988f6bcf151d82c55f`；依序复用到当前分支的提交为 `51aa5b2a3`、`efc8576db`、`817a465db`、`becf97199`、`9da00120c`、`c77446c95`、`e56ecc303`、`a3c7546ac`、`a57d063a9`。候选第六笔的 `.dod.md` 改动不在任务范围，未提交；其余改动仅在 `docs/registry/coding-workflow-authority.json` 及 `packages/brain/scripts/coding-workflow/`。实际执行 `git rev-parse HEAD` 得 `a57d063a910920457d849508f71c14e2bd7a03f4`；`git merge-base HEAD 95d3d6b9647a4accc748a4988f6bcf151d82c55f` 返回同一 base；`git log --format='%H %P %s' 95d3d6b9647a4accc748a4988f6bcf151d82c55f..HEAD` 返回上述九笔线性提交；`git diff --check 95d3d6b9647a4accc748a4988f6bcf151d82c55f..HEAD` 无输出、退出码 0。`git status --porcelain=v1 --untracked-files=all` 仅列原有 sprint 未跟踪材料，暂存区空。本文件最后写入，不纳入提交。

本轮 Native 完整验收命令：`CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1`。原生输出：8 个文件、194 项全通过，耗时 33.18 秒，退出码 0。默认 HTTP/系统 pgrep 路径、本轮外层独立核验和生产旧失败读回未在当前隔离环境执行，不记为通过。
