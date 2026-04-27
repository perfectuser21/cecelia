# PRD: Gate 1 — lint-no-fake-test + test impact analysis

## 背景

Brain 任务 ID：`1d45c943-cc7c-4735-be94-a4193dbbc42a`
分支：`cp-0427162913-lint-no-fake-test`

历史教训（PR #2670/#2671/#2672）：implementer subagent 给 executor.js / cortex.js / thalamus.js
添加的 stub test 全是 `expect(handler).toBeDefined()` 零行为断言——coverage 100% 但生产代码
改坏不报错，属于典型"假覆盖"。

现有 lint 分工：
- `lint-test-quality.sh`：拦 readFileSync(src/) + 全 .skip + 0 expect
- `lint-no-mock-only-test.sh`：拦 heavy mock（≥30）无配套真覆盖
- `lint-no-fake-test.sh`（本 PR）：拦**弱断言占 100%** / **mock-heavy + 低 expect**

## 成功标准

1. `lint-no-fake-test.sh` 在 CI `lint-no-fake-test` job 中执行，PR 有新增全弱断言测试时 hard fail
2. `brain-unit` job 在 PR 模式下使用 `vitest --changed` 只跑被影响测试，加速到 < 5 min
3. 7 个 case 自测脚本全通过（4 个 FAIL case + 3 个 PASS case）

## 范围

- `.github/workflows/scripts/lint-no-fake-test.sh`（新增，112 行）
- `.github/workflows/scripts/__tests__/lint-no-fake-test.test.sh`（新增，159 行）
- `.github/workflows/ci.yml`（新增 `lint-no-fake-test` job + `brain-unit` vitest --changed 改造）

## 测试策略

类型：shell script unit test（bash 自跑）
- 7 个 isolated git repo case 覆盖 Rule 1 + Rule 2 的所有路径
- CI job 直接 `bash lint-no-fake-test.sh` 执行，无外部依赖
