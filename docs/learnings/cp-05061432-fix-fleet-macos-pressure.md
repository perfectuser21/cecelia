# Learning: cp-05061432-fix-fleet-macos-pressure

## 事件

`fleet-resource-cache.js` 用 `(totalMem - freeMem) / totalMem` 当 macOS 内存压力指标，导致美国本机 `effective_slots` 长期为 0。Dispatcher 因此从不派任何需要本机的 dev task，包括"修这个 bug 本身的 dev task"——形成 **bootstrap 死锁**。

实测：旧算法报 99.5% used，macOS 官方 `memory_pressure` 命令报 45% used。差 54.5 个百分点。

## 根本原因

跨平台内存语义假设错误：
- **Linux**：`free` 是真 free，`(total - free) / total` 反映真实压力
- **macOS**：`os.freemem()` 只返 vm_stat 的 "Pages free"，不含 inactive + compressor。系统主动用满 RAM 做 cache/compress，inactive + compressor 是"伪占用"——新进程要内存时随时让位
- 用 Linux 思维算 macOS 压力，必然系统性误读

更深的问题：`fleet-resource-cache` 这种"调度核心"模块的指标可信度从未被 sanity check 过。`effective_slots = 0 持续 N 天` 这种异常状态没有任何告警，也没有 CI 防护。

## 下次预防

- [ ] **跨平台指标必须分平台实现**：任何"系统压力 / 资源使用"指标，darwin / linux / windows 必须各自走专属采集路径，不能假设 Node.js 标准 API 跨平台等价
- [ ] **调度核心指标加 sanity 告警**：`effective_slots == 0` 持续超过 N 分钟应该触发 P0 告警（Bark/Feishu）
- [ ] **Walking Skeleton 视角**：本次属于 MJ4 Cecelia 自主神经闭环 Step "Tick Loop 任务自驾"的一段加厚任务，应该被显式纳入 Feature 加厚计划
- [ ] **加厚要先减肥**：本 PR 没有"旧 thin 实现要替换"——属于 0→thin（新建函数），但未来加厚（比如改用 host_statistics64 syscall）必须先删 `memory_pressure` 命令调用再写新实现
- [ ] **CI 没法测真机器压力**：本 PR 单测 mock execSync 输出验证逻辑；真机器 effective_slots 验证只能 merge 后部署 + curl capacity-budget。未来类似"调度核心指标"修复应有"灰度部署 + 验证"checklist
