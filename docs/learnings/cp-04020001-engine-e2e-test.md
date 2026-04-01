# Learning: cp-04020001-engine-e2e-test

## 根本原因

Engine 有 102 个 unit 测试但 E2E 为 0——所有测试验证单个脚本，从未端到端组装验证 /dev 全流程。

这种缺口在 Engine 重构前尤其危险：删除 Stage 系统、精简 stop-dev.sh 之类的改动若没有行为级安全网，只能靠人工回归。

bash 变量赋值 `result=$(fn)` 是一个常见陷阱——bash 不对赋值语句应用 `set -e`，导致函数返回的非零退出码被静默吞掉。

## 什么有效

`result=$(devloop_check ...)` 在 bash 中会吞掉函数 exit code（bash 赋值语句不触发 `set -e`），直接调用 `devloop_check ...` 才能让返回码正确传播。

`spawnSync` 捕获 stdout 不受影响——即使 `set -e` 提前退出，已写入的输出依然被捕获。

## 测试设计要点

- E2E 测试覆盖"零件组装"层面：worktree 脚本能跑、devloop-check 读 .dev-mode 判断 Stage 正确、stop hook 退出码语义正确
- 不依赖真实 remote：`git init` 临时目录 + 写 .dev-mode 文件即可隔离测试 devloop_check 行为
- worktree-manage create 测试：CI 无 remote 时允许 status≠0，但不允许 usage error

## 下次预防

- [ ] 测试 shell 函数退出码时，禁止用 `result=$(fn)` 形式——用 `fn` 直接调用或 `fn; rc=$?; exit $rc`
- [ ] E2E 测试放 `tests/e2e/`，vitest.config.ts 加注释标记目录存在（CI 可发现）
- [ ] 新增 shell 脚本改动时，同步补充对应 E2E 或 integration test
