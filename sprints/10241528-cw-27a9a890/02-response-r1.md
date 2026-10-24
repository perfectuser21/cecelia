### R-1
处理: 采纳
说明: Q-5 已改为发布前 verify 当时现场的验收，并要求预览 QA 只查阅该阶段真实记录，不对已发布 HEAD 重施 manifest 零差异。Q-6 对预览 QA 当前 HEAD 独立执行固定基线的完整 DAG、全仓差异与未跟踪文件检查，同时核验 README 原字节保留、合法来源增量及可信同步归属。用户看到的结果是合规 publish 来源登记不会被误判为越界；验证时分别核对发布前零差异记录和发布后当前 HEAD 的增量。依据：`lib/qa-gate.mjs` 的 `qaRound`（第 342–369 行）在 PR worktree 检出当前 head 后启动 evaluate；I-4 将零差异限定为发布前 verify。
