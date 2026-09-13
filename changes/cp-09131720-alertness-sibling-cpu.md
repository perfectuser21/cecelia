## Brain {VERSION} — alertness CPU 指标邻居负载免疫

- fix(brain): alertness collectCPUMetric 从全机 loadavg 改为 Brain 自身进程 CPU（PR#5290 executor 同病同修）——修复 us-vps 上 openclaw 邻居把 loadavg 顶高导致 Escalation 误升 emergency_brake+safe_mode 把调度器自己刹停；全机压力保留为 system_pressure_pct 观测字段
