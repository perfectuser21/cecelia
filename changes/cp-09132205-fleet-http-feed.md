## Brain {VERSION} — fleet 容量喂数改 worker HTTP，自动派发解堵

- fix(brain): fleet-resource-cache 采集从 ssh/isLocal 改为 fleet-worker :5231 /health HTTP（machine-registry 解析地址）——旧 isLocal 路径在 Brain 迁 us-vps 后把 VPS 被邻居顶高的压力记在 us-mac-m4 头上致 effectiveSlots=0
- fix(brain): slot-allocator 调度器模式（CECELIA_LOCAL_EXECUTION_ENABLED=false）派发容量改取 fleet worker 聚合 getTotalEffectiveSlots；执行机模式保持本机来源零变化——终结 tick 恒 pool_c_full 永不自动派发
