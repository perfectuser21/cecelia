## Brain {VERSION} — 守卫阈值校正+泄漏甄别观测线（escort 误伤案）

- 内存阈值 1400→2000（env OPENCLAW_MEM_LIMIT_MB 可调）：旧值低于网关多会话正常工作态（1.4-1.7G），一天误摁 9 次打断在跑 escort；容器硬顶同步在线抬 2.29G
- 新增 memlog 观测线（每轮记 mem/会话数/node 进程数）：真泄漏判据=会话归零后不回落，替代此前的体温误诊
