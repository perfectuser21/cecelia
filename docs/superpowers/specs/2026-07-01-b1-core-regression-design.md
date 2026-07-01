# 设计：无条件核心回归闸（B1）

## 背景 / 问题
CI 的 `workspace` 路径门（`ci.yml` changes job：`^apps/` 命中才 true）只在改动目录内跑测试。但 `apps/` 与 `packages/brain` 是**共享 DB schema / API 契约的运行时耦合**——改 brain 打坏 apps 行为时，那次 PR 没碰 `apps/`，`workspace-test` 被 `if` 跳过，绿灯放行。依赖图（Bazel 式）也算不全这种运行时耦合。此外现有 `regression-smoke`（ci.yml:716）扫一个不存在的 `*.golden-smoke.test.ts` 目录、静默 `exit 0`——假绿灯。

## 目标
新增一条**无条件**核心回归闸：不管改了哪个目录，都跑一批"绝不能坏"的断言；干掉假绿灯；用一个 committed 的契约文件驱动。

## 组件（单一职责）
1. **`regression-contract.yaml`（root）** — SSOT。schema 对齐 `packages/quality/contracts/regression-contract.template.yaml`（`golden_paths[]` 各含 `id / priority / triggers / test_command / must_never_break`）。本 sprint 播种 ≥1 条真实、已有 committed 测试支撑的 P0 must-never-break 条目（选一条现有 Brain 契约/selfcheck 测试）。
2. **`scripts/ci/run-core-regression.sh`** — 纯执行器。入参 `--tier pr|release`；用 `yq` 解析 contract，按 tier 选条目（pr=P0/P1 子集，release=全集），逐条跑 `test_command`；任一失败 `exit 1`；引用文件不存在 `exit 1`（不静默）；**空契约守卫**：release tier 选出 0 条 → `exit 1`。
3. **`ci.yml` 新增 `core-regression` job** — **无 `if` 路径门**（永远跑）。两档：PR 事件跑 `--tier pr`；push 到 main（复用 `|| github.ref=='refs/heads/main'` 先例）跑 `--tier release`。接入 `ci-passed` 汇总（永远真跑，不会 skipped）。
4. **删除/改造 `regression-smoke`（ci.yml:716）** — 删掉假绿灯，或改成真正 `run-core-regression.sh` 消费 contract。

## 数据流
`regression-contract.yaml` → `run-core-regression.sh --tier X` → 逐条 `test_command` → job 退出码 → `ci-passed`。

## 错误处理
- yq 解析失败 → `exit 1`（报错，不静默）
- `test_command` 引用文件不存在 → `exit 1`
- release tier 选出 0 条（空契约）→ `exit 1`（防退化成假绿灯）

## 测试策略（TDD）
- **unit（bash）**：`run-core-regression.sh` 对 fixture contract 的行为——正常全绿 exit 0 / 某条 fail → exit 1 / 空 release 集 → exit 1 / 引用缺失文件 → exit 1。
- **静态断言（node -e / grep，CI 兼容）**：`ci.yml` 的 core-regression job 无 `workspace==` 路径门 if、含 `refs/heads/main` release 档；`regression-smoke` 不再扫空的 `*.golden-smoke.test.ts`；`regression-contract.yaml` 非空含 ≥1 golden_path。
- 均为逻辑接缝 → CI regression test 即守卫，proven-to-fire：先写红。

## 不包含
A1 动态加载 / A3 自动 promotion / CS 专属 test（跨 ZenithJoy）/ 真机 tests/rog。

## invariant（enforce）
真环境验证才算done；测试默认多租户；禁止写死环境假设值；端点鉴权。
