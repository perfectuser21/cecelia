## engine cleanup — 删死文件、ORPHAN 标记、幽灵测试引用（2026-04-04）

### 根本原因
engine 从 v13.x 升到 v14.x 过程中遗留了 3 类垃圾：
1. `regression-contract.yaml.bak` — v13.7.5 备份文件，untracked，长期未清理
2. `execution-logger.sh` — 有完整函数定义但无任何 source 调用方（hook-contracts.test.ts 只测文件存在性，不测功能），属于孤儿模块
3. `regression-contract.yaml` 中 27 行 `test:` 引用 — 指向 7 个已删除的测试文件，造成 CI 回归契约误判

### 下次预防
- [ ] 删除测试文件时同步清理 regression-contract.yaml 中对应的 `test:` 行，不留幽灵引用
- [ ] 版本 bump 时顺手检查 `.bak`/`.old`/`.backup` 文件是否可以一并清理
- [ ] 新增 sh 工具函数前确认有实际调用方；若只是预留接口需在文件顶部注明 ORPHAN 状态
