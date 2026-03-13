### [2026-03-13] 并行测试-CC：新增 format-duration.sh 工具函数

**失败统计**：CI 失败 1 次（L2 版本检查），本地测试失败 0 次

#### 根本原因

`packages/engine/lib/` 目录下新增文件时，仍然需要 Engine 版本 bump（6 个文件同步）。
之前的记忆是 "lib/ 不在 CORE_PATHS 里，不需要 [CONFIG] tag 或 Impact Check"，
但这不意味着不需要版本 bump——Version Check 检查的是 package.json 版本，任何 engine 改动都触发。

#### 下次预防

- [ ] 任何 `packages/engine/` 下的改动（包括 lib/）都需要 Engine 版本 bump 6 文件
- [ ] lib/ 改动不需要 [CONFIG] tag 或 feature-registry.yml 更新
- [ ] 版本 bump 口诀：`package.json + package-lock.json(engine) + 根 package-lock.json(engine) + VERSION + .hook-core-version + regression-contract.yaml`

**影响程度**: Low（1 次 CI 失败，根因清晰，秒级修复）

**并行测试发现的额外问题**（Codex 侧）：

- `runner.sh` 中 `--cwd` flag 不被当前 codex-bin 版本支持（需改为 `cd` 方式）
- `--sandbox full-access` → 正确值为 `danger-full-access`
- `codex-bin exec` 需要 `CODEX_HOME` 环境变量指向账号认证目录
- 西安 Mac 未安装 `gh` CLI（已补充安装 + 配置认证）

这些是 runner.sh 对 codex-bin API 的兼容性问题，需要通过 /dev 修复 runner.sh。
