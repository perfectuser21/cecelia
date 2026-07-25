# Contract Draft — One Session 编排门循环与 CI 合同闸 hotfix

## Golden Path

1. 已批准合同的 `## Test Contract` 表只要显式标出 `Test File` 与 `BEHAVIOR 覆盖` 表头，即使列序调整，覆盖检查也能正确解析并定位到真实测试文件。
2. open PR 的 CI 运行 `test-pyramid-guard` / `ratchet-guard` 时，只忽略本 PR 当前 diff 命中的 sprint 目录；其他 sprint 仍按 baseline 记入 orphan 统计。
3. Harness v5 sprint tests 与 `dod-behavior-dynamic` 在 GitHub Actions 中使用 `cecelia_test` + `CI_DB_PASSWORD`，并把 `DB_*`/`PG*` 环境透传到 `vitest` / `psql` / `bash -c` 子进程。

## 约束

- 不改 PR #4336 的合同、DoD、测试文件。
- 不把 PR 阶段 orphan 豁免扩展到仓库全部 sprint，只限当前 PR diff 命中的 sprint 目录。
- 不把缺密码降级成空串回退，不把数据库失败吞成 PASS。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Test Contract parser | `packages/engine/scripts/devgate/check-test-coverage.cjs` | 列序调整后仍能识别 Test File 与 BEHAVIOR 覆盖 | 旧实现只按固定第 2/3 列取值，#4336 直接报“表为空” |
| Test pyramid guard | `scripts/test-pyramid-guard.mjs` | PR 场景忽略当前 diff 命中的 sprint 目录，非 PR 保持原闸 | 旧实现对 open PR 新增 sprint 测试直接计入 orphan，和毕业时序冲突 |
| Harness v5 CI wiring | `.github/workflows/harness-v5-checks.yml` | Sprint Tests 实跑透传 DB/PG 环境并使用 `cecelia_test` | 旧实现缺完整环境，日志出现 `role \"root\" does not exist` |
| Dynamic DoD CI wiring | `.github/workflows/ci.yml` | DoD 动态命令透传 DB/PG 环境 | 旧实现子命令可能回退 root / 空密码 |

## E2E 验收

1. 直接构造最小合同，表头使用 `功能 | BEHAVIOR 覆盖 | Test File | 预期红证据`，运行 `node packages/engine/scripts/devgate/check-test-coverage.cjs <contract>`，应返回 0。
2. 运行 `bash scripts/__tests__/test-pyramid-guard.test.sh`，其中 PR 场景 fixture 应明确通过，A1/A2/A3 红况仍保持 proven-to-fire。
3. 静态检查 `.github/workflows/harness-v5-checks.yml` 与 `.github/workflows/ci.yml`，确认 DB/PG 环境变量与 `cecelia_test` 接线存在。
