---
task_id: b3d6f213-3fa3-48f9-a2c1-6d7e3b68d132
step: build
upstream: ["02-spec.md#S-1", "02-spec.md#S-2", "02-spec.md#S-3", "02-spec.md#S-4", "02-spec.md#S-5", "02-spec.md#S-6", "02-spec.md#S-7", "02-spec.md#S-8", "02-spec.md#S-9"]
---

# Build 记录

本轮固定 initial base：`6e9076aab2002e301304256b4936e2790f9de8e7`；固定候选：`e526517009e3a9523900dacd600b4228fca6d297`；产品提交：`7581a074f37c1ff4cd0b61fb1ea9656e8dea783a`。下列 B-1 至 B-9 的提交 SHA 均为该产品提交。

共同失败基线命令：`python3 - <<'PY' ... git rev-parse e526517009e3a9523900dacd600b4228fca6d297:<各 S 代表路径> 与 git rev-parse HEAD:<同路径> 逐项断言 ... PY`。实际退出 1，S-1 至 S-9 均为 FAIL；S-1、S-2、S-5、S-7、S-8 代表路径在 initial base 中缺失，其余 blob 不同。该断言核固定候选合同的缺口，不冒充逐项业务行为 RED。22 个文件只从候选真实 Git 对象经 `git show <候选>:<路径>` 取原字节。

共同通过命令 V（本轮实际运行）：

```sh
CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1
```

V 实际退出 0：8 个测试文件、194 项通过；其中 authority-refs 4 项、intent 42 项、new-task 46 项、brain-transport 11 项、protocol 47 项、run-once 28 项、run-once-recovery 11 项、owned-process-enum 5 项，耗时 33.20 秒。本次命令使用 IPC 和 owned；它不能代替后续独立 verify 对真正 Native 隔离和外层进程现场的判定，也不代表 TCP 验收。

### B-1
对应 S-1。改动：`docs/registry/coding-workflow-authority.json`、`packages/brain/scripts/coding-workflow/lib/authority-refs.mjs`、`activities/intent.mjs`、`__tests__/authority-refs.test.mjs`、`__tests__/intent.test.mjs`（后两者及活动路径均位于 `packages/brain/scripts/coding-workflow/`）。验证方式：共同失败基线的 S-1 固定 blob 断言先失败；恢复候选后运行 V，真实 Git 与 intent 子进程测试通过。另运行 `git show e526517009e3a9523900dacd600b4228fca6d297:packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs | rg -n 'jump/secret.md|authority_non_regular_file|replace'`，输出保留 `jump/secret.md` 与拒绝断言。提交 SHA：`7581a074f37c1ff4cd0b61fb1ea9656e8dea783a`。

### B-2
对应 S-2。改动：`docs/registry/coding-workflow-authority.json`、`packages/brain/scripts/coding-workflow/lib/authority-refs.mjs`、`packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs`、`packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs`。验证方式：共同失败基线 S-2 断言先失败；V 中真实 Git 两提交、路径偷换和 Git replace 挑战通过。上述 `git show ... | rg -n 'jump/secret.md|authority_non_regular_file|replace'` 还输出 `package.json` 偷换拒绝断言。提交 SHA：`7581a074f37c1ff4cd0b61fb1ea9656e8dea783a`。

### B-3
对应 S-3。改动：`packages/brain/scripts/coding-workflow/new-task.mjs`、`activities/intent.mjs`、`__tests__/new-task.test.mjs`、`__tests__/brain-transport.test.mjs`、`__tests__/fixtures/brain-fetch-preload.mjs`、`__tests__/helpers/brain-transport.mjs`（后五者均位于 `packages/brain/scripts/coding-workflow/`）。验证方式：共同失败基线 S-3 断言先失败；V 中 new-task 46 项、brain-transport 11 项及 intent 42 项通过，覆盖受控服务调用与真实活动子进程。真实预览建单仍交 QA。提交 SHA：`7581a074f37c1ff4cd0b61fb1ea9656e8dea783a`。

### B-4
对应 S-4。改动：`packages/brain/scripts/coding-workflow/lib/intent.mjs`、`activities/intent.mjs`、`__tests__/intent.test.mjs`、`docs/registry/coding-workflow-authority.json`。验证方式：共同失败基线 S-4 断言先失败；V 中 intent 42 项通过，测试新生成 01 的背景、验收条目和原字节 SHA-256。本任务受保护的 bootstrap 01 未修改；预览中新建任务的归属和摘要仍交 QA。提交 SHA：`7581a074f37c1ff4cd0b61fb1ea9656e8dea783a`。

