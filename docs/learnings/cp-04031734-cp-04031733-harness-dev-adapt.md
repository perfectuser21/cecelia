## /dev Harness v2.0 适配（2026-04-03）

### 根本原因
Harness v2.0 Sprint 循环需要 /dev 在 harness_mode 下简化流程：Generator 只写代码+创建PR，Evaluator 独立验证。现有 4-Stage Pipeline 的 DoD 验证、CI 等待、Learning 写入步骤在 harness 模式下多余。

### 下次预防
- [ ] 新模式引入时，列清所有受影响的 checkpoint（devloop-check / stop-dev / step 文件），一次改完
- [ ] harness_mode 标记放在 .dev-mode 中（非 task payload），方便 shell 脚本直接读取，无需调 Brain API
