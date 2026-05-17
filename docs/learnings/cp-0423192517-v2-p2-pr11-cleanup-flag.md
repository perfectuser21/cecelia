## v2 P2 PR11 清 SPAWN_V2_ENABLED flag（2026-04-23）

### 根本原因

v2 P2 最后一个 PR。删 spawn.js 的 SPAWN_V2_ENABLED flag 和两条等价分支——这个 flag 是 PR1 预留的灰度开关，当时想着后续 PR 接入 middleware 时出事可以 `SPAWN_V2_ENABLED=false` 回滚。

但实际 PR2-10 的接线方式是"直接在 executeInDocker 里调 middleware"（不是在 spawn.js 里分叉），所以 SPAWN_V2_ENABLED flag 从始至终两条分支就是等价的（都 `return executeInDocker(opts)`）。flag 从来没起过实际作用，留着就是死代码。

现在 9 个 middleware 全部建立、5 处已接线（account-rotation/cascade/docker-run/resource-tier re-export），剩余 4 个外层 middleware 待未来 attempt-loop 整合 PR 接入。PR11 清掉 flag + 更新 spawn.js JSDoc + 更新 README 状态。

P2 完成：11 PR 连续合并（#2543-#2555），Spawn Policy Layer 架构落地。

### 下次预防

- [ ] **灰度 flag 要在真分叉代码路径里才有意义**：PR1 的 SPAWN_V2_ENABLED 是"预留位"，两条分支从头到尾等价——本质是死代码。下次设计 flag 时要明确"这 flag 决定**什么代码路径**"，不要预留空 flag
- [ ] **P2 所有 middleware 都是独立模块 + 未强接线**：这是刻意的设计——模块独立、测试独立、commit 独立，风险可控。整合由未来单独 PR 做（spec §5.2 attempt-loop 真 for 循环）。P2 是"地基 + 空房子"，attempt-loop 整合 PR 是"装修入住"
- [ ] **P2 一共 48 个 middleware test cases**：smoke(4) + docker-run(4) + account-rotation(7) + cascade(5) + cap-marking(6) + retry-circuit(13) + resource-tier(8) + spawn-pre(5) + logging(4) + cost-cap(5) + billing(5) = 66 cases 覆盖 9 个 middleware。这是 middleware 层健康的证据
