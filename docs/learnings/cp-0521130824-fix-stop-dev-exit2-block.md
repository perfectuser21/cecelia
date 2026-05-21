# Learning: stop-dev.sh exit 2 修复

**分支**: cp-0521130824-fix-stop-dev-exit2-block  
**日期**: 2026-05-21

### 根本原因

v24 引入"单一出口纪律"重构，将所有散点 exit 0 收拢到文件末尾一个 `exit 0`。
该重构将 block 分支原有的 `exit 2` 也改成了 `exit 0`，
导致 stop.sh 路由永远 fall-through（case 0|99），
Claude Code 永远收不到 exit 2 的 block 信号，每次 stop hook 都放行。

**现象**：PR 提交后 CI 开始跑，stop hook 应 block 等 CI，但实际立即 X0 退出，用户必须手动等待。

### 下次预防

- [ ] 任何"单一出口重构"前，必须检查每个分支的 exit code 语义是否不同
- [ ] block/release 路径的 exit code 是 stop.sh 路由的唯一信号，修改时必须对照 stop.sh case 表
- [ ] 新增 `stop-dev-exit-code.test.sh` 集成测试防止同类回归
- [ ] 对比其他 hook（stop-architect.sh / stop-decomp.sh）确认一致性
