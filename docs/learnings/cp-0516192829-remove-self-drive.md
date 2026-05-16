# 永久删除 SelfDrive 自驱引擎

## 问题描述

SelfDrive 每次 Brain 重启就自动回来——根源是 `capability-probe.js` 的 `probeSelfDriveHealth` 函数检测到 loop 没在跑，触发 self-heal 重启 loop。用户决定彻底删除该功能。

### 根本原因

SelfDrive 设计了三重自愈机制（server 启动 → probe 检测 → consciousness guard 守护），导致任何人工停止都会被系统自动拉起。无法通过运行时操作永久停用。

### 下次预防

- [ ] 新增"可关闭"功能时，必须提供 feature flag（brain_config 表的 enabled 字段）作为永久禁用开关
- [ ] 带 self-heal 的功能必须先检查 enabled flag，再决定是否重启
- [ ] probe 探针的 self-heal 逻辑需要 bypass 开关，不能无条件拉起
