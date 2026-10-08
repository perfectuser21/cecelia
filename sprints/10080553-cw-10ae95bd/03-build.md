---
task_id: 10ae95bd-55c4-43f2-a7d5-399466ed7d26
step: build
upstream: ["02-spec.md#S-1","02-spec.md#S-2"]
---

### B-1
- 对应规格：S-2（先写测试，TDD 红阶段）+ S-1（实现）
- 改动文件：
  - `packages/brain/scripts/coding-workflow/runner/__tests__/helpers/sandbox.mjs`：新增并导出 `cleanTestEnv(base = process.env, opts)`（基于 `childEnv` 再删除所有 `CODING_WF_` 开头的键，不改 `base`）；`runnerEnv` 基底改为 `cleanTestEnv(process.env, { stripClaude: true })`，显式覆盖与 `...extra` 不变。
  - `runner/__tests__/runner-sh.test.mjs`、`runner/__tests__/install.test.mjs`：`...childEnv()` 改为 `...cleanTestEnv()`，import 改自 `./helpers/sandbox.mjs`，移除不再使用的 `childEnv` import。
  - 生产代码与 `childEnv` 语义未改动。
- 新增测试：`runner/__tests__/sandbox-env.test.mjs`（2 条）
  - `cleanTestEnv`：不含任何 `CODING_WF_*`、不含 `GIT_DIR`、保留 `HOME`/`KEEP`、入参未被修改。
  - `runnerEnv`：`process.env.CODING_WF_AUTOMERGE='0'` 时返回值该键为 `undefined`，显式 `extra` 传入仍生效；`finally` 还原 `process.env`。
- 实际运行的命令与输出摘要（均在 `packages/brain` 下）：
  1. 红：`npx vitest run scripts/coding-workflow/runner/__tests__/sandbox-env.test.mjs`（实现前）→ 2 failed（`cleanTestEnv` 未定义；`expected '0' to be undefined`）。
  2. 绿 / I-2（环境中 `env | grep '^CODING_WF_'` 无输出）：`npx vitest run scripts/coding-workflow/runner/__tests__` → 7 files passed，63 tests passed。
  3. I-1 污染场景：`CODING_WF_REPO=/nonexistent CODING_WF_AUTOMERGE=0 CODING_WF_MAIN_LOG=/tmp/cw-x.log npx vitest run scripts/coding-workflow/runner/__tests__` → 7 files passed，63 tests passed；`/tmp/cw-x.log` 不存在（`No such file or directory`），说明未泄漏进 runner.sh 子进程。
  4. 先红后绿对照：临时回退 `runnerEnv` 与 install/runner-sh 的改动后，在同样的污染变量下 → 5 failed（install dry-run plist、run-once 认领 409、run-once 成功路径、run-once-recovery、sandbox-env 新用例）；恢复修复后再次全绿。
  5. 回归保护：`npx vitest run scripts/coding-workflow/__tests__/protocol.test.mjs` → 47 passed（`childEnv` 保留 `CODING_WF_*` 的语义未变）。
  6. 全目录：`npx vitest run scripts/coding-workflow` → 24 files passed，457 tests passed。
- 提交 SHA：`fee50414c`（`test(workflow): runner 测试隔离外部 CODING_WF_* 环境变量`）；提交后工作区除 `sprints/` 外无遗留改动。
