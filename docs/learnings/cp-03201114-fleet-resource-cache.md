# Learning: Fleet Resource Cache — Brain 全局资源感知

## 概要
Brain 的 slot-allocator 只看美国本机 CPU/内存，完全不知道西安两台 Mac mini 的状态。infra-status API 能采集所有设备但数据完全孤立，不被调度使用。

### 根本原因
slot-allocator 和 executor 在设计时只考虑单机场景。infra-status 是后来加的可观测性功能，没有与调度层打通。导致西安 Codex Bridge 5 个账号完全空闲。

### 下次预防
- [ ] 新增硬件资源时，同步更新 COMPUTE_SERVERS 列表
- [ ] 调度相关的决策不能只看 localhost，必须查 fleet cache
- [ ] fleet cache 采集失败要有告警（目前只 console.log）
