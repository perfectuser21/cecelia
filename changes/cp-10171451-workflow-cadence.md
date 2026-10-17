## Brain {VERSION} — Workflow Commander 使用独立调度周期

- 将原 `workflow-commander-dispatch` 接入现有 completion 循环，独立每 60 秒运行；慢串行巡检不再延迟其首轮和后续调度，活性声明同步为 60 秒。
- 复用原 completion 的真实执行与哨兵写回互斥：观察超时或 stop/start 不会重发仍未结束的同一个 job。派发资格、设备锁、收割顺序、批量和预算保持原实现。
- 调度回归覆盖慢串行等待、60 秒节奏和未知执行防重入；源码测试不代表获客 104 已发送或手机业务验收通过。
