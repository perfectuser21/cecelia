## CI Gate — manual: 命令白名单本地前置拦截（2026-03-23）

### 根本原因

manual: 命令只有到 CI L1 才被拒绝，本地 verify-step.sh 无检查。
用户写了 `Test: manual:grep pattern file` 本地通过，push 后 CI 失败，
反复 push→失败→修改的循环。

### 下次预防

- [ ] 新的 CI 检查规则，本地 verify-step.sh 必须同步实现本地版本
- [ ] 共享脚本（.cjs）导出核心函数供测试 import，避免 spawnSync 覆盖率 0% 陷阱
- [ ] verify-step.sh 中找脚本路径用多路径 fallback（相对路径 + PROJECT_ROOT 路径）
