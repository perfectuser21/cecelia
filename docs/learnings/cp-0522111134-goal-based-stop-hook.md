## Goal-Based Stop Hook（2026-05-22）

### 根本原因

Cecelia stop hook 体系（stop-dev.sh + guardian + devloop-check + ship-finalize）存在结构性问题：
- 被动等待：PR 推完后 session 在空转中等待
- 状态外置：依赖文件系统 .cecelia/lights/ 跨 session 传递状态，崩溃后难恢复
- session ID 错位：无头模式下 session ID 不一致导致灯文件找不到
- 维护负担：stop-dev.sh 229 行，devloop-check.sh 559 行，25+ 测试文件

### 下次预防

- [ ] 用 Claude Code 官方 `--settings` 注入 prompt-based stop hook（Haiku 评估目标条件）
- [ ] executor.js 通过 task.goal_condition 或 HARNESS_GOAL_CONDITIONS 生成 --settings JSON
- [ ] cecelia-bridge.js 必须特殊处理含 JSON 的 env var（单引号包裹，不 strip 引号）
- [ ] cecelia-run.sh 通过临时文件传递 JSON 给 --settings，避免 bash -c 字符串中的引号地狱
- [ ] 删除 stop hook 文件时，必须同步更新 e2e-integrity-check.sh 中对应的文件存在性检测
- [ ] codex runner 等依赖 devloop-check.sh 的文件需要一并清理
