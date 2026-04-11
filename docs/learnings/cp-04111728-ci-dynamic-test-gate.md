# Dynamic Test Gate — CI 强制动态测试门禁（2026-04-11）

### 根本原因

改动 hooks/ 和 lib/ 的 Shell 脚本时，测试可以只用 `readFileSync + toContain` 静态检查通过，
但不能捕获脚本实际执行时的行为错误。纯静态检查无法替代真实执行验证。

### 下次预防
- [ ] 改动 `packages/engine/hooks/*.sh` 或 `lib/*.sh` 时，测试必须包含 `execSync/spawnSync`（真实执行脚本）
- [ ] CI `engine-tests` job 新增 Dynamic Test Gate step，自动拦截纯静态测试
- [ ] `check-dynamic-tests.sh` 作为 CI 守门员，改了 hook/lib 必须有对应动态测试变更