### B-5
对应 S-5。改动：`packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs`、`intent.test.mjs`、`new-task.test.mjs`、`helpers/procs.mjs`、`helpers/run-activity.mjs`；`protocol.test.mjs` 原有测试保持通过，未修改。验证方式：共同失败基线 S-5 断言先失败；原运行记录由 `shasum -a 256 /Users/administrator/.cecelia/coding-workflow-runner/0c7aa78f-c899-4210-b42e-7be31d0eef18.json` 核得 `1d989c24cd8d7e69e1e567e7380726decda006b0fa780af4f93f81180aa4c37a`。实际运行内联 `python3` 解析该 JSON 的 build attempts transport.stderr 原 JSONL，读得 item_94：`npx vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs` 退出 1，预期 `authority_non_regular_file`、实际 `authority_file_missing`；item_96 同命令退出 0、2 项通过。`git show --format='%H %P %s' --no-patch 3e14f5d7f06c0ee2b8b335eda6d6856834918045` 与对应 `0e67398830dece34fced35c4dd81793dc131a42b` 均退出 0，显示测试提交是实现提交的父提交。本轮 V 退出 0，194 项通过。历史 RED 不记成本轮测试失败，也不以缺模块错误充数。提交 SHA：`7581a074f37c1ff4cd0b61fb1ea9656e8dea783a`。

### B-6
对应 S-6。改动：`packages/brain/scripts/coding-workflow/runner/run-once.mjs`、`runner/__tests__/run-once.test.mjs`、`runner/__tests__/fixtures/fake-executor.mjs`；`runner/__tests__/run-once-recovery.test.mjs` 原有测试保持通过，未修改。验证方式：共同失败基线 S-6 断言先失败；V 中 run-once 28 项及 recovery 11 项通过，核已有运行结果不重认领、失败回写不变 completed。生产旧任务只读状态由监督端另核，本 build 未触碰。提交 SHA：`7581a074f37c1ff4cd0b61fb1ea9656e8dea783a`。

### B-7
对应 S-7。改动：`packages/brain/scripts/coding-workflow/__tests__/brain-transport.test.mjs`、`fixtures/brain-fetch-preload.mjs`、`helpers/brain-transport.mjs`、`authority-refs.test.mjs`、`intent.test.mjs`、`new-task.test.mjs`（后五者同属该 coding-workflow 目录）。验证方式：共同失败基线 S-7 断言先失败；显式 IPC 的 V 退出 0、194 项通过。Git replace 测试本身先证实替换生效，再判固定索引与正文未受替换；本轮未改生产 fetch 或开放网络。提交 SHA：`7581a074f37c1ff4cd0b61fb1ea9656e8dea783a`。

### B-8
对应 S-8。改动：`packages/brain/scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs`、`helpers/owned-processes.mjs`、`helpers/sandbox.mjs`、`fixtures/executor-ipc-preload.mjs`、`fixtures/fake-executor.mjs`、`run-once.test.mjs`、`runner/README.md`、`packages/brain/scripts/smoke/coding-workflow-runner-smoke.sh`。验证方式：共同失败基线 S-8 断言先失败；V 显式 owned，5 项新增进程所有权回归和总计 194 项通过。此处记录本轮本地运行，真正 Native 禁网、禁宿主枚举与认证清理由独立 verify 再核。提交 SHA：`7581a074f37c1ff4cd0b61fb1ea9656e8dea783a`。

### B-9
对应 S-9。改动：上述且仅上述 22 个产品路径；本 build 只另外写此未提交的 `03-build.md`，未修改 sprint 其他文件。验证方式：共同失败基线 S-9 断言先失败；`git cat-file -t <initial-base>` 与 `git cat-file -t <candidate>` 均输出 `commit`；逐路径 `git rev-parse <candidate>:<path>` 和 `git show <candidate>:<path>` 22/22 可读。恢复后内联 `python3` 逐路径比较 `git hash-object <path>` 与候选 blob，输出 `PASS 22 product blobs exact candidate`；`git diff --cached --check` 退出 0；提交前内联 `python3` 核暂存路径恰为 22 个且 blob 全同候选，输出 `PASS staged paths exactly 22 allowed product paths; each blob equals candidate`；提交后再核 HEAD 22 个 blob、该提交路径、initial base 祖先和干净的已跟踪工作树/暂存区，输出 `PASS committed 22 exact candidate blobs; commit changed only allowed paths; initial base ancestor; index and tracked worktree clean`。`git ls-files --others --exclude-standard` 当时仅列本 sprint 的 01/02 与 review 文件，均未提交。后续来源事件、正式预览、QA、judge、CI 和合并不属于本 build 的已完成事实。提交 SHA：`7581a074f37c1ff4cd0b61fb1ea9656e8dea783a`。
