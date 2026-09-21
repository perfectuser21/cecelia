## Brain {VERSION} — fleet-worker 冷探测超时与真离线分类区分（准入侧收尾）

- `capability-gate` 的 `NODE_ADMISSION_SIGNATURES` 纳入 `node_probe_timeout`：Worker
  冷启动 /health 探测（4–6s）超出单次准入往返时，`production-probes.admittedNode`
  已产出 `node_probe_timeout` 信号（区别于真离线的 `machine_offline`），但此前准入门
  未识别该信号，fallback_reason 被压平。收尾后探测超时以独立信号落到 fallback_reason，
  可进短时基础设施 backoff（1–2 分钟自愈）而非等同硬离线判死。
